/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ streaks: vi.fn(), streaksPlayed: vi.fn(), streaksPrefs: vi.fn() }));
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
import { GAME_IDS } from "../src/games/registry";
import { addPending, cheerText, dayKey, pendingByGame, playsFor, removeSent, weekLabels } from "../src/streaks/logic";
import { bindStreaks, flushStreaks, loadStreaks, markPlayed, onStreakEvent, openStreaks, resetStreaks, useStreaks } from "../src/streaks/store";
import type { StreakSummary } from "../src/streaks/types";

const require = createRequire(import.meta.url);

const summary = (over: Partial<StreakSummary> = {}): StreakSummary => ({
  today: dayKey(),
  weekStartDay: 3,
  games: GAME_IDS.map((id) => ({
    id,
    name: id,
    current: 0,
    best: 0,
    today: false,
    atRisk: false,
    week: [false, false, false, false, false, false, false],
    last: null,
  })),
  overall: { current: 0, best: 0, today: false, atRisk: false, week: [false, false, false, false, false, false, false], last: null },
  remind: true,
  milestones: [3, 7],
  ...over,
});

describe("chuỗi hằng ngày: hàm thuần", () => {
  it("ngày theo giờ Việt Nam", () => {
    expect(dayKey(Date.parse("2026-10-02T16:59:00Z"))).toBe("2026-10-02");
    expect(dayKey(Date.parse("2026-10-02T17:00:00Z"))).toBe("2026-10-03");
  });

  it("nhãn 7 ngày, ngày cuối là hôm nay", () => {
    expect(weekLabels(3)).toEqual(["T5", "T6", "T7", "CN", "T2", "T3", "Nay"]);
  });

  it("hàng chờ ngày chơi: không trùng, chơi lúc chưa đăng nhập tính cho người đăng nhập sau", () => {
    let list = addPending([], "blocks", "2026-10-01", null);
    list = addPending(list, "blocks", "2026-10-01", null);
    list = addPending(list, "blocks", "2026-10-02", 5);
    list = addPending(list, "caro", "2026-10-02", 6);
    expect(list).toHaveLength(3);
    expect(pendingByGame(list, 5)).toEqual({ blocks: ["2026-10-01", "2026-10-02"] });
    expect(removeSent(list, "blocks", ["2026-10-01", "2026-10-02"], 5)).toEqual([{ game: "caro", day: "2026-10-02", uid: 6, t: expect.any(Number) }]);
    // Gửi kèm lúc chơi để máy chủ trừ độ lệch đồng hồ điện thoại
    expect(playsFor(list, 5, "blocks")).toEqual([
      { day: "2026-10-01", t: expect.any(Number) },
      { day: "2026-10-02", t: expect.any(Number) },
    ]);
  });

  it("lời chúc", () => {
    expect(cheerText("Cờ vua", 1)).toMatch(/Bắt đầu chuỗi Cờ vua/);
    expect(cheerText("Cờ vua", 5)).toBe("🔥 Chuỗi Cờ vua: 5 ngày liên tiếp!");
  });

  it("mọi game trên trang Trò chơi của app đều có trong danh sách chuỗi của máy chủ", () => {
    const server = require("../../src/streaks.js") as { GAMES: { id: string }[] };
    expect([...GAME_IDS].sort()).toEqual(server.GAMES.map((g) => g.id).sort());
  });
});

describe("chuỗi hằng ngày: dữ liệu trong app", () => {
  const toasts: string[] = [];
  let me = 5;
  let online = true;

  beforeEach(() => {
    resetStreaks();
    storage.clear();
    toasts.length = 0;
    me = 5;
    online = true;
    for (const fn of Object.values(api)) fn.mockReset();
    bindStreaks({ meId: () => me, toast: (t) => toasts.push(t), online: () => online });
  });

  it("chơi Xếp Khối lúc mất mạng: lưu ngày chơi, có mạng thì gửi, gửi xong thì bỏ khỏi hàng chờ", async () => {
    online = false;
    markPlayed("blocks");
    markPlayed("blocks");
    await vi.waitFor(() => expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(1));
    await flushStreaks();
    expect(api.streaksPlayed).not.toHaveBeenCalled();
    online = true;
    api.streaksPlayed.mockResolvedValueOnce(summary());
    await flushStreaks();
    expect(api.streaksPlayed).toHaveBeenCalledWith("blocks", [dayKey()], [{ day: dayKey(), t: expect.any(Number) }]);
    expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(0);
    expect(useStreaks.getState().data).not.toBeNull();
  });

  it("gửi xong rồi thì các nước đi sau trong ngày không gửi lại", async () => {
    markPlayed("blocks");
    await vi.waitFor(() => expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(1));
    api.streaksPlayed.mockResolvedValueOnce(summary());
    await flushStreaks();
    expect(api.streaksPlayed).toHaveBeenCalledTimes(1);
    markPlayed("blocks");
    markPlayed("blocks");
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(0);
    await flushStreaks();
    expect(api.streaksPlayed).toHaveBeenCalledTimes(1);
  });

  it("hết phiên / phải đổi mật khẩu (401, 403): giữ ngày chơi; đổi người giữa chừng thì dừng gửi", async () => {
    markPlayed("blocks");
    markPlayed("caro");
    await vi.waitFor(() => expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(2));
    api.streaksPlayed.mockRejectedValueOnce(new ApiError("Phải đổi mật khẩu", 403)).mockRejectedValueOnce(new ApiError("Hết phiên", 401));
    await flushStreaks();
    expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(2);
    api.streaksPlayed.mockReset();
    api.streaksPlayed.mockImplementationOnce(async () => {
      me = 6; // người khác đăng nhập trong lúc đang gửi
      return summary();
    });
    await flushStreaks();
    expect(api.streaksPlayed).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(1);
    // Người cũ đăng nhập lại: gửi nốt phần còn lại
    me = 5;
    api.streaksPlayed.mockResolvedValueOnce(summary());
    await flushStreaks();
    expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(0);
  });

  it("máy chủ lỗi tạm thời thì giữ lại để gửi sau", async () => {
    markPlayed("caro");
    await vi.waitFor(() => expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(1));
    api.streaksPlayed.mockRejectedValueOnce(new ApiError("Không kết nối được máy chủ.", 0));
    await flushStreaks();
    expect(JSON.parse(storage.get("think.streak.days") || "[]")).toHaveLength(1);
  });

  it("vừa chơi lần đầu trong ngày: báo chuỗi; đạt mốc: mở bảng chúc mừng; ngày cũ gửi muộn: không báo", async () => {
    const s = summary();
    onStreakEvent({ game: "chess", name: "Cờ vua", days: [dayKey()], isToday: true, current: 4, best: 4, milestone: null, overallMilestone: null, summary: s });
    expect(toasts).toEqual(["🔥 Chuỗi Cờ vua: 4 ngày liên tiếp!"]);
    onStreakEvent({ game: "chess", name: "Cờ vua", days: [dayKey()], isToday: true, current: 7, best: 7, milestone: 7, overallMilestone: null, summary: s });
    expect(useStreaks.getState().sheet).toMatchObject({ kind: "milestone", event: { milestone: 7 } });
    onStreakEvent({
      game: "blocks",
      name: "Xếp Khối",
      days: ["2026-01-01"],
      isToday: false,
      current: 1,
      best: 1,
      milestone: null,
      overallMilestone: null,
      summary: s,
    });
    expect(toasts).toHaveLength(1);
  });

  it("tải chuỗi; đăng xuất giữa chừng thì bỏ phản hồi cũ", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    api.streaks.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p = loadStreaks();
    resetStreaks();
    resolve(summary());
    await p;
    expect(useStreaks.getState().data).toBeNull();
    api.streaks.mockResolvedValueOnce(summary({ remind: false }));
    await loadStreaks();
    expect(useStreaks.getState().data?.remind).toBe(false);
    openStreaks("farm");
    expect(useStreaks.getState().sheet).toEqual({ kind: "detail", game: "farm" });
  });
});
