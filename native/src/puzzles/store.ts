import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { api, ApiError } from "../api";
import { shapeOf, SIZE as BSIZE } from "../blocks/engine";
import * as P from "./core";
import type { BlocksPuzzle, BlocksState, CaroPuzzle, CaroState, ChessPuzzle, ChessState, GameId, Puzzle } from "./core";
import { chapterOf, dailyPuzzle, puzzleData, restoreRemoteData, syncRemoteData } from "./data";
import {
  addPendingResult,
  applyDailyEvent,
  blocksLeftText,
  dailyKey,
  isUnlocked,
  levelKey,
  mergeStars,
  sortSolvers,
  starsString,
  TEXT,
  withLevelStars,
} from "./logic";
import type { DailyEvent, GameSummary, Hint, LocalData, PendingResult, Play, PuzzleSummary, Route, Session, Solver } from "./types";

// Câu đố của Cờ vua, Xếp Khối, Cờ caro (Quiz hằng ngày + Thử thách nhanh) trong app.
// - Giải xong là lưu ngay trên máy (sao từng màn, quiz hôm nay), rồi gửi lên máy chủ. Mất mạng / máy chủ lỗi thì
//   giữ trong hàng chờ (AsyncStorage, theo từng người), có mạng lại / mở app / nối lại thì gửi theo đúng thứ tự.
// - Sao từng màn = số lớn nhất giữa máy này và máy chủ. Màn n mở khi màn n − 1 đã giải.
// - Xếp Khối và cờ caro chơi được khi mất mạng (dữ liệu đóng gói trong app).
// Realtime "puzzle:daily", tải lại khi nối lại mạng, chuỗi hằng ngày: nối ở src/store.ts qua bindPuzzles().

const KEY = (uid: number) => `think.puzzles.${uid}`;

type State = {
  /** Người đang có dữ liệu trên máy (0 = chưa đọc) */
  uid: number;
  local: LocalData | null;
  summary: PuzzleSummary | null;
  loading: boolean;
  route: Route | null;
  session: Session | null;
  /** Tăng mỗi lần đổi sang bộ câu đố mới tải từ máy chủ (để vẽ lại) */
  dataRev: number;
};

export const usePuzzles = create<State>(() => ({ uid: 0, local: null, summary: null, loading: false, route: null, session: null, dataRev: 0 }));

const get = usePuzzles.getState;
const set = usePuzzles.setState;

type Bridge = {
  /** Người đang đăng nhập (0 = chưa) */
  meId: () => number;
  online: () => boolean;
  toast: (text: string) => void;
  /** Hôm nay có chơi game này (chuỗi hằng ngày, game chạy trên máy) */
  played: (game: GameId) => void;
};
let bridge: Bridge = { meId: () => 0, online: () => true, toast: () => undefined, played: () => undefined };

export function bindPuzzles(b: Bridge) {
  bridge = b;
}

/** Tăng khi đăng xuất: bỏ kết quả của các lượt tải / gửi đang chạy dở */
let gen = 0;

const emptyLocal = (): LocalData => ({ levels: {}, daily: {}, revealed: {}, pending: [], summary: null });

function parseLocal(raw: string | null): LocalData {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return emptyLocal();
    return {
      levels: v.levels && typeof v.levels === "object" ? v.levels : {},
      daily: v.daily && typeof v.daily === "object" ? v.daily : {},
      revealed: v.revealed && typeof v.revealed === "object" ? v.revealed : {},
      pending: Array.isArray(v.pending) ? v.pending : [],
      summary: v.summary && typeof v.summary === "object" && v.summary.games ? v.summary : null,
    };
  } catch {
    return emptyLocal();
  }
}

let localLoad: { uid: number; gen: number; p: Promise<LocalData | null> } | null = null;

/** Đọc dữ liệu trên máy của người `uid` (một lần) */
function ensureLocal(uid: number): Promise<LocalData | null> {
  if (!uid) return Promise.resolve(null);
  const s = get();
  if (s.uid === uid && s.local) return Promise.resolve(s.local);
  if (localLoad && localLoad.uid === uid && localLoad.gen === gen) return localLoad.p;
  const g0 = gen;
  const p = AsyncStorage.getItem(KEY(uid))
    .catch(() => null)
    .then((raw) => {
      if (g0 !== gen) return null;
      const cur = get();
      if (cur.uid === uid && cur.local) return cur.local;
      const data = parseLocal(raw);
      set({ uid, local: data, summary: data.summary });
      return data;
    });
  localLoad = { uid, gen: g0, p };
  return p;
}

/** Sửa dữ liệu trên máy sau khi đã đọc xong (người chưa đăng nhập thì thôi) */
function withLocal(fn: (d: LocalData) => LocalData, then?: () => void) {
  const uid = bridge.meId();
  if (!uid) return Promise.resolve();
  return ensureLocal(uid).then(() => {
    updateLocal(fn);
    then?.();
  });
}

function updateLocal(fn: (d: LocalData) => LocalData) {
  const s = get();
  if (!s.uid || !s.local || s.uid !== bridge.meId()) return;
  const next = fn(s.local);
  if (next === s.local) return;
  set({ local: next });
  AsyncStorage.setItem(KEY(s.uid), JSON.stringify(next)).catch(() => undefined);
}

/** Số màn theo dữ liệu đóng gói (chỉ gọi từ giao diện: đọc file dữ liệu của game đó) */
const levelCount = (game: GameId) => puzzleData(game).levels.length;

/** Gộp sao máy chủ vào chuỗi trên máy (không cần đọc file dữ liệu: lúc mở app chưa phải đọc) */
const mergeLocal = (mine: string | undefined, gs: GameSummary) =>
  starsString(mergeStars(Math.max(gs.count || 0, gs.stars.length, (mine || "").length), mine, gs.stars));

/* ---------------- Tải, gộp với máy chủ ---------------- */

/** Máy chủ gửi bản tóm tắt một game: cập nhật, gộp sao vào bản trên máy */
function applyGame(game: GameId, gs: GameSummary) {
  if (!gs || typeof gs.stars !== "string") return;
  const prev = get().summary;
  const summary: PuzzleSummary = { today: gs.daily?.day || prev?.today || P.dayKey(), games: { ...(prev?.games || {}), [game]: gs } };
  set({ summary });
  updateLocal((d) => ({
    ...d,
    levels: { ...d.levels, [game]: mergeLocal(d.levels[game], gs) },
    summary,
  }));
}

function applySummary(sum: PuzzleSummary) {
  if (!sum || !sum.games) return;
  set({ summary: sum });
  // Máy chủ đã thêm màn (bộ câu đố mới hơn bản trong app): tải về
  for (const g of P.GAMES) {
    const v = sum.games[g]?.version;
    if (typeof v === "number" && v > puzzleData(g).version) {
      syncRemoteData(g, v).then((ok) => {
        const cur = get();
        if (ok) set({ dataRev: cur.dataRev + 1, summary: cur.summary ? { ...cur.summary } : cur.summary });
      });
    }
  }
  updateLocal((d) => {
    const levels = { ...d.levels };
    for (const g of P.GAMES) {
      const gs = sum.games[g];
      if (gs && typeof gs.stars === "string") levels[g] = mergeLocal(d.levels[g], gs);
    }
    return { ...d, levels, summary: sum };
  });
}

/** Tải bản tóm tắt (sao, quiz hôm nay, bảng xếp hạng) rồi gửi các kết quả chờ */
let restored: Promise<void> | null = null;

export async function loadPuzzles() {
  const uid = bridge.meId();
  if (!uid) return;
  if (!restored) restored = restoreRemoteData();
  await restored;
  await ensureLocal(uid);
  if (get().loading) return;
  const g0 = gen;
  set({ loading: true });
  try {
    const sum = await api.puzzles();
    if (g0 === gen && bridge.meId() === uid) applySummary(sum);
  } catch {
    /* mất mạng: dùng bản lưu trên máy */
  } finally {
    if (g0 === gen) set({ loading: false });
  }
  await flushPuzzles();
}

/* ---------------- Hàng chờ gửi kết quả ---------------- */

const MAX_LOCKED_TRIES = 30;
let flushing: Promise<void> | null = null;

const starsOfPending = (x: PendingResult) => P.stars(x.mistakes, x.hints);

/** Gửi lần lượt các kết quả chờ (theo thứ tự giải) */
export function flushPuzzles(): Promise<void> {
  if (flushing) return flushing;
  const uid = bridge.meId();
  if (!uid || !bridge.online()) return Promise.resolve();
  const g0 = gen;
  const p: Promise<void> = (async () => {
    await ensureLocal(uid);
    let i = 0;
    for (;;) {
      if (g0 !== gen || bridge.meId() !== uid) break; // vừa đăng xuất / đổi người: để dành cho đúng người
      const item = get().local?.pending[i];
      if (!item) break;
      try {
        const body = { moves: item.moves, mistakes: item.mistakes, hints: item.hints, ms: item.ms, playedAt: item.playedAt };
        const res =
          item.kind === "level"
            ? await api.puzzleLevel(item.game, { ...body, level: item.level })
            : await api.puzzleDaily(item.game, { ...body, day: item.day, id: item.id });
        if (g0 !== gen || bridge.meId() !== uid) break;
        updateLocal((d) => ({ ...d, pending: d.pending.filter((x) => x !== item) }));
        if (res?.summary) applyGame(item.game, res.summary);
      } catch (err) {
        if (g0 !== gen || bridge.meId() !== uid) break;
        // Mất mạng, máy chủ lỗi / đang bận, hết phiên, phải đổi mật khẩu: dừng, lần sau gửi lại (giữ thứ tự)
        if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500 || [401, 403, 408, 429].includes(err.status)) break;
        // Màn chưa mở trên máy chủ (409): giữ lại, gửi sau khi các màn trước đã tới
        if (err.status === 409 && item.kind === "level" && (item.tries || 0) + 1 < MAX_LOCKED_TRIES) {
          updateLocal((d) => ({ ...d, pending: d.pending.map((x) => (x === item ? { ...x, tries: (item.tries || 0) + 1 } : x)) }));
          i++;
          continue;
        }
        // Lời giải sai / quiz đã đóng / quiz đã đổi (400, 404, 409 của quiz): bỏ
        updateLocal((d) => ({ ...d, pending: d.pending.filter((x) => x !== item) }));
      }
    }
  })().finally(() => {
    if (flushing === p) flushing = null;
  });
  flushing = p;
  return p;
}

/* ---------------- Realtime, đăng xuất ---------------- */

/** "puzzle:daily": có người vừa giải quiz hôm nay → thêm vào danh sách người giải (ngày khác thì thôi) */
export function onPuzzleDaily(evt: DailyEvent) {
  if (!evt || !P.GAMES.includes(evt.game) || evt.day !== P.dayKey()) return;
  const sum = get().summary;
  let next = applyDailyEvent(sum?.games[evt.game], evt);
  if (!sum || !next) return;
  // Chính mình vừa giải ở máy khác (web / máy kia): hôm nay coi như đã giải
  if (evt.userId === get().uid && !next.daily.mine) {
    next = { ...next, daily: { ...next.daily, mine: { ms: evt.ms ?? null, mistakes: evt.mistakes || 0, hints: 0, stars: evt.stars || 1 } } };
  }
  set({ summary: { ...sum, games: { ...sum.games, [evt.game]: next } } });
}

export function resetPuzzles() {
  gen++;
  flushing = null;
  localLoad = null;
  set({ uid: 0, local: null, summary: null, loading: false, route: null, session: null });
}

/* ---------------- Đọc dữ liệu cho giao diện ---------------- */

/** Sao từng màn của một game (gộp máy này + máy chủ) */
export function levelStarsOf(s: Pick<State, "local" | "summary">, game: GameId) {
  return mergeStars(levelCount(game), s.local?.levels[game], s.summary?.games[game]?.stars);
}

export type DailyInfo = {
  day: string;
  puzzle: Puzzle | null;
  /** Kết quả của mình hôm nay (trên máy này hoặc máy chủ) */
  solved: { ms: number | null; mistakes: number; hints: number; stars: number; pending: boolean } | null;
  revealed: boolean;
  /** Ai đã giải hôm nay (đã sắp xếp; có cả mình nếu vừa giải mà chưa gửi được) */
  solvers: Solver[];
};

export function dailyInfo(s: Pick<State, "local" | "summary">, game: GameId, meId: number, today = P.dayKey()): DailyInfo {
  const gs = s.summary?.games[game];
  const live = gs && gs.daily.day === today ? gs.daily : null;
  const loc = s.local?.daily[game];
  const mineLocal = loc && loc.day === today ? loc : null;
  const pending = Boolean(mineLocal && s.local?.pending.some((x) => x.kind === "daily" && x.game === game && x.day === today));
  const solved = live?.mine
    ? { ms: live.mine.ms, mistakes: live.mine.mistakes, hints: live.mine.hints, stars: live.mine.stars, pending: false }
    : mineLocal
      ? { ms: mineLocal.ms, mistakes: mineLocal.mistakes, hints: mineLocal.hints, stars: mineLocal.stars, pending }
      : null;
  let solvers = live ? live.solvers : [];
  if (solved && meId && !solvers.some((x) => x.userId === meId)) {
    solvers = sortSolvers([
      ...solvers,
      { userId: meId, ms: solved.ms, mistakes: solved.mistakes, hints: solved.hints, stars: solved.stars, at: mineLocal?.at ?? 0 },
    ]);
  }
  return {
    day: today,
    puzzle: dailyPuzzle(game, today, live?.id ?? null),
    solved,
    revealed: Boolean(s.local?.revealed[game]?.day === today),
    solvers,
  };
}

/* ---------------- Màn hình: bản đồ màn / câu đang giải ---------------- */

export function openRoute(game: GameId, what: "map" | "daily", from: string) {
  set({ route: { game, map: what === "map", play: what === "daily" ? { kind: "daily" } : null, from }, session: null });
}

export function playLevel(level: number) {
  const r = get().route;
  if (!r) return;
  set({ route: { ...r, map: true, play: { kind: "level", level } }, session: null });
}

/** Về bản đồ màn */
export function closePlay() {
  const r = get().route;
  set({ route: r ? { ...r, map: true, play: null } : null, session: null });
}

/** Rời hẳn phần câu đố; trả về chỗ cần quay lại */
export function closeRoute() {
  const r = get().route;
  set({ route: null, session: null });
  return r;
}

export const sessionKey = (game: GameId, play: Play, day: string) => (play.kind === "level" ? levelKey(game, play.level) : dailyKey(game, day));

function startState(game: GameId, p: Puzzle) {
  if (game === "chess") return P.chessStart(p as ChessPuzzle);
  if (game === "blocks") return P.blocksStart(p as BlocksPuzzle);
  return P.caroStart(p as CaroPuzzle);
}

/** Bắt đầu giải (đồng hồ tính từ lúc này, chỉ hiện khi giải xong) */
export function startSession(game: GameId, play: Play, day = P.dayKey()): Session | null {
  const data = puzzleData(game);
  let puzzle: Puzzle | null = null;
  let chapter: string | null = null;
  if (play.kind === "level") {
    // Màn chưa mở (vd. bấm "Màn tiếp" sau khi xem lời giải màn trước): không cho chơi
    if (!isUnlocked(levelStarsOf(get(), game), play.level)) {
      set({ session: null });
      return null;
    }
    puzzle = data.levels[play.level - 1] ?? null;
    chapter = chapterOf(data, play.level)?.name ?? null;
  } else {
    const gs = get().summary?.games[game];
    puzzle = dailyPuzzle(game, day, gs && gs.daily.day === day ? gs.daily.id : null);
  }
  if (!puzzle) {
    set({ session: null });
    return null;
  }
  const session: Session = {
    key: sessionKey(game, play, day),
    game,
    kind: play.kind,
    level: play.kind === "level" ? play.level : null,
    day: play.kind === "daily" ? day : null,
    puzzle,
    chapter,
    state: startState(game, puzzle),
    mistakes: 0,
    hints: 0,
    hintLevel: 0,
    hint: null,
    startedAt: Date.now(),
    moved: false,
    revealed: false,
    finished: null,
    status: TEXT.start,
    tone: "info",
  };
  set({ session });
  return session;
}

/** Giải lại từ đầu (lượt mới, đồng hồ mới) */
export function replaySession() {
  const ss = get().session;
  if (!ss) return null;
  const next = startSession(ss.game, ss.kind === "level" ? { kind: "level", level: ss.level! } : { kind: "daily" }, ss.day ?? P.dayKey());
  // Vừa xem lời giải rồi giải lại: tính như đã dùng 3 gợi ý (tối đa 1 sao), giống bản web
  if (next && ss.revealed) {
    const penalized = { ...next, hints: Math.max(next.hints, 3) };
    set({ session: penalized });
    return penalized;
  }
  return next;
}

export function endSession() {
  set({ session: null });
}

function patch(p: Partial<Session>) {
  const ss = get().session;
  if (ss) set({ session: { ...ss, ...p } });
}

/** Nước đi đầu tiên của lượt: tính là có chơi game hôm nay (Xếp Khối, cờ caro) */
function firstMove(ss: Session) {
  if (ss.moved || ss.revealed) return; // máy tự đi lời giải thì không tính là có chơi
  if (ss.game !== "chess") {
    try {
      bridge.played(ss.game);
    } catch {
      /* bỏ qua */
    }
  }
}

/** Cờ vua: người chơi đi nước `uci` (trả về kết quả để màn hình cho quân trượt, phát tiếng) */
export function puzzleChess(uci: string) {
  const ss = get().session;
  if (!ss || ss.game !== "chess" || ss.finished) return null;
  const r = P.chessTry(ss.puzzle as ChessPuzzle, ss.state as ChessState, uci);
  if (r.illegal) return r;
  if (!r.ok) {
    patch({ mistakes: ss.revealed ? ss.mistakes : ss.mistakes + 1, status: TEXT.chessWrong, tone: "bad" });
    return r;
  }
  firstMove(ss);
  patch({ state: r.state, moved: true, hint: null, hintLevel: 0, status: r.done ? TEXT.solved : TEXT.correct, tone: "good" });
  if (r.done) complete();
  return r;
}

/** Cờ caro: người chơi (X) đánh vào ô i; máy (O) chặn ngay trong kết quả */
export function puzzleCaro(i: number) {
  const ss = get().session;
  if (!ss || ss.game !== "caro" || ss.finished) return null;
  const r = P.caroTry(ss.puzzle as CaroPuzzle, ss.state as CaroState, i);
  if (!r.ok) {
    if (r.reason === "taken") patch({ status: TEXT.taken, tone: "bad" });
    else patch({ mistakes: ss.revealed ? ss.mistakes : ss.mistakes + 1, status: r.reason === "not-four" ? TEXT.notFour : TEXT.noWin, tone: "bad" });
    return r;
  }
  firstMove(ss);
  patch({ state: r.state, moved: true, hint: null, status: r.won ? TEXT.solved : TEXT.correct, tone: "good" });
  if (r.won) complete();
  return r;
}

/** Xếp Khối: đặt khối ở ô khay `slot` vào hàng r, cột c (null = không đặt được) */
export function puzzleBlocks(slot: number, r: number, c: number) {
  const ss = get().session;
  if (!ss || ss.game !== "blocks" || ss.finished) return null;
  const p = ss.puzzle as BlocksPuzzle;
  const res = P.blocksPlace(p, ss.state as BlocksState, slot, r, c);
  if (!res) return null;
  firstMove(ss);
  if (res.won) {
    patch({ state: res.state, moved: true, hint: null, status: TEXT.solved, tone: "good" });
    complete();
  } else if (res.lost) {
    patch({ state: res.state, moved: true, hint: null, mistakes: ss.revealed ? ss.mistakes : ss.mistakes + 1, status: TEXT.blocksLost, tone: "bad" });
  } else {
    patch({ state: res.state, moved: true, hint: null, status: blocksLeftText(p.pieces.length - res.state.used), tone: "good" });
  }
  return res;
}

/** Nút "Làm lại": về thế ban đầu, đồng hồ vẫn chạy. Xếp Khối: đã đặt khối mà làm lại thì tính một lần sai */
export function puzzleRestart() {
  const ss = get().session;
  if (!ss || ss.finished || ss.revealed) return;
  const st = ss.state as BlocksState;
  const extra = ss.game === "blocks" && st.history.length > 0 && !st.lost ? 1 : 0;
  patch({ state: startState(ss.game, ss.puzzle), mistakes: ss.mistakes + extra, hint: null, hintLevel: 0, status: TEXT.start, tone: "info" });
}

/** Nút "Gợi ý" (mỗi lần gợi ý mới tính một lần) */
export function puzzleHint(): Hint | null {
  const ss = get().session;
  if (!ss || ss.finished || ss.revealed) return null;
  if (ss.game === "chess") {
    if (ss.hintLevel >= 2) return ss.hint;
    const level = ss.hintLevel + 1;
    const m = P.chessHint(ss.puzzle as ChessPuzzle, ss.state as ChessState, level);
    if (!m) return null;
    const hint: Hint = level >= 2 ? { kind: "move", uci: m } : { kind: "square", sq: m };
    const status = level >= 2 ? `Gợi ý: đi ${m.slice(0, 2)} → ${m.slice(2, 4)}` : `Gợi ý: đi quân ở ô ${m}`;
    patch({ hint, hintLevel: level, hints: ss.hints + 1, status, tone: "info" });
    return hint;
  }
  if (ss.game === "caro") {
    const i = P.caroHint(ss.puzzle as CaroPuzzle, ss.state as CaroState);
    if (i == null) {
      patch({ status: TEXT.hintNone, tone: "info" });
      return null;
    }
    if (ss.hint?.kind === "cell" && ss.hint.i === i) return ss.hint;
    const hint: Hint = { kind: "cell", i };
    patch({ hint, hints: ss.hints + 1, status: TEXT.hintCell, tone: "info" });
    return hint;
  }
  const st = ss.state as BlocksState;
  const h = P.blocksHint(ss.puzzle as BlocksPuzzle, st);
  if (!h) {
    patch({ status: TEXT.blocksHintRestart, tone: "info" });
    return null;
  }
  if (ss.hint?.kind === "blocks" && ss.hint.slot === h.slot && ss.hint.r === h.r && ss.hint.c === h.c) return ss.hint;
  const shape = shapeOf(st.tray[h.slot]!.shape);
  const cells = (shape?.cells || []).map(([dr, dc]) => (h.r + dr) * BSIZE + h.c + dc);
  const hint: Hint = { kind: "blocks", slot: h.slot, r: h.r, c: h.c, cells };
  patch({ hint, hints: ss.hints + 1, status: TEXT.hintBlocks, tone: "info" });
  return hint;
}

/** "Xem lời giải": về thế ban đầu, màn hình tự đi lời giải (puzzleSolutionNext); không tính sao, không gửi */
export function puzzleReveal() {
  const ss = get().session;
  if (!ss || ss.finished || ss.revealed) return;
  patch({ revealed: true, state: startState(ss.game, ss.puzzle), hint: null, hintLevel: 0, status: TEXT.revealing, tone: "info" });
  if (ss.kind === "daily" && ss.day) {
    const id = ss.puzzle.id;
    const day = ss.day;
    const g = ss.game;
    withLocal((d) => ({ ...d, revealed: { ...d.revealed, [g]: { day, id } } }));
  }
}

/** Nước tiếp theo của lời giải (cờ vua: uci; caro: ô; Xếp Khối: ô khay + chỗ đặt) */
export function puzzleSolutionNext(): { uci: string } | { cell: number } | { slot: number; r: number; c: number } | null {
  const ss = get().session;
  if (!ss || ss.finished) return null;
  if (ss.game === "chess") {
    const m = (ss.puzzle as ChessPuzzle).moves[(ss.state as ChessState).ply];
    return m ? { uci: m } : null;
  }
  if (ss.game === "caro") {
    const m = (ss.puzzle as CaroPuzzle).moves[(ss.state as CaroState).history.length];
    return m != null ? { cell: m } : null;
  }
  const st = ss.state as BlocksState;
  const m = (ss.puzzle as BlocksPuzzle).sol[st.history.length];
  if (!m) return null;
  const slot = st.tray.findIndex((x) => x && x.k === m[0]);
  return slot < 0 ? null : { slot, r: m[1], c: m[2] };
}

/** Nước đi gửi lên máy chủ */
function submitMoves(game: GameId, state: Session["state"]): unknown[] {
  if (game === "chess") return (state as ChessState).history.filter((_, i) => i % 2 === 0);
  if (game === "blocks") return (state as BlocksState).history;
  return (state as CaroState).xs;
}

/** Giải xong: tính sao, lưu trên máy, đưa vào hàng chờ gửi */
function complete() {
  const ss = get().session;
  if (!ss || ss.finished) return;
  const ms = Math.max(0, Date.now() - ss.startedAt);
  if (ss.revealed) {
    patch({ finished: { stars: 0, ms, mistakes: ss.mistakes, hints: ss.hints, revealed: true }, status: TEXT.revealedDone, tone: "info" });
    return;
  }
  const stars = P.stars(ss.mistakes, ss.hints);
  patch({ finished: { stars, ms, mistakes: ss.mistakes, hints: ss.hints, revealed: false } });
  const moves = submitMoves(ss.game, ss.state);
  const now = Date.now();
  const game = ss.game;
  if (ss.kind === "level" && ss.level) {
    const level = ss.level;
    const item: PendingResult = { kind: "level", key: levelKey(game, level), game, level, moves, mistakes: ss.mistakes, hints: ss.hints, ms, playedAt: now };
    withLocal(
      (d) => ({
        ...d,
        levels: { ...d.levels, [game]: withLevelStars(d.levels[game], level, stars) },
        pending: addPendingResult(d.pending, item, starsOfPending),
      }),
      flushPuzzles,
    );
  } else if (ss.kind === "daily" && ss.day) {
    const day = ss.day;
    const id = ss.puzzle.id;
    const mine = get().summary?.games[game]?.daily;
    if (mine && mine.day === day && mine.mine) return; // đã giải ở máy khác: máy chủ chỉ tính lần đầu
    const item: PendingResult = { kind: "daily", key: dailyKey(game, day), game, day, id, moves, mistakes: ss.mistakes, hints: ss.hints, ms, playedAt: now };
    withLocal((d) => {
      const prev = d.daily[game];
      if (prev && prev.day === day) return d;
      return {
        ...d,
        daily: { ...d.daily, [game]: { day, id, ms, mistakes: ss.mistakes, hints: ss.hints, stars, at: now } },
        pending: addPendingResult(d.pending, item, starsOfPending),
      };
    }, flushPuzzles);
  }
}
