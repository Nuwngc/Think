/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ blocks: vi.fn(), blocksSubmit: vi.fn() }));
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/api", () => ({ api }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((k: string) => Promise.resolve(storage.get(k) ?? null)),
    setItem: vi.fn((k: string, v: string) => {
      storage.set(k, v);
      return Promise.resolve();
    }),
    removeItem: vi.fn((k: string) => {
      storage.delete(k);
      return Promise.resolve();
    }),
  },
}));
vi.mock("../src/blocks/sound", () => ({ setBlockSound: vi.fn(), playBlock: vi.fn(), preloadBlockSounds: vi.fn() }));

import * as E from "../src/blocks/engine";
import { bindBlocks, blocksSummary, loadBlocks, onScoreEvent, placePiece, recordGame, sync, useBlocks } from "../src/blocks/store";

// Luật bản web (public/blocks-core.js) để so khớp: hai bản phải tính điểm giống hệt nhau
const requireCjs = createRequire(import.meta.url);
const Web = requireCjs("../../public/blocks-core.js");

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("luật Xếp Khối", () => {
  it("có đủ các hình khối, xoay đúng", () => {
    expect(E.SHAPES.length).toBe(37);
    const draw = (id: string) => {
      const s = E.shapeOf(id)!;
      const rows: string[] = [];
      for (let r = 0; r < s.h; r++) {
        let l = "";
        for (let c = 0; c < s.w; c++) l += s.cells.some(([a, b]) => a === r && b === c) ? "#" : ".";
        rows.push(l);
      }
      return rows.join("|");
    };
    expect(draw("c30")).toBe("##|#.");
    expect(draw("c31")).toBe("##|.#");
    expect(draw("l51")).toBe("###|#..|#..");
    expect(draw("t41")).toBe(".#|##|.#");
  });

  it("đặt khối, ăn hàng và cột cùng lúc, combo, dọn sạch bàn", () => {
    const rand = seeded(3);
    let st = E.newGame(rand, 1000);
    st = { ...st, board: E.emptyBoard(), tray: [{ shape: "o1", color: 3 }, { shape: "o2", color: 4 }, { shape: "i2h", color: 5 }] };
    for (let c = 0; c < 7; c++) st.board[c] = 2;
    const r1 = E.place(st, 0, 0, 7, rand)!;
    expect(r1.lines).toBe(1);
    expect(r1.allClear).toBe(true);
    expect(r1.gained).toBe(1 + 10 + E.ALL_CLEAR);
    // Hàng 7 + cột 7 (thiếu góc), một ô khác để không sạch bàn
    const b = E.emptyBoard();
    for (let c = 0; c < 7; c++) b[7 * 8 + c] = 1;
    for (let r = 0; r < 7; r++) b[r * 8 + 7] = 1;
    b[0] = 6;
    const r2 = E.place({ ...r1.state, board: b, tray: [{ shape: "o1", color: 3 }, null, { shape: "o2", color: 5 }] }, 0, 7, 7, rand)!;
    expect(r2.lines).toBe(2);
    expect(r2.combo).toBe(2);
    expect(r2.gained).toBe(1 + 25 * 2);
    expect(r2.allClear).toBe(false);
  });

  it("mất combo sau 3 lần đặt không ăn hàng; hết khối thì có 3 khối mới", () => {
    const rand = seeded(5);
    let st: E.BlocksState = { ...E.newGame(rand), combo: 4, sinceClear: 0, tray: [{ shape: "o1", color: 1 }, { shape: "o1", color: 2 }, { shape: "o1", color: 3 }] };
    st = E.place(st, 0, 3, 3, rand)!.state;
    st = E.place(st, 1, 3, 4, rand)!.state;
    expect(st.combo).toBe(4);
    const last = E.place(st, 2, 3, 5, rand)!;
    expect(last.state.combo).toBe(0);
    expect(last.refilled).toBe(true);
    expect(last.state.tray.every(Boolean)).toBe(true);
  });

  it("hết chỗ đặt thì hết ván; không đặt được vào ô đã có khối", () => {
    const rand = seeded(9);
    const board = E.emptyBoard().map((_, i) => ((i + Math.floor(i / 8)) % 2 ? 1 : 0));
    const st: E.BlocksState = { ...E.newGame(rand), board, tray: [{ shape: "o1", color: 3 }, { shape: "o2", color: 5 }, null] };
    expect(E.place(st, 0, 0, 1, rand)).toBeNull();
    const r = E.place(st, 0, 0, 0, rand)!;
    expect(r.over).toBe(true);
    expect(E.validState(r.state)).toBe(true);
    expect(E.validState({ board: [1] })).toBe(false);
  });

  it("điểm mỗi nước không vượt giới hạn máy chủ kiểm tra (1700)", () => {
    // Tệ nhất: 9 ô + ăn 6 hàng với combo x10 + sạch bàn
    expect(9 + E.LINE_POINTS[6] * E.MAX_MULTIPLIER + E.ALL_CLEAR).toBeLessThan(1700);
  });

  it("bản app và bản web tính y hệt nhau", () => {
    for (const seed of [1, 7, 42, 99]) {
      const ra = seeded(seed);
      const rb = seeded(seed);
      let a = E.newGame(ra, 5000);
      let b = Web.newGame(rb, 5000);
      expect(a).toEqual(b);
      for (let step = 0; step < 300 && !a.over; step++) {
        // Đặt khối đầu tiên đặt được vào chỗ đầu tiên (cả hai bản như nhau)
        let move: [number, number, number] | null = null;
        for (let k = 0; k < 3 && !move; k++) {
          const p = a.tray[k];
          if (!p) continue;
          for (let r = 0; r < 8 && !move; r++) for (let c = 0; c < 8 && !move; c++) if (E.canPlace(a.board, p.shape, r, c)) move = [k, r, c];
        }
        if (!move) break;
        const x = E.place(a, move[0], move[1], move[2], ra)!;
        const y = Web.place(b, move[0], move[1], move[2], rb);
        expect({ gained: x.gained, lines: x.lines, combo: x.combo, over: x.over }).toEqual({ gained: y.gained, lines: y.lines, combo: y.combo, over: y.over });
        a = x.state;
        b = y.state;
      }
      expect(a).toEqual(b);
    }
  });
});

describe("điểm và bảng xếp hạng trong app", () => {
  let me: number | null = 7;
  const toasts: string[] = [];
  beforeEach(async () => {
    storage.clear();
    toasts.length = 0;
    me = 7;
    api.blocks.mockReset();
    api.blocksSubmit.mockReset();
    bindBlocks({ meId: () => me, online: () => true, toast: (t) => toasts.push(t) });
    await loadBlocks();
    useBlocks.setState({ game: null, pending: [], bests: {}, board: null, syncError: false });
  });

  function nearlyOver() {
    const board = E.emptyBoard().map((_, i) => ((i + Math.floor(i / 8)) % 2 ? 1 + (i % 7) : 0));
    useBlocks.setState({
      game: { ...E.newGame(), board, tray: [{ shape: "o1", color: 3 }, { shape: "o2", color: 5 }, null], score: 500, moves: 20, lines: 6 },
    });
  }

  it("hết ván: ghi kỷ lục, đưa vào hàng chờ gửi, gửi xong thì xóa khỏi hàng chờ", async () => {
    const board = { game: "blocks", weekStart: 0, me: { best: 501, bestAt: 1, games: 1, lines: 6, weekBest: 501, rank: 1, weekRank: 1 }, leaderboard: { all: [], week: [] } };
    let resolve: (v: unknown) => void = () => undefined;
    api.blocksSubmit.mockReturnValue(new Promise((r) => (resolve = r)));
    nearlyOver();
    const res = placePiece(0, 0, 0)!;
    expect(res.over).toBe(true);
    expect(res.record).toEqual({ record: true, best: 501 });
    expect(useBlocks.getState().pending).toHaveLength(1);
    expect(useBlocks.getState().bests["7"]).toBe(501);
    await vi.waitFor(() => expect(api.blocksSubmit).toHaveBeenCalled()); // gửi sau khi đọc xong dữ liệu trên máy
    const sent = api.blocksSubmit.mock.calls[0][0];
    expect(sent[0]).toMatchObject({ score: 501, moves: 21, lines: 6 });
    expect(sent[0].uid).toBeUndefined(); // không gửi mã người dùng lên máy chủ
    resolve({ ...board, accepted: [sent[0].id], rejected: [], newBest: true });
    await sync();
    await new Promise((r) => setTimeout(r, 0));
    expect(useBlocks.getState().pending).toHaveLength(0);
    expect(useBlocks.getState().board?.me.best).toBe(501);
    expect(recordGame()).toBeNull(); // không ghi hai lần
  });

  it("mất mạng: giữ ván trong hàng chờ, báo lỗi đồng bộ", async () => {
    api.blocksSubmit.mockRejectedValue(new Error("offline"));
    nearlyOver();
    placePiece(0, 0, 0);
    await sync();
    await new Promise((r) => setTimeout(r, 0));
    expect(useBlocks.getState().pending).toHaveLength(1);
    expect(useBlocks.getState().syncError).toBe(true);
    expect(JSON.parse(storage.get("think.blocks.pending")!)).toHaveLength(1);
  });

  it("mở app: đọc dữ liệu trên máy xong mới gửi, không ghi đè kỷ lục offline", async () => {
    // Kỷ lục chơi offline (chưa đăng nhập) cao hơn điểm trên máy chủ
    useBlocks.setState({ bests: { local: 3000 }, pending: [] });
    api.blocks.mockResolvedValue({ game: "blocks", weekStart: 0, me: { best: 1200, bestAt: 1, games: 3, lines: 9, weekBest: 0, rank: 2, weekRank: null }, leaderboard: { all: [], week: [] } });
    await sync();
    expect(useBlocks.getState().bests.local).toBe(3000);
    expect(blocksSummary(useBlocks.getState(), 7).best).toBe(3000);
  });

  it("chơi lúc chưa đăng nhập: tính cho người đăng nhập sau", async () => {
    me = null;
    nearlyOver();
    placePiece(0, 0, 0);
    expect(api.blocksSubmit).not.toHaveBeenCalled();
    expect(useBlocks.getState().pending[0].uid).toBeNull();
    me = 7;
    expect(blocksSummary(useBlocks.getState(), 7).pending).toBe(1);
    expect(blocksSummary(useBlocks.getState(), 7).best).toBe(501);
  });

  it("có người lên số 1: thông báo nhỏ (trừ khi là mình)", async () => {
    api.blocks.mockResolvedValue({ game: "blocks", weekStart: 0, me: { best: 0, bestAt: null, games: 0, lines: 0, weekBest: 0, rank: null, weekRank: null }, leaderboard: { all: [], week: [] } });
    onScoreEvent({ game: "blocks", userId: 3, name: "Bình", best: 4820, rank: 1, newLeader: true });
    onScoreEvent({ game: "blocks", userId: 3, name: "Bình", best: 5000, rank: 1, newLeader: false }); // tự phá kỷ lục của mình
    onScoreEvent({ game: "blocks", userId: 7, name: "Tôi", best: 9000, rank: 1, newLeader: true });
    onScoreEvent({ game: "blocks", userId: 4, name: "Chi", best: 100, rank: 3, newLeader: false });
    expect(toasts).toEqual(["🏆 Bình vừa đứng đầu Xếp Khối với 4.820 điểm!"]);
  });
});
