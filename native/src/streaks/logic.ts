// Hàm thuần cho chuỗi hằng ngày (dễ kiểm thử)

const TZ = 7 * 3600 * 1000;
const WD = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Ngày theo giờ Việt Nam, dạng 2026-10-02 */
export const dayKey = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);

/** Nhãn 7 ngày gần nhất (ngày cuối là "Nay") */
export function weekLabels(weekStartDay: number) {
  return Array.from({ length: 7 }, (_, i) => (i === 6 ? "Nay" : WD[(weekStartDay + i) % 7]));
}

/** t: lúc chơi theo đồng hồ điện thoại (máy chủ tự trừ độ lệch đồng hồ, điện thoại để sai ngày giờ vẫn tính đúng) */
export type PendingDay = { game: string; day: string; uid: number | null; t?: number };

/** Thêm ngày chơi vào hàng chờ gửi (không trùng, giữ tối đa 120 dòng) */
export function addPending(list: PendingDay[], game: string, day: string, uid: number | null, t = Date.now()): PendingDay[] {
  if (list.some((x) => x.game === game && x.day === day && x.uid === uid)) return list;
  return [...list, { game, day, uid, t }].slice(-120);
}

/** Các lần chơi (ngày + lúc chơi) của một game, để gửi lên máy chủ */
export function playsFor(list: PendingDay[], uid: number, game: string) {
  return list.filter((x) => x.game === game && (x.uid == null || x.uid === uid)).map((x) => ({ day: x.day, t: x.t }));
}

/** Ngày chơi cần gửi cho người đang đăng nhập (ngày chơi lúc chưa đăng nhập cũng tính cho người này), theo game */
export function pendingByGame(list: PendingDay[], uid: number) {
  const out: Record<string, string[]> = {};
  for (const x of list) {
    if (x.uid != null && x.uid !== uid) continue;
    const days = out[x.game] || (out[x.game] = []);
    if (!days.includes(x.day)) days.push(x.day);
  }
  return out;
}

export const removeSent = (list: PendingDay[], game: string, days: string[], uid: number) =>
  list.filter((x) => !(x.game === game && days.includes(x.day) && (x.uid == null || x.uid === uid)));

/** Lời chúc khi vừa chơi lần đầu trong ngày */
export function cheerText(name: string, current: number) {
  return current <= 1 ? `🔥 Bắt đầu chuỗi ${name}! Mai chơi tiếp để chuỗi tăng.` : `🔥 Chuỗi ${name}: ${current} ngày liên tiếp!`;
}

/** Ngày đóng băng chưa báo (seen: các ngày đã báo của người này) */
export const freshFrozen = (used: string[], seen: unknown) => used.filter((d) => !(Array.isArray(seen) && seen.includes(d)));

/** Lời báo khi máy chủ vừa dùng lượt đóng băng (giống bản web) */
export function freezeText(n: number, current: number) {
  return `❄️ Hôm ${n > 1 ? "trước" : "qua"} bạn quên chơi — đã dùng ${n} lượt đóng băng để giữ chuỗi${current ? ` ${current} ngày` : ""}.`;
}
