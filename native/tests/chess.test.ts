/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  chess: vi.fn(),
  chessMove: vi.fn(),
  chessGame: vi.fn(),
  chessHistory: vi.fn(),
  chessAnalysis: vi.fn(),
  chessAnalyze: vi.fn(),
}));

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

import { ApiError } from "../src/api";
import { clockText, coachText, evalText, material, MOVE_CLASS, moveComment, outcomeFor, replay, resultTitle, tcLabel } from "../src/chess/format";
import {
  bindChess,
  chessBadge,
  closeGame,
  loadHistory,
  onAnalysisEvent,
  onChessEvent,
  openGame,
  playMove,
  requestAnalysis,
  resetChess,
  useChess,
} from "../src/chess/store";
import type { ChessGame } from "../src/chess/types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function game(over: Partial<ChessGame> = {}): ChessGame {
  return {
    id: 1,
    status: "active",
    rated: true,
    whiteId: 1,
    blackId: 2,
    bot: null,
    botColor: null,
    challengerId: 1,
    opponentId: 2,
    colorPref: "white",
    base: 300000,
    inc: 2000,
    moves: [],
    fen: START,
    turn: "w",
    clocks: { w: 300000, b: 300000 },
    serverNow: Date.now(),
    firstMoveDeadline: null,
    drawOffer: null,
    result: null,
    reason: null,
    ratings: { w: 1200, b: 1200 },
    deltas: { w: null, b: null },
    live: { w: 1200, b: 1200 },
    createdAt: 1,
    startedAt: 1,
    endedAt: null,
    expiresAt: null,
    ...over,
  };
}

describe("chữ hiển thị cờ vua", () => {
  it("ghi thời gian ván", () => {
    expect(tcLabel({ base: 300000, inc: 3000 })).toBe("5+3");
    expect(tcLabel({ base: 0, inc: 0 })).toBe("Không giới hạn");
  });

  it("đồng hồ: phút:giây, dưới 10 giây có phần mười", () => {
    expect(clockText(245000)).toBe("4:05");
    expect(clockText(3600000 + 65000)).toBe("1:01:05");
    expect(clockText(9340)).toBe("0:09.3");
    expect(clockText(-5)).toBe("0:00.0");
  });

  it("kết quả nhìn từ phía mình", () => {
    const g = game({ status: "finished", result: "0-1", reason: "checkmate" });
    expect(outcomeFor(g, "b")).toBe("win");
    expect(outcomeFor(g, "w")).toBe("loss");
    expect(resultTitle(g, null)).toBe("Đen thắng");
    expect(outcomeFor(game({ status: "aborted" }), "w")).toBe("aborted");
  });

  it("dựng lại ký hiệu nước đi", () => {
    const r = replay(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1"]);
    expect(r.san).toEqual(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "O-O"]);
    expect(r.fens).toHaveLength(8);
  });

  it("đếm quân đã ăn và điểm hơn", () => {
    // Trắng đã ăn một mã đen
    const m = material("r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(m.captured.w).toEqual(["bN"]);
    expect(m.lead).toEqual({ w: 3, b: 0 });
  });

  it("đếm việc cần làm ở tab Cờ vua", () => {
    const s = {
      games: {
        1: game({ id: 1, turn: "w" }), // tới lượt mình (trắng)
        2: game({ id: 2, turn: "b" }),
        3: game({ id: 3, status: "challenge", opponentId: 1, challengerId: 2, whiteId: null, blackId: null }),
        4: game({ id: 4, status: "challenge", opponentId: 2, challengerId: 1, whiteId: null, blackId: null }),
      },
    } as any;
    expect(chessBadge(s, 1)).toBe(2);
  });
});

describe("đi quân", () => {
  const toasts: string[] = [];
  beforeEach(() => {
    resetChess();
    toasts.length = 0;
    api.chessMove.mockReset();
    api.chessGame.mockReset();
    bindChess({
      meId: () => 1,
      nameOf: (id) => (id === 2 ? "Minh" : "Bạn"),
      toast: (t) => toasts.push(t),
      onTab: () => false,
      showChess: () => undefined,
    });
  });

  it("hiện nước đi ngay, máy chủ nhận thì giữ nguyên", async () => {
    onChessEvent("chess:game", { game: game() });
    let resolve!: (v: any) => void;
    api.chessMove.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = playMove(1, "e2e4");
    const shown = useChess.getState().games[1];
    expect(shown.moves).toEqual(["e2e4"]);
    expect(shown.turn).toBe("b");
    expect(useChess.getState().sending[1]).toBe(true);
    resolve({ game: { ...shown, serverNow: Date.now() } });
    expect(await p).toBe(true);
    expect(useChess.getState().sending[1]).toBe(false);
    expect(api.chessMove).toHaveBeenCalledWith(1, "e2e4", 0);
  });

  it("máy chủ từ chối thì trả bàn cờ về như cũ", async () => {
    onChessEvent("chess:game", { game: game() });
    api.chessMove.mockRejectedValue(new ApiError("Nước đi không hợp lệ.", 400, undefined, { game: game() }));
    expect(await playMove(1, "e2e4")).toBe(false);
    expect(useChess.getState().games[1].moves).toEqual([]);
    expect(toasts).toContain("Nước đi không hợp lệ.");
  });

  it("không cho đi nước sai luật hay khi chưa tới lượt", async () => {
    onChessEvent("chess:game", { game: game() });
    expect(await playMove(1, "e2e5")).toBe(false);
    expect(api.chessMove).not.toHaveBeenCalled();
  });

  it("xem ván của người khác: luôn lấy bản mới; đóng ván thì báo cho màn chính", async () => {
    const closed = vi.fn();
    bindChess({ meId: () => 1, nameOf: () => "Minh", toast: () => undefined, onTab: () => false, showChess: () => undefined, closed });
    onChessEvent("chess:game", { game: game({ id: 5, whiteId: 2, blackId: 3 }) });
    api.chessGame.mockResolvedValueOnce({ game: game({ id: 5, whiteId: 2, blackId: 3, moves: ["e2e4"], turn: "b" }) });
    await openGame(5);
    await Promise.resolve();
    expect(api.chessGame).toHaveBeenCalledWith(5);
    expect(useChess.getState().games[5].moves).toEqual(["e2e4"]);
    api.chessGame.mockClear();
    onChessEvent("chess:game", { game: game({ id: 6 }) }); // ván của mình: dùng bản đang có
    await openGame(6);
    expect(api.chessGame).not.toHaveBeenCalled();
    closeGame();
    expect(useChess.getState().openId).toBeNull();
    expect(closed).toHaveBeenCalled();
  });

  it("báo khi đối thủ đi mà mình đang ở chỗ khác", () => {
    onChessEvent("chess:game", { game: game({ moves: ["e2e4"], turn: "b", whiteId: 2, blackId: 1 }) });
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5"], turn: "w", whiteId: 2, blackId: 1 }) });
    expect(toasts).toHaveLength(0); // lượt của Minh (trắng), không phải của mình
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5", "g1f3"], turn: "b", whiteId: 2, blackId: 1 }) });
    expect(toasts[0]).toContain("Minh vừa đi");
  });

  it("bỏ qua bản cũ đến trễ", () => {
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5"], turn: "w" }) });
    onChessEvent("chess:game", { game: game({ moves: ["e2e4"], turn: "b" }) });
    expect(useChess.getState().games[1].moves).toHaveLength(2);
  });

  it("ván đã xong không bị bản cũ đến trễ đưa về đang chơi", () => {
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5"], turn: "w" }) });
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5"], status: "finished", result: "1-0", reason: "resign" }) });
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5", "g1f3"], turn: "b" }) });
    expect(useChess.getState().games[1].status).toBe("finished");
  });

  it("báo lời thách đấu mới", () => {
    onChessEvent("chess:challenge", {
      game: game({ id: 9, status: "challenge", challengerId: 2, opponentId: 1, whiteId: null, blackId: null }),
    });
    expect(toasts[0]).toContain("Minh thách bạn một ván 5+2");
  });
});

describe("phân tích và lịch sử", () => {
  const toasts: { text: string; gameId?: number }[] = [];
  beforeEach(() => {
    resetChess();
    toasts.length = 0;
    bindChess({
      meId: () => 1,
      nameOf: () => "Minh",
      toast: (text, extra) => toasts.push({ text, gameId: extra?.chessGameId }),
      onTab: () => false,
      showChess: () => undefined,
    });
  });

  it("ghi điểm đánh giá dễ đọc", () => {
    expect(evalText({ cp: 134, mate: null, wp: 60 })).toBe("+1.3");
    expect(evalText({ cp: -50, mate: null, wp: 45 })).toBe("−0.5");
    expect(evalText({ cp: null, mate: 3, wp: 100 })).toBe("M3");
    expect(evalText({ cp: null, mate: -2, wp: 0 })).toBe("M2");
    expect(evalText({ cp: null, mate: null, wp: 0, end: "checkmate" })).toBe("0-1");
    expect(evalText({ cp: 0, mate: null, wp: 50, end: "draw" })).toBe("½-½");
  });

  it("nhận xét nước đi kiểu huấn luyện viên", () => {
    const before = { cp: 20, mate: null, wp: 52, best: "d8e7", bestSan: "Qe7" };
    expect(moveComment({ ply: 6, uci: "g8f6", san: "Nf6", color: "b", cls: "blunder", loss: 48, accuracy: 3, allowsMate: 1 }, before)).toBe(
      "3… Nf6 là sai lầm nghiêm trọng. Nước tốt nhất là Qe7. Đối thủ có thể chiếu hết sau 1 nước.",
    );
    const best = { cp: 20, mate: null, wp: 52, best: "e2e4", bestSan: "e4" };
    expect(moveComment({ ply: 1, uci: "e2e4", san: "e4", color: "w", cls: "best", loss: 0, accuracy: 100 }, best)).toBe("1. e4 là nước tốt nhất. Đúng nước máy chọn.");
    expect(coachText({ ply: 9, uci: "f3e5", san: "Nxe5", color: "w", cls: "brilliant", loss: 0, accuracy: 100, sac: "q" }, best)).toEqual({
      title: "Nxe5 là nước thiên tài!",
      detail: "Thí Hậu rất đẹp mà thế cờ vẫn tốt nhất. Không dễ nhìn ra đâu!",
    });
    expect(coachText({ ply: 3, uci: "g1f3", san: "Nf3", color: "w", cls: "book", loss: 0, accuracy: 100 }, best, { opening: { eco: "C40", name: "King's Knight Opening", ply: 3 } }).detail).toBe(
      "Khai cuộc: King's Knight Opening.",
    );
    expect(coachText({ ply: 20, uci: "a2a3", san: "a3", color: "w", cls: "miss", loss: 30, accuracy: 20, missedMate: 2 }, { ...best, best: "d1h5", bestSan: "Qh5+" }).detail).toBe(
      "Bạn đã có đường chiếu hết sau 2 nước, bắt đầu bằng Qh5+.",
    );
    expect(Object.keys(MOVE_CLASS)).toEqual(expect.arrayContaining(["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder"]));
  });

  it("kết quả phân tích không bị tin tiến độ cũ đè lên, xong thì báo", async () => {
    onAnalysisEvent({ gameId: 5, analysis: { status: "running", progress: 1, total: 8 } });
    onAnalysisEvent({ gameId: 5, analysis: { status: "done", progress: 8, total: 8, result: { engine: "Stockfish 11" } as any } });
    onAnalysisEvent({ gameId: 5, analysis: { status: "running", progress: 7, total: 8 } });
    expect(useChess.getState().analyses[5].status).toBe("done");
    expect(toasts.at(-1)).toEqual({ text: "Đã phân tích xong ván cờ. Chạm để xem.", gameId: 5 });
    api.chessAnalyze.mockRejectedValue(new Error("Máy đang bận"));
    await requestAnalysis(9);
    expect(toasts.at(-1)?.text).toBe("Máy đang bận");
  });

  it("tải lịch sử theo trang", async () => {
    api.chessHistory.mockResolvedValueOnce({ games: [game({ id: 30, status: "finished", endedAt: 300 }), game({ id: 29, status: "finished", endedAt: 290 })], hasMore: true });
    await loadHistory();
    expect(useChess.getState().history).toMatchObject({ ids: [30, 29], hasMore: true, loaded: true });
    api.chessHistory.mockResolvedValueOnce({ games: [game({ id: 28, status: "finished", endedAt: 280 })], hasMore: false });
    await loadHistory(true);
    expect(api.chessHistory).toHaveBeenLastCalledWith(290, 29);
    expect(useChess.getState().history.ids).toEqual([30, 29, 28]);
    await loadHistory(true); // hết trang: không gọi nữa
    expect(api.chessHistory).toHaveBeenCalledTimes(2);
  });
});
