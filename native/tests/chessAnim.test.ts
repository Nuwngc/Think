import { Chess } from "chess.js";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { duration, plan, squareAt, squareXY } from "../src/chess/anim";
import { makeLayout } from "../src/chess/layout";

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

describe("lớp quân của bàn cờ", () => {
  it("tốt phong cấp: Hậu nằm ở ô phong cấp, Xe vừa đi vẫn ở ô mới, thứ tự vẽ các quân không đổi (lỗi bản 0.6)", () => {
    // Xe trắng a8 che trước tốt a7: đi Xe a8→d8, đen đi Vua, rồi tốt a7 phong Hậu
    const c = new Chess("R7/P5k1/8/8/8/8/1KP5/8 w - - 0 70");
    let L = makeLayout(null, c.fen(), "w", 40, null);
    const ids = (l: typeof L) => l.sprites.map((x) => x.id);
    for (const uci of ["a8d8", "g7g6", "a7a8q", "g6h6"]) {
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      const before = ids(L);
      L = makeLayout(L, c.fen(), "w", 40, uci);
      // Các quân còn lại giữ đúng thứ tự cũ (React không phải dời quân nào)
      const kept = ids(L).filter((id) => before.includes(id));
      expect(kept).toEqual(before.filter((id) => kept.includes(id)));
      expect(ids(L)).toEqual([...ids(L)].sort((a, b) => a - b));
    }
    const at = (sq: string) => L.sprites.filter((x) => x.sq === sq).map((x) => x.code);
    expect(at("a8")).toEqual(["wQ"]);
    expect(at("d8")).toEqual(["wR"]);
    expect(at("h6")).toEqual(["bK"]);
    expect(L.sprites).toHaveLength(5);
  });

  it("không bao giờ có hai quân cùng id (xem lại ván nhảy nhiều nước)", () => {
    const rand = rng(11);
    for (let game = 0; game < 10; game++) {
      const c = new Chess();
      const fens = [c.fen()];
      for (let i = 0; i < 80 && !c.isGameOver(); i++) {
        const moves = c.moves({ verbose: true });
        c.move(moves[Math.floor(rand() * moves.length)]);
        fens.push(c.fen());
      }
      let L = makeLayout(null, fens[0], "w", 40, null);
      for (let k = 0; k < 60; k++) {
        const fen = fens[Math.floor(rand() * fens.length)];
        L = makeLayout(L, fen, "w", 40, null);
        const list = L.sprites.map((x) => x.id);
        expect(new Set(list).size).toBe(list.length);
        expect(L.sprites.length).toBe([...new Chess(fen).board().flat()].filter(Boolean).length);
      }
    }
  });
});
