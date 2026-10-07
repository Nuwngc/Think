// Tin 24 giờ (2.13.0): màu nền tin chữ, cảm xúc, thời gian — giống public/stories-ui.js
// (máy chủ chỉ nhận các mã màu này: STORY_BGS trong src/stories.js)

export const STORY_BGS: Record<string, [string, string]> = {
  jade: ["#0B6E56", "#1DB98A"],
  sunset: ["#C2410C", "#F76707"],
  berry: ["#A61E4D", "#E64980"],
  ocean: ["#1C4FD6", "#1098AD"],
  grape: ["#5F3DC4", "#9775FA"],
  night: ["#111418", "#3B4148"],
};

export const BG_NAMES: Record<string, string> = { jade: "Xanh ngọc", sunset: "Cam", berry: "Hồng", ocean: "Xanh biển", grape: "Tím", night: "Đêm" };

export const STORY_REACTIONS = ["❤️", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F621}", "\u{1F44D}"]; // ❤️ 😂 😮 😢 😡 👍

export const IMAGE_MS = 5000;

/** Thời gian hiện một tin chữ: dài thì lâu hơn (5–10 giây) */
export const textMs = (t: string | null | undefined) => Math.min(10000, Math.max(5000, 3000 + String(t || "").length * 50));

export const bgColors = (key: string | null | undefined): [string, string] => STORY_BGS[key || ""] || STORY_BGS.jade;

/** "Vừa xong", "5 phút", "3 giờ" */
export function storyAgo(ts: number, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - ts) / 60000));
  if (m < 1) return "Vừa xong";
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)} giờ`;
}
