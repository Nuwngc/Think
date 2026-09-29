import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { api } from "../api";
import { newGame, place, validState, type BlocksState, type PlaceResult } from "./engine";
import { setBlockSound } from "./sound";
import type { BlocksBoard, PendingScore } from "./types";

// Dữ liệu game Xếp Khối trong app: ván đang chơi, kỷ lục, các ván chờ gửi lên bảng xếp hạng (chơi lúc mất mạng),
// bảng xếp hạng lần tải gần nhất. Tất cả lưu trên máy nên mở app không có mạng vẫn chơi tiếp được.

const KEY = {
  game: "think.blocks.game",
  best: "think.blocks.best",
  pending: "think.blocks.pending",
  sound: "think.blocks.sound",
  board: "think.blocks.board",
};

type State = {
  loaded: boolean;
  game: BlocksState | null;
  /** Kỷ lục theo người dùng ("local" = chơi khi chưa đăng nhập) */
  bests: Record<string, number>;
  pending: PendingScore[];
  board: (BlocksBoard & { uid: number; fetchedAt: number }) | null;
  sound: boolean;
  syncing: boolean;
  syncError: boolean;
  /** Mở game từ màn đăng nhập / màn chờ máy chủ (chưa vào app) */
  standalone: boolean;
};

export const useBlocks = create<State>(() => ({
  loaded: false,
  game: null,
  bests: {},
  pending: [],
  board: null,
  sound: true,
  syncing: false,
  syncError: false,
  standalone: false,
}));

const get = useBlocks.getState;
const set = useBlocks.setState;

type Hooks = { meId: () => number | null; online: () => boolean; toast: (text: string) => void };
let hooks: Hooks = { meId: () => null, online: () => false, toast: () => undefined };
/** src/store.ts gắn vào: người đang đăng nhập, có mạng không, thông báo nhỏ */
export function bindBlocks(h: Hooks) {
  hooks = h;
}

const save = (key: string, value: unknown) => {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
};

let loading: Promise<void> | null = null;
/** Đọc dữ liệu đã lưu (một lần) */
export function loadBlocks() {
  if (!loading) {
    loading = (async () => {
      try {
        const [game, best, pending, sound, board] = await Promise.all(
          [KEY.game, KEY.best, KEY.pending, KEY.sound, KEY.board].map((k) => AsyncStorage.getItem(k)),
        );
        const parse = (raw: string | null) => {
          try {
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        };
        const g = parse(game);
        const snd = parse(sound);
        set({
          game: validState(g) && !g.over ? g : null,
          bests: parse(best) || {},
          pending: Array.isArray(parse(pending)) ? parse(pending) : [],
          sound: snd !== false,
          board: parse(board),
          loaded: true,
        });
        setBlockSound(snd !== false);
      } catch {
        set({ loaded: true });
      }
    })();
  }
  return loading;
}

const bestKey = (uid: number | null) => (uid == null ? "local" : String(uid));

export function localBest(s: Pick<State, "bests">, uid: number | null) {
  return Math.max(Number(s.bests[bestKey(uid)]) || 0, uid != null ? Number(s.bests.local) || 0 : 0);
}

function setBest(uid: number | null, score: number) {
  const k = bestKey(uid);
  const bests = get().bests;
  if (!(score > (Number(bests[k]) || 0))) return;
  const next = { ...bests, [k]: score };
  set({ bests: next });
  save(KEY.best, next);
}

/** Ván chơi lúc chưa đăng nhập tính cho người đăng nhập tiếp theo trên máy này */
export const pendingFor = (s: Pick<State, "pending">, uid: number | null) => s.pending.filter((p) => p.uid == null || p.uid === uid);

export function setSound(on: boolean) {
  set({ sound: on });
  setBlockSound(on);
  save(KEY.sound, on);
}

/** Ván mới (ván cũ chưa xong thì bỏ, không tính điểm) */
export function startGame() {
  const game = newGame();
  set({ game });
  save(KEY.game, game);
  return game;
}

/** Ván đang chơi, hoặc ván mới nếu chưa có */
export function ensureGame() {
  const g = get().game;
  if (g && !g.over) return g;
  return startGame();
}

/** Đặt khối; hết ván thì ghi điểm ngay. Trả về chuyện vừa xảy ra để giao diện vẽ hiệu ứng. */
export function placePiece(slot: number, r: number, c: number): (PlaceResult & { record?: { record: boolean; best: number } | null }) | null {
  const g = get().game;
  if (!g) return null;
  const res = place(g, slot, r, c);
  if (!res) return null;
  set({ game: res.state });
  if (res.over) return { ...res, record: recordGame() };
  save(KEY.game, res.state);
  return res;
}

/** Ghi điểm ván vừa hết (vào hàng chờ gửi lên máy chủ) */
export function recordGame() {
  const g = get().game;
  if (!g || !g.over || g.recorded) return null;
  const uid = hooks.meId();
  const before = localBest(get(), uid);
  const recorded = { ...g, recorded: true };
  set({ game: recorded });
  if (g.moves > 0) {
    const entry: PendingScore = {
      id: g.id,
      score: g.score,
      moves: g.moves,
      lines: g.lines,
      durationMs: Math.min(Date.now() - g.startedAt, 7 * 86400000),
      playedAt: Date.now(),
      uid,
    };
    const pending = [...get().pending.filter((p) => p.id !== g.id), entry].slice(-200);
    set({ pending });
    save(KEY.pending, pending);
    setBest(uid, g.score);
  }
  AsyncStorage.removeItem(KEY.game).catch(() => undefined);
  sync();
  return { record: g.score > before && g.score > 0, best: Math.max(before, g.score) };
}

let syncing: Promise<void> | null = null;
/** Gửi các ván chờ lên máy chủ và tải bảng xếp hạng (đọc xong dữ liệu trên máy rồi mới gửi) */
export function sync(): Promise<void> {
  const uid = hooks.meId();
  if (uid == null || syncing) return syncing || Promise.resolve();
  syncing = (async () => {
    set({ syncing: true });
    try {
      await loadBlocks(); // hàng chờ và kỷ lục đã lưu phải có trước, không thì gửi thiếu / ghi đè mất kỷ lục
      const list = pendingFor(get(), uid);
      let data: BlocksBoard & { accepted?: string[]; rejected?: { id: string }[] };
      if (list.length) {
        data = await api.blocksSubmit(list.slice(0, 50).map(({ uid: _u, ...s }) => s));
        const done = new Set([...(data.accepted || []), ...(data.rejected || []).map((r) => r.id)]);
        const pending = get().pending.filter((p) => !done.has(p.id));
        set({ pending });
        save(KEY.pending, pending);
      } else {
        data = await api.blocks();
      }
      const board = { game: data.game, weekStart: data.weekStart, me: data.me, leaderboard: data.leaderboard, uid, fetchedAt: Date.now() };
      set({ board, syncError: false });
      save(KEY.board, board);
      if (data.me) setBest(uid, data.me.best);
    } catch {
      set({ syncError: true });
    } finally {
      set({ syncing: false });
      syncing = null;
    }
    if (pendingFor(get(), uid).length && !get().syncError) setTimeout(sync, 500);
  })();
  return syncing;
}

/** Có người vừa lập kỷ lục (sự kiện realtime) */
export function onScoreEvent(data: { game?: string; userId?: number; name?: string; best?: number; rank?: number | null; newLeader?: boolean }) {
  if (!data || data.game !== "blocks") return;
  // Chỉ báo khi có người mới vượt lên số 1
  if (data.userId !== hooks.meId() && data.newLeader) {
    hooks.toast(`🏆 ${data.name || "Ai đó"} vừa đứng đầu Xếp Khối với ${Number(data.best || 0).toLocaleString("vi-VN")} điểm!`);
  }
  sync();
}

export function openStandalone(on: boolean) {
  set({ standalone: on });
}

/** Đăng xuất: bỏ bảng xếp hạng của người cũ (ván đang chơi và ván chờ gửi vẫn giữ) */
export function resetBlocksBoard() {
  set({ board: null });
  AsyncStorage.removeItem(KEY.board).catch(() => undefined);
}

/** Tóm tắt cho trang Trò chơi */
export function blocksSummary(s: State, uid: number | null) {
  const board = s.board && s.board.uid === uid ? s.board : null;
  return {
    best: Math.max(localBest(s, uid), board?.me.best || 0),
    rank: board?.me.rank ?? null,
    weekRank: board?.me.weekRank ?? null,
    pending: pendingFor(s, uid).length,
    playing: s.game && !s.game.over && s.game.moves > 0 ? s.game.score : null,
    top: board ? board.leaderboard.week.slice(0, 3) : [],
  };
}
