import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { api, ApiError } from "../api";
import { allRipeAt, itemsOf, newLogEntries, unknownItem } from "./logic";
import { scheduleFarmReady } from "./notify";
import { playFarm, setFarmSound, type FarmSound } from "./sound";
import type { ActResult, Catalog, Farm, FarmAction, FarmEvent, FarmTab, FriendSummary, Item, Leaderboard, LevelUp, Market, PublicFarm } from "./types";

// Dữ liệu game Nông trại trong app. Máy chủ giữ hết luật (src/farm.js); app chỉ hiển thị và gửi thao tác.
// Realtime ("farm:event": bạn bè ghé vườn) và thông báo nhỏ nối ở src/store.ts qua bindFarm().

const KEY = {
  catalog: "think.farm.catalog",
  sound: "think.farm.sound",
  plantAll: "think.farm.plantAll",
  notify: "think.farm.notify",
  tab: "think.farm.tab",
  logSeen: "think.farm.logSeen",
};

const TABS: FarmTab[] = ["field", "build", "orders", "storage", "friends"];

export type Point = { x: number; y: number };
/** Hiệu ứng: chữ bay lên (float) hoặc sản phẩm bay về Kho (fly) */
export type Fx =
  { id: number; kind: "float"; at: Point | null; parts: { emoji?: string; text: string }[] } | { id: number; kind: "fly"; at: Point; emoji: string };

type State = {
  cat: Catalog | null;
  cv: string;
  items: Record<string, Item>;
  farm: Farm | null;
  /** Đã có nông trại chưa (null = chưa biết) */
  started: boolean | null;
  market: Market | null;
  /** Giờ máy chủ trừ giờ trên máy */
  skew: number;
  loading: boolean;
  error: string | null;
  tab: FarmTab;
  /** Đang mở màn Nông trại */
  open: boolean;
  /** Đang ghé vườn của ai */
  visit: number | null;
  visitFarm: PublicFarm | null;
  visitError: string | null;
  friends: FriendSummary[] | null;
  board: Leaderboard | null;
  boardTab: "level" | "week";
  socialLoading: boolean;
  /** Thao tác đang gửi (để khóa nút / ô đất đang chờ) */
  busy: Record<string, true>;
  levelUps: LevelUp[] | null;
  fx: Fx[];
  /** Tăng mỗi lần số xu đổi (để nảy ô xu) */
  coinBump: number;
  sound: boolean;
  plantAll: boolean;
  notify: boolean;
  /** Lúc xem nhật ký vườn lần cuối */
  logSeen: number;
  prefsLoaded: boolean;
};

export const useFarm = create<State>(() => ({
  cat: null,
  cv: "",
  items: {},
  farm: null,
  started: null,
  market: null,
  skew: 0,
  loading: false,
  error: null,
  tab: "field",
  open: false,
  visit: null,
  visitFarm: null,
  visitError: null,
  friends: null,
  board: null,
  boardTab: "level",
  socialLoading: false,
  busy: {},
  levelUps: null,
  fx: [],
  coinBump: 0,
  sound: true,
  plantAll: false,
  notify: true,
  logSeen: 0,
  prefsLoaded: false,
}));

const get = useFarm.getState;
const set = useFarm.setState;

type Bridge = {
  meId: () => number;
  nameOf: (id: number | null | undefined) => string;
  toast: (text: string) => void;
  /** App đang mở và đang xem màn Nông trại */
  onFarm: () => boolean;
};

let bridge: Bridge = { meId: () => 0, nameOf: () => "Người dùng", toast: () => undefined, onFarm: () => false };

export function bindFarm(b: Bridge) {
  bridge = b;
}

const save = (key: string, value: unknown) => {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
};

/** Giờ máy chủ (ước lượng) */
export const serverNow = () => Date.now() + get().skew;

export const itemOf = (s: Pick<State, "items">, id: string) => s.items[id] || unknownItem(id);

/* ---------------- Lựa chọn lưu trên máy ---------------- */

let prefsLoading: Promise<void> | null = null;
export function loadFarmPrefs() {
  if (!prefsLoading) {
    prefsLoading = (async () => {
      const parse = (raw: string | null) => {
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      };
      try {
        const [cat, sound, plantAll, notify, tab] = await Promise.all(
          [KEY.catalog, KEY.sound, KEY.plantAll, KEY.notify, KEY.tab].map((k) => AsyncStorage.getItem(k)),
        );
        const c = parse(cat);
        const snd = parse(sound) !== false;
        set((s) => ({
          ...(!s.cat && c && c.v && c.cat ? { cat: c.cat as Catalog, cv: String(c.v), items: itemsOf(c.cat) } : {}),
          sound: snd,
          plantAll: parse(plantAll) === true,
          notify: parse(notify) !== false,
          tab: TABS.includes(parse(tab)) ? parse(tab) : s.tab,
          prefsLoaded: true,
        }));
        setFarmSound(snd);
      } catch {
        set({ prefsLoaded: true });
      }
    })();
  }
  return prefsLoading;
}

/** Lúc xem nhật ký lần cuối (theo người dùng) */
async function loadLogSeen() {
  const uid = bridge.meId();
  if (!uid) return;
  const g = gen;
  try {
    const v = Number(await AsyncStorage.getItem(`${KEY.logSeen}.${uid}`));
    if (g === gen && Number.isFinite(v) && v > get().logSeen) set({ logSeen: v });
  } catch {
    /* thôi */
  }
}

export function setSound(on: boolean) {
  set({ sound: on });
  setFarmSound(on);
  save(KEY.sound, on);
}

export function setPlantAll(on: boolean) {
  set({ plantAll: on });
  save(KEY.plantAll, on);
}

export function setNotify(on: boolean) {
  set({ notify: on });
  save(KEY.notify, on);
  planReady();
}

export function setTab(tab: FarmTab) {
  if (!TABS.includes(tab)) return;
  set({ tab });
  save(KEY.tab, tab);
  if (tab === "friends") {
    loadSocial();
    markLogSeen();
  }
}

export function setBoardTab(boardTab: "level" | "week") {
  set({ boardTab });
}

/** Đã xem nhật ký vườn (ẩn khung "khi bạn vắng nhà") */
export function markLogSeen() {
  const f = get().farm;
  const latest = Math.max(get().logSeen, ...(f?.log || []).map((e) => e.t));
  if (latest <= get().logSeen) return;
  set({ logSeen: latest });
  const uid = bridge.meId();
  if (uid) AsyncStorage.setItem(`${KEY.logSeen}.${uid}`, String(latest)).catch(() => undefined);
}

export const unseenLog = (s: Pick<State, "farm" | "logSeen">) => newLogEntries(s.farm?.log, s.logSeen);

/* ---------------- Tải dữ liệu ---------------- */

/** Tăng mỗi khi áp dụng kết quả của một thao tác (để bản tải về chậm hơn không đè lên) */
let applied = 0;

function applyFarm(farm: Farm | null, now?: number, fromAction = false) {
  if (fromAction) applied++;
  const patch: Partial<State> = {};
  if (Number.isFinite(now)) patch.skew = (now as number) - Date.now();
  if (farm) {
    const prev = get().farm;
    patch.farm = farm;
    patch.started = true;
    if (prev && prev.coins !== farm.coins) patch.coinBump = get().coinBump + 1;
  }
  set(patch);
  if (farm) planReady();
  // Qua ngày mới (quà, giá chợ, món hot): lấy lại giá chợ
  const market = get().market;
  if (farm && market && farm.day !== market.day && !loading) loadFarm();
}

/** Hẹn thông báo "cả ruộng đã chín" theo nông trại mới nhất */
function planReady() {
  const s = get();
  if (!s.farm) return;
  const at = s.notify ? allRipeAt(s.farm, serverNow()) : null;
  scheduleFarmReady(at == null ? null : at - s.skew);
}

let loading: Promise<void> | null = null;
/** Lượt tải đang chạy (để lượt cũ của người đã đăng xuất không xóa nhầm lượt mới) */
let current: object | null = null;
let loadAgain = false;
/** Tăng khi đăng xuất: phản hồi của người cũ về trễ thì bỏ qua */
let gen = 0;

/** Tải nông trại (peek = chỉ xem, chưa có thì không tạo — dùng cho thẻ ở trang Trò chơi) */
export function loadFarm({ peek = false }: { peek?: boolean } = {}) {
  if (loading) {
    if (!peek) loadAgain = true;
    return loading;
  }
  const g = gen;
  const token = {};
  current = token;
  const p: Promise<void> = (async () => {
    await loadFarmPrefs();
    if (!get().logSeen) await loadLogSeen();
    set({ loading: true });
    const seen = applied;
    try {
      const data = await api.farm(get().cv, peek && !get().open);
      if (g !== gen) return;
      if (data.catalog) {
        set({ cat: data.catalog, cv: data.catalogVersion, items: itemsOf(data.catalog) });
        save(KEY.catalog, { v: data.catalogVersion, cat: data.catalog });
      }
      set({ market: data.market || get().market, error: null, started: data.farm ? true : get().started === true });
      // Có thao tác vừa xong trong lúc đang tải: bản này có thể cũ hơn, tải lại cho chắc
      if (applied !== seen && get().farm) loadAgain = true;
      else applyFarm(data.farm, data.now);
    } catch (err) {
      if (g === gen) set({ error: err instanceof Error ? err.message : "Không tải được nông trại." });
    } finally {
      if (current === token) {
        current = null;
        loading = null;
        set({ loading: false });
      }
      if (loadAgain && g === gen) {
        loadAgain = false;
        loadFarm();
      }
    }
  })();
  loading = p;
  return p;
}

/* ---------------- Gửi thao tác ---------------- */

let fxSeq = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();

function later(fn: () => void, ms: number) {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

export function addFx(fx: Omit<Extract<Fx, { kind: "float" }>, "id"> | Omit<Extract<Fx, { kind: "fly" }>, "id">) {
  const id = ++fxSeq;
  set((s) => ({ fx: [...s.fx.slice(-6), { ...fx, id } as Fx] }));
  later(() => set((s) => ({ fx: s.fx.filter((x) => x.id !== id) })), fx.kind === "fly" ? 800 : 1500);
}

export function dismissLevelUp() {
  set({ levelUps: null });
}

function showLevelUps(ups: LevelUp[] | undefined) {
  if (!ups || !ups.length) return;
  later(() => {
    playFarm("levelup");
    set((s) => ({ levelUps: [...(s.levelUps || []), ...ups] }));
  }, 380);
}

const SOUND_OF: Partial<Record<FarmAction, FarmSound>> = {
  plant: "plant",
  harvest: "harvest",
  clearBug: "bug",
  craft: "craft",
  sell: "coin",
  deliver: "order",
  build: "build",
  addSlot: "build",
  buyPlot: "build",
  upgradeStorage: "build",
  buyDecor: "build",
  buyDog: "build",
  gift: "gift",
};

function afterAct(action: FarmAction, r: ActResult, before: Farm | null, at: Point | null) {
  const f = get().farm;
  const sound = action === "collect" ? (Object.keys(r.gained || {}).length ? "collect" : null) : SOUND_OF[action];
  if (sound) playFarm(sound);
  const coinsDelta = before && f ? f.coins - before.coins : 0;
  const parts: { emoji?: string; text: string }[] = [];
  for (const [id, n] of Object.entries(r.gained || {})) parts.push({ emoji: itemOf(get(), id).emoji, text: `+${n}` });
  if (coinsDelta > 0) parts.push({ emoji: "🪙", text: `+${coinsDelta}` });
  if ((r.xp || 0) > 0) parts.push({ emoji: "⭐", text: `+${r.xp}` });
  if (parts.length) addFx({ kind: "float", at, parts });
  if (action === "harvest" && r.full) bridge.toast("Kho đầy rồi. Bán bớt hàng hoặc nâng kho để thu hoạch tiếp.");
  if (action === "collect" && r.full) bridge.toast("Kho đầy, chưa lấy hết hàng. Bán bớt hoặc nâng kho nhé.");
  if (action === "plant" && r.skipped) bridge.toast(`Không đủ xu, mới gieo được ${(r.planted || []).length} ô.`);
  showLevelUps(r.levelUps);
}

/** Khóa của thao tác (để không gửi trùng khi bấm liên tục) */
export function busyKey(action: string, payload: Record<string, unknown> = {}) {
  return `${action}:${JSON.stringify(payload)}`;
}

// Gửi lần lượt từng thao tác: phản hồi về đúng thứ tự, nông trại hiện trên máy không bị lùi lại
let queue: Promise<unknown> = Promise.resolve();

/** Gửi một thao tác trên nông trại của mình; at = chỗ bấm (để chữ "+xu" bay lên từ đó) */
export function act(action: FarmAction, payload: Record<string, unknown> = {}, at: Point | null = null): Promise<ActResult | null> {
  const key = busyKey(action, payload);
  if (get().busy[key]) return Promise.resolve(null);
  set((s) => ({ busy: { ...s.busy, [key]: true } }));
  const g = gen;
  const run = async (): Promise<ActResult | null> => {
    if (g !== gen) return null;
    try {
      const data = await api.farmAct({ action, ...payload });
      if (g !== gen) return null;
      const before = get().farm;
      applyFarm(data.farm, data.now, true);
      const r = data.result || {};
      afterAct(action, r, before, at);
      return r;
    } catch (err) {
      if (g !== gen) return null;
      playFarm("error");
      if (!(err instanceof ApiError && err.status === 401)) bridge.toast(err instanceof Error ? err.message : "Chưa làm được.");
      if (err instanceof ApiError && (err.status === 400 || err.status === 404 || err.status === 409)) loadFarm();
      return null;
    } finally {
      if (g === gen) {
        set((s) => {
          const busy = { ...s.busy };
          delete busy[key];
          return { busy };
        });
      }
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/* ---------------- Ghé vườn bạn bè ---------------- */

export async function openVisit(userId: number | null) {
  const next = userId && userId !== bridge.meId() ? userId : null;
  if (next === get().visit) {
    if (next) loadVisit();
    return;
  }
  const back = get().visit != null && next == null;
  set({ visit: next, visitFarm: null, visitError: null });
  if (next) await loadVisit();
  // Vừa ghé vườn bạn về: số ô hái được, số sâu đã đổi
  else if (back && get().friends) loadSocial();
}

export async function loadVisit() {
  const id = get().visit;
  if (!id) return;
  try {
    const data = await api.farmOf(id);
    if (get().visit !== id) return;
    set({ visitFarm: data.farm, visitError: null, skew: data.now - Date.now() });
  } catch (err) {
    if (get().visit !== id) return;
    set({ visitError: err instanceof Error ? err.message : "Không sang được vườn này." });
  }
}

/** Bấm vào một ô ở vườn bạn: bắt sâu giúp hoặc hái trộm */
export async function visitAct(plot: number, action: "help" | "steal", at: Point | null = null) {
  const id = get().visit;
  if (!id) return null;
  const key = busyKey(`visit-${action}`, { id, plot });
  if (get().busy[key]) return null;
  set((s) => ({ busy: { ...s.busy, [key]: true } }));
  const g = gen;
  try {
    const data = await api.farmVisitAct(id, action, plot);
    if (g !== gen) return null;
    if (get().visit === id) set({ visitFarm: data.farm });
    applyFarm(data.me, data.now, true);
    const r = data.result || {};
    if (action === "help") {
      playFarm("bug");
      addFx({
        kind: "float",
        at,
        parts: [
          { emoji: "🪙", text: `+${r.coins ?? 0}` },
          { emoji: "⭐", text: `+${r.xp ?? 0}` },
        ],
      });
    } else if (r.caught) {
      playFarm("dog");
      bridge.toast(`Bị chó giữ vườn đuổi! Bạn phải đền ${r.fine ?? 0} xu cho ${bridge.nameOf(id)}.`);
    } else {
      playFarm("steal");
      addFx({ kind: "float", at, parts: [{ emoji: itemOf(get(), r.item || "").emoji, text: "+1" }] });
    }
    showLevelUps(r.levelUps);
    return r;
  } catch (err) {
    if (g !== gen) return null;
    playFarm("error");
    if (!(err instanceof ApiError && err.status === 401)) bridge.toast(err instanceof Error ? err.message : "Chưa làm được.");
    loadVisit();
    return null;
  } finally {
    if (g === gen) {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[key];
        return { busy };
      });
    }
  }
}

/* ---------------- Bạn bè, bảng xếp hạng ---------------- */

export async function loadSocial() {
  if (get().socialLoading) return;
  set({ socialLoading: true });
  const g = gen;
  try {
    const [fr, lb] = await Promise.all([api.farmFriends(), api.farmLeaderboard()]);
    if (g === gen) set({ friends: fr.friends, board: lb, skew: fr.now - Date.now() });
  } catch (err) {
    if (g !== gen) return;
    if (!get().friends) set({ friends: [] });
    bridge.toast(err instanceof Error ? err.message : "Không tải được danh sách vườn.");
  } finally {
    set({ socialLoading: false });
  }
}

/* ---------------- Mở / đóng màn ---------------- */

export function setFarmOpen(open: boolean) {
  set({ open });
  if (open) {
    loadFarm();
  } else {
    set({ fx: [], visit: null, visitFarm: null, visitError: null });
  }
}

/* ---------------- Sự kiện realtime ---------------- */

export function onFarmEvent(data: FarmEvent) {
  if (!data || typeof data !== "object") return;
  const who = bridge.nameOf(data.by);
  const crop = data.item ? itemOf(get(), data.item).name.toLowerCase() : "rau";
  if (data.type === "steal") bridge.toast(`${who} vừa hái trộm ${crop} của bạn! 😤`);
  else if (data.type === "caught") bridge.toast(`Chó nhà bạn vừa đuổi ${who} khỏi vườn 🐕`);
  else if (data.type === "help") bridge.toast(`${who} vừa bắt sâu giúp ruộng ${crop} của bạn 🐛`);
  else return;
  const here = bridge.onFarm();
  if (here && data.type === "caught") playFarm("dog");
  if (get().farm || here) {
    loadFarm().then(() => {
      if (bridge.onFarm()) markLogSeen(); // đã báo ngay rồi, không cần nhắc lại ở khung "khi bạn vắng nhà"
    });
  }
}

/** Đăng xuất: quên nông trại của người cũ */
export function resetFarm() {
  gen++;
  for (const t of timers) clearTimeout(t);
  timers.clear();
  loading = null;
  current = null;
  loadAgain = false;
  queue = Promise.resolve();
  scheduleFarmReady(null);
  set({
    farm: null,
    started: null,
    market: null,
    error: null,
    loading: false,
    open: false,
    visit: null,
    visitFarm: null,
    visitError: null,
    friends: null,
    board: null,
    busy: {},
    levelUps: null,
    fx: [],
    logSeen: 0,
  });
}
