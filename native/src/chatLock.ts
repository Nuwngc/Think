import type { Conversation } from "./types";

// Khóa cuộc trò chuyện bằng mật khẩu (2.9.0): phần tính toán không phụ thuộc giao diện (có kiểm thử trong tests/chatlock.test.ts).
// Máy chủ: src/chat-lock.js. Bản web: isGated / leaveUnlocked trong public/app.js.

/** Rời cuộc trò chuyện đã mở khóa (hoặc để app chạy nền) quá lâu thì khóa lại */
export const RELOCK_MS = 2 * 60 * 1000;
export const LOCK_MIN = 4;
export const LOCK_MAX = 32;

/** Mật khẩu khóa hợp lệ (tính theo ký tự, kể cả chữ có dấu / biểu tượng) */
export const lockLengthOk = (p: string) => [...p].length >= LOCK_MIN && [...p].length <= LOCK_MAX;

/** Cuộc trò chuyện đã khóa và chưa mở khóa (unlocked: mã -> mở tới lúc nào, Infinity = đang xem) */
export function isGated(c: Pick<Conversation, "id" | "locked"> | undefined | null, unlocked: Record<number, number>, now = Date.now()) {
  return Boolean(c && c.locked && !((unlocked[c.id] || 0) > now));
}

/** Rời cuộc trò chuyện đang xem: còn xem lại được trong RELOCK_MS (trả về bản mới, hoặc chính nó nếu không đổi) */
export function leaveUnlocked(unlocked: Record<number, number>, id: number | null, now = Date.now()) {
  if (id == null || unlocked[id] !== Infinity) return unlocked;
  return { ...unlocked, [id]: now + RELOCK_MS };
}

/** Quay lại app sau khi chạy nền: lâu quá thì khóa lại tất cả */
export function afterBackground(unlocked: Record<number, number>, hiddenAt: number, now = Date.now()) {
  return hiddenAt && now - hiddenAt > RELOCK_MS ? {} : unlocked;
}
