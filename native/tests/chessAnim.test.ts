import { Chess } from "chess.js";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { duration, plan, squareAt, squareXY } from "../src/chess/anim";

const require = createRequire(import.meta.url);
// Bản web: hai bản phải tính y hệt nhau
const web = require("../../public/chess-anim.js") as {
  plan: typeof plan;
  duration: typeof duration;
  offset: (from: string, to: string, o: "w" | "b") => { dx: number; dy: number };
};

/** Số giả ngẫu nhiên lặp lại được */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe("chuyển động quân cờ trong app", () => {
  it("giống hệt bản web trên nhiều ván ngẫu nhiên (từng nước và khi nhảy nhiều nước)", () => {
    const rand = rng(7);
    for (let game = 0; game < 12; game++) {
      const c = new Chess();
      const fens = [c.fen()];
      const ucis: string[] = [];
      for (let i = 0; i < 70 && !c.isGameOver(); i++) {
        const moves = c.moves({ verbose: true });
        const m = moves[Math.floor(rand() * moves.length)];
        c.move(m);
        fens.push(c.fen());
        ucis.push(`${m.from}${m.to}${m.promotion || ""}`);
      }
      for (let i = 1; i < fens.length; i++) {
        const a = plan(fens[i - 1], fens[i], ucis[i - 1]);
        expect(a).toEqual(web.plan(fens[i - 1], fens[i], ucis[i - 1]));
        // Một nước đi: luôn có quân trượt, quân mới chỉ hiện khi không ghép được
        expect(a.moves.length).toBeGreaterThan(0);
        expect(a.appear).toEqual([]);
        expect(duration(a.moves)).toBe(web.duration(a.moves));
      }
      // Xem lại ván: nhảy từ đầu ván tới giữa ván và ngược lại
      const mid = Math.floor(fens.length / 2);
      expect(plan(fens[0], fens[mid], null)).toEqual(web.plan(fens[0], fens[mid], null));
      expect(plan(fens[fens.length - 1], fens[0], null)).toEqual(web.plan(fens[fens.length - 1], fens[0], null));
    }
  });

  it("vị trí ô trên màn hình và ô dưới ngón tay khớp nhau, cả khi xoay bàn cờ", () => {
    const cell = 40;
    for (const o of ["w", "b"] as const) {
      for (const f of "abcdefgh") {
        for (let r = 1; r <= 8; r++) {
          const sq = `${f}${r}`;
          const { x, y } = squareXY(sq, cell, o);
          expect(squareAt(x + cell / 2, y + cell / 2, cell, o)).toBe(sq);
        }
      }
    }
    expect(squareXY("a1", cell, "w")).toEqual({ x: 0, y: 280 });
    expect(squareXY("a1", cell, "b")).toEqual({ x: 280, y: 0 });
    expect(squareAt(-1, 10, cell, "w")).toBeNull();
    expect(squareAt(10, 320, cell, "w")).toBeNull();
    // Độ lệch của bản web cùng chiều với vị trí trong app
    const a = squareXY("e2", cell, "b");
    const b = squareXY("g5", cell, "b");
    const off = web.offset("e2", "g5", "b");
    expect({ dx: off.dx * cell, dy: off.dy * cell }).toEqual({ dx: a.x - b.x, dy: a.y - b.y });
  });
});
