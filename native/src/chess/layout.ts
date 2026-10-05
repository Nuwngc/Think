// Lớp quân của bàn cờ: ghép quân của thế cờ mới với quân đang hiện để quân trượt thay vì nhảy (dùng trong Board.tsx).
// Tách riêng để kiểm thử được (tests/chessAnim.test.ts).
import { duration, plan, squares } from "./anim";
import type { Color } from "./types";

export type Sprite = { id: number; sq: string; code: string };
export type Layout = {
  fen: string;
  orientation: Color;
  cell: number;
  sprites: Sprite[];
  /** Quân trượt: id → ô cũ */
  moved: { id: number; from: string; to: string }[];
  gone: { key: string; sq: string; code: string }[];
  ms: number;
};

let spriteSeq = 1;

/** Ghép quân của thế cờ mới với quân đang hiện (giữ nguyên id để quân trượt thay vì nhảy) */
export function makeLayout(prev: Layout | null, fen: string, orientation: Color, cell: number, lastMove: string | null | undefined): Layout {
  const cur = squares(fen);
  if (!prev || prev.orientation !== orientation || prev.cell !== cell) {
    return { fen, orientation, cell, sprites: [...cur].map(([sq, code]) => ({ id: spriteSeq++, sq, code })), moved: [], gone: [], ms: 0 };
  }
  if (prev.fen === fen) return prev;
  const p = plan(prev.fen, fen, lastMove);
  const bySq = new Map(prev.sprites.map((x) => [x.sq, x]));
  const moveTo = new Map(p.moves.map((m) => [m.to, m]));
  const sprites: Sprite[] = [];
  const moved: Layout["moved"] = [];
  // Quân đã trượt đi nơi khác: ô cũ của nó có quân mới thì quân mới phải có id riêng (không trùng key)
  const taken = new Set<number>();
  for (const [sq] of cur) {
    const m = moveTo.get(sq);
    const src = m ? bySq.get(m.from) : undefined;
    if (src) taken.add(src.id);
  }
  for (const [sq, code] of cur) {
    const m = moveTo.get(sq);
    const src = m ? bySq.get(m.from) : undefined;
    if (m && src) {
      sprites.push({ id: src.id, sq, code });
      moved.push({ id: src.id, from: m.from, to: sq });
      continue;
    }
    const keep = bySq.get(sq);
    sprites.push(keep && keep.code === code && !taken.has(keep.id) ? keep : { id: spriteSeq++, sq, code });
  }
  // Giữ nguyên thứ tự vẽ các quân (theo id, quân mới ở cuối): React không phải dời chỗ quân nào trong cây giao diện
  sprites.sort((x, y) => x.id - y.id);
  const ms = duration(p.moves);
  return { fen, orientation, cell, sprites, moved, gone: p.gone.map((g) => ({ key: `${fen}|${g.sq}`, ...g })), ms };
}
