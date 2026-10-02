/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ puzzles: vi.fn(), puzzleLevel: vi.fn(), puzzleDaily: vi.fn(), puzzleData: vi.fn() }));
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
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
  },
}));

import { ApiError } from "../src/api";
import * as P from "../src/puzzles/core";
import type { CaroPuzzle, GameId } from "../src/puzzles/core";
import { dailyPuzzle, puzzleData } from "../src/puzzles/data";
import { isUnlocked, mergeStars, nextLevel, shortGoal, sortSolvers, starsString, timeText, withLevelStars } from "../src/puzzles/logic";
import {
  bindPuzzles,
  closePlay,
  closeRoute,
  dailyInfo,
  flushPuzzles,
  levelStarsOf,
  loadPuzzles,
  onPuzzleDaily,
  openRoute,
  playLevel,
  puzzleBlocks,
  puzzleCaro,
  puzzleChess,
  puzzleHint,
  puzzleRestart,
  puzzleReveal,
  puzzleSolutionNext,
  resetPuzzles,
  startSession,
  usePuzzles,
} from "../src/puzzles/store";
import type { GameSummary, LocalData, Play, PuzzleSummary } from "../src/puzzles/types";

const today = P.dayKey();

function gameSummary(game: GameId, over: Partial<GameSummary> = {}, daily: Partial<GameSummary["daily"]> = {}): GameSummary {
  const d = puzzleData(game);
  const p = dailyPuzzle(game, today)!;
  return {
    count: d.levels.length,
    version: d.version,
    stars: "0".repeat(d.levels.length),
    solved: 0,
    totalStars: 0,
    daily: { day: today, index: P.dailyIndex(today, d.daily.length), id: p.id, mine: null, solvers: [], ...daily },
    board: [],
    ...over,
  };
}
const summary = (games: Partial<Record<GameId, GameSummary>> = {}): PuzzleSummary => ({
  today,
  games: { chess: gameSummary("chess"), blocks: gameSummary("blocks"), caro: gameSummary("caro"), ...games },
});
const local = (uid: number): LocalData => JSON.parse(storage.get(`think.puzzles.${uid}`) || "null");

/** Mở sẵn màn `level` (coi như các màn trước đã giải 1 sao) — màn chưa mở thì không chơi được */
function unlock(game: GameId, level: number) {
  const st = usePuzzles.getState();
  const stars = levelStarsOf(st, game).map((v, i) => (i < level - 1 ? Math.max(v, 1) : v));
  usePuzzles.setState({ local: { ...st.local!, levels: { ...st.local!.levels, [game]: starsString(stars) } } });
}

/** Giải trọn một câu bằng lời giải (qua đúng các hàm màn hình dùng) */
function solve(game: GameId, play: Play) {
  if (play.kind === "level") unlock(game, play.level);
  const ss = startSession(game, play)!;
  expect(ss).not.toBeNull();
  for (let k = 0; k < 40 && !usePuzzles.getState().session?.finished; k++) {
    const m = puzzleSolutionNext()!;
    if ("uci" in m) puzzleChess(m.uci);
    else if ("cell" in m) puzzleCaro(m.cell);
    else puzzleBlocks(m.slot, m.r, m.c);
  }
  return usePuzzles.getState().session!;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("câu đố: hàm thuần", () => {
  it("màn n mở khi màn n − 1 đã giải; màn tiếp theo là màn chưa giải đầu tiên đang mở", () => {
    const stars = [3, 2, 0, 1, 0, 0];
    expect(isUnlocked(stars, 1)).toBe(true);
    expect(isUnlocked(stars, 3)).toBe(true);
    expect(isUnlocked(stars, 4)).toBe(false);
    expect(isUnlocked(stars, 5)).toBe(true);
    expect(isUnlocked(stars, 6)).toBe(false);
    expect(isUnlocked(stars, 7)).toBe(false);
    expect(nextLevel(stars)).toBe(3);
    expect(nextLevel([1, 1])).toBeNull();
    expect(nextLevel([0, 0])).toBe(1);
  });

  it("gộp sao máy này + máy chủ: lấy số lớn hơn, đủ số màn", () => {
    expect(mergeStars(5, "0120", "30100", null)).toEqual([3, 1, 2, 0, 0]);
    expect(mergeStars(2, "39x")).toEqual([3, 0]);
    expect(withLevelStars("10", 4, 2)).toBe("1002");
    expect(withLevelStars("13", 2, 1)).toBe("13");
  });

  it("chữ: thời gian, mục tiêu ngắn, xếp người giải", () => {
    expect(timeText(42000)).toBe("0:42");
    expect(timeText(125400)).toBe("2:05");
    expect(shortGoal("Trắng đi — chiếu hết sau 2 nước")).toBe("Chiếu hết sau 2 nước");
    expect(shortGoal("Đặt hết 3 khối để dọn sạch bàn")).toBe("Đặt hết 3 khối để dọn sạch bàn");
    const s = sortSolvers([
      { userId: 1, ms: 9000, mistakes: 1, hints: 0, stars: 2, at: 1 },
      { userId: 2, ms: 20000, mistakes: 0, hints: 0, stars: 3, at: 2 },
      { userId: 3, ms: 10000, mistakes: 0, hints: 0, stars: 3, at: 3 },
    ]);
    expect(s.map((x) => x.userId)).toEqual([3, 2, 1]);
  });
});

describe("câu đố: dữ liệu trong app", () => {
  let me = 5;
  let online = true;
  const played: string[] = [];

  beforeEach(() => {
    resetPuzzles();
    storage.clear();
    played.length = 0;
    me = 5;
    online = true;
    for (const fn of Object.values(api)) fn.mockReset();
    bindPuzzles({ meId: () => me, online: () => online, toast: () => undefined, played: (g) => played.push(g) });
  });

  it("tải: gộp sao máy chủ vào bản trên máy (lấy số lớn hơn), lưu lại để xem khi mất mạng", async () => {
    storage.set("think.puzzles.5", JSON.stringify({ levels: { blocks: "0120" }, daily: {}, revealed: {}, pending: [], summary: null }));
    api.puzzles.mockResolvedValueOnce(summary({ blocks: gameSummary("blocks", { stars: "30100" + "0".repeat(195) }) }));
    await loadPuzzles();
    const st = levelStarsOf(usePuzzles.getState(), "blocks");
    expect(st.slice(0, 6)).toEqual([3, 1, 2, 0, 0, 0]);
    expect(st).toHaveLength(puzzleData("blocks").levels.length);
    expect(local(5).levels.blocks!.slice(0, 5)).toBe("31200");
    expect(local(5).summary?.games.blocks?.stars.slice(0, 3)).toBe("301");
    // Mở lại app lúc mất mạng: vẫn có sao và bản tóm tắt cũ
    resetPuzzles();
    api.puzzles.mockRejectedValueOnce(new ApiError("Không kết nối được máy chủ.", 0));
    await loadPuzzles();
    expect(levelStarsOf(usePuzzles.getState(), "blocks").slice(0, 3)).toEqual([3, 1, 2]);
    expect(usePuzzles.getState().summary?.games.chess).toBeTruthy();
  });

  it("giải màn lúc mất mạng: lưu sao ngay, giữ trong hàng chờ; có mạng thì gửi đúng lời giải rồi bỏ khỏi hàng chờ", async () => {
    await loadPuzzles(); // chưa có máy chủ (api trả undefined)
    online = false;
    const ss = solve("chess", { kind: "level", level: 1 });
    expect(ss.finished).toMatchObject({ stars: 3, mistakes: 0, hints: 0, revealed: false });
    await settle();
    expect(levelStarsOf(usePuzzles.getState(), "chess")[0]).toBe(3);
    expect(local(5).pending).toHaveLength(1);
    expect(api.puzzleLevel).not.toHaveBeenCalled();
    expect(isUnlocked(levelStarsOf(usePuzzles.getState(), "chess"), 2)).toBe(true);

    online = true;
    api.puzzleLevel.mockResolvedValueOnce({
      game: "chess",
      summary: gameSummary("chess", { stars: "3" + "0".repeat(puzzleData("chess").levels.length - 1), solved: 1, totalStars: 3 }),
    });
    await flushPuzzles();
    const p1 = puzzleData("chess").levels[0] as P.ChessPuzzle;
    expect(api.puzzleLevel).toHaveBeenCalledWith("chess", expect.objectContaining({ level: 1, moves: P.solutionMoves("chess", p1), mistakes: 0, hints: 0 }));
    expect(local(5).pending).toHaveLength(0);
    expect(usePuzzles.getState().summary?.games.chess?.totalStars).toBe(3);
  });

  it("hàng chờ: máy chủ lỗi / mất mạng thì dừng và giữ thứ tự; 400 bỏ; 409 (màn chưa mở) giữ lại gửi sau", async () => {
    await loadPuzzles();
    online = false;
    solve("blocks", { kind: "level", level: 1 });
    solve("blocks", { kind: "level", level: 2 });
    solve("caro", { kind: "level", level: 1 });
    await settle();
    expect(local(5).pending.map((x) => x.key)).toEqual(["blocks|level|1", "blocks|level|2", "caro|level|1"]);
    online = true;

    // Máy chủ đang lỗi: không gửi tiếp các kết quả sau
    api.puzzleLevel.mockRejectedValueOnce(new ApiError("Máy chủ gặp lỗi.", 503));
    await flushPuzzles();
    expect(api.puzzleLevel).toHaveBeenCalledTimes(1);
    expect(local(5).pending).toHaveLength(3);

    // Màn 1: lời giải bị từ chối (400) → bỏ; màn 2: chưa mở (409) → giữ; caro: nhận
    api.puzzleLevel.mockReset();
    api.puzzleLevel
      .mockRejectedValueOnce(new ApiError("Lời giải không đúng.", 400))
      .mockRejectedValueOnce(new ApiError("Màn này chưa mở: giải màn trước đã.", 409))
      .mockResolvedValueOnce({ game: "caro", summary: gameSummary("caro") });
    await flushPuzzles();
    expect(api.puzzleLevel.mock.calls.map((c) => [c[0], c[1].level])).toEqual([
      ["blocks", 1],
      ["blocks", 2],
      ["caro", 1],
    ]);
    expect(local(5).pending.map((x) => x.key)).toEqual(["blocks|level|2"]);
    expect(local(5).pending[0]).toMatchObject({ tries: 1 });
    // Sao trên máy vẫn giữ
    expect(levelStarsOf(usePuzzles.getState(), "blocks").slice(0, 2)).toEqual([3, 3]);

    // Hết phiên (401): giữ để gửi sau
    api.puzzleLevel.mockReset();
    api.puzzleLevel.mockRejectedValueOnce(new ApiError("Hết phiên", 401));
    await flushPuzzles();
    expect(local(5).pending).toHaveLength(1);
    expect(played).toEqual(expect.arrayContaining(["blocks", "caro"]));
    expect(played).not.toContain("chess");
  });

  it("giải lại một màn: hàng chờ chỉ giữ lần nhiều sao nhất; đổi người thì dừng gửi", async () => {
    await loadPuzzles();
    online = false;
    // Lần 1: sai một nước (2 sao)
    unlock("caro", 21);
    startSession("caro", { kind: "level", level: 21 });
    const p = puzzleData("caro").levels[20] as CaroPuzzle;
    const far = P.caroStart(p).board.findIndex((v, i) => !v && !P.nearX(P.caroStart(p).board).includes(i));
    expect(puzzleCaro(far)).toMatchObject({ ok: false, reason: "not-four" });
    expect(usePuzzles.getState().session?.status).toBe("Nước này chưa tạo tứ — đối thủ không phải chặn");
    for (let k = 0; k < 10 && !usePuzzles.getState().session?.finished; k++) puzzleCaro((puzzleSolutionNext() as { cell: number }).cell);
    expect(usePuzzles.getState().session?.finished?.stars).toBe(2);
    await settle();
    // Lần 2: 3 sao → thay; lần 3: 2 sao → giữ lần 3 sao
    solve("caro", { kind: "level", level: 21 });
    await settle();
    unlock("caro", 21);
    startSession("caro", { kind: "level", level: 21 });
    puzzleHint();
    for (let k = 0; k < 10 && !usePuzzles.getState().session?.finished; k++) puzzleCaro((puzzleSolutionNext() as { cell: number }).cell);
    expect(usePuzzles.getState().session?.finished).toMatchObject({ stars: 2, hints: 1 });
    await settle();
    expect(local(5).pending).toHaveLength(1);
    expect(local(5).pending[0]).toMatchObject({ mistakes: 0, hints: 0 });
    expect(levelStarsOf(usePuzzles.getState(), "caro")[20]).toBe(3);

    online = true;
    api.puzzleLevel.mockImplementationOnce(async () => {
      me = 6; // người khác đăng nhập trong lúc đang gửi
      return { game: "caro", summary: gameSummary("caro") };
    });
    await flushPuzzles();
    expect(api.puzzleLevel).toHaveBeenCalledTimes(1);
  });

  it("gợi ý, nước sai, làm lại: tính sao đúng", async () => {
    await loadPuzzles();
    // Cờ vua: gợi ý 2 lần (ô rồi cả nước), bấm lần 3 không tính thêm; đi sai 1 lần → 3 lỗi → 1 sao
    startSession("chess", { kind: "level", level: 1 });
    const p = puzzleData("chess").levels[0] as P.ChessPuzzle;
    expect(puzzleHint()).toEqual({ kind: "square", sq: p.moves[0].slice(0, 2) });
    expect(puzzleHint()).toEqual({ kind: "move", uci: p.moves[0] });
    puzzleHint();
    expect(usePuzzles.getState().session).toMatchObject({ hints: 2, hintLevel: 2 });
    const legal = new (await import("chess.js")).Chess(p.fen).moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ""}`);
    const wrong = legal.find((m) => m !== p.moves[0])!;
    expect(puzzleChess(wrong)).toMatchObject({ ok: false });
    expect(usePuzzles.getState().session).toMatchObject({ mistakes: 1, status: "Chưa phải nước hay nhất — thử lại", tone: "bad" });
    for (let k = 0; k < 10 && !usePuzzles.getState().session?.finished; k++) puzzleChess((puzzleSolutionNext() as { uci: string }).uci);
    expect(usePuzzles.getState().session?.finished).toMatchObject({ stars: 1, mistakes: 1, hints: 2 });

    // Xếp Khối: đặt một khối rồi Làm lại = 1 lần sai; gợi ý lệch lời giải → nhắc Làm lại
    const lv = puzzleData("blocks").levels.findIndex((x) => (x as P.BlocksPuzzle).pieces.length >= 2) + 1;
    unlock("blocks", lv);
    startSession("blocks", { kind: "level", level: lv });
    const bp = puzzleData("blocks").levels[lv - 1] as P.BlocksPuzzle;
    const st0 = P.blocksStart(bp);
    let off: [number, number] | null = null;
    for (let i = 0; i < 64 && !off; i++) {
      const r = Math.floor(i / 8);
      const c = i % 8;
      if ((r !== bp.sol[0][1] || c !== bp.sol[0][2]) && P.blocksPlace(bp, st0, 0, r, c)) off = [r, c];
    }
    expect(puzzleBlocks(0, off![0], off![1])).not.toBeNull();
    expect(puzzleHint()).toBeNull();
    expect(usePuzzles.getState().session?.status).toBe("Hãy bấm Làm lại để gợi ý tiếp");
    puzzleRestart();
    expect(usePuzzles.getState().session).toMatchObject({ mistakes: 1, hints: 0, status: "Đến lượt bạn" });
    expect(puzzleHint()).toMatchObject({ kind: "blocks", r: bp.sol[0][1], c: bp.sol[0][2] });
    expect(usePuzzles.getState().session?.hints).toBe(1);
  });

  it("quiz hôm nay: giải → hiện ngay trong danh sách (chờ gửi), gửi đúng ngày + mã câu; realtime thêm người giải", async () => {
    api.puzzles.mockResolvedValueOnce(
      summary({ caro: gameSummary("caro", {}, { solvers: [{ userId: 9, ms: 30000, mistakes: 0, hints: 0, stars: 3, at: 1 }] }) }),
    );
    await loadPuzzles();
    online = false;
    let info = dailyInfo(usePuzzles.getState(), "caro", 5);
    expect(info.solved).toBeNull();
    expect(info.solvers).toHaveLength(1);
    const ss = solve("caro", { kind: "daily" });
    expect(ss.finished?.stars).toBe(3);
    await settle();
    info = dailyInfo(usePuzzles.getState(), "caro", 5);
    expect(info.solved).toMatchObject({ stars: 3, pending: true });
    expect(info.solvers.map((x) => x.userId)).toContain(5);

    // Người khác vừa giải (realtime), ngày khác / trùng thì bỏ qua
    onPuzzleDaily({ game: "caro", day: today, userId: 7, ms: 50000, mistakes: 2, stars: 2 });
    onPuzzleDaily({ game: "caro", day: today, userId: 7, ms: 50000, mistakes: 2, stars: 2 });
    onPuzzleDaily({ game: "caro", day: "2020-01-01", userId: 8, ms: 1000, mistakes: 0, stars: 3 });
    const solvers = usePuzzles.getState().summary?.games.caro?.daily.solvers.map((x) => x.userId);
    expect(solvers).toEqual([9, 7]);

    online = true;
    const p = dailyPuzzle("caro", today)!;
    api.puzzleDaily.mockResolvedValueOnce({
      game: "caro",
      first: true,
      summary: gameSummary(
        "caro",
        {},
        { mine: { ms: 1000, mistakes: 0, hints: 0, stars: 3 }, solvers: [{ userId: 5, ms: 1000, mistakes: 0, hints: 0, stars: 3, at: 2 }] },
      ),
    });
    await flushPuzzles();
    expect(api.puzzleDaily).toHaveBeenCalledWith("caro", expect.objectContaining({ day: today, id: p.id, moves: P.solutionMoves("caro", p) }));
    info = dailyInfo(usePuzzles.getState(), "caro", 5);
    expect(info.solved).toMatchObject({ stars: 3, pending: false });
    // Quiz chỉ gửi lần đầu: giải lại không vào hàng chờ
    online = false;
    solve("caro", { kind: "daily" });
    await settle();
    expect(local(5).pending).toHaveLength(0);
  });

  it("quiz: 409 (quiz đã đổi) / 400 (quiz đã đóng) thì bỏ", async () => {
    await loadPuzzles();
    online = false;
    solve("blocks", { kind: "daily" });
    solve("chess", { kind: "daily" });
    await settle();
    online = true;
    api.puzzleDaily
      .mockRejectedValueOnce(new ApiError("Quiz hôm nay đã đổi, tải lại nhé.", 409))
      .mockRejectedValueOnce(new ApiError("Quiz của ngày này đã đóng.", 400));
    await flushPuzzles();
    expect(local(5).pending).toHaveLength(0);
    expect(dailyInfo(usePuzzles.getState(), "blocks", 5).solved).toMatchObject({ stars: 3 });
  });

  it("xem lời giải: máy tự đi, không tính sao, không gửi; quiz hôm nay không giải được nữa trên máy này", async () => {
    await loadPuzzles();
    startSession("chess", { kind: "daily" });
    puzzleHint();
    puzzleReveal();
    expect(usePuzzles.getState().session).toMatchObject({ revealed: true, hint: null, status: "Đang xem lời giải…" });
    expect(puzzleHint()).toBeNull();
    for (let k = 0; k < 20 && !usePuzzles.getState().session?.finished; k++) puzzleChess((puzzleSolutionNext() as { uci: string }).uci);
    expect(usePuzzles.getState().session?.finished).toMatchObject({ stars: 0, revealed: true });
    await settle();
    expect(local(5).pending).toHaveLength(0);
    const info = dailyInfo(usePuzzles.getState(), "chess", 5);
    expect(info.revealed).toBe(true);
    expect(info.solved).toBeNull();
  });

  it("máy chủ báo đã giải quiz (ở máy khác): hiện đã giải, không gửi lại", async () => {
    api.puzzles.mockResolvedValueOnce(summary({ chess: gameSummary("chess", {}, { mine: { ms: 42000, mistakes: 0, hints: 1, stars: 2 } }) }));
    await loadPuzzles();
    expect(dailyInfo(usePuzzles.getState(), "chess", 5).solved).toMatchObject({ ms: 42000, stars: 2, pending: false });
    solve("chess", { kind: "daily" });
    await settle();
    expect(local(5).pending).toHaveLength(0);
  });

  it("đường đi giữa các màn: bản đồ → màn → bản đồ → rời", () => {
    openRoute("blocks", "map", "blocks");
    expect(usePuzzles.getState().route).toEqual({ game: "blocks", map: true, play: null, from: "blocks" });
    playLevel(3);
    expect(usePuzzles.getState().route?.play).toEqual({ kind: "level", level: 3 });
    closePlay();
    expect(usePuzzles.getState().route).toMatchObject({ map: true, play: null });
    expect(closeRoute()).toMatchObject({ from: "blocks" });
    openRoute("caro", "daily", "hub");
    expect(usePuzzles.getState().route).toEqual({ game: "caro", map: false, play: { kind: "daily" }, from: "hub" });
  });

  it("đăng xuất giữa lúc tải: bỏ phản hồi cũ; dữ liệu trên máy theo từng người", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    api.puzzles.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p = loadPuzzles();
    await settle();
    resetPuzzles();
    resolve(summary());
    await p;
    expect(usePuzzles.getState().summary).toBeNull();

    await loadPuzzles();
    online = false;
    solve("blocks", { kind: "level", level: 1 });
    await settle();
    me = 6;
    resetPuzzles();
    await loadPuzzles();
    expect(levelStarsOf(usePuzzles.getState(), "blocks")[0]).toBe(0);
    expect(local(5).levels.blocks?.[0]).toBe("3");
  });
});

describe("câu đố: máy chủ đã thêm màn", () => {
  it("tải bộ câu đố mới hơn (chỉ nhận bản thêm màn vào cuối), lưu lại cho lần mở sau", async () => {
    const { syncRemoteData } = await import("../src/puzzles/data");
    const old = puzzleData("caro");
    const extra = old.levels.slice(0, 2).map((p, i) => ({ ...p, id: `k-new-${i}` }));
    // Bản đổi màn cũ: không nhận
    api.puzzleData.mockResolvedValueOnce({ ...old, version: old.version + 1, levels: [{ ...old.levels[0], id: "khac" }, ...old.levels.slice(1)] });
    expect(await syncRemoteData("caro", old.version + 1)).toBe(false);
    expect(puzzleData("caro")).toBe(old);
    // Bản thêm 2 màn vào cuối: nhận, lưu lại
    const next = { ...old, version: old.version + 1, levels: [...old.levels, ...extra], chapters: [...old.chapters, { name: "Thử thách thêm 1", size: 2 }] };
    api.puzzleData.mockResolvedValueOnce(next);
    expect(await syncRemoteData("caro", old.version + 1)).toBe(true);
    expect(puzzleData("caro").levels).toHaveLength(old.levels.length + 2);
    expect(JSON.parse(storage.get("think.puzzles.data.caro") || "null")?.version).toBe(old.version + 1);
    // Cùng bản thì không tải nữa
    expect(await syncRemoteData("caro", old.version + 1)).toBe(false);
    expect(api.puzzleData).toHaveBeenCalledTimes(2);
  });
});
