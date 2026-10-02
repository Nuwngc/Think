// Các hàm thuần cho game Nông trại trong app (không đụng giao diện / mạng), giống public/farm-ui.js.
// Luật thật nằm ở máy chủ (src/farm-logic.js); ở đây chỉ tính để hiển thị.

import type { Catalog, Farm, Item, LogEntry, Plot, PublicPlot } from "./types";

export const DAY = 24 * 3600 * 1000;

/** Tên file Twemoji: mã Unicode viết thường nối bằng "-", bỏ FE0F nếu không phải chuỗi ghép (ZWJ) */
export function emojiKey(ch: string) {
  const cps = Array.from(String(ch)).map((c) => c.codePointAt(0) as number);
  return (cps.includes(0x200d) ? cps : cps.filter((c) => c !== 0xfe0f)).map((c) => c.toString(16)).join("-");
}

/* ---------------- Chữ ---------------- */

export const fmt = (n: number) => {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return v < 0 ? `-${s}` : s;
};

export function minutes(m: number) {
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} giờ ${m % 60} phút` : `${h} giờ`;
}

/** Đồng hồ ngắn trên ô đất: 12:05, 1g20 */
export function clockText(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}g${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Thời gian còn lại đọc thành chữ: 45 giây, 12 phút, 1 giờ 5 phút */
export function longLeft(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} giây`;
  return minutes(Math.ceil(s / 60));
}

export function ago(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

/* ---------------- Danh mục ---------------- */

export function itemsOf(cat: Catalog | null): Record<string, Item> {
  const out: Record<string, Item> = {};
  if (!cat) return out;
  for (const c of cat.crops) out[c.id] = { id: c.id, name: c.name, emoji: c.emoji, kind: "crop", level: c.level, price: c.price, xp: c.xp, min: c.min };
  for (const p of cat.products) out[p.id] = { id: p.id, name: p.name, emoji: p.emoji, kind: p.kind, level: p.level, price: p.price, xp: p.xp, min: p.min };
  return out;
}

export const unknownItem = (id: string): Item => ({ id, name: id, emoji: "❓", kind: "crop", level: 1, price: 0, xp: 0, min: 0 });

/** Tên + hình của thứ vừa mở khóa khi lên cấp */
export function unlockOf(cat: Catalog, items: Record<string, Item>, id: string) {
  if (id === "dog") return { name: "Chó giữ vườn", emoji: "🐕" };
  return items[id] || cat.buildings.find((b) => b.id === id) || cat.decor.find((d) => d.id === id) || { name: id, emoji: "✨" };
}

/* ---------------- Ô đất ---------------- */

export type PlotState = "empty" | "growing" | "ripe";

export function plotState(pl: Pick<Plot, "c" | "r">, t: number): PlotState {
  if (!pl.c) return "empty";
  return pl.r <= t ? "ripe" : "growing";
}

export const bugOn = (pl: Plot, t: number) => Boolean(pl.c && pl.b > 0 && !pl.bd && pl.b <= t);

/** Cây lớn dần: p = 0..1, scale và độ đậm màu của hình cây, sprout = còn là mầm */
export function growth(pl: Pick<Plot, "p" | "r">, t: number) {
  const p = Math.min(1, Math.max(0, (t - pl.p) / Math.max(1, pl.r - pl.p)));
  return { p, scale: 0.45 + 0.55 * p, sat: 0.35 + 0.65 * p, sprout: p < 0.22 };
}

/** Ở vườn bạn: bấm vào ô này thì làm gì */
export function visitActionOf(pl: PublicPlot, t: number): "help" | "steal" | null {
  if (pl.bug) return "help";
  if (pl.c && pl.r <= t && pl.canSteal) return "steal";
  return null;
}

/* ---------------- Tổng hợp ---------------- */

const have = (f: Farm, id: string) => f.inv[id] || 0;

export const orderReady = (f: Farm, o: Farm["orders"][number], t: number) => o.at <= t && o.items.every(([id, q]) => have(f, id) >= q);

/** Số việc cần làm ở mỗi mục (hiện trên tab) */
export function badges(f: Farm | null, t: number, friends?: { bugs: number; stealable: number }[] | null) {
  if (!f) return { field: 0, build: 0, orders: 0, storage: 0, friends: 0 };
  const ripe = f.plots.filter((p) => plotState(p, t) === "ripe").length;
  let done = 0;
  for (const b of Object.values(f.buildings)) done += b.q.filter((x) => x.e <= t).length;
  const ready = f.orders.filter((o) => orderReady(f, o, t)).length;
  const fr = friends ? friends.filter((x) => x.bugs || x.stealable).length : 0;
  return { field: ripe, build: done, orders: ready, storage: 0, friends: fr };
}

/** Đơn hàng đang cần bao nhiêu mỗi món (để nhắc trước khi bán hết) */
export function neededByOrders(f: Farm, t: number) {
  const need: Record<string, number> = {};
  for (const o of f.orders) if (o.at <= t) for (const [id, q] of o.items) need[id] = (need[id] || 0) + q;
  return need;
}

/** Ngày trước đó (YYYY-MM-DD) */
export const prevDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

/** Quà hôm nay (null = đã nhận) */
export function giftPreview(f: Farm, day: string | null | undefined, gifts: number[]) {
  if (!day || f.giftDay === day || !gifts.length) return null;
  const streak = f.giftDay === prevDay(day) ? f.giftStreak + 1 : 1;
  return { streak, coins: gifts[Math.min(streak, gifts.length) - 1], max: gifts[gifts.length - 1] };
}

/** Giá nâng kho tiếp theo (null = đã tối đa) */
export function storageDeal(f: Farm, cat: Catalog) {
  if (f.storage >= cat.rules.maxStorage) return null;
  const cost = cat.storageCosts[(f.storage - cat.rules.startStorage) / cat.rules.storageStep];
  return cost == null ? null : cost;
}

/** Ô đất mua tiếp theo (null = đã đủ) */
export function plotDeal(f: Farm, cat: Catalog) {
  return cat.plotCosts.find((x) => x.n === f.plots.length + 1) || null;
}

/** Giá thêm một chỗ cho chuồng / xưởng (null = đã tối đa) */
export function slotDeal(f: Farm, cat: Catalog, bid: string) {
  const own = f.buildings[bid];
  if (!own || own.slots >= cat.rules.maxSlots) return null;
  const v = cat.slotCosts[bid]?.[own.slots - cat.rules.startSlots];
  return v == null ? null : v;
}

/** Lúc cả ruộng chín hết (để hẹn thông báo); null = không có cây nào đang lớn */
export function allRipeAt(f: Farm, t: number) {
  let last = 0;
  for (const p of f.plots) if (p.c && p.r > t) last = Math.max(last, p.r);
  return last || null;
}

/** Nhật ký mới kể từ lần xem trước (ai ghé vườn khi mình vắng mặt) */
export const newLogEntries = (log: LogEntry[] | undefined, seen: number) => (log || []).filter((e) => e.t > seen);

export function logText(e: LogEntry, who: string, cropName: string | null) {
  const crop = cropName ? cropName.toLowerCase() : "";
  if (e.type === "help") return `${who} bắt sâu giúp ruộng ${crop}`.trim();
  if (e.type === "caught") return `Chó đuổi ${who} khỏi vườn, ${who} đền ${e.coins ?? 0} xu`;
  return `${who} hái trộm 1 ${crop || "nông sản"}`;
}

export const logEmoji = (type: LogEntry["type"]) => (type === "help" ? "🐛" : type === "caught" ? "🐕" : "😤");

/** Tóm tắt cho thẻ ở trang Trò chơi */
export function farmSummary(f: Farm | null, t: number) {
  if (!f) return null;
  const b = badges(f, t);
  return { level: f.level, coins: f.coins, ripe: b.field, done: b.build, orders: b.orders, plots: f.plots.length };
}
