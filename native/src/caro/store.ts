import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { api, ApiError } from "../api";
import { bestMove, CELLS, fromMoves, LEVELS, play, RULES, turnAfter, type CaroState, type Level, type Rule } from "./engine";
import { otherSide, playerOf, ruleLabel, sideNum, sideOf, turnLabel } from "./format";
import { setCaroSound } from "./sound";
import type { BotGame, BotPrefs, BotRecord, BotStats, CaroGame, CaroOptions, CaroRating, Side } from "./types";

// Dữ liệu cờ caro trong app.
// - Ván với bạn bè: máy chủ giữ luật và đồng hồ (src/caro.js); realtime và thông báo nhỏ nối ở src/store.ts qua bindCaro().
// - Ván với máy: chạy hẳn trên điện thoại (không cần mạng), lưu trong máy để mở lại chơi tiếp.

const KEY = {
  bot: "think.caro.bot",
  stats: "think.caro.botStats",
  prefs: "think.caro.botPrefs",
  sound: "think.caro.sound",
};

type State = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  games: Record<number, CaroGame>;
  /** Giờ máy chủ trừ giờ trên máy lúc nhận ván (để chạy đồng hồ mỗi nước cho đúng) */
  offsets: Record<number, number>;
  me: CaroRating | null;
  leaderboard: CaroRating[] | null;
  options: CaroOptions;
  /** Ván với bạn bè đang mở toàn màn hình */
  openId: number | null;
  /** Đang gửi nước đi của ván nào */
  sending: Record<number, boolean>;
  /** Đã đọc xong dữ liệu lưu trên máy (ván với máy, thành tích, âm thanh) */
  localLoaded: boolean;
  bot: BotGame | null;
  /** Đang mở màn chơi với máy */
  botOpen: boolean;
  /** Máy đang nghĩ nước đi */
  thinking: boolean;
  /** Thành tích với máy theo người dùng ("local" = chơi khi chưa đăng nhập) */
  stats: Record<string, Partial<Record<Level, BotRecord>>>;
  prefs: BotPrefs;
  sound: boolean;
};

const DEFAULT_OPTIONS: CaroOptions = { turnSeconds: [0, 15, 30, 60, 120], rules: ["free", "block2"] };
const DEFAULT_PREFS: BotPrefs = { level: "medium", side: "x", rule: "free" };

export const useCaro = create<State>(() => ({
  loaded: false,
  loading: false,
  error: null,
  games: {},
  offsets: {},
  me: null,
  leaderboard: null,
  options: DEFAULT_OPTIONS,
  openId: null,
  sending: {},
  localLoaded: false,
  bot: null,
  botOpen: false,
  thinking: false,
  stats: {},
  prefs: DEFAULT_PREFS,
  sound: true,
}));

const get = useCaro.getState;
const set = useCaro.setState;

type Bridge = {
  /** Đã đóng ván đang mở (để màn chính quên chỗ quay về) */
  closed?: () => void;
  /** Người đang đăng nhập (0 = chưa đăng nhập) */
  meId: () => number;
  nameOf: (id: number | null | undefined) => string;
  toast: (text: string, extra?: { title?: string; senderId?: number; caroGameId?: number }) => void;
  /** Đang xem trang Cờ caro (không mở ván nào) và app đang mở */
  onCaro: () => boolean;
  /** Vừa đi một nước với máy (chuỗi hằng ngày, src/streaks/store.ts) */
  played?: () => void;
};

let bridge: Bridge = {
  meId: () => 0,
  nameOf: () => "Người dùng",
  toast: () => undefined,
  onCaro: () => false,
};

export function bindCaro(b: Bridge) {
  bridge = b;
}

const save = (key: string, value: unknown) => {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
};

/** Đăng xuất: bỏ dữ liệu ván với bạn bè (ván với máy và thành tích vẫn giữ trên máy) */
export function resetCaro() {
  loadAgain = false;
  touched.clear();
  closeBot();
  set({ loaded: false, loading: false, error: null, games: {}, offsets: {}, me: null, leaderboard: null, openId: null, sending: {} });
}

/* =========================================================
   Ván với bạn bè
   ========================================================= */

/** Thứ tự trạng thái của một ván: lời thách đấu → đang chơi → đã xong. Không bao giờ lùi lại. */
const stageOf = (g: CaroGame) => (g.status === "challenge" ? 0 : g.status === "active" ? 1 : 2);

function upsert(list: CaroGame[]) {
  const now = Date.now();
  set((s) => {
    const games = { ...s.games };
    const offsets = { ...s.offsets };
    for (const g of list) {
      if (!g || !Number.isInteger(g.id)) continue;
      const prev = games[g.id];
      if (prev) {
        // Bản cũ đến trễ (phản hồi của lần tải đang dở, sự kiện đến không theo thứ tự): bỏ qua
        if (stageOf(g) < stageOf(prev)) continue;
        if (g.status === "active" && prev.status === "active" && prev.moves.length > g.moves.length) continue;
      }
      games[g.id] = g;
      if (Number.isFinite(g.serverTime)) offsets[g.id] = g.serverTime - now;
    }
    return { games, offsets };
  });
}

let loadAgain = false;
/** Ván có sự kiện realtime trong lúc đang tải danh sách (không được bỏ đi khi tải xong) */
const touched = new Set<number>();

/** Tải tổng quan: điểm, lời thách đấu, ván đang chơi, ván gần đây, bảng xếp hạng */
export async function loadCaro() {
  if (get().loading) {
    loadAgain = true; // có thay đổi trong lúc đang tải: tải thêm một lần nữa cho chắc
    return;
  }
  touched.clear();
  set({ loading: true });
  try {
    const data = await api.caro();
    const fresh = new Set(data.games.map((g) => g.id));
    set((s) => {
      // Bỏ các ván không còn trong danh sách (lời thách đấu đã hủy / hết hạn…), trừ ván đang mở
      const games: Record<number, CaroGame> = {};
      for (const g of Object.values(s.games)) if (fresh.has(g.id) || g.id === s.openId || touched.has(g.id)) games[g.id] = g;
      return {
        games,
        me: data.me,
        leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : [],
        options: data.options?.turnSeconds?.length ? data.options : s.options,
        loaded: true,
        error: null,
      };
    });
    upsert(data.games);
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Không tải được cờ caro." });
  } finally {
    touched.clear();
    set({ loading: false });
    if (loadAgain) {
      loadAgain = false;
      loadCaro();
    }
  }
}

/** Tải lại một ván */
export async function loadGameFresh(id: number) {
  try {
    const { game } = await api.caroGame(id);
    upsert([game]);
  } catch {
    /* thôi */
  }
}

export async function openGame(id: number) {
  cancelBotTimer();
  set({ openId: id, botOpen: false, thinking: false });
  if (get().games[id]) {
    loadGameFresh(id); // lấy bản mới nhất cho chắc (có thể vừa mất kết nối)
    return;
  }
  try {
    const { game } = await api.caroGame(id);
    upsert([game]);
  } catch (err) {
    if (get().openId === id) set({ openId: null });
    bridge.toast(err instanceof Error ? err.message : "Không mở được ván caro.");
  }
}

export function closeGame() {
  set({ openId: null });
  bridge.closed?.();
}

export async function sendChallenge(body: { opponentId: number; turnSeconds: number; rule: Rule; side: Side | "random"; rated: boolean }) {
  const { game } = await api.caroChallenge(body);
  upsert([game]);
  return game;
}

export async function answerChallenge(id: number, action: "accept" | "decline" | "cancel") {
  try {
    const { game } = await api.caroAnswer(id, action);
    upsert([game]);
    if (action === "accept" && game.status === "active") openGame(game.id);
    return game;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) loadCaro();
    bridge.toast(err instanceof Error ? err.message : "Chưa làm được.");
    return null;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gửi nước đi; mạng chập chờn thì gửi lại đúng nước đó (máy chủ nhận ra nước đã có, không đi hai lần) */
async function sendMove(id: number, index: number, ply: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.caroMove(id, index, ply);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 0 || attempt >= 2) throw err;
      await wait(800 * (attempt + 1));
    }
  }
}

/** Đi một nước: hiện ngay trên bàn, máy chủ từ chối thì trả lại như cũ và báo lỗi */
export async function playMove(id: number, index: number) {
  const g = get().games[id];
  const mine = g ? sideOf(g, bridge.meId()) : null;
  if (!g || g.status !== "active" || !mine || g.turn !== mine || get().sending[id]) return false;
  const state = fromMoves(g.moves, g.rule);
  if (state.winner || !play(state, index)) return false;
  const ply = g.moves.length;
  const now = Date.now();
  const serverNow = now + (get().offsets[id] ?? 0);
  // Đồng hồ chuyển sang đối thủ ngay, như máy chủ sẽ làm
  const optimistic: CaroGame = { ...g, moves: [...g.moves, index], turn: otherSide(g.turn), turnStartedAt: serverNow };
  set((s) => ({ games: { ...s.games, [id]: optimistic }, sending: { ...s.sending, [id]: true } }));
  try {
    const res = await sendMove(id, index, ply);
    upsert([res.game]);
    return true;
  } catch (err) {
    // Trả bàn về như trước (nếu chưa có bản mới hơn), rồi lấy bản của máy chủ
    set((s) => (s.games[id] === optimistic ? { games: { ...s.games, [id]: g } } : {}));
    loadGameFresh(id);
    if (!(err instanceof ApiError && err.status === 401)) bridge.toast(err instanceof Error ? err.message : "Chưa đi được nước này.");
    return false;
  } finally {
    set((s) => ({ sending: { ...s.sending, [id]: false } }));
  }
}

async function act(fn: () => Promise<{ game: CaroGame }>) {
  try {
    const { game } = await fn();
    upsert([game]);
    return game;
  } catch (err) {
    bridge.toast(err instanceof Error ? err.message : "Chưa làm được.");
    return null;
  }
}

/** Đầu hàng (chưa đủ 2 nước thì là hủy ván) */
export async function resign(id: number) {
  const game = await act(() => api.caroResign(id));
  if (game) loadCaro(); // cập nhật điểm
  return game;
}

/** Đấu lại: gửi lời thách đấu mới (đổi bên) rồi mở màn chờ nhận lời */
export async function rematch(id: number) {
  const game = await act(() => api.caroRematch(id));
  if (game) openGame(game.id);
  return game;
}

/* ---------------- Sự kiện realtime ---------------- */

export function onCaroEvent(event: "caro:game" | "caro:challenge", data: { game: CaroGame }) {
  const g = data?.game;
  if (!g || !Number.isInteger(g.id)) return;
  const me = bridge.meId();
  const prev = get().games[g.id];
  if (get().loading) touched.add(g.id);
  upsert([g]);
  if (get().games[g.id] !== g) return; // bản cũ đến trễ
  const open = get().openId === g.id;
  const mine = sideOf(g, me);
  const oppName = () => bridge.nameOf(mine ? playerOf(g, otherSide(mine)) : g.challengerId === me ? g.opponentId : g.challengerId);

  if (event === "caro:challenge") {
    if (g.status === "challenge" && g.opponentId === me && !prev) {
      bridge.toast(`${oppName()} thách bạn một ván caro (${turnLabel(g.turnMs).toLowerCase()}, luật ${ruleLabel(g.rule).toLowerCase()}). Chạm để xem.`, {
        title: "⭕ Thách đấu cờ caro",
        senderId: g.challengerId ?? undefined,
        caroGameId: g.id,
      });
    } else if (g.status === "declined" && g.challengerId === me && prev?.status === "challenge") {
      bridge.toast(`${oppName()} đã từ chối lời thách đấu cờ caro.`);
    }
    return;
  }

  // Lời thách đấu mình gửi vừa được nhận: vào ván luôn nếu đang ở trang Cờ caro
  if (g.status === "active" && prev?.status === "challenge" && g.challengerId === me && !open) {
    if (bridge.onCaro() && get().openId == null && !get().botOpen) openGame(g.id);
    else bridge.toast(`${oppName()} đã nhận lời. Chạm để vào chơi!`, { title: "⭕ Vào chơi caro thôi", caroGameId: g.id });
  }
  // Ván vừa kết thúc: cập nhật điểm
  if ((g.status === "finished" || g.status === "aborted") && prev?.status === "active") {
    loadCaro();
    if (!open && mine) bridge.toast("Một ván caro của bạn vừa kết thúc. Chạm để xem.", { caroGameId: g.id });
  }
  // Đối thủ vừa đi mà mình đang ở chỗ khác
  if (g.status === "active" && prev && prev.moves.length < g.moves.length && !open && mine && mine === g.turn) {
    bridge.toast(`${oppName()} vừa đi. Tới lượt bạn!`, { title: "⭕ Cờ caro", caroGameId: g.id });
  }
}

/** Số việc cần làm ở Cờ caro: lời thách đấu gửi tới mình + ván đang tới lượt mình */
export function caroBadge(s: Pick<State, "games">, meId: number) {
  let n = 0;
  for (const g of Object.values(s.games)) {
    if (g.status === "challenge" && g.opponentId === meId) n++;
    else if (g.status === "active" && sideOf(g, meId) === g.turn) n++;
  }
  return n;
}

/** Thời gian còn lại của nước đang đi (ms), null = không giới hạn */
export function turnLeft(g: CaroGame, offset: number, now = Date.now()) {
  if (g.status !== "active" || !g.turnMs || g.turnStartedAt == null) return null;
  return Math.max(0, g.turnStartedAt + g.turnMs - (now + offset));
}

/* =========================================================
   Ván với máy (chạy hẳn trên điện thoại)
   ========================================================= */

const isSide = (v: unknown): v is Side => v === "x" || v === "o";

export function validBot(g: any): g is BotGame {
  if (!g || typeof g !== "object" || g.v !== 1 || !LEVELS.includes(g.level) || !RULES.includes(g.rule) || !isSide(g.side)) return false;
  if (!Array.isArray(g.moves) || !g.moves.every((m: unknown) => Number.isInteger(m) && (m as number) >= 0 && (m as number) < CELLS)) return false;
  if (![null, "win", "loss", "draw"].includes(g.result ?? null)) return false;
  return fromMoves(g.moves, g.rule).moves.length === g.moves.length;
}

function validPrefs(p: any): BotPrefs {
  return {
    level: LEVELS.includes(p?.level) ? p.level : DEFAULT_PREFS.level,
    side: isSide(p?.side) || p?.side === "random" ? p.side : DEFAULT_PREFS.side,
    rule: RULES.includes(p?.rule) ? p.rule : DEFAULT_PREFS.rule,
  };
}

let localLoading: Promise<void> | null = null;
/** Đọc ván với máy, thành tích, lựa chọn và âm thanh đã lưu (một lần) */
export function loadLocal() {
  if (!localLoading) {
    localLoading = (async () => {
      const parse = (raw: string | null) => {
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      };
      try {
        const [bot, stats, prefs, sound] = await Promise.all([KEY.bot, KEY.stats, KEY.prefs, KEY.sound].map((k) => AsyncStorage.getItem(k)));
        const b = parse(bot);
        const st = parse(stats);
        const snd = parse(sound);
        set((s) => ({
          // Đã bắt đầu ván mới trong lúc đang đọc thì giữ ván mới
          bot: s.bot ?? (validBot(b) ? { ...b, result: b.result ?? null } : null),
          stats: st && typeof st === "object" ? { ...st, ...s.stats } : s.stats,
          prefs: validPrefs(parse(prefs)),
          sound: snd !== false,
          localLoaded: true,
        }));
        setCaroSound(snd !== false);
      } catch {
        set({ localLoaded: true });
      }
    })();
  }
  return localLoading;
}

export function setSound(on: boolean) {
  set({ sound: on });
  setCaroSound(on);
  save(KEY.sound, on);
}

const statKey = () => String(bridge.meId() || "local");

/** Thành tích với máy của người đang dùng máy này */
export function botStatsOf(s: Pick<State, "stats">, uid: number | null): BotStats {
  const mine = s.stats[String(uid || "local")] || {};
  const out = {} as BotStats;
  for (const k of LEVELS) {
    const r = mine[k] || ({} as Partial<BotRecord>);
    out[k] = { win: Number(r.win) || 0, loss: Number(r.loss) || 0, draw: Number(r.draw) || 0 };
  }
  return out;
}

function bumpStat(level: Level, result: "win" | "loss" | "draw", d: number) {
  const key = statKey();
  const all = { ...get().stats };
  const mine = { ...(all[key] || {}) };
  const r = { win: 0, loss: 0, draw: 0, ...(mine[level] || {}) };
  r[result] = Math.max(0, (Number(r[result]) || 0) + d);
  mine[level] = r;
  all[key] = mine;
  set({ stats: all });
  save(KEY.stats, all);
}

/** Kết quả ván với máy nhìn từ phía mình */
export function botResultOf(st: Pick<CaroState, "winner">, side: Side): BotGame["result"] {
  if (!st.winner) return null;
  if (st.winner === 3) return "draw";
  return st.winner === sideNum(side) ? "win" : "loss";
}

export const isMyBotTurn = (g: BotGame) => turnAfter(g.moves.length) === sideNum(g.side);

/** Còn nước của mình để đi lại không */
export const canUndo = (g: BotGame | null) => Boolean(g && g.moves.some((_, k) => turnAfter(k) === sideNum(g.side)));

let botTimer: ReturnType<typeof setTimeout> | null = null;
function cancelBotTimer() {
  if (botTimer) clearTimeout(botTimer);
  botTimer = null;
}

function applyBot(g: BotGame, next: CaroState) {
  const result = botResultOf(next, g.side);
  const updated: BotGame = { ...g, moves: next.moves, result, updatedAt: Date.now() };
  set({ bot: updated });
  save(KEY.bot, updated);
  if (result) bumpStat(g.level, result, 1);
  return updated;
}

/** Tới lượt máy: nghĩ một chút cho tự nhiên (vẽ bàn trước, tính sau) */
export function scheduleBot() {
  const g = get().bot;
  if (!g || g.result || botTimer || !get().botOpen || isMyBotTurn(g)) return;
  const st = fromMoves(g.moves, g.rule);
  if (st.winner) return;
  set({ thinking: true });
  const delay = g.moves.length === 0 ? 450 : 300 + Math.random() * 400;
  botTimer = setTimeout(() => {
    botTimer = null;
    if (get().bot !== g || !get().botOpen) {
      set({ thinking: false });
      return;
    }
    const next = play(st, bestMove(st, g.level));
    set({ thinking: false });
    if (next) applyBot(g, next);
  }, delay);
}

/** Ván mới với máy (ván cũ chưa xong thì bỏ) */
export function newBotGame(p: BotPrefs, rand: () => number = Math.random) {
  cancelBotTimer();
  const prefs = validPrefs(p);
  const side: Side = prefs.side === "random" ? (rand() < 0.5 ? "x" : "o") : prefs.side;
  const now = Date.now();
  const game: BotGame = { v: 1, id: now, level: prefs.level, side, pref: prefs.side, rule: prefs.rule, moves: [], result: null, startedAt: now, updatedAt: now };
  set({ bot: game, prefs, thinking: false });
  save(KEY.bot, game);
  save(KEY.prefs, prefs);
  scheduleBot();
  return game;
}

/** Mở màn chơi với máy: chơi tiếp ván đang lưu, chưa có thì tạo ván mới theo lựa chọn lần trước */
export async function openBot() {
  set({ botOpen: true, openId: null });
  await loadLocal();
  if (!get().botOpen) return;
  if (!get().bot) newBotGame(get().prefs);
  else scheduleBot();
}

export function closeBot() {
  cancelBotTimer();
  set({ botOpen: false, thinking: false });
}

/** Mình đi một nước trong ván với máy */
export function playBot(i: number) {
  const g = get().bot;
  if (!g || g.result || get().thinking || !isMyBotTurn(g)) return false;
  const next = play(fromMoves(g.moves, g.rule), i);
  if (!next) return false;
  applyBot(g, next);
  bridge.played?.();
  scheduleBot();
  return true;
}

/** Đi lại: bỏ nước trả lời của máy (nếu có) và nước gần nhất của mình */
export function undoBot() {
  const g = get().bot;
  if (!g || !canUndo(g)) return false;
  cancelBotTimer();
  // Ván đã tính thành tích: đi lại thì bỏ kết quả đó
  if (g.result) bumpStat(g.level, g.result, -1);
  const mineAt = (k: number) => turnAfter(k) === sideNum(g.side);
  const moves = g.moves.slice();
  while (moves.length && !mineAt(moves.length - 1)) moves.pop();
  if (moves.length) moves.pop();
  const updated: BotGame = { ...g, moves, result: null, updatedAt: Date.now() };
  set({ bot: updated, thinking: false });
  save(KEY.bot, updated);
  scheduleBot();
  return true;
}

/** Đổi bên: ván mới, mình cầm quân bên kia */
export function swapBot() {
  const g = get().bot;
  if (!g) return null;
  return newBotGame({ level: g.level, side: otherSide(g.side), rule: g.rule });
}

/** Tóm tắt cho trang Trò chơi */
export function caroSummary(s: State, meId: number) {
  const rank = s.leaderboard ? s.leaderboard.findIndex((r) => r.userId === meId) + 1 : 0;
  let active = 0;
  for (const g of Object.values(s.games)) if (g.status === "active" && sideOf(g, meId)) active++;
  return {
    todo: caroBadge(s, meId),
    active,
    rating: s.me && s.me.userId === meId ? s.me : null,
    rank,
    botPlaying: s.bot && !s.bot.result && s.bot.moves.length > 0 ? s.bot : null,
  };
}
