// Chữ và thời gian hiển thị, giống hệt bản web (public/app.js) để hai bên đọc như nhau.
import type { ChatItem, Conversation, Message, User } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export const hm = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function daysAgo(ts: number, now = Date.now()) {
  const a = new Date(ts);
  a.setHours(0, 0, 0, 0);
  const b = new Date(now);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const WEEKDAY_NAMES = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

/** Giờ ngắn trong danh sách chat: 09:30, Hôm qua, T3, 12/05 */
export function shortTime(ts: number, now = Date.now()) {
  const days = daysAgo(ts, now);
  if (days <= 0) return hm(ts);
  if (days === 1) return "Hôm qua";
  if (days < 7) return WEEKDAYS[new Date(ts).getDay()];
  const d = new Date(ts);
  const year = d.getFullYear() !== new Date(now).getFullYear() ? `/${String(d.getFullYear()).slice(2)}` : "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${year}`;
}

/** Dòng ngăn cách ngày trong khung chat */
export function dayLabel(ts: number, now = Date.now()) {
  const days = daysAgo(ts, now);
  if (days <= 0) return "Hôm nay";
  if (days === 1) return "Hôm qua";
  const d = new Date(ts);
  return `${WEEKDAY_NAMES[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export function lastSeenText(u: Pick<User, "online" | "lastSeen"> | undefined | null, now = Date.now()) {
  if (!u) return "";
  if (u.online) return "Đang hoạt động";
  if (!u.lastSeen) return "Chưa hoạt động";
  const mins = Math.floor((now - u.lastSeen) / 60000);
  if (mins < 1) return "Vừa mới hoạt động";
  if (mins < 60) return `Hoạt động ${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hoạt động ${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hoạt động ${days} ngày trước`;
  const d = new Date(u.lastSeen);
  return `Hoạt động ngày ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

/** Bỏ dấu để tìm kiếm: gõ "minh" vẫn ra "Mính" */
export const fold = (s: string | null | undefined) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();

/** Bảng màu ảnh đại diện chữ cái, cùng bảng với web */
export const AVATAR_COLORS = ["#2F6F8F", "#8A4FA3", "#B4533C", "#3E7D4F", "#A0527A", "#5160C4", "#B86F1F", "#2B8585"];
export const colorOf = (id: number | null | undefined) => AVATAR_COLORS[Math.abs(Number(id) || 0) % AVATAR_COLORS.length];
export const initialOf = (name: string | null | undefined) => (Array.from(String(name || "?").trim())[0] || "?").toUpperCase();

export const oneLine = (s: string | null | undefined) => String(s || "").replace(/\s+/g, " ").trim();

export type Names = { meId: number; nameOf: (id: number | null | undefined) => string };

export function listNames(ids: number[] | undefined, { meId, nameOf }: Names) {
  const names = (ids || []).map((id) => (id === meId ? "bạn" : nameOf(id)));
  return names.length <= 2 ? names.join(" và ") : `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
}

/** Tin hệ thống trong nhóm, lưu dạng JSON, hiển thị theo tên hiện tại của mọi người */
export function systemText(m: Pick<Message, "text" | "senderId">, names: Names) {
  let d: { event?: string; name?: string; targets?: number[]; text?: string | null; image?: boolean; emoji?: string } = {};
  try {
    d = JSON.parse(m.text || "{}");
  } catch {
    /* bỏ qua */
  }
  const actor = m.senderId === names.meId ? "Bạn" : names.nameOf(m.senderId);
  switch (d.event) {
    case "create":
      return `${actor} đã tạo nhóm`;
    case "rename":
      return `${actor} đã đổi tên nhóm thành “${d.name}”`;
    case "add":
      return `${actor} đã thêm ${listNames(d.targets, names)} vào nhóm`;
    case "remove":
      return `${actor} đã xóa ${listNames(d.targets, names)} khỏi nhóm`;
    case "leave":
      return `${actor} đã rời nhóm`;
    case "pin":
      return `${actor} đã ghim một tin nhắn${d.text ? `: “${d.text}”` : d.image ? " (ảnh)" : ""}`;
    case "theme":
      return `${actor} đã đổi chủ đề thành ${d.name || "mới"}`;
    case "emoji":
      return `${actor} đã đổi biểu tượng cảm xúc nhanh thành ${d.emoji}`;
    default:
      return "Cuộc trò chuyện vừa được cập nhật";
  }
}

const hasImage = (m: ChatItem) => Boolean(m.image || ("localUri" in m && m.localUri));

export function messageSummary(m: ChatItem, names: Names) {
  if (m.kind === "system") return systemText(m, names);
  if (m.deleted) return "Tin nhắn đã được thu hồi";
  if (m.kind === "poll") return `📊 ${oneLine(m.text)}`;
  if (hasImage(m) && !m.text) return "Đã gửi một ảnh";
  if ("imagePurged" in m && m.imagePurged && !m.text) return "Ảnh đã được dọn khỏi máy chủ";
  const shared = !hasImage(m) && m.text ? chessShareOf(m.text) : null;
  if (shared) return `♟ ${shared.title}`;
  return `${hasImage(m) ? "📷 " : ""}${oneLine(m.text)}`;
}

/* ---------------- Ván cờ được chia sẻ vào cuộc trò chuyện ----------------
   Tin dạng: "♟ An (Trắng) vs Bình (Đen)\nAn thắng do chiếu hết · 5+3 · 24 nước\nhttps://…/#/chess/g/12"
   (giống bản web). Hai bên đều hiện thành thẻ bấm được để mở ván. */

export type ChessShare = { title: string; sub: string; id: number };

export function chessShareOf(text: string | null | undefined): ChessShare | null {
  const m = /^♟ ([^\n]+)\n(?:([^\n]*)\n)?\S*#\/chess\/g\/(\d+)\s*$/.exec(String(text || ""));
  return m ? { title: m[1], sub: m[2] || "", id: Number(m[3]) } : null;
}

export function chessShareText(share: { title: string; sub: string; id: number }, origin: string) {
  return `♟ ${share.title}\n${share.sub}\n${origin.replace(/\/+$/, "")}/#/chess/g/${share.id}`;
}

/* ---------------- Bảng tin ---------------- */

/** Thời gian của bài đăng, bình luận: Vừa xong, 5 phút trước, 3 giờ trước, 2 ngày trước, 12/05 */
export function timeAgo(ts: number, now = Date.now()) {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return "Vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  return shortTime(ts, now);
}

/** "Tham gia tháng 9/2026" */
export function joinedText(ts: number | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  return `Tham gia tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
}

/** Dòng xem trước trong danh sách chat: "Bạn: …", "Minh: …" (nhóm) */
export function previewText(m: ChatItem, c: Pick<Conversation, "type">, names: Names) {
  if (m.kind === "system") return systemText(m, names);
  const who = m.senderId === names.meId ? "Bạn" : c.type !== "dm" ? names.nameOf(m.senderId) : "";
  return who ? `${who}: ${messageSummary(m, names)}` : messageSummary(m, names);
}

export function convTitle(c: Pick<Conversation, "type" | "name" | "peerId">, nameOf: Names["nameOf"]) {
  return c.type === "dm" ? nameOf(c.peerId) : c.name || "Cả nhóm";
}

// Tạo bằng RegExp trong try/catch: bộ chạy JS trên điện thoại (Hermes) có thể chưa hiểu \p{...}
function safeRegExp(source: string, flags: string) {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}
const EMOJI_ONLY = safeRegExp(String.raw`^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|\s)+$`, "u");
const HAS_EMOJI = safeRegExp(String.raw`\p{Extended_Pictographic}|\p{Regional_Indicator}`, "u");
const JOINERS = safeRegExp(String.raw`[‍️⃣]|\p{Emoji_Modifier}`, "gu");
// Dự phòng: các khối biểu tượng cảm xúc thông dụng
const EMOJI_BASIC = /^(?:[☀-➿⬀-⯿‍️⃣\s]|\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udc00-\udfff])+$/;

/** Tin chỉ có 1–3 biểu tượng cảm xúc thì hiện to, không có bong bóng */
export function isEmojiOnly(text: string | null | undefined) {
  const t = String(text || "").trim();
  if (!t || t.length > 30) return false;
  if (EMOJI_ONLY && HAS_EMOJI) {
    if (!EMOJI_ONLY.test(t) || !HAS_EMOJI.test(t)) return false;
  } else if (!EMOJI_BASIC.test(t) || /^[\s‍️⃣]+$/.test(t)) {
    return false;
  }
  const compact = t.replace(/\s+/g, "");
  const Seg = (Intl as any).Segmenter;
  if (Seg) return [...new Seg("vi", { granularity: "grapheme" }).segment(compact)].length <= 3;
  const stripped = JOINERS ? compact.replace(JOINERS, "") : compact.replace(/[‍️⃣]|\ud83c[\udffb-\udfff]/g, "");
  return Array.from(stripped).length <= 3;
}

export type TextPart = { text: string; url?: string };

/** Tách đường link trong tin nhắn để bấm được */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    let url = match[0];
    const trail = /[),.!?;:]+$/.exec(url);
    if (trail) url = url.slice(0, -trail[0].length);
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: url, url });
    last = match.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Kích thước ảnh nằm trong tên file (…_800x600.jpg) để giữ chỗ trước khi tải */
export function imageSize(path: string | null | undefined): { w: number; h: number } | null {
  const match = /_(\d+)x(\d+)\.\w+$/.exec(path || "");
  return match ? { w: Number(match[1]), h: Number(match[2]) } : null;
}

const numFmt = (n: number, digits = 0) => {
  const fixed = n.toFixed(digits);
  const [int, dec] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec && Number(dec) ? `${grouped},${dec.replace(/0+$/, "")}` : grouped;
};

export const fmtNum = (n: number) => numFmt(n || 0);

export function fmtBytes(bytes: number) {
  const b = bytes || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${numFmt(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${numFmt(b / 1024 / 1024, 1)} MB`;
  return `${numFmt(b / 1024 / 1024 / 1024, 2)} GB`;
}

export const REACTIONS = ["❤️", "\u{1F606}", "\u{1F62E}", "\u{1F622}", "\u{1F621}", "\u{1F44D}"]; // ❤️ 😆 😮 😢 😡 👍

/** Gom cảm xúc: tối đa 3 biểu tượng nhiều nhất + tổng số */
export function reactionSummary(list: { userId: number; emoji: string }[], meId: number) {
  const counts = new Map<string, number>();
  for (const r of list) counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e);
  const mine = list.find((r) => r.userId === meId)?.emoji || null;
  return { top, total: list.length, mine };
}
