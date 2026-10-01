import type { Conversation } from "./types";

// Chủ đề cuộc trò chuyện (màu bong bóng tin của mình) và biểu tượng gửi nhanh.
// Máy chủ chỉ lưu mã chủ đề; màu giống hệt bản web (public/app.js, THEMES).

export type ChatTheme = { id: string; name: string; a: string; b: string };

export const THEMES: ChatTheme[] = [
  { id: "default", name: "Think", a: "#0E7C66", b: "#139C80" },
  { id: "ocean", name: "Đại dương", a: "#1565C0", b: "#00A5C8" },
  { id: "sunset", name: "Hoàng hôn", a: "#E8542F", b: "#E84A8A" },
  { id: "grape", name: "Nho tím", a: "#6A3FC4", b: "#B046C9" },
  { id: "forest", name: "Rừng thông", a: "#2E7D32", b: "#6FA83A" },
  { id: "candy", name: "Kẹo ngọt", a: "#E0467E", b: "#F37A5A" },
  { id: "night", name: "Đêm sao", a: "#283593", b: "#5E35B1" },
  { id: "fire", name: "Lửa hồng", a: "#D32F2F", b: "#EF6C00" },
  { id: "gold", name: "Nắng vàng", a: "#B86E00", b: "#D89400" },
  { id: "mono", name: "Đen trắng", a: "#263238", b: "#546E7A" },
  { id: "love", name: "Tình yêu", a: "#C2185B", b: "#E53972" },
  { id: "mint", name: "Bạc hà", a: "#00897B", b: "#1FB5C9" },
];

const BY_ID: Record<string, ChatTheme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

export const themeOf = (c: Pick<Conversation, "theme"> | null | undefined): ChatTheme => BY_ID[c?.theme || "default"] || THEMES[0];

export const DEFAULT_EMOJI = "👍";
export const emojiOf = (c: Pick<Conversation, "emoji"> | null | undefined) => c?.emoji || DEFAULT_EMOJI;

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "🔥", "😍", "🥰", "😎", "🎉", "👏", "🙏", "💯", "⭐", "🌸", "🐱", "🍕", "☕", "⚽", "🎮", "😆", "🤝", "💪", "🌈", "✨", "😘"];

export const MUTE_OPTIONS: { label: string; ms: number }[] = [
  { label: "Trong 1 giờ", ms: 3600e3 },
  { label: "Trong 8 giờ", ms: 8 * 3600e3 },
  { label: "Trong 24 giờ", ms: 24 * 3600e3 },
  { label: "Cho đến khi bật lại", ms: -1 },
];

/** Cuộc trò chuyện đang tắt thông báo */
export const isMuted = (c: Pick<Conversation, "mutedUntil"> | null | undefined, now = Date.now()) =>
  Boolean(c) && (c!.mutedUntil === -1 || (c!.mutedUntil ?? 0) > now);
