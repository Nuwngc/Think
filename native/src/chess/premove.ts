import { Chess } from "chess.js";

// Đi trước (premove): lúc đối thủ đang nghĩ, chọn sẵn một nước; tới lượt mình thì tự đi nếu còn hợp lệ.
// Giống bản web (premoveTargets trong public/chess-ui.js). Có kiểm thử trong tests/chess.test.ts.

const FILES = "abcdefgh";

/** Quân trên bàn theo FEN: ô -> mã quân (vd "wN") */
function boardOf(fen: string) {
  const map = new Map<string, string>();
  const rows = String(fen || "")
    .split(" ")[0]
    .split("/");
  rows.slice(0, 8).forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        map.set(`${FILES[f]}${8 - r}`, ch === ch.toUpperCase() ? `w${ch}` : `b${ch.toUpperCase()}`);
        f++;
      }
    }
  });
  return map;
}

/**
 * Các ô quân ở `sq` có thể đặt nước đi trước: theo cách quân đi, không xét quân chắn
 * (thế cờ còn đổi sau nước của đối thủ). Ô có vua mình thì không.
 */
export function premoveTargets(fen: string, sq: string): string[] {
  const board = boardOf(fen);
  const code = board.get(sq);
  if (!code) return [];
  const color = code[0];
  const type = code[1].toLowerCase();
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  const out = new Set<string>();
  const add = (df: number, dr: number) => {
    const nf = f + df;
    const nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) return;
    const to = `${FILES[nf]}${nr + 1}`;
    if (board.get(to) === `${color}K`) return;
    out.add(to);
  };
  const ray = (df: number, dr: number) => {
    for (let k = 1; k < 8; k++) add(df * k, dr * k);
  };
  if (type === "p") {
    const d = color === "w" ? 1 : -1;
    add(0, d);
    if (r === (color === "w" ? 1 : 6)) add(0, 2 * d);
    add(-1, d);
    add(1, d);
  } else if (type === "n") {
    for (const [a, b] of [
      [1, 2],
      [2, 1],
      [-1, 2],
      [-2, 1],
      [1, -2],
      [2, -1],
      [-1, -2],
      [-2, -1],
    ])
      add(a, b);
  } else if (type === "k") {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) add(a, b);
    if (f === 4 && r === (color === "w" ? 0 : 7)) {
      add(2, 0);
      add(-2, 0);
    }
  } else {
    if (type !== "b")
      for (const [a, b] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        ray(a, b);
    if (type !== "r")
      for (const [a, b] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        ray(a, b);
  }
  return [...out];
}

/** Tới lượt: nước đi trước còn hợp lệ ở thế cờ `fen` không. Trả về nước dạng e2e4 (phong cấp thì thành Hậu), không thì null */
export function resolvePremove(fen: string, pm: { from: string; to: string }): string | null {
  try {
    const move = new Chess(fen).moves({ square: pm.from as never, verbose: true }).find((m) => m.to === pm.to);
    return move ? `${pm.from}${pm.to}${move.promotion ? "q" : ""}` : null;
  } catch {
    return null;
  }
}
