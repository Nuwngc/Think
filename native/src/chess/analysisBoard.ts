import { Chess } from "chess.js";

import type { Color } from "./types";

// Bàn phân tích: phần luật không phụ thuộc giao diện (có kiểm thử trong tests/chess.test.ts)

/**
 * Đi nước `uci` khi đang xem tới nước `ply`. Trùng nước kế tiếp đã có thì chỉ tiến lên;
 * nước khác thì bỏ các nước phía sau (nhánh mới). Nước sai luật: trả null.
 */
export function playAt(moves: string[], ply: number, uci: string): { moves: string[]; ply: number; san: string } | null {
  const chess = new Chess();
  for (const m of moves.slice(0, ply)) {
    try {
      chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined });
    } catch {
      return null;
    }
  }
  let r;
  try {
    r = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  } catch {
    return null;
  }
  const norm = `${r.from}${r.to}${r.promotion || ""}`;
  const next = moves[ply] === norm ? moves : [...moves.slice(0, ply), norm];
  return { moves: next, ply: ply + 1, san: r.san };
}

/** Dãy nước của máy kèm số nước: "2. Nf3 Nc6 3. Bb5" hoặc "2… Nc6 3. Bb5" (ply: số nước đã đi trước dãy) */
export function pvText(pv: string[], ply: number, turn: Color) {
  let no = Math.floor(ply / 2) + 1;
  let white = turn === "w";
  const out: string[] = [];
  pv.forEach((m, i) => {
    if (white) out.push(`${no}. ${m}`);
    else out.push(i === 0 ? `${no}… ${m}` : m);
    if (!white) no++;
    white = !white;
  });
  return out.join(" ");
}
