/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ farm: vi.fn(), farmAct: vi.fn(), farmFriends: vi.fn(), farmLeaderboard: vi.fn(), farmOf: vi.fn(), farmVisitAct: vi.fn() }));
const storage = vi.hoisted(() => new Map<string, string>());
const played = vi.hoisted(() => [] as string[]);
const scheduled = vi.hoisted(() => [] as (number | null)[]);
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
vi.mock("../src/farm/sound", () => ({ setFarmSound: vi.fn(), playFarm: (n: string) => played.push(n), preloadFarmSounds: vi.fn() }));
vi.mock("../src/farm/notify", () => ({ scheduleFarmReady: (at: number | null) => scheduled.push(at), cancelFarmReady: vi.fn() }));

import { ApiError } from "../src/api";
import {
  allRipeAt,
  badges,
  clockText,
  emojiKey,
  fmt,
  giftPreview,
  growth,
  itemsOf,
  logText,
  longLeft,
  minutes,
  neededByOrders,
  newLogEntries,
  plotDeal,
  plotState,
  slotDeal,
  storageDeal,
  visitActionOf,
} from "../src/farm/logic";
import { act, bindFarm, busyKey, loadFarm, markLogSeen, onFarmEvent, resetFarm, setTab, unseenLog, useFarm, visitAct, openVisit } from "../src/farm/store";
import type { Catalog, Farm, Plot } from "../src/farm/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// Danh mục thật của máy chủ (src/farm-logic.js)
const L = require("../../src/farm-logic.js");
const CAT: Catalog = L.catalog();

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 2, 3, 0, 0);
const plot = (o: Partial<Plot> = {}): Plot => ({ c: null, p: 0, r: 0, y: 0, b: 0, bd: false, st: 0, ...o });

function farm(o: Partial<Farm> = {}): Farm {
  return {
    v: 1,
    coins: 100,
    xp: 0,
    level: 1,
    xpCur: 0,
    xpNext: 10,
    plots: [plot(), plot()],
    inv: {},
    storage: 100,
    used: 0,
    buildings: {},
    orders: [],
    dog: false,
    decor: [],
    day: "2026-10-02",
    helps: 0,
    steals: 0,
    giftDay: "",
    giftStreak: 0,
    beauty: 0,
    weekCoins: 0,
    log: [],
    stats: { harvest: 0, craft: 0, orders: 0, sold: 0, earned: 0, helps: 0, steals: 0 },
    ...o,
  };
}

describe("nông trại: hàm hiển thị", () => {
  it("tên hình Twemoji giống tên file đã chép", () => {
    expect(emojiKey("🌾")).toBe("1f33e");
    expect(emojiKey("🌶️")).toBe("1f336"); // bỏ FE0F
    expect(emojiKey("👩‍🌾")).toBe("1f469-200d-1f33e"); // chuỗi ghép giữ nguyên
    expect(emojiKey("🗑️")).toBe("1f5d1");
  });

  it("mọi biểu tượng trong danh mục đều có hình trong app", () => {
    const icons = readFileSync(join(root, "src/farm/icons.ts"), "utf8");
    const keys = new Set([...icons.matchAll(/"([0-9a-f-]+)": require\("\.\.\/\.\.\/(assets\/farm\/[0-9a-f-]+\.png)"\)/g)].map((m) => m[1]));
    const files = [...icons.matchAll(/require\("\.\.\/\.\.\/(assets\/farm\/[0-9a-f-]+\.png)"\)/g)].map((m) => m[1]);
    for (const f of files) expect(existsSync(join(root, f))).toBe(true);
    const all = [...CAT.crops, ...CAT.products, ...CAT.buildings, ...CAT.decor, ...CAT.customers].map((x) => x.emoji);
    // Biểu tượng dùng trong giao diện app
    const ui = [
      "🪙",
      "⭐",
      "🐕",
      "🐛",
      "🌱",
      "📦",
      "📋",
      "🛒",
      "🎁",
      "🧺",
      "🔒",
      "✨",
      "🏆",
      "🚜",
      "😤",
      "🥇",
      "🥈",
      "🥉",
      "🔨",
      "👥",
      "📒",
      "⏳",
      "🗑️",
      "🎉",
      "🌧️",
    ];
    for (const e of [...all, ...ui]) expect(keys.has(emojiKey(e)), `thiếu hình ${e}`).toBe(true);
  });

  it("mọi tiếng khai báo đều có file trong app", () => {
    const src = readFileSync(join(root, "src/farm/soundFiles.ts"), "utf8");
    const files = [...src.matchAll(/require\("\.\.\/\.\.\/(assets\/sounds\/farm\/[\w-]+\.wav)"\)/g)].map((m) => m[1]);
    expect(files).toHaveLength(13);
    for (const f of files) expect(existsSync(join(root, f))).toBe(true);
  });

  it("đọc thời gian, số xu", () => {
    expect(clockText(65 * 1000)).toBe("1:05");
    expect(clockText(80 * MIN)).toBe("1g20");
    expect(longLeft(30 * 1000)).toBe("30 giây");
    expect(longLeft(61 * 1000)).toBe("2 phút");
    expect(minutes(90)).toBe("1 giờ 30 phút");
    expect(minutes(120)).toBe("2 giờ");
    expect(fmt(1234567)).toBe("1.234.567");
    expect(fmt(-1500)).toBe("-1.500");
  });

  it("cây lớn dần rồi chín", () => {
    const pl = plot({ c: "bap", p: T0, r: T0 + 8 * MIN, y: 2 });
    expect(plotState(pl, T0)).toBe("growing");
    expect(growth(pl, T0).sprout).toBe(true);
    expect(growth(pl, T0 + 4 * MIN).p).toBeCloseTo(0.5);
    expect(growth(pl, T0 + 4 * MIN).sprout).toBe(false);
    expect(plotState(pl, T0 + 8 * MIN)).toBe("ripe");
    expect(plotState(plot(), T0)).toBe("empty");
  });

  it("đếm việc cần làm ở từng mục", () => {
    const f = farm({
      plots: [plot({ c: "lua_mi", p: T0 - 5 * MIN, r: T0 - MIN, y: 2 }), plot({ c: "bap", p: T0, r: T0 + MIN, y: 2 }), plot()],
      buildings: {
        chuong_ga: {
          slots: 2,
          q: [
            { id: "trung", s: T0 - 20 * MIN, e: T0 - 5 * MIN },
            { id: "trung", s: T0 - 5 * MIN, e: T0 + 10 * MIN },
          ],
        },
      },
      inv: { lua_mi: 3, trung: 1 },
      orders: [
        { id: 1, who: 0, items: [["lua_mi", 2]], coins: 10, xp: 2, at: T0 - MIN },
        { id: 2, who: 1, items: [["trung", 2]], coins: 50, xp: 5, at: T0 - MIN },
        { id: 3, who: 2, items: [["lua_mi", 1]], coins: 5, xp: 1, at: T0 + MIN },
      ],
    });
    expect(
      badges(f, T0, [
        { bugs: 1, stealable: 0 },
        { bugs: 0, stealable: 0 },
      ]),
    ).toEqual({ field: 1, build: 1, orders: 1, storage: 0, friends: 1 });
    expect(neededByOrders(f, T0)).toEqual({ lua_mi: 2, trung: 2 });
    expect(allRipeAt(f, T0)).toBe(T0 + MIN);
    expect(allRipeAt(farm(), T0)).toBe(null);
  });

  it("quà mỗi ngày tăng dần khi ghé liên tục", () => {
    const gifts = CAT.rules.dailyGift;
    expect(giftPreview(farm({ giftDay: "2026-10-02" }), "2026-10-02", gifts)).toBe(null);
    expect(giftPreview(farm({ giftDay: "2026-10-01", giftStreak: 2 }), "2026-10-02", gifts)).toEqual({
      streak: 3,
      coins: gifts[2],
      max: gifts[gifts.length - 1],
    });
    expect(giftPreview(farm({ giftDay: "2026-09-20", giftStreak: 5 }), "2026-10-02", gifts)?.streak).toBe(1);
    expect(giftPreview(farm({ giftDay: "2026-10-01", giftStreak: 30 }), "2026-10-02", gifts)?.coins).toBe(gifts[gifts.length - 1]);
  });

  it("giá mua ô đất, nâng kho, thêm chỗ giống máy chủ", () => {
    const f = farm({ plots: Array.from({ length: 6 }, () => plot()), storage: 125, buildings: { bep: { slots: 3, q: [] } } });
    expect(plotDeal(f, CAT)).toEqual({ n: 7, cost: L.plotCost(7), level: L.plotLevel(7) });
    expect(storageDeal(f, CAT)).toBe(L.storageCost(125));
    expect(slotDeal(f, CAT, "bep")).toBe(L.slotCost("bep", 3));
    expect(slotDeal(f, CAT, "xuong")).toBe(null);
    expect(storageDeal(farm({ storage: CAT.rules.maxStorage }), CAT)).toBe(null);
    expect(plotDeal(farm({ plots: Array.from({ length: CAT.rules.maxPlots }, () => plot()) }), CAT)).toBe(null);
  });

  it("ở vườn bạn: bấm sâu là bắt giúp, ô chín là hái trộm", () => {
    expect(visitActionOf({ c: "bap", p: 0, r: T0 + MIN, bug: true, st: null, canSteal: false }, T0)).toBe("help");
    expect(visitActionOf({ c: "bap", p: 0, r: T0 - MIN, bug: false, st: null, canSteal: true }, T0)).toBe("steal");
    expect(visitActionOf({ c: "bap", p: 0, r: T0 - MIN, bug: false, st: "me", canSteal: false }, T0)).toBe(null);
    expect(visitActionOf({ c: null, p: 0, r: 0, bug: false, st: null, canSteal: false }, T0)).toBe(null);
  });

  it("nhật ký: chỉ những lần ghé mới", () => {
    const log = [
      { t: T0, type: "steal" as const, by: 2, c: "ca_rot" },
      { t: T0 - 1000, type: "help" as const, by: 3, c: "bap" },
    ];
    expect(newLogEntries(log, T0 - 500)).toHaveLength(1);
    expect(logText(log[0], "Lan", "Cà rốt")).toBe("Lan hái trộm 1 cà rốt");
    expect(logText(log[1], "Minh", "Bắp")).toBe("Minh bắt sâu giúp ruộng bắp");
    expect(logText({ t: T0, type: "caught", by: 2, coins: 15 }, "Lan", null)).toBe("Chó đuổi Lan khỏi vườn, Lan đền 15 xu");
  });

  it("danh mục: mọi nguyên liệu đều có", () => {
    const items = itemsOf(CAT);
    for (const p of CAT.products) for (const id of Object.keys(p.inputs)) expect(items[id], `${p.id} cần ${id}`).toBeTruthy();
    expect(items.tra_sua.kind).toBe("food");
    expect(items.lua_mi.kind).toBe("crop");
  });
});

describe("nông trại: dữ liệu trong app", () => {
  const toasts: string[] = [];
  let onFarm = false;

  beforeEach(() => {
    resetFarm();
    toasts.length = 0;
    played.length = 0;
    scheduled.length = 0;
    onFarm = false;
    for (const fn of Object.values(api)) fn.mockReset();
    bindFarm({ meId: () => 7, nameOf: (id) => (id === 2 ? "Lan" : "Ai đó"), toast: (t) => toasts.push(t), onFarm: () => onFarm });
  });

  const real = (now: number) => {
    const s = L.newFarm(now, () => 0.99);
    const info = L.levelInfo(s.xp);
    return { ...s, level: info.level, xpCur: info.cur, xpNext: info.next, used: L.used(s), beauty: 0, weekCoins: 0 } as Farm;
  };

  it("tải nông trại kèm danh mục, nhớ danh mục để lần sau khỏi tải", async () => {
    const now = Date.now();
    api.farm.mockResolvedValueOnce({ now, catalogVersion: "abc", farm: real(now), market: L.market(now), catalog: CAT });
    await loadFarm();
    const s = useFarm.getState();
    expect(s.farm?.plots).toHaveLength(6);
    expect(s.cv).toBe("abc");
    expect(s.items.tra_sua.name).toBe("Trà sữa trân châu");
    expect(JSON.parse(storage.get("think.farm.catalog") || "{}").v).toBe("abc");
    expect(api.farm).toHaveBeenCalledWith("", false);
    // Lần sau gửi phiên bản danh mục đang có
    api.farm.mockResolvedValueOnce({ now, catalogVersion: "abc", farm: real(now), market: L.market(now) });
    await loadFarm();
    expect(api.farm).toHaveBeenLastCalledWith("abc", false);
    expect(useFarm.getState().cat).toBeTruthy();
  });

  it("thẻ ở trang Trò chơi chỉ xem, chưa có nông trại thì không tạo", async () => {
    api.farm.mockResolvedValueOnce({ now: Date.now(), catalogVersion: "abc", farm: null });
    await loadFarm({ peek: true });
    expect(api.farm).toHaveBeenCalledWith(expect.any(String), true);
    expect(useFarm.getState().started).toBe(false);
    expect(useFarm.getState().farm).toBe(null);
  });

  it("gửi thao tác lần lượt, không gửi trùng; có kết quả thì kêu và hiện chữ bay lên", async () => {
    const now = Date.now();
    const f0 = real(now);
    useFarm.setState({ farm: f0, cat: CAT, items: itemsOf(CAT) });
    const order: string[] = [];
    let release: () => void = () => undefined;
    api.farmAct.mockImplementation(async (body: { action: string; plots: number[] }) => {
      order.push(`start ${body.plots[0]}`);
      if (body.plots[0] === 0) await new Promise<void>((r) => (release = r));
      order.push(`end ${body.plots[0]}`);
      return { now, result: { gained: { lua_mi: 2 }, xp: 2, levelUps: [] }, farm: { ...f0, coins: f0.coins + (body.plots[0] === 0 ? 0 : 5) } };
    });
    const a = act("harvest", { plots: [0] }, { x: 10, y: 20 });
    const dup = act("harvest", { plots: [0] });
    const b = act("harvest", { plots: [1] });
    expect(await dup).toBe(null); // đang gửi rồi
    expect(useFarm.getState().busy[busyKey("harvest", { plots: [0] })]).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["start 0", "end 0", "start 1", "end 1"]);
    expect(played).toEqual(["harvest", "harvest"]);
    const fx = useFarm.getState().fx;
    expect(fx[0]).toMatchObject({ kind: "float", at: { x: 10, y: 20 } });
    expect(fx[1]).toMatchObject({ kind: "float", parts: [{ text: "+2" }, { emoji: "🪙", text: "+5" }, { emoji: "⭐", text: "+2" }] });
    expect(useFarm.getState().busy).toEqual({});
    expect(useFarm.getState().coinBump).toBe(1);
  });

  it("máy chủ từ chối: kêu lỗi, báo lý do, tải lại", async () => {
    useFarm.setState({ farm: real(Date.now()), cat: CAT });
    api.farmAct.mockRejectedValueOnce(new ApiError("Không đủ xu mua hạt Bắp (4 xu).", 400));
    api.farm.mockResolvedValueOnce({ now: Date.now(), catalogVersion: "abc", farm: real(Date.now()) });
    expect(await act("plant", { plots: [2], crop: "bap" })).toBe(null);
    expect(played).toEqual(["error"]);
    expect(toasts).toEqual(["Không đủ xu mua hạt Bắp (4 xu)."]);
    await vi.waitFor(() => expect(api.farm).toHaveBeenCalled());
  });

  it("lên cấp thì hiện bảng lên cấp", async () => {
    vi.useFakeTimers();
    const f0 = real(Date.now());
    useFarm.setState({ farm: f0, cat: CAT, items: itemsOf(CAT) });
    api.farmAct.mockResolvedValueOnce({ now: Date.now(), result: { coins: 30, xp: 12, levelUps: [{ level: 2, coins: 40, unlocks: ["bap"] }] }, farm: f0 });
    await act("deliver", { order: 1 });
    expect(useFarm.getState().levelUps).toBe(null);
    await vi.advanceTimersByTimeAsync(500);
    expect(useFarm.getState().levelUps).toEqual([{ level: 2, coins: 40, unlocks: ["bap"] }]);
    expect(played).toEqual(["order", "levelup"]);
    vi.useRealTimers();
  });

  it("hẹn thông báo lúc cả ruộng chín (theo giờ trên máy)", async () => {
    const now = Date.now();
    const f = { ...real(now), plots: [plot({ c: "bap", p: now, r: now + 8 * MIN, y: 2 }), plot({ c: "ot", p: now, r: now + 20 * MIN, y: 3 })] };
    // Giờ máy chủ chạy nhanh hơn máy 5 giây
    api.farm.mockResolvedValueOnce({ now: now + 5000, catalogVersion: "abc", farm: f });
    await loadFarm();
    const at = scheduled[scheduled.length - 1] as number;
    expect(Math.abs(at - (now + 20 * MIN - 5000))).toBeLessThan(200);
  });

  it("đăng xuất giữa chừng: phản hồi cũ không ghi đè", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    api.farm.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p = loadFarm();
    await new Promise((r) => setTimeout(r, 0));
    resetFarm();
    resolve({ now: Date.now(), catalogVersion: "x", farm: real(Date.now()) });
    await p;
    expect(useFarm.getState().farm).toBe(null);
  });

  it("bạn bè ghé vườn: báo tên người, tải lại nông trại, đang xem thì coi như đã đọc nhật ký", async () => {
    const now = Date.now();
    const f = { ...real(now), log: [{ t: now, type: "steal" as const, by: 2, c: "ca_rot" }] };
    useFarm.setState({ farm: real(now), cat: CAT, items: itemsOf(CAT) });
    api.farm.mockResolvedValue({ now, catalogVersion: "abc", farm: f });
    onFarm = true;
    onFarmEvent({ type: "steal", by: 2, plot: 1, item: "ca_rot" });
    expect(toasts).toEqual(["Lan vừa hái trộm cà rốt của bạn! 😤"]);
    await vi.waitFor(() => expect(useFarm.getState().logSeen).toBe(now));
    expect(unseenLog(useFarm.getState())).toHaveLength(0);
    onFarmEvent({ type: "caught", by: 2, plot: 1, item: "bap" });
    expect(played).toContain("dog");
  });

  it("khi vắng nhà: nhật ký mới hiện ra, xem mục Bạn bè thì đánh dấu đã xem", async () => {
    const now = Date.now();
    useFarm.setState({ farm: { ...real(now), log: [{ t: now, type: "help", by: 2, c: "bap" }] }, cat: CAT });
    expect(unseenLog(useFarm.getState())).toHaveLength(1);
    api.farmFriends.mockResolvedValue({ now, friends: [] });
    api.farmLeaderboard.mockResolvedValue({ now, weekStart: 0, level: [], week: [] });
    setTab("friends");
    expect(unseenLog(useFarm.getState())).toHaveLength(0);
    expect(storage.get("think.farm.logSeen.7")).toBe(String(now));
    markLogSeen(); // không đổi gì
    await vi.waitFor(() => expect(useFarm.getState().friends).toEqual([]));
  });

  it("bản tải về chậm hơn một thao tác vừa xong thì không đè lên (tải lại cho chắc)", async () => {
    const now = Date.now();
    const old = real(now);
    useFarm.setState({ farm: old, cat: CAT, items: itemsOf(CAT) });
    let resolveGet: (v: unknown) => void = () => undefined;
    api.farm.mockReturnValueOnce(new Promise((r) => (resolveGet = r)));
    const fresh = { ...old, coins: old.coins + 99 };
    api.farm.mockResolvedValueOnce({ now, catalogVersion: "abc", farm: fresh, market: L.market(now) });
    const p = loadFarm();
    await new Promise((r) => setTimeout(r, 0));
    api.farmAct.mockResolvedValueOnce({ now, result: {}, farm: fresh });
    await act("sell", { item: "lua_mi", qty: 1 });
    resolveGet({ now, catalogVersion: "abc", farm: old, market: L.market(now) }); // bản cũ về sau
    await p;
    expect(useFarm.getState().farm?.coins).toBe(fresh.coins);
    await vi.waitFor(() => expect(api.farm).toHaveBeenCalledTimes(2));
  });

  it("mục Bạn bè: ghé vườn về thì tải lại danh sách", async () => {
    const now = Date.now();
    useFarm.setState({ farm: real(now), cat: CAT, items: itemsOf(CAT), friends: [] });
    api.farmOf.mockResolvedValue({ now, userId: 2, farm: { level: 1, dog: false, decor: [], plots: [], buildings: {} } });
    api.farmFriends.mockResolvedValue({ now, friends: [{ userId: 2, level: 1, xp: 0, ripe: 0, stealable: 0, bugs: 0, dog: false, beauty: 0, plots: 6 }] });
    api.farmLeaderboard.mockResolvedValue({ now, weekStart: 0, level: [], week: [] });
    await openVisit(2);
    await openVisit(null);
    await vi.waitFor(() => expect(useFarm.getState().friends).toHaveLength(1));
  });

  it("ghé vườn bạn: hái trộm được thì kêu, bị chó bắt thì báo phạt", async () => {
    const now = Date.now();
    useFarm.setState({ farm: real(now), cat: CAT, items: itemsOf(CAT) });
    const pub = { level: 3, dog: true, decor: [], plots: [], buildings: {} };
    api.farmOf.mockResolvedValue({ now, userId: 2, farm: pub });
    await openVisit(2);
    expect(useFarm.getState().visitFarm).toEqual(pub);
    api.farmVisitAct.mockResolvedValueOnce({ now, result: { caught: false, item: "ca_rot", levelUps: [] }, farm: pub, me: real(now) });
    await visitAct(0, "steal", { x: 1, y: 2 });
    expect(played).toEqual(["steal"]);
    expect(useFarm.getState().fx[0]).toMatchObject({ kind: "float", parts: [{ emoji: "🥕", text: "+1" }] });
    api.farmVisitAct.mockResolvedValueOnce({ now, result: { caught: true, fine: 15 }, farm: pub, me: real(now) });
    await visitAct(1, "steal");
    expect(played).toEqual(["steal", "dog"]);
    expect(toasts).toEqual(["Bị chó giữ vườn đuổi! Bạn phải đền 15 xu cho Lan."]);
    // Ghé vườn của chính mình: không làm gì
    await openVisit(7);
    expect(useFarm.getState().visit).toBe(null);
  });
});
