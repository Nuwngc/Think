// Tin nhắn thoại: phần dùng chung (giống hệt public/voice-core.js của bản web — tests/voice.test.ts so khớp hai bản).
// Dạng sóng: 40 cột, mỗi cột một ký tự 0–9 a–v (0 = im lặng, v = to nhất), gửi kèm tin để vẽ ngay.

export const BARS = 40;
const LEVELS = 32;
export const MAX_MS = 2 * 60 * 1000;
export const MIN_MS = 700;
const DIGITS = "0123456789abcdefghijklmnopqrstuv";

/** Gom các mức âm lượng (0–1, lấy mẫu đều trong lúc ghi) thành BARS cột, mã hóa thành chuỗi */
export function encodeWave(levels: number[]) {
  const list = Array.isArray(levels) ? levels.filter((v) => Number.isFinite(v)) : [];
  if (!list.some((v) => v > 0)) return ""; // máy không đo được âm lượng: bên nghe vẽ sóng mặc định
  const out: string[] = [];
  for (let i = 0; i < BARS; i++) {
    const a = Math.floor((i * list.length) / BARS);
    const b = Math.max(a + 1, Math.floor(((i + 1) * list.length) / BARS));
    let peak = 0;
    for (let k = a; k < b && k < list.length; k++) peak = Math.max(peak, list[k]);
    out.push(DIGITS[Math.round(Math.min(1, Math.max(0, peak)) * (LEVELS - 1))]);
  }
  return out.join("");
}

/** Chuỗi dạng sóng → các cột 0–1 (luôn BARS cột; thiếu thì vẽ sóng nhẹ đều) */
export function decodeWave(wave: string | null | undefined) {
  const s = typeof wave === "string" && /^[0-9a-v]{1,64}$/.test(wave) ? wave : "";
  if (!s) return Array.from({ length: BARS }, (_, i) => 0.25 + 0.15 * Math.abs(Math.sin(i * 0.9)));
  return Array.from({ length: BARS }, (_, i) => {
    const ch = s[Math.min(s.length - 1, Math.floor((i * s.length) / BARS))];
    return Math.max(0.08, DIGITS.indexOf(ch) / (LEVELS - 1));
  });
}

/** Mức âm lượng từ decibel (máy ghi của app: -160…0 dB) */
export const levelFromDb = (db: number | undefined | null) => (Number.isFinite(db) ? Math.min(1, Math.max(0, ((db as number) + 50) / 50)) : 0);

/** 0:07, 1:05 */
export function clock(ms: number | null | undefined) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Chữ thay cho tin nhắn thoại ở danh sách, trích dẫn, thông báo */
export const voiceLabel = (ms?: number | null) => `🎤 Tin nhắn thoại${ms ? ` (${clock(ms)})` : ""}`;
