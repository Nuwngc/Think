/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  chess: vi.fn(),
  chessMove: vi.fn(),
  chessGame: vi.fn(),
  chessHistory: vi.fn(),
  chessAnalysis: vi.fn(),
  chessAnalyze: vi.fn(),
  chessHint: vi.fn(),
  chessTakeback: vi.fn(),
  chessSay: vi.fn(),
  chessTakebackAsk: vi.fn(),
  chessPgn: vi.fn(),
  chessLive: vi.fn(),
  chessTournaments: vi.fn(),
  chessTournament: vi.fn(),
  chessCreateTournament: vi.fn(),
  chessTournamentAct: vi.fn(),
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
import { playAt, pvText } from "../src/chess/analysisBoard";
import { localState, localStatusText } from "../src/chess/local";
import { BOARD_THEMES, themeOf } from "../src/chess/prefs";
import { movesFromPgn, pgnOf } from "../src/chess/pgn";
import { premoveTargets, resolvePremove } from "../src/chess/premove";
import {
  askHint,
  askTakeback,
  closeTournament,
  createTournament,
  loadLive,
  myTournaments,
  onChessRefresh,
  onTournamentEvent,
  openTournament,
  tLabel,
  tournamentAct,
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
  sayPhrase,
  takeBack,
  useChess,
} from "../src/chess/store";
import type { ChessGame, ChessTournament } from "../src/chess/types";

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

  it("đi lại nước (takebacks tăng): nhận bản ít nước hơn; bản cũ từ trước lần đi lại thì bỏ", () => {
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5"], turn: "w", takebacks: 0 }) });
    onChessEvent("chess:game", { game: game({ moves: [], turn: "w", takebacks: 1 }) });
    expect(useChess.getState().games[1].moves).toEqual([]);
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5"], turn: "w", takebacks: 0 }) });
    expect(useChess.getState().games[1].moves).toEqual([]);
    onChessEvent("chess:game", { game: game({ moves: ["d2d4"], turn: "b", takebacks: 1 }) });
    expect(useChess.getState().games[1].moves).toEqual(["d2d4"]);
  });

  it("gợi ý và đi lại trong ván với máy", async () => {
    const bot = { id: "ma", name: "Mã Phi", elo: 900, about: "", source: { name: "x", url: "https://x", license: "MIT" } };
    onChessEvent("chess:game", { game: game({ moves: ["e2e4", "e7e5"], turn: "w", bot, botColor: "b", blackId: null }) });
    api.chessHint.mockResolvedValue({ move: "g1f3", game: game({ moves: ["e2e4", "e7e5"], turn: "w", bot, botColor: "b", blackId: null, hints: 1 }) });
    await askHint(1);
    expect(useChess.getState().hint).toEqual({ gameId: 1, ply: 2, move: "g1f3" });
    expect(useChess.getState().games[1].hints).toBe(1);
    api.chessTakeback.mockResolvedValue({ game: game({ moves: [], turn: "w", bot, botColor: "b", blackId: null, hints: 1, takebacks: 1 }) });
    await takeBack(1);
    expect(useChess.getState().games[1].moves).toEqual([]);
    expect(useChess.getState().hint).toBeNull();
    api.chessTakeback.mockRejectedValue(new ApiError("Chưa có nước nào của bạn để đi lại.", 409));
    await takeBack(1);
    expect(toasts).toContain("Chưa có nước nào của bạn để đi lại.");
    expect(useChess.getState().helping[1]).toBe(false);
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

describe("hai người một máy", () => {
  it("dựng ván, chiếu hết, hòa, đầu hàng", () => {
    const fool = localState(["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(fool.outcome).toEqual({ result: "0-1", reason: "checkmate" });
    expect(localStatusText(fool)).toBe("Chiếu hết! Đen thắng.");
    const start = localState([]);
    expect(start.outcome).toBeNull();
    expect(localStatusText(start)).toBe("Trắng đi.");
    const check = localState(["e2e4", "f7f6", "d1h5"]);
    expect(localStatusText(check)).toContain("đang bị chiếu");
    // Nước hỏng trong dữ liệu lưu: bỏ từ đó trở đi
    expect(localState(["e2e4", "e2e4", "e7e5"]).moves).toEqual(["e2e4"]);
    // Phong cấp
    const promo = localState(["a2a4", "h7h5", "a4a5", "h5h4", "a5a6", "h4h3", "a6b7", "h3g2", "b7a8q"]);
    expect(promo.san[8]).toBe("bxa8=Q");
    expect(promo.fen.startsWith("Qn")).toBe(true);
    const resign = localState(["e2e4", "e7e5"], "b");
    expect(resign.outcome).toEqual({ result: "1-0", reason: "resign" });
    expect(localStatusText(resign)).toBe("Đen đầu hàng. Trắng thắng.");
    const rep = localState(["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]);
    expect(rep.outcome?.reason).toBe("repetition");
  });
});

describe("cờ vua 2.7", () => {
  it("cờ theo ngày: nhãn thời gian và đồng hồ ghi ngày giờ", () => {
    expect(tcLabel({ base: 0, inc: 0, daily: 3 * 86400000 })).toBe("3 ngày/nước");
    expect(clockText(2 * 86400000 + 5 * 3600000 + 1000)).toBe("2 ngày 5 giờ");
    expect(clockText(5 * 3600000)).toBe("5:00:00");
  });

  it("bàn phân tích: đi tiếp, đi nước khác thì bỏ nhánh cũ, nước sai luật", () => {
    let r = playAt([], 0, "e2e4");
    expect(r).toEqual({ moves: ["e2e4"], ply: 1, san: "e4" });
    r = playAt(["e2e4", "e7e5", "g1f3"], 1, "e7e5");
    expect(r?.moves).toEqual(["e2e4", "e7e5", "g1f3"]); // đúng nước kế tiếp: giữ các nước sau
    expect(r?.ply).toBe(2);
    r = playAt(["e2e4", "e7e5", "g1f3"], 1, "c7c5");
    expect(r?.moves).toEqual(["e2e4", "c7c5"]);
    expect(playAt(["e2e4"], 1, "e2e4")).toBeNull();
    // Phong cấp
    const promo = ["a2a4", "h7h5", "a4a5", "h5h4", "a5a6", "h4h3", "a6b7", "h3g2"];
    expect(playAt(promo, 8, "b7a8q")?.san).toBe("bxa8=Q");
  });

  it("dãy nước của máy có số nước", () => {
    expect(pvText(["Nf3", "Nc6", "Bb5"], 2, "w")).toBe("2. Nf3 Nc6 3. Bb5");
    expect(pvText(["Nc6", "Bb5", "a6"], 3, "b")).toBe("2… Nc6 3. Bb5 a6");
  });

  it("màu bàn cờ: có mặc định, mã lạ thì dùng mặc định", () => {
    expect(BOARD_THEMES.length).toBe(6);
    expect(themeOf("wood").light).toBe("#F0D9B5");
    expect(themeOf("xyz").id).toBe("green");
  });

  it("câu nói nhanh: gửi thì cập nhật ván, lỗi thì báo", async () => {
    const toasts: string[] = [];
    resetChess();
    bindChess({ meId: () => 1, nameOf: () => "Minh", toast: (t) => toasts.push(t), onTab: () => false, showChess: () => undefined });
    onChessEvent("chess:game", { game: game() });
    api.chessSay.mockResolvedValueOnce({ game: game({ chat: { color: "w", text: "Chúc may mắn!", ply: 0, at: 5 } }) });
    expect(await sayPhrase(1, "gl")).toBe(true);
    expect(useChess.getState().games[1].chat?.text).toBe("Chúc may mắn!");
    api.chessSay.mockRejectedValueOnce(new ApiError("Từ từ thôi, đợi vài giây nhé.", 429));
    expect(await sayPhrase(1, "hi")).toBe(false);
    expect(toasts).toContain("Từ từ thôi, đợi vài giây nhé.");
  });
});

function tournament(over: Partial<ChessTournament> = {}): ChessTournament {
  return {
    id: 7,
    name: "Giải mùa thu",
    creatorId: 2,
    status: "open",
    daily: 86400000,
    rated: false,
    rounds: 1,
    createdAt: 10,
    startedAt: null,
    endedAt: null,
    players: [
      { userId: 2, status: "joined" },
      { userId: 1, status: "invited" },
      { userId: 3, status: "invited" },
    ],
    standings: [],
    games: [],
    winners: [],
    ...over,
  };
}

describe("cờ vua 2.8", () => {
  it("đi trước: ô theo cách quân đi, không xét quân chắn", () => {
    const sorted = (a: string[]) => [...a].sort();
    // Tốt trắng ở hàng 2: đi 1, 2 ô và hai ô chéo (ăn quân có thể xuất hiện)
    expect(sorted(premoveTargets(START, "e2"))).toEqual(["d3", "e3", "e4", "f3"]);
    // Mã: không ra ngoài bàn; ô có quân mình vẫn đặt được (quân đó có thể bị ăn trước)
    expect(sorted(premoveTargets(START, "g1"))).toEqual(["e2", "f3", "h3"]);
    // Xe bị quân chắn vẫn có cả hàng / cột (trừ ô vua e1)
    expect(premoveTargets(START, "a1")).toHaveLength(13);
    expect(premoveTargets(START, "a1")).toContain("a8");
    // Vua ở e1: thêm ô nhập thành
    expect(premoveTargets(START, "e1")).toEqual(expect.arrayContaining(["g1", "c1", "d2"]));
    // Không bao giờ đặt vào ô vua mình
    expect(premoveTargets(START, "d1")).not.toContain("e1");
    expect(premoveTargets(START, "e4")).toEqual([]);
  });

  it("đi trước: tới lượt thì kiểm tra lại, phong cấp thành Hậu", () => {
    const after = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    expect(resolvePremove(after, { from: "g1", to: "f3" })).toBe("g1f3");
    expect(resolvePremove(after, { from: "e4", to: "e5" })).toBeNull(); // bị chặn
    expect(resolvePremove("8/P6k/8/8/8/8/8/K7 w - - 0 1", { from: "a7", to: "a8" })).toBe("a7a8q");
  });

  it("PGN: đọc ván dán vào, bỏ bình luận và nhánh phụ, báo lỗi dễ hiểu", () => {
    expect(movesFromPgn('[Event "x"]\n\n1. e4 e5 2. Nf3 {hay} Nc6 (2... d6) 3. Bb5 a6 *')).toEqual(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]);
    expect(() => movesFromPgn("1. e4 e5 2. Qh5 Ke6 3. Qxe5")).toThrow('Nước "Ke6" không hợp lệ');
    expect(() => movesFromPgn("1. e4 e5 2. Qh5 Ke9")).toThrow("Không đọc được PGN này.");
    expect(() => movesFromPgn("   ")).toThrow("Chưa có PGN để dán.");
    expect(() => movesFromPgn('[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/k7 w - - 0 1"]\n\n1. Kd3')).toThrow("thế cờ riêng");
    const pgn = pgnOf(["e2e4", "e7e5", "g1f3"], new Date(2026, 9, 6));
    expect(pgn).toContain('[Event "Bàn phân tích"]');
    expect(pgn).toContain('[Date "2026.10.06"]');
    expect(pgn).toContain("1. e4 e5 2. Nf3");
    expect(movesFromPgn(pgn)).toEqual(["e2e4", "e7e5", "g1f3"]);
  });

  it("tên giải không lặp chữ Giải", () => {
    expect(tLabel("Giải mùa thu")).toBe("Giải mùa thu");
    expect(tLabel("Cờ nhà")).toBe("Giải Cờ nhà");
  });

  it("giải đấu: lời mời báo, nhận lời, tạo giải mở trang giải, danh sách của tôi", async () => {
    const toasts: { text: string; extra?: unknown }[] = [];
    resetChess();
    bindChess({ meId: () => 1, nameOf: (id) => (id === 2 ? "Bình" : "Ai đó"), toast: (text, extra) => toasts.push({ text, extra }), onTab: () => false, showChess: () => undefined });
    onTournamentEvent({ tournament: tournament() });
    expect(toasts[0].text).toBe("Bình mời bạn vào Giải mùa thu. Chạm để xem.");
    expect(toasts[0].extra).toMatchObject({ chessTournamentId: 7 });
    expect(chessBadge(useChess.getState(), 1)).toBe(1); // lời mời vào giải là một việc cần làm
    // Nhận lời: giải bắt đầu thì tải lại cờ vua
    api.chess.mockResolvedValue({ rating: null, bots: [], challenges: [], active: [], recent: [] });
    api.chessTournaments.mockResolvedValue({ tournaments: [], dailyDays: [1, 2] });
    api.chessLive.mockResolvedValue({ games: [] });
    api.chessTournamentAct.mockResolvedValueOnce({ tournament: tournament({ status: "active", players: tournament().players.map((p) => ({ ...p, status: "joined" as const })) }) });
    const t = await tournamentAct(7, "join");
    expect(t?.status).toBe("active");
    expect(useChess.getState().tournaments[7].status).toBe("active");
    expect(api.chess).toHaveBeenCalled();
    // Lỗi: báo, tải lại giải
    api.chessTournamentAct.mockRejectedValueOnce(new ApiError("Giải đã bắt đầu, không đổi được nữa.", 409));
    api.chessTournament.mockResolvedValueOnce({ tournament: tournament({ status: "active" }) });
    expect(await tournamentAct(7, "decline")).toBeNull();
    expect(toasts.map((x) => x.text)).toContain("Giải đã bắt đầu, không đổi được nữa.");
    // Tạo giải: mở trang giải
    api.chessCreateTournament.mockResolvedValueOnce({ tournament: tournament({ id: 9, name: "Cờ nhà", creatorId: 1 }) });
    api.chessTournament.mockResolvedValueOnce({ tournament: tournament({ id: 9, name: "Cờ nhà", creatorId: 1 }) });
    await createTournament({ name: "Cờ nhà", players: [2, 3], days: 1, rounds: 1, rated: false });
    expect(useChess.getState().tournamentOpen).toBe(9);
    closeTournament();
    expect(useChess.getState().tournamentOpen).toBeNull();
    // Danh sách của tôi: đang mời trước, đang đấu sau, giải đã xong giữ 3 giải
    const list = {
      1: tournament({ id: 1, status: "active", startedAt: 5 }),
      2: tournament({ id: 2, status: "open" }),
      3: tournament({ id: 3, status: "finished", endedAt: 1 }),
      4: tournament({ id: 4, status: "finished", endedAt: 4 }),
      5: tournament({ id: 5, status: "finished", endedAt: 3 }),
      6: tournament({ id: 6, status: "finished", endedAt: 2 }),
      8: tournament({ id: 8, status: "cancelled" }),
      10: tournament({ id: 10, status: "open", players: [{ userId: 1, status: "declined" }] }),
    };
    expect(myTournaments(list, 1).map((x) => x.id)).toEqual([2, 1, 4, 5, 6]);
    // Giải xong khi không mở trang giải: báo nhà vô địch
    onTournamentEvent({ tournament: tournament({ id: 1, status: "active" }) });
    onTournamentEvent({ tournament: tournament({ id: 1, status: "finished", winners: [1] }) });
    expect(toasts.map((x) => x.text)).toContain("🏆 Bạn vô địch Giải mùa thu!");
  });

  it("máy chủ báo tải lại: tải cờ vua và giải đang mở", async () => {
    resetChess();
    bindChess({ meId: () => 1, nameOf: () => "Bình", toast: () => undefined, onTab: () => false, showChess: () => undefined });
    api.chess.mockClear();
    api.chessTournament.mockClear();
    api.chessTournament.mockResolvedValue({ tournament: tournament({ status: "active" }) });
    openTournament(7);
    onChessRefresh({ tournamentId: 7 });
    await new Promise((r) => setTimeout(r, 0));
    expect(api.chess).toHaveBeenCalled();
    expect(api.chessTournament).toHaveBeenCalledTimes(2);
    closeTournament();
  });

  it("xin đi lại với bạn và ván bạn bè đang đánh", async () => {
    resetChess();
    bindChess({ meId: () => 1, nameOf: () => "Bình", toast: () => undefined, onTab: () => false, showChess: () => undefined });
    onChessEvent("chess:game", { game: game({ rated: false, moves: ["e2e4"], turn: "b" }) });
    api.chessTakebackAsk.mockResolvedValueOnce({ game: game({ rated: false, moves: ["e2e4"], turn: "b", takebackOffer: "w" }) });
    await askTakeback(1, "offer");
    expect(useChess.getState().games[1].takebackOffer).toBe("w");
    // Đồng ý đi lại: ván ít nước hơn nhưng takebacks tăng nên vẫn nhận
    onChessEvent("chess:game", { game: game({ rated: false, moves: [], turn: "w", takebacks: 1, takebackOffer: null }) });
    expect(useChess.getState().games[1].moves).toEqual([]);
    api.chessLive.mockResolvedValueOnce({ games: [game({ id: 5, whiteId: 2, blackId: 3 })] });
    await loadLive();
    expect(useChess.getState().live.map((g) => g.id)).toEqual([5]);
  });
});
