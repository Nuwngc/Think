// Câu đố của Cờ vua, Xếp Khối, Cờ caro (Quiz hằng ngày + Thử thách nhanh): luật kiểm tra từng nước, máy đáp, gợi ý.
// Giống hệt bản web public/puzzles-core.js (tests/puzzles.test.ts so khớp hai bản trên toàn bộ câu đố).
import { Chess } from "chess.js";

import { canPlace, COLORS, fitsAnywhere, fullLines, SIZE as BSIZE, shapeOf } from "../blocks/engine";

export type GameId = "chess" | "blocks" | "caro";
export const GAMES: GameId[] = ["chess", "blocks", "caro"];
export const NAMES: Record<GameId, string> = { chess: "Cờ vua", blocks: "Xếp Khối", caro: "Cờ caro" };

export type ChessPuzzle = { id: string; fen: string; last?: string | null; goal: "mate" | "win"; n: number; moves: string[] };
export type BlocksPuzzle = { id: string; board: string; pieces: [string, number][]; sol: [number, number, number][] };
export type CaroPuzzle = { id: string; x: number[]; o: number[]; n: number; moves: number[] };
export type Puzzle = ChessPuzzle | BlocksPuzzle | CaroPuzzle;
export type PuzzleData<T = Puzzle> = { game: GameId; version: number; chapters: { name: string; size: number }[]; levels: T[]; daily: T[] };

const TZ = 7 * 3600 * 1000;
export const EPOCH = Date.UTC(2026, 0, 1);

export const dayKey = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);
export const dayNumber = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - EPOCH) / 86400000);
export const dailyIndex = (day: string, count: number) => (count > 0 ? ((dayNumber(day) % count) + count) % count : -1);
export function stars(mistakes: number, hints: number) {
  const bad = Math.max(0, mistakes | 0) + Math.max(0, hints | 0);
  return bad === 0 ? 3 : bad <= 2 ? 2 : 1;
}

/* =================== Cờ vua =================== */

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const applyUci = (c: Chess, uci: string) => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });

export type ChessState = { fen: string; ply: number; done: boolean; last: string | null; history: string[] };
export type ChessTry = { ok: boolean; illegal?: boolean; played?: string; reply?: string | null; midFen?: string; done?: boolean; state: ChessState };

export const chessStart = (p: ChessPuzzle): ChessState => ({ fen: p.fen, ply: 0, done: false, last: p.last || null, history: [] });
export const chessSide = (p: ChessPuzzle): "w" | "b" => (String(p.fen).split(" ")[1] === "b" ? "b" : "w");

export function chessTry(p: ChessPuzzle, st: ChessState, uci: string): ChessTry {
  if (!st || st.done || typeof uci !== "string" || !UCI.test(uci)) return { ok: false, illegal: true, state: st };
  const c = new Chess(st.fen);
  let mv: ReturnType<Chess["move"]> | null = null;
  try {
    mv = applyUci(c, uci);
  } catch {
    mv = null;
  }
  if (!mv) return { ok: false, illegal: true, state: st };
  const played = `${mv.from}${mv.to}${mv.promotion || ""}`;
  const isLast = st.ply === p.moves.length - 1;
  const ok = played === p.moves[st.ply] || (isLast && p.goal === "mate" && c.isCheckmate());
  if (!ok) return { ok: false, played, state: st };
  const midFen = c.fen();
  let ply = st.ply + 1;
  let reply: string | null = null;
  if (ply < p.moves.length) {
    reply = p.moves[ply];
    applyUci(c, reply);
    ply++;
  }
  const done = ply >= p.moves.length;
  const history = st.history.concat(played, reply ? [reply] : []);
  return { ok: true, played, reply, midFen, done, state: { fen: c.fen(), ply, done, last: reply || played, history } };
}

export function chessHint(p: ChessPuzzle, st: ChessState, level = 1) {
  if (!st || st.done) return null;
  const m = p.moves[st.ply];
  return level >= 2 ? m : m.slice(0, 2);
}

export function chessVerify(p: ChessPuzzle, moves: string[]) {
  if (!Array.isArray(moves)) return false;
  let st = chessStart(p);
  for (const m of moves) {
    const r = chessTry(p, st, m);
    if (!r.ok) return false;
    st = r.state;
  }
  return st.done;
}

export function chessGoal(p: ChessPuzzle) {
  const side = chessSide(p) === "w" ? "Trắng" : "Đen";
  if (p.goal === "mate") return p.n === 1 ? `${side} đi — chiếu hết ngay` : `${side} đi — chiếu hết sau ${p.n} nước`;
  return `${side} đi — tìm nước thắng quân`;
}

/* =================== Xếp Khối =================== */

export type BlocksPiece = { shape: string; color: number; k: number };
export type BlocksState = {
  board: number[];
  tray: (BlocksPiece | null)[];
  next: number;
  used: number;
  history: [number, number, number][];
  won: boolean;
  lost: boolean;
};
export type BlocksPlace = {
  state: BlocksState;
  placed: number[];
  rows: number[];
  cols: number[];
  clearedCells: { i: number; color: number }[];
  lines: number;
  refilled: boolean;
  won: boolean;
  lost: boolean;
  stuck: boolean;
};

const pieceOf = (p: BlocksPuzzle, k: number): BlocksPiece | null => (k < p.pieces.length ? { shape: p.pieces[k][0], color: p.pieces[k][1], k } : null);
const trayFrom = (p: BlocksPuzzle, from: number) => [0, 1, 2].map((j) => pieceOf(p, from + j));

export function blocksStart(p: BlocksPuzzle): BlocksState {
  const board = String(p.board).split("").map(Number);
  return { board, tray: trayFrom(p, 0), next: Math.min(3, p.pieces.length), used: 0, history: [], won: false, lost: false };
}

export function blocksPlace(p: BlocksPuzzle, st: BlocksState, slot: number, r: number, c: number): BlocksPlace | null {
  const piece = st && st.tray[slot];
  if (!piece || st.won || st.lost || !Number.isInteger(r) || !Number.isInteger(c) || !canPlace(st.board, piece.shape, r, c)) return null;
  const N = BSIZE;
  const s = shapeOf(piece.shape)!;
  const board = st.board.slice();
  const placed = s.cells.map(([dr, dc]) => (r + dr) * N + c + dc);
  for (const i of placed) board[i] = piece.color;
  const { rows, cols } = fullLines(board);
  const cleared = new Set<number>();
  for (const row of rows) for (let j = 0; j < N; j++) cleared.add(row * N + j);
  for (const col of cols) for (let j = 0; j < N; j++) cleared.add(j * N + col);
  const clearedCells = [...cleared].map((i) => ({ i, color: board[i] }));
  for (const i of cleared) board[i] = 0;
  let tray = st.tray.map((x, k) => (k === slot ? null : x));
  let next = st.next;
  let refilled = false;
  if (tray.every((x) => !x) && next < p.pieces.length) {
    tray = trayFrom(p, next);
    next = Math.min(next + 3, p.pieces.length);
    refilled = true;
  }
  const used = st.used + 1;
  const allUsed = used >= p.pieces.length;
  const won = allUsed && board.every((v) => !v);
  const stuck = !allUsed && tray.every((x) => !x || !fitsAnywhere(board, x.shape));
  const lost = (allUsed && !won) || stuck;
  const state: BlocksState = { board, tray, next, used, history: st.history.concat([[piece.k, r, c]]), won, lost };
  return { state, placed, rows, cols, clearedCells, lines: rows.length + cols.length, refilled, won, lost, stuck };
}

export function blocksHint(p: BlocksPuzzle, st: BlocksState) {
  if (!st || st.won || st.lost || !Array.isArray(p.sol)) return null;
  for (let i = 0; i < st.history.length; i++) {
    const a = st.history[i];
    const b = p.sol[i];
    if (!b || a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return null;
  }
  const nx = p.sol[st.history.length];
  if (!nx) return null;
  const slot = st.tray.findIndex((x) => x && x.k === nx[0]);
  return slot < 0 ? null : { slot, k: nx[0], r: nx[1], c: nx[2] };
}

export function blocksVerify(p: BlocksPuzzle, moves: [number, number, number][]) {
  if (!Array.isArray(moves)) return false;
  let st = blocksStart(p);
  for (const m of moves) {
    if (!Array.isArray(m) || m.length !== 3) return false;
    const slot = st.tray.findIndex((x) => x && x.k === m[0]);
    const r = slot < 0 ? null : blocksPlace(p, st, slot, m[1], m[2]);
    if (!r) return false;
    st = r.state;
  }
  return st.won;
}

export const blocksGoal = (p: BlocksPuzzle) => `Đặt hết ${p.pieces.length} khối để dọn sạch bàn`;
export const BLOCK_COLORS = COLORS;

/* =================== Cờ caro =================== */

export const CSIZE = 15;
export const CELLS = CSIZE * CSIZE;
export const X = 1;
export const O = 2;
const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];
const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < CSIZE && c < CSIZE;

export function makesFive(board: number[], i: number, p: number) {
  const r0 = Math.floor(i / CSIZE);
  const c0 = i % CSIZE;
  for (const [dr, dc] of DIRS) {
    let n = 1;
    for (let k = 1; k < 5 && inside(r0 + dr * k, c0 + dc * k) && board[(r0 + dr * k) * CSIZE + c0 + dc * k] === p; k++) n++;
    for (let k = 1; k < 5 && inside(r0 - dr * k, c0 - dc * k) && board[(r0 - dr * k) * CSIZE + c0 - dc * k] === p; k++) n++;
    if (n >= 5) return true;
  }
  return false;
}

export function winSquares(board: number[], p: number) {
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (!board[i] && makesFive(board, i, p)) out.push(i);
  return out;
}

export function winSquaresThrough(board: number[], p: number, i: number) {
  const r0 = Math.floor(i / CSIZE);
  const c0 = i % CSIZE;
  const out = new Set<number>();
  for (const [dr, dc] of DIRS) {
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const r = r0 + dr * k;
      const c = c0 + dc * k;
      if (!inside(r, c)) continue;
      const j = r * CSIZE + c;
      if (!board[j] && makesFive(board, j, p)) out.add(j);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function nearX(board: number[]) {
  const seen = new Uint8Array(CELLS);
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== X) continue;
    const r0 = Math.floor(i / CSIZE);
    const c0 = i % CSIZE;
    for (const [dr, dc] of DIRS) {
      for (let k = -4; k <= 4; k++) {
        const r = r0 + dr * k;
        const c = c0 + dc * k;
        if (!k || !inside(r, c)) continue;
        const j = r * CSIZE + c;
        if (!board[j] && !seen[j]) {
          seen[j] = 1;
          out.push(j);
        }
      }
    }
  }
  return out.sort((a, b) => a - b);
}

export function vcf(board: number[], budget: number, limit = 50000) {
  return vcfInner(board.slice(), budget, { left: limit });
}

/** Như vcf, kèm cho biết đã tìm hết chưa (exhausted = hết lượt tìm mà chưa kết luận được) */
export function vcfStatus(board: number[], budget: number, limit: number) {
  const ctx = { left: limit };
  const line = vcfInner(board.slice(), budget, ctx);
  return { line, exhausted: !line && ctx.left < 0 };
}
function vcfInner(board: number[], budget: number, ctx: { left: number }): number[] | null {
  if (budget < 1 || --ctx.left < 0) return null;
  const xw = winSquares(board, X);
  if (xw.length) return [xw[0]];
  if (budget < 2 || winSquares(board, O).length) return null;
  const tries: { c: number; w: number[] }[] = [];
  for (const c of nearX(board)) {
    board[c] = X;
    const w = winSquaresThrough(board, X, c);
    board[c] = 0;
    if (w.length) tries.push({ c, w });
  }
  tries.sort((a, b) => b.w.length - a.w.length || a.c - b.c);
  for (const { c, w } of tries) {
    board[c] = X;
    const b = w[0];
    board[b] = O;
    const rest = vcfInner(board, budget - 1, ctx);
    board[b] = 0;
    board[c] = 0;
    if (rest) return [c, b, ...rest];
    if (ctx.left < 0) return null;
  }
  return null;
}

export function caroBoard(p: CaroPuzzle) {
  const board = new Array<number>(CELLS).fill(0);
  for (const i of p.x) board[i] = X;
  for (const i of p.o) board[i] = O;
  return board;
}

export type CaroState = { board: number[]; xs: number[]; history: number[]; done: boolean; won: boolean; last: number | null };
export type CaroTry = { ok: boolean; won?: boolean; done?: boolean; reply?: number | null; reason?: "taken" | "not-four" | "no-win"; state: CaroState };

export const caroStart = (p: CaroPuzzle): CaroState => ({ board: caroBoard(p), xs: [], history: [], done: false, won: false, last: null });
const followsSolution = (p: CaroPuzzle, st: CaroState) => st.history.every((m, i) => p.moves[i] === m);

/**
 * Người chơi (X) đi vào ô i (xem public/puzzles-core.js). Nước khác lời giải: tìm nhanh tối đa `limit` thế cờ
 * (máy yếu không bị đứng), tìm chưa xong thì cho đi tiếp. check = false: chỉ cần tạo tứ (kiểm tra cả dãy nước).
 */
export function caroTry(p: CaroPuzzle, st: CaroState, i: number, limit = 2000, check = true): CaroTry {
  if (!st || st.done || !Number.isInteger(i) || i < 0 || i >= CELLS) return { ok: false, reason: "taken", state: st };
  if (st.board[i]) return { ok: false, reason: "taken", state: st };
  const left = p.n - st.xs.length;
  if (left < 1) return { ok: false, reason: "no-win", state: st };
  const board = st.board.slice();
  const o5 = winSquares(board, O).length > 0;
  board[i] = X;
  if (makesFive(board, i, X)) {
    const state = { board, xs: st.xs.concat(i), history: st.history.concat(i), done: true, won: true, last: i };
    return { ok: true, won: true, done: true, reply: null, state };
  }
  if (o5 || left < 2) return { ok: false, reason: "no-win", state: st };
  const w = winSquaresThrough(board, X, i);
  if (!w.length) return { ok: false, reason: "not-four", state: st };
  const b = w[0];
  board[b] = O;
  const onPath = followsSolution(p, st) && p.moves[st.history.length] === i && p.moves[st.history.length + 1] === b;
  if (!onPath && check) {
    const res = vcfStatus(board, left - 1, limit);
    if (!res.line && !res.exhausted) return { ok: false, reason: "no-win", state: st };
  }
  const state = { board, xs: st.xs.concat(i), history: st.history.concat(i, b), done: false, won: false, last: b };
  return { ok: true, won: false, done: false, reply: b, state };
}

/** Gợi ý ô nên đi theo lời giải (đã đi khác lời giải thì null: nên bấm Làm lại) */
export function caroHint(p: CaroPuzzle, st: CaroState) {
  if (!st || st.done || !followsSolution(p, st)) return null;
  return p.moves[st.history.length];
}

export function caroVerify(p: CaroPuzzle, xs: number[]) {
  if (!Array.isArray(xs) || xs.length > p.n) return false;
  let st = caroStart(p);
  for (const i of xs) {
    const r = caroTry(p, st, i, 0, false);
    if (!r.ok) return false;
    st = r.state;
  }
  return st.won;
}

export const caroGoal = (p: CaroPuzzle) => (p.n === 1 ? "Bạn cầm X — tìm nước thắng ngay" : `Bạn cầm X — thắng trong ${p.n} nước`);

/* =================== Chung =================== */

export function goalText(game: GameId, p: Puzzle) {
  if (game === "chess") return chessGoal(p as ChessPuzzle);
  if (game === "blocks") return blocksGoal(p as BlocksPuzzle);
  return caroGoal(p as CaroPuzzle);
}

/** Dãy nước của lời giải (để kiểm thử và để gửi lên máy chủ) */
export function solutionMoves(game: GameId, p: Puzzle): unknown[] {
  if (game === "blocks") return (p as BlocksPuzzle).sol;
  return (p as ChessPuzzle | CaroPuzzle).moves.filter((_, i) => i % 2 === 0);
}

export function verify(game: GameId, p: Puzzle, moves: unknown) {
  try {
    if (game === "chess") return chessVerify(p as ChessPuzzle, moves as string[]);
    if (game === "blocks") return blocksVerify(p as BlocksPuzzle, moves as [number, number, number][]);
    return caroVerify(p as CaroPuzzle, moves as number[]);
  } catch {
    return false;
  }
}
