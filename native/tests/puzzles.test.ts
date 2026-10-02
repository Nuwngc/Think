/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { Chess } from "chess.js";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

// Không cần máy chủ (data.ts chỉ gọi api khi tải bộ câu đố mới)
vi.mock("../src/api", () => ({ api: {}, ApiError: Error }));

import { canPlace, SIZE as BSIZE, shapeOf } from "../src/blocks/engine";
import * as P from "../src/puzzles/core";
import type { BlocksPuzzle, CaroPuzzle, ChessPuzzle, GameId, Puzzle, PuzzleData } from "../src/puzzles/core";
import { chaptersOf } from "../src/puzzles/data";

// So khớp luật câu đố của app (src/puzzles/core.ts) với bản web / máy chủ (public/puzzles-core.js) trên TOÀN BỘ câu đố
// đóng gói trong app: lời giải đúng ở cả hai bên, từng bước giống hệt nhau, nước sai cho cùng kết quả.

const require = createRequire(import.meta.url);
const W = require("../../public/puzzles-core.js");
const DATA: Record<GameId, PuzzleData> = {
  chess: require("../src/puzzles/data/chess.json"),
  blocks: require("../src/puzzles/data/blocks.json"),
  caro: require("../src/puzzles/data/caro.json"),
};
const all = (game: GameId): Puzzle[] => [...DATA[game].levels, ...DATA[game].daily];

/** Mẫu cố định (mỗi k câu lấy một) để thử nước sai mà không quá lâu */
const sample = <T>(list: T[], every: number) => list.filter((_, i) => i % every === 0);

describe("dữ liệu câu đố trong app", () => {
  it.each(P.GAMES)("%s: giống hệt bản web (public/puzzles/*.json), chương khớp số màn", (game) => {
    expect(DATA[game]).toEqual(require(`../../public/puzzles/${game}.json`));
    const ch = chaptersOf(DATA[game]);
    expect(ch.reduce((a, c) => a + c.size, 0)).toBe(DATA[game].levels.length);
    expect(DATA[game].levels.length).toBeGreaterThan(0);
    expect(DATA[game].daily.length).toBeGreaterThan(0);
  });

  it("hàm chung giống nhau", () => {
    for (const t of [Date.parse("2026-10-02T16:59:00Z"), Date.parse("2026-10-02T17:00:00Z"), 0, Date.now()]) expect(P.dayKey(t)).toBe(W.dayKey(t));
    for (const day of ["2026-01-01", "2026-10-02", "2025-12-31", "2027-03-15"])
      for (const n of [1, 7, 150]) expect(P.dailyIndex(day, n)).toBe(W.dailyIndex(day, n));
    for (let m = 0; m < 5; m++) for (let h = 0; h < 5; h++) expect(P.stars(m, h)).toBe(W.stars(m, h));
    expect(P.NAMES).toEqual(W.NAMES);
    for (const g of P.GAMES) for (const p of all(g).slice(0, 20)) expect(P.goalText(g, p)).toBe(W.goalText(g, p));
  });
});

describe("cờ vua: app và web chấm giống nhau", () => {
  const list = all("chess") as ChessPuzzle[];

  it("lời giải đúng ở cả hai bên, từng bước giống hệt", () => {
    for (const p of list) {
      const moves = P.solutionMoves("chess", p) as string[];
      expect(P.verify("chess", p, moves), p.id).toBe(true);
      expect(W.verify("chess", p, moves, Chess), p.id).toBe(true);
      let a = P.chessStart(p);
      let b = W.chessStart(p);
      expect(a).toEqual(b);
      for (const m of moves) {
        expect(P.chessHint(p, a, 1)).toBe(W.chessHint(p, b, 1));
        expect(P.chessHint(p, a, 2)).toBe(W.chessHint(p, b, 2));
        const ra = P.chessTry(p, a, m);
        const rb = W.chessTry(p, b, m, Chess);
        expect(ra, `${p.id} ${m}`).toEqual(rb);
        a = ra.state;
        b = rb.state;
      }
      expect(a.done).toBe(true);
    }
  });

  it("nước sai / không hợp lệ: cùng kết quả", () => {
    let wrong = 0;
    for (const p of sample(list, 10)) {
      const st = P.chessStart(p);
      const legal = new Chess(p.fen).moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ""}`);
      for (const uci of [...legal, "a1a1", "e2e5", "zz"]) {
        const r = P.chessTry(p, st, uci);
        if (!r.ok && !r.illegal) wrong++;
        expect(r, `${p.id} ${uci}`).toEqual(W.chessTry(p, W.chessStart(p), uci, Chess));
      }
      expect(P.verify("chess", p, [legal.find((m) => m !== p.moves[0]) ?? "a1a1"])).toBe(
        W.verify("chess", p, [legal.find((m) => m !== p.moves[0]) ?? "a1a1"], Chess),
      );
    }
    expect(wrong).toBeGreaterThan(50);
  });
});

describe("Xếp Khối: app và web chấm giống nhau", () => {
  const list = all("blocks") as BlocksPuzzle[];

  it("lời giải đúng ở cả hai bên, từng bước giống hệt", () => {
    for (const p of list) {
      expect(P.verify("blocks", p, p.sol), p.id).toBe(true);
      expect(W.verify("blocks", p, p.sol), p.id).toBe(true);
      let a = P.blocksStart(p);
      let b = W.blocksStart(p);
      expect(a).toEqual(b);
      for (const [k, r, c] of p.sol) {
        expect(P.blocksHint(p, a)).toEqual(W.blocksHint(p, b));
        const slot = a.tray.findIndex((x) => x && x.k === k);
        const ra = P.blocksPlace(p, a, slot, r, c)!;
        const rb = W.blocksPlace(p, b, slot, r, c);
        expect(ra, `${p.id} ${k}`).toEqual(rb);
        a = ra.state;
        b = rb.state;
      }
      expect(a.won).toBe(true);
    }
  });

  it("đặt sai chỗ, lệch lời giải: cùng kết quả (cả gợi ý)", () => {
    for (const p of sample(list, 3)) {
      let a = P.blocksStart(p);
      let b = W.blocksStart(p);
      // Đặt khối đầu tiên vào chỗ đặt được đầu tiên (thường khác lời giải), rồi đi tiếp như vậy tới khi hết khối / kẹt
      for (let step = 0; step < p.pieces.length && !a.won && !a.lost; step++) {
        const slot = a.tray.findIndex((x) => x);
        const piece = a.tray[slot]!;
        let placed = false;
        for (let i = 0; i < BSIZE * BSIZE && !placed; i++) {
          const r = Math.floor(i / BSIZE);
          const c = i % BSIZE;
          if (!canPlace(a.board, piece.shape, r, c)) {
            if (i % 9 === 0) expect(P.blocksPlace(p, a, slot, r, c)).toEqual(W.blocksPlace(p, b, slot, r, c));
            continue;
          }
          const ra = P.blocksPlace(p, a, slot, r, c)!;
          const rb = W.blocksPlace(p, b, slot, r, c);
          expect(ra, `${p.id} ${piece.shape} ${r},${c}`).toEqual(rb);
          a = ra.state;
          b = rb.state;
          placed = true;
        }
        expect(P.blocksHint(p, a)).toEqual(W.blocksHint(p, b));
        if (!placed) break;
      }
      expect(shapeOf(p.pieces[0][0])).not.toBeNull();
    }
  });
});

describe("cờ caro: app và web chấm giống nhau", () => {
  const list = all("caro") as CaroPuzzle[];

  it("lời giải đúng ở cả hai bên, từng bước giống hệt", () => {
    for (const p of list) {
      const xs = P.solutionMoves("caro", p) as number[];
      expect(P.verify("caro", p, xs), p.id).toBe(true);
      expect(W.verify("caro", p, xs), p.id).toBe(true);
      let a = P.caroStart(p);
      let b = W.caroStart(p);
      expect(a).toEqual(b);
      for (const i of xs) {
        expect(P.caroHint(p, a)).toBe(W.caroHint(p, b));
        const ra = P.caroTry(p, a, i);
        const rb = W.caroTry(p, b, i);
        expect(ra, `${p.id} ${i}`).toEqual(rb);
        a = ra.state;
        b = rb.state;
      }
      expect(a.won).toBe(true);
    }
  });

  it("nước sai (chưa tạo tứ, tứ mà không thắng, ô đã có quân): cùng kết quả", () => {
    const seen = new Set<string>();
    for (const p of sample(list, 12)) {
      const a = P.caroStart(p);
      const b = W.caroStart(p);
      const near = P.nearX(a.board);
      const tries = [...near.filter((_, k) => k % 4 === 0).slice(0, 8), p.x[0], p.o[0], -1, 225, 3.5];
      for (const i of tries) {
        const r = P.caroTry(p, a, i);
        seen.add(r.ok ? "ok" : r.reason!);
        expect(r, `${p.id} ${i}`).toEqual(W.caroTry(p, b, i));
      }
      // Đi một nước tạo tứ khác lời giải (nếu có) rồi xin gợi ý: hai bên tìm giống nhau
      const other = near.find((c) => c !== p.moves[0] && P.caroTry(p, a, c).ok);
      if (other != null) {
        const ra = P.caroTry(p, a, other);
        const rb = W.caroTry(p, b, other);
        expect(ra).toEqual(rb);
        expect(P.caroHint(p, ra.state)).toBe(W.caroHint(p, rb.state));
      }
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(["no-win", "not-four", "taken"]));
  });
});
