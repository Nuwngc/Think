// Luật game Xếp Khối (kiểu Block Blast): bàn 8×8, mỗi lượt 3 khối, đầy hàng ngang / cột dọc thì xóa và được điểm.
// Giống hệt bản web (public/blocks-core.js) để điểm hai bên tính như nhau.

export const SIZE = 8;
export const COLORS = 7; // màu khối 1..7, 0 = ô trống
export const LINE_POINTS = [0, 10, 25, 45, 70, 100, 135];
export const MAX_MULTIPLIER = 10;
export const ALL_CLEAR = 300;
export const COMBO_GRACE = 3;

export type Shape = { id: string; weight: number; cells: [number, number][]; w: number; h: number };
export type Piece = { shape: string; color: number };
export type BlocksState = {
  id: string;
  board: number[];
  tray: (Piece | null)[];
  score: number;
  combo: number;
  sinceClear: number;
  moves: number;
  lines: number;
  startedAt: number;
  over: boolean;
  recorded?: boolean;
};
export type PlaceResult = {
  state: BlocksState;
  placed: number[];
  rows: number[];
  cols: number[];
  clearedCells: { i: number; color: number }[];
  lines: number;
  gained: number;
  linePoints: number;
  combo: number;
  allClear: boolean;
  refilled: boolean;
  over: boolean;
};

export const SHAPES: Shape[] = [];
function shape(id: string, weight: number, rows: string[]) {
  const cells: [number, number][] = [];
  rows.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) if (line[c] === "#") cells.push([r, c]);
  });
  SHAPES.push({ id, weight, cells, h: rows.length, w: Math.max(...rows.map((l) => l.length)) });
}
function rotations(id: string, weight: number, rows: string[], count = 4) {
  let cur = rows;
  for (let k = 0; k < count; k++) {
    shape(`${id}${k}`, weight, cur);
    const h = cur.length;
    const w = Math.max(...cur.map((l) => l.length));
    const next: string[] = [];
    for (let c = 0; c < w; c++) {
      let line = "";
      for (let r = h - 1; r >= 0; r--) line += cur[r][c] === "#" ? "#" : ".";
      next.push(line);
    }
    cur = next;
  }
}
shape("o1", 2, ["#"]);
shape("i2h", 3, ["##"]);
shape("i2v", 3, ["#", "#"]);
shape("i3h", 3, ["###"]);
shape("i3v", 3, ["#", "#", "#"]);
shape("i4h", 2, ["####"]);
shape("i4v", 2, ["#", "#", "#", "#"]);
shape("i5h", 1.5, ["#####"]);
shape("i5v", 1.5, ["#", "#", "#", "#", "#"]);
shape("o2", 4, ["##", "##"]);
shape("o3", 1.5, ["###", "###", "###"]);
shape("r23", 2, ["###", "###"]);
shape("r32", 2, ["##", "##", "##"]);
rotations("c3", 2, ["##", "#."]);
rotations("l4", 1, ["#.", "#.", "##"]);
rotations("j4", 1, [".#", ".#", "##"]);
rotations("t4", 1, ["###", ".#."]);
shape("s4h", 0.8, [".##", "##."]);
shape("s4v", 0.8, ["#.", "##", ".#"]);
shape("z4h", 0.8, ["##.", ".##"]);
shape("z4v", 0.8, [".#", "##", "#."]);
rotations("l5", 1, ["#..", "#..", "###"]);

const BY_ID: Record<string, Shape> = Object.fromEntries(SHAPES.map((s) => [s.id, s]));
const TOTAL_WEIGHT = SHAPES.reduce((s, x) => s + x.weight, 0);

export const shapeOf = (id: string): Shape | null => BY_ID[id] || null;
export const emptyBoard = () => new Array<number>(SIZE * SIZE).fill(0);

export function canPlace(board: number[], shapeId: string, r: number, c: number) {
  const s = shapeOf(shapeId);
  if (!s || r < 0 || c < 0 || r + s.h > SIZE || c + s.w > SIZE) return false;
  for (const [dr, dc] of s.cells) if (board[(r + dr) * SIZE + c + dc]) return false;
  return true;
}

export function fitsAnywhere(board: number[], shapeId: string) {
  const s = shapeOf(shapeId);
  if (!s) return false;
  for (let r = 0; r + s.h <= SIZE; r++) for (let c = 0; c + s.w <= SIZE; c++) if (canPlace(board, shapeId, r, c)) return true;
  return false;
}

export function fullLines(board: number[]) {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < SIZE; i++) {
    let row = true;
    let col = true;
    for (let j = 0; j < SIZE; j++) {
      if (!board[i * SIZE + j]) row = false;
      if (!board[j * SIZE + i]) col = false;
    }
    if (row) rows.push(i);
    if (col) cols.push(i);
  }
  return { rows, cols };
}

/** Các hàng / cột sẽ đầy nếu đặt khối vào (r, c) */
export function linesIfPlaced(board: number[], shapeId: string, r: number, c: number) {
  const s = shapeOf(shapeId)!;
  const next = board.slice();
  for (const [dr, dc] of s.cells) next[(r + dr) * SIZE + c + dc] = 1;
  return fullLines(next);
}

function pickShape(rand: () => number) {
  let x = rand() * TOTAL_WEIGHT;
  for (const s of SHAPES) {
    x -= s.weight;
    if (x <= 0) return s.id;
  }
  return SHAPES[SHAPES.length - 1].id;
}

/** Ba khối mới, cố chọn sao cho đặt được ít nhất một khối */
export function newTray(board: number[], rand: () => number = Math.random): Piece[] {
  let tray: Piece[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    tray = [0, 1, 2].map(() => ({ shape: pickShape(rand), color: 1 + Math.floor(rand() * COLORS) }));
    if (tray[1].color === tray[0].color) tray[1].color = (tray[0].color % COLORS) + 1;
    if (tray[2].color === tray[1].color || tray[2].color === tray[0].color) {
      for (let k = 1; k <= COLORS; k++) {
        if (k !== tray[0].color && k !== tray[1].color) {
          tray[2].color = k;
          break;
        }
      }
    }
    if (tray.some((p) => fitsAnywhere(board, p.shape))) return tray;
  }
  if (board.some((v) => !v)) tray[0] = { shape: "o1", color: tray[0].color };
  return tray;
}

export function newGame(rand: () => number = Math.random, now = Date.now()): BlocksState {
  const board = emptyBoard();
  return {
    id: `${now.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`,
    board,
    tray: newTray(board, rand),
    score: 0,
    combo: 0,
    sinceClear: 0,
    moves: 0,
    lines: 0,
    startedAt: now,
    over: false,
  };
}

export function validState(s: any): s is BlocksState {
  return Boolean(
    s &&
      typeof s === "object" &&
      Array.isArray(s.board) &&
      s.board.length === SIZE * SIZE &&
      s.board.every((v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= COLORS) &&
      Array.isArray(s.tray) &&
      s.tray.length === 3 &&
      s.tray.every((p: any) => p === null || (p && shapeOf(p.shape) && Number.isInteger(p.color))) &&
      [s.score, s.moves, s.lines, s.combo, s.sinceClear, s.startedAt].every((v) => Number.isFinite(v) && v >= 0) &&
      typeof s.id === "string",
  );
}

export const isOver = (s: Pick<BlocksState, "tray" | "board">) =>
  s.tray.every((p) => !p || !fitsAnywhere(s.board, p.shape)) && s.tray.some(Boolean);

/** Đặt khối tray[slot] vào (r, c): trạng thái mới + chuyện vừa xảy ra (để vẽ hiệu ứng, phát tiếng) */
export function place(state: BlocksState, slot: number, r: number, c: number, rand: () => number = Math.random): PlaceResult | null {
  const p = state.tray[slot];
  if (state.over || !p || !canPlace(state.board, p.shape, r, c)) return null;
  const s = shapeOf(p.shape)!;
  const board = state.board.slice();
  const placed = s.cells.map(([dr, dc]) => (r + dr) * SIZE + c + dc);
  for (const i of placed) board[i] = p.color;
  const { rows, cols } = fullLines(board);
  const cleared = new Set<number>();
  for (const row of rows) for (let j = 0; j < SIZE; j++) cleared.add(row * SIZE + j);
  for (const col of cols) for (let j = 0; j < SIZE; j++) cleared.add(j * SIZE + col);
  const clearedCells = [...cleared].map((i) => ({ i, color: board[i] }));
  for (const i of cleared) board[i] = 0;

  const n = rows.length + cols.length;
  let combo = state.combo;
  let sinceClear = state.sinceClear;
  let gained = s.cells.length;
  let linePoints = 0;
  let allClear = false;
  if (n > 0) {
    combo += 1;
    sinceClear = 0;
    linePoints = LINE_POINTS[Math.min(n, LINE_POINTS.length - 1)] * Math.min(combo, MAX_MULTIPLIER);
    gained += linePoints;
    if (board.every((v) => !v)) {
      allClear = true;
      gained += ALL_CLEAR;
    }
  } else {
    sinceClear += 1;
    if (sinceClear >= COMBO_GRACE) combo = 0;
  }

  let tray: (Piece | null)[] = state.tray.map((x, k) => (k === slot ? null : x));
  let refilled = false;
  if (tray.every((x) => !x)) {
    tray = newTray(board, rand);
    refilled = true;
  }
  const next: BlocksState = {
    ...state,
    board,
    tray,
    score: state.score + gained,
    combo,
    sinceClear,
    moves: state.moves + 1,
    lines: state.lines + n,
  };
  next.over = isOver(next);
  return { state: next, placed, rows, cols, clearedCells, lines: n, gained, linePoints, combo: n > 0 ? combo : 0, allClear, refilled, over: next.over };
}

/** Lời khen khi ăn nhiều hàng một lúc */
export function praise(lines: number, combo: number) {
  if (lines >= 5) return "Không thể tin nổi!";
  if (lines === 4) return "Xuất sắc!";
  if (lines === 3) return "Tuyệt vời!";
  if (lines === 2) return "Tốt lắm!";
  if (combo >= 3) return "Liên hoàn!";
  return "";
}
