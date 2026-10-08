// Kèo và hẹn giờ gửi tin (2.16.0): chữ hiển thị giờ hẹn, các lựa chọn giờ nhanh — giống hệt public/plans-core.js
// của bản web (tests/plans.test.ts so khớp hai bản). Mọi giờ tính theo giờ của máy đang dùng.
import type { EventInfo } from "../types";

const WD_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const WD_LONG = ["Chủ nhật", "thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy"];
const pad = (n: number) => String(n).padStart(2, "0");

export const hm = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** Số ngày từ hôm nay tới ngày của ts (0 = hôm nay, 1 = ngày mai, -1 = hôm qua) */
const dayDiff = (ts: number, now: number) => Math.round((startOfDay(ts) - startOfDay(now)) / 86400000);

/** Mốc giờ h:m của ngày cách hôm nay `days` ngày */
export function at(now: number, days: number, h: number, m = 0) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** "hôm nay", "ngày mai", "thứ Bảy 11/10" */
export function dayText(ts: number, now = Date.now()) {
  const diff = dayDiff(ts, now);
  if (diff === 0) return "hôm nay";
  if (diff === 1) return "ngày mai";
  if (diff === -1) return "hôm qua";
  const d = new Date(ts);
  const year = d.getFullYear() !== new Date(now).getFullYear() ? `/${d.getFullYear()}` : "";
  return `${WD_LONG[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}${year}`;
}
/** "20:00 hôm nay", "08:00 ngày mai", "19:00 thứ Bảy 11/10" */
export const whenText = (ts: number, now = Date.now()) => `${hm(ts)} ${dayText(ts, now)}`;

/** "còn 25 phút", "còn 1 giờ 20 phút", "còn 5 giờ", "còn 3 ngày" ("" nếu đã qua) */
export function untilText(ts: number, now = Date.now()) {
  const mins = Math.ceil((ts - now) / 60000);
  if (mins <= 0) return "";
  if (mins < 60) return `còn ${mins} phút`;
  const h = Math.floor(mins / 60);
  if (h < 3 && mins % 60) return `còn ${h} giờ ${mins % 60} phút`;
  if (h < 24) return `còn ${h} giờ`;
  return `còn ${Math.round(h / 24)} ngày`;
}

/** Ô lịch trên thẻ kèo: thứ, ngày, tháng */
export function dateBlock(ts: number) {
  const d = new Date(ts);
  return { wd: WD_SHORT[d.getDay()], day: String(d.getDate()), month: `Th${d.getMonth() + 1}` };
}

export type EventPhase = "canceled" | "past" | "soon" | "upcoming";
/** Trạng thái kèo: canceled (đã hủy), past (đã diễn ra), soon (còn dưới 1 tiếng), upcoming */
export function eventPhase(ev: Pick<EventInfo, "canceled" | "startsAt"> | null | undefined, now = Date.now()): EventPhase {
  if (!ev) return "past";
  if (ev.canceled) return "canceled";
  if (ev.startsAt <= now) return "past";
  return ev.startsAt - now <= 3600000 ? "soon" : "upcoming";
}

export type Preset = { label: string; at: number };

function uniq(list: Preset[], after: number) {
  const seen = new Set<number>();
  return list.filter((p) => {
    if (p.at < after || seen.has(p.at)) return false;
    seen.add(p.at);
    return true;
  });
}

/** Giờ nhanh khi tạo kèo: tối nay, tối mai, thứ Bảy, Chủ nhật (bỏ mốc đã qua / trùng) */
export function eventPresets(now = Date.now()): Preset[] {
  const dow = new Date(now).getDay();
  const toSat = (6 - dow + 7) % 7;
  const toSun = (7 - dow) % 7;
  // Thứ Bảy / Chủ nhật đã qua giờ thì lấy tuần sau
  const next = (days: number, h: number) => (at(now, days, h) < now + 30 * 60000 ? at(now, days + 7, h) : at(now, days, h));
  return uniq(
    [
      { label: "Tối nay 20:00", at: at(now, 0, 20) },
      { label: "Tối mai 19:00", at: at(now, 1, 19) },
      { label: "Thứ Bảy 19:00", at: next(toSat, 19) },
      { label: "Chủ nhật 9:00", at: next(toSun, 9) },
    ],
    now + 30 * 60000,
  );
}

/** Giờ nhanh khi hẹn giờ gửi tin: sau 1 tiếng, tối nay 20:00, sáng mai 8:00 */
export function schedulePresets(now = Date.now()): Preset[] {
  const inHour = Math.ceil((now + 3600000) / 60000) * 60000;
  return uniq(
    [
      { label: "Sau 1 tiếng", at: inHour },
      { label: "Tối nay 20:00", at: at(now, 0, 20) },
      { label: "Sáng mai 8:00", at: at(now, 1, 8) },
    ],
    now + 10 * 60000,
  );
}

/** "An, Bình và 2 người khác" */
export function peopleText(names: string[], max = 2) {
  if (!names.length) return "";
  if (names.length <= max + 1) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} và ${names.length - max} người khác`;
}
