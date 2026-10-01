/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ caro: vi.fn(), caroGame: vi.fn(), caroMove: vi.fn(), caroAnswer: vi.fn(), caroResign: vi.fn(), caroRematch: vi.fn() }));
const storage = vi.hoisted(() => new Map<string, string>());
const played = vi.hoisted(() => [] as string[]);
vi.mock("../src/api", () => {
  class ApiError extends Error {
    status: number;
    data: any;
    constructor(message: string, status: number, _code?: string, data?: any) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return { api, ApiError };
});
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
vi.mock("../src/caro/sound", () => ({ setCaroSound: vi.fn(), playCaro: (n: string) => played.push(n), preloadCaroSounds: vi.fn() }));

import { ApiError } from "../src/api";
import * as E from "../src/caro/engine";
import { countdownText, makesThreat, outcomeFor, reasonText, resultTitle, signed, turnLabel } from "../src/caro/format";
import {
  bindCaro,
  botStatsOf,
  canUndo,
  caroBadge,
  loadCaro,
  loadLocal,
  newBotGame,
  onCaroEvent,
  openBot,
  closeBot,
  openGame,
  playBot,
  playMove,
  resetCaro,
  swapBot,
  turnLeft,
  undoBot,
  useCaro,
  validBot,
} from "../src/caro/store";
import type { CaroGame } from "../src/caro/types";

// Luật bản web / máy chủ (public/caro-core.js) để so khớp: hai bản phải chơi y hệt nhau
const requireCjs = createRequire(import.meta.url);
const Web = requireCjs("../../public/caro-core.js");

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const at = (r: number, c: number) => r * E.SIZE + c;

/** Ván từ danh sách nước (bỏ qua kiểm tra lượt): X ở các ô xs, O ở các ô os, đi xen kẽ */
function movesOf(xs: number[], os: number[]) {
  const out: number[] = [];
  for (let k = 0; k < Math.max(xs.length, os.length); k++) {
    if (k < xs.length) out.push(xs[k]);
    if (k < os.length) out.push(os[k]);
  }
  return out;
}

describe("luật cờ caro", () => {
  it("X đi trước, hai bên đi xen kẽ, không đánh vào ô đã có quân", () => {
    let g = E.newGame();
    g = E.play(g, 112)!;
    expect(g.board[112]).toBe(E.X);
    g = E.play(g, 113)!;
    expect(g.board[113]).toBe(E.O);
    expect(E.play(g, 112)).toBeNull();
    expect(E.play(g, -1)).toBeNull();
    expect(E.play(g, 225)).toBeNull();
    expect(E.turnAfter(2)).toBe(E.X);
    expect(E.cellName(0)).toBe("A15");
    expect(E.cellName(112)).toBe("H8");
    expect(E.cellName(224)).toBe("O1");
  });

  it("5 quân liền (ngang, dọc, chéo) là thắng; ván thắng rồi không đi tiếp được", () => {
    const lines = [
      [0, 1, 2, 3, 4].map((k) => at(7, 3 + k)),
      [0, 1, 2, 3, 4].map((k) => at(2 + k, 9)),
      [0, 1, 2, 3, 4].map((k) => at(4 + k, 4 + k)),
      [0, 1, 2, 3, 4].map((k) => at(3 + k, 12 - k)),
    ];
    for (const xs of lines) {
      const os = [at(14, 0), at(14, 2), at(14, 4), at(14, 6)];
      const g = E.fromMoves(movesOf(xs, os));
      expect(g.winner).toBe(E.X);
      expect([...g.line!].sort((a, b) => a - b)).toEqual([...xs].sort((a, b) => a - b));
      expect(E.play(g, at(0, 14))).toBeNull();
    }
    // 4 quân chưa thắng
    expect(E.fromMoves(movesOf([at(7, 3), at(7, 4), at(7, 5), at(7, 6)], [0, 1, 2])).winner).toBe(0);
  });

  it("luật chặn hai đầu: bị O chặn cả hai đầu thì không tính; mép bàn không tính là chặn", () => {
    const xs = [1, 2, 3, 4, 5].map((c) => at(7, c));
    const blocked = movesOf(xs, [at(7, 0), at(7, 6), at(0, 0), at(0, 2)]);
    expect(E.fromMoves(blocked, "free").winner).toBe(E.X);
    expect(E.fromMoves(blocked, "block2").winner).toBe(0);
    // Một đầu là mép bàn: vẫn thắng
    const edge = movesOf([0, 1, 2, 3, 4].map((c) => at(3, c)), [at(3, 5), at(0, 0), at(0, 2), at(0, 4)]);
    expect(E.fromMoves(edge, "block2").winner).toBe(E.X);
    expect(E.newGame("lạ" as E.Rule).rule).toBe("free");
  });

  it("kín bàn mà không ai có 5 quân: hòa", () => {
    const board = new Array(E.CELLS).fill(0).map((_, i) => ((Math.floor((i % 15) / 2) + Math.floor(i / 15)) % 2 === 0 ? E.X : E.O));
    for (let i = 0; i < E.CELLS; i++) expect(E.winLine(board, i)).toBeNull();
    const last = at(0, 0); // ô của X
    const before = { ...E.newGame(), board: board.map((v, i) => (i === last ? 0 : v)), moves: new Array(224).fill(0).map((_, k) => (k < last ? k : k + 1)) };
    const g = E.play(before, last)!;
    expect(g.winner).toBe(3);
    expect(g.line).toBeNull();
  });

  it("nhận ra thế 4 (còn một nước là thắng)", () => {
    const g = E.fromMoves(movesOf([at(7, 3), at(7, 4), at(7, 5), at(7, 6)], [0, 1, 2]));
    expect(makesThreat(g.board, at(7, 6))).toBe(true);
    const three = E.fromMoves(movesOf([at(7, 3), at(7, 4), at(7, 5)], [0, 1]));
    expect(makesThreat(three.board, at(7, 5))).toBe(false);
    // "4 gãy" X X _ X X cũng là thế 4
    const split = E.fromMoves(movesOf([at(5, 2), at(5, 3), at(5, 5), at(5, 6)], [0, 1, 2]));
    expect(makesThreat(split.board, at(5, 6))).toBe(true);
  });

  it("máy: đánh nước thắng, chặn đường 5 của đối thủ", () => {
    const rand = seeded(4);
    // Máy (X) có 4 quân: đi nước thứ 5
    const win = E.fromMoves(movesOf([at(7, 3), at(7, 4), at(7, 5), at(7, 6)], [at(0, 0), at(0, 2), at(0, 4), at(0, 6)]));
    for (const level of E.LEVELS) expect([at(7, 2), at(7, 7)]).toContain(E.bestMove(win, level, rand));
    // Máy (O) phải chặn 4 quân mở của X
    const block = E.fromMoves(movesOf([at(7, 3), at(7, 4), at(7, 5), at(7, 6)], [at(0, 0), at(0, 2), at(14, 14)]));
    for (const level of ["medium", "hard"] as const) expect([at(7, 2), at(7, 7)]).toContain(E.bestMove(block, level, rand));
    expect(E.bestMove(E.newGame(), "hard")).toBe(112);
  });
});

describe("bản app và bản web / máy chủ chơi y hệt nhau", () => {
  it("cùng luật trên các ván ngẫu nhiên (cả hai luật)", () => {
    for (const seed of [3, 17, 99, 2024]) {
      for (const rule of E.RULES) {
        const rand = seeded(seed);
        let a = E.newGame(rule);
        let b = Web.newGame(rule);
        for (let step = 0; step < 160 && !a.winner; step++) {
          // Đánh gần các quân đã có cho ván dày, dễ ra 5 quân
          const cand = E.candidates(a.board);
          expect(cand).toEqual(Web.candidates(b.board));
          const i = cand[Math.floor(rand() * cand.length)];
          const t = E.turnAfter(a.moves.length);
          expect(E.threatsAt(a.board, i, t)).toEqual(Web.threatsAt(b.board, i, t));
          a = E.play(a, i)!;
          b = Web.play(b, i);
          expect(a).toEqual(b);
        }
        expect(E.fromMoves(a.moves, rule)).toEqual(Web.fromMoves(a.moves, rule));
      }
    }
  });

  it("máy chọn cùng nước ở mọi mức (cùng nguồn ngẫu nhiên)", () => {
    for (const seed of [1, 5, 8]) {
      for (const level of E.LEVELS) {
        const ra = seeded(seed * 31);
        const rb = seeded(seed * 31);
        let a = E.newGame(seed % 2 ? "free" : "block2");
        let b = Web.newGame(a.rule);
        // Hai máy cùng mức đánh với nhau vài chục nước
        for (let step = 0; step < 24 && !a.winner; step++) {
          const i = E.bestMove(a, level, ra);
          expect(Web.bestMove(b, level, rb)).toBe(i);
          a = E.play(a, i)!;
          b = Web.play(b, i);
        }
        expect(a).toEqual(b);
      }
    }
  });
});

describe("chữ hiển thị cờ caro", () => {
  const fin = (over: Partial<CaroGame>) => ({ status: "finished", result: "x", reason: "five", ...over }) as CaroGame;

  it("thời gian, kết quả, lý do", () => {
    expect(turnLabel(30000)).toBe("30 giây/nước");
    expect(turnLabel(120000)).toBe("2 phút/nước");
    expect(turnLabel(0)).toBe("Không giới hạn giờ");
    expect(countdownText(29100)).toBe("0:30");
    expect(countdownText(65000)).toBe("1:05");
    expect(countdownText(-3)).toBe("0:00");
    expect(signed(19)).toBe("+19");
    expect(signed(-7)).toBe("−7");
    expect(outcomeFor(fin({}), "x")).toBe("win");
    expect(outcomeFor(fin({}), "o")).toBe("loss");
    expect(outcomeFor(fin({ result: "draw", reason: "full" }), "o")).toBe("draw");
    expect(outcomeFor(fin({ status: "aborted", result: null, reason: "aborted" }), "x")).toBe("aborted");
    expect(resultTitle(fin({}), "x")).toBe("Bạn thắng!");
    expect(resultTitle(fin({}), "o")).toBe("Bạn thua");
    expect(reasonText(fin({}), "x")).toBe("5 quân liền");
    expect(reasonText(fin({}), "o", "Minh")).toBe("Minh có 5 quân liền");
    expect(reasonText(fin({ reason: "resign" }), "x")).toBe("Đối thủ đầu hàng");
    expect(reasonText(fin({ reason: "resign" }), "o")).toBe("Bạn đã đầu hàng");
    expect(reasonText(fin({ reason: "timeout" }), "o")).toBe("Bạn hết giờ");
  });
});

/* =========================================================
   Ván với máy (lưu trên máy)
   ========================================================= */

describe("chơi với máy", () => {
  let me = 7;
  beforeEach(async () => {
    vi.useFakeTimers();
    storage.clear();
    played.length = 0;
    me = 7;
    bindCaro({ meId: () => me, nameOf: () => "Minh", toast: () => undefined, onCaro: () => false });
    await loadLocal();
    closeBot();
    useCaro.setState({ bot: null, stats: {}, botOpen: false, thinking: false });
  });
  afterEach(() => {
    closeBot();
    vi.useRealTimers();
  });

  it("ván mới được lưu; mình đi, máy nghĩ một lát rồi trả lời", async () => {
    await openBot();
    const g = useCaro.getState().bot!;
    expect(g.moves).toEqual([]);
    expect(JSON.parse(storage.get("think.caro.bot")!).id).toBe(g.id);
    expect(JSON.parse(storage.get("think.caro.botPrefs")!)).toEqual({ level: "medium", side: "x", rule: "free" });
    expect(playBot(112)).toBe(true);
    expect(useCaro.getState().thinking).toBe(true);
    expect(playBot(113)).toBe(false); // máy đang nghĩ
    await vi.advanceTimersByTimeAsync(750);
    const after = useCaro.getState().bot!;
    expect(after.moves).toHaveLength(2);
    expect(useCaro.getState().thinking).toBe(false);
    expect(JSON.parse(storage.get("think.caro.bot")!).moves).toEqual(after.moves);
    expect(playBot(after.moves[1])).toBe(false); // ô đã có quân
  });

  it("đi lại: bỏ nước của máy và nước của mình", async () => {
    useCaro.setState({ botOpen: true });
    newBotGame({ level: "easy", side: "x", rule: "free" });
    playBot(112);
    await vi.advanceTimersByTimeAsync(750);
    playBot(at(2, 2));
    await vi.advanceTimersByTimeAsync(750);
    expect(useCaro.getState().bot!.moves).toHaveLength(4);
    expect(undoBot()).toBe(true);
    expect(useCaro.getState().bot!.moves).toHaveLength(2);
    expect(undoBot()).toBe(true);
    expect(useCaro.getState().bot!.moves).toEqual([]);
    expect(canUndo(useCaro.getState().bot)).toBe(false);
    expect(undoBot()).toBe(false);
  });

  it("thắng thì ghi thành tích theo mức; đi lại thì bỏ kết quả đó", async () => {
    useCaro.setState({ botOpen: true });
    newBotGame({ level: "hard", side: "x", rule: "free" });
    // Dựng thế 4 quân của mình, tới lượt mình
    const g = useCaro.getState().bot!;
    useCaro.setState({ bot: { ...g, moves: movesOf([at(7, 3), at(7, 4), at(7, 5), at(7, 6)], [0, 1, 2, 3]) } });
    expect(playBot(at(7, 7))).toBe(true);
    expect(useCaro.getState().bot!.result).toBe("win");
    expect(useCaro.getState().thinking).toBe(false);
    expect(botStatsOf(useCaro.getState(), 7).hard).toEqual({ win: 1, loss: 0, draw: 0 });
    expect(JSON.parse(storage.get("think.caro.botStats")!)["7"].hard.win).toBe(1);
    expect(playBot(at(10, 10))).toBe(false); // ván đã xong
    undoBot();
    expect(useCaro.getState().bot!.result).toBeNull();
    expect(botStatsOf(useCaro.getState(), 7).hard.win).toBe(0);
    // Chơi khi chưa đăng nhập: thành tích để riêng
    me = 0;
    expect(botStatsOf(useCaro.getState(), null).hard.win).toBe(0);
  });

  it("đổi bên: mình cầm O, máy đi trước", async () => {
    useCaro.setState({ botOpen: true });
    newBotGame({ level: "easy", side: "x", rule: "block2" });
    const g2 = swapBot()!;
    expect(g2.side).toBe("o");
    expect(g2.rule).toBe("block2");
    await vi.advanceTimersByTimeAsync(500);
    expect(useCaro.getState().bot!.moves).toEqual([112]);
    // Đóng màn chơi thì máy thôi nghĩ
    newBotGame({ level: "easy", side: "o", rule: "free" });
    closeBot();
    await vi.advanceTimersByTimeAsync(1000);
    expect(useCaro.getState().bot!.moves).toEqual([]);
  });

  it("chỉ nhận ván lưu hợp lệ", () => {
    const ok = { v: 1, id: 1, level: "easy", side: "x", pref: "x", rule: "free", moves: [112, 113], result: null, startedAt: 1, updatedAt: 1 };
    expect(validBot(ok)).toBe(true);
    expect(validBot({ ...ok, moves: [112, 112] })).toBe(false);
    expect(validBot({ ...ok, level: "god" })).toBe(false);
    expect(validBot({ ...ok, moves: [300] })).toBe(false);
    expect(validBot(null)).toBe(false);
  });
});

/* =========================================================
   Ván với bạn bè
   ========================================================= */

function game(over: Partial<CaroGame> = {}): CaroGame {
  const now = Date.now();
  return {
    id: 1,
    status: "active",
    xId: 1,
    oId: 2,
    challengerId: 1,
    opponentId: 2,
    sidePref: "x",
    rule: "free",
    turnMs: 30000,
    rated: true,
    moves: [],
    turn: "x",
    result: null,
    reason: null,
    winLine: null,
    xRating: null,
    oRating: null,
    xDelta: null,
    oDelta: null,
    turnStartedAt: now,
    createdAt: now,
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    serverTime: now,
    ...over,
  };
}

describe("thách đấu bạn bè", () => {
  const toasts: { text: string; id?: number }[] = [];
  let onCaro = false;
  beforeEach(() => {
    resetCaro();
    toasts.length = 0;
    onCaro = false;
    for (const f of Object.values(api)) f.mockReset();
    api.caroGame.mockResolvedValue({ game: game() });
    bindCaro({ meId: () => 1, nameOf: (id) => (id === 2 ? "Minh" : "Bạn"), toast: (text, extra) => toasts.push({ text, id: extra?.caroGameId }), onCaro: () => onCaro });
  });
  afterEach(() => vi.useRealTimers());

  it("hiện nước đi ngay, máy chủ nhận thì giữ nguyên", async () => {
    onCaroEvent("caro:game", { game: game() });
    let resolve!: (v: any) => void;
    api.caroMove.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = playMove(1, 112);
    const shown = useCaro.getState().games[1];
    expect(shown.moves).toEqual([112]);
    expect(shown.turn).toBe("o");
    expect(useCaro.getState().sending[1]).toBe(true);
    expect(caroBadge(useCaro.getState(), 1)).toBe(0); // hết lượt mình
    resolve({ game: game({ moves: [112], turn: "o" }) });
    expect(await p).toBe(true);
    expect(api.caroMove).toHaveBeenCalledWith(1, 112, 0);
    expect(useCaro.getState().sending[1]).toBe(false);
  });

  it("máy chủ từ chối: trả bàn về như cũ, báo lỗi, tải lại ván", async () => {
    onCaroEvent("caro:game", { game: game() });
    api.caroMove.mockRejectedValue(new ApiError("Bạn đã hết giờ.", 409));
    expect(await playMove(1, 112)).toBe(false);
    expect(useCaro.getState().games[1].moves).toEqual([]);
    expect(toasts.map((t) => t.text)).toContain("Bạn đã hết giờ.");
    expect(api.caroGame).toHaveBeenCalledWith(1);
  });

  it("mất mạng: gửi lại đúng nước đó (cùng ply)", async () => {
    vi.useFakeTimers();
    onCaroEvent("caro:game", { game: game({ moves: [112, 113], turn: "x" }) });
    api.caroMove.mockRejectedValueOnce(new ApiError("Không kết nối được máy chủ.", 0)).mockResolvedValueOnce({ game: game({ moves: [112, 113, 114], turn: "o" }) });
    const p = playMove(1, 114);
    await vi.advanceTimersByTimeAsync(900);
    expect(await p).toBe(true);
    expect(api.caroMove).toHaveBeenCalledTimes(2);
    expect(api.caroMove.mock.calls.every((c) => c[1] === 114 && c[2] === 2)).toBe(true);
    expect(toasts).toHaveLength(0);
  });

  it("không đi khi chưa tới lượt, ô đã có quân hay ván đã xong", async () => {
    onCaroEvent("caro:game", { game: game({ moves: [112], turn: "o" }) });
    expect(await playMove(1, 113)).toBe(false);
    onCaroEvent("caro:game", { game: game({ moves: [112, 113], turn: "x" }) });
    expect(await playMove(1, 113)).toBe(false);
    expect(api.caroMove).not.toHaveBeenCalled();
  });

  it("realtime: bỏ bản cũ đến trễ, ván đã xong không quay lại đang chơi", () => {
    onCaroEvent("caro:game", { game: game({ moves: [112, 113], turn: "x" }) });
    onCaroEvent("caro:game", { game: game({ moves: [112], turn: "o" }) });
    expect(useCaro.getState().games[1].moves).toHaveLength(2);
    onCaroEvent("caro:game", { game: game({ moves: [112, 113], status: "finished", result: "o", reason: "resign" }) });
    onCaroEvent("caro:game", { game: game({ moves: [112, 113, 114], turn: "o" }) });
    expect(useCaro.getState().games[1].status).toBe("finished");
  });

  it("báo lời thách đấu mới, đối thủ vừa đi, lời thách đấu được nhận", async () => {
    onCaroEvent("caro:challenge", { game: game({ id: 5, status: "challenge", challengerId: 2, opponentId: 1, xId: null, oId: null, turnMs: 60000, rule: "block2" }) });
    expect(toasts[0]).toEqual({ text: "Minh thách bạn một ván caro (1 phút/nước, luật chặn hai đầu). Chạm để xem.", id: 5 });
    expect(caroBadge(useCaro.getState(), 1)).toBe(1);
    onCaroEvent("caro:game", { game: game({ id: 6, xId: 2, oId: 1, moves: [112], turn: "o" }) });
    onCaroEvent("caro:game", { game: game({ id: 6, xId: 2, oId: 1, moves: [112, 113], turn: "x" }) });
    onCaroEvent("caro:game", { game: game({ id: 6, xId: 2, oId: 1, moves: [112, 113, 114], turn: "o" }) });
    expect(toasts.at(-1)).toEqual({ text: "Minh vừa đi. Tới lượt bạn!", id: 6 });
    expect(caroBadge(useCaro.getState(), 1)).toBe(2);
    // Lời mình gửi được nhận khi đang ở trang Cờ caro: vào ván luôn
    onCaroEvent("caro:challenge", { game: game({ id: 7, status: "challenge", xId: null, oId: null }) });
    onCaroEvent("caro:game", { game: game({ id: 7, status: "active", xId: 2, oId: 1 }) });
    expect(toasts.at(-1)?.text).toBe("Minh đã nhận lời. Chạm để vào chơi!");
    onCaro = true;
    onCaroEvent("caro:challenge", { game: game({ id: 8, status: "challenge", xId: null, oId: null }) });
    onCaroEvent("caro:game", { game: game({ id: 8, status: "active" }) });
    expect(useCaro.getState().openId).toBe(8);
  });

  it("tải tổng quan: bỏ ván không còn, giữ ván đang mở và ván vừa có sự kiện", async () => {
    onCaroEvent("caro:challenge", { game: game({ id: 3, status: "challenge", xId: null, oId: null }) });
    await openGame(4).catch(() => undefined);
    useCaro.setState((s) => ({ games: { ...s.games, 4: game({ id: 4 }) } }));
    let resolve!: (v: any) => void;
    api.caro.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = loadCaro();
    onCaroEvent("caro:challenge", { game: game({ id: 9, status: "challenge", challengerId: 2, opponentId: 1, xId: null, oId: null }) });
    resolve({ games: [game({ id: 10, status: "finished", result: "x", reason: "five" })], me: { userId: 1, rating: 1210, peak: 1210, games: 1, wins: 1, draws: 0, losses: 0 }, leaderboard: [], options: { turnSeconds: [0, 30], rules: ["free"] } });
    await p;
    const ids = Object.keys(useCaro.getState().games).map(Number).sort((a, b) => a - b);
    expect(ids).toEqual([4, 9, 10]);
    expect(useCaro.getState().me?.rating).toBe(1210);
    expect(useCaro.getState().options.turnSeconds).toEqual([0, 30]);
  });

  it("đồng hồ mỗi nước theo giờ máy chủ", () => {
    const g = game({ turnStartedAt: 1_000_000, turnMs: 30000 });
    // Giờ máy chủ nhanh hơn điện thoại 5 giây
    expect(turnLeft(g, 5000, 1_000_000)).toBe(25000);
    expect(turnLeft(g, 0, 1_040_000)).toBe(0);
    expect(turnLeft({ ...g, turnMs: 0 }, 0, 1_000_000)).toBeNull();
  });
});
