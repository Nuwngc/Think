// Hàm thuần của câu đố (dễ kiểm thử): gộp sao máy này + máy chủ, mở màn, hàng chờ gửi, danh sách người giải quiz.
import type { GameId } from "./core";
import type { DailyEvent, GameSummary, PendingResult, Solver } from "./types";

/** Chữ trên màn giải câu đố (giống bản web) */
export const TEXT = {
  start: "Đến lượt bạn",
  correct: "Đúng rồi! Tiếp tục…",
  chessWrong: "Chưa phải nước hay nhất — thử lại",
  notFour: "Nước này chưa tạo tứ — đối thủ không phải chặn",
  noWin: "Có tứ nhưng chưa thắng được — thử nước khác",
  taken: "Ô này đã có quân",
  blocksLost: "Chưa dọn sạch bàn — bấm Làm lại",
  blocksHintRestart: "Hãy bấm Làm lại để gợi ý tiếp",
  hintNone: "Bạn đã đi khác lời giải — bấm Làm lại để xem gợi ý",
  hintCell: "Gợi ý: đánh vào ô được tô (chạm lần nữa để đánh)",
  hintBlocks: "Gợi ý: kéo khối được tô vào chỗ sáng trên bàn",
  solved: "Giải xong!",
  revealing: "Đang xem lời giải…",
  revealedDone: "Đây là lời giải — lần này không tính sao",
  dailySolved: "Bạn đã giải quiz hôm nay",
  dailyRevealed: "Bạn đã xem lời giải — mai có quiz mới nhé",
};

export const blocksLeftText = (left: number) => `Còn ${left} khối — tiếp tục…`;

/** Sao từng màn: lấy số lớn nhất giữa các nguồn (chuỗi '0'–'3'), đủ `count` màn */
export function mergeStars(count: number, ...sources: (string | null | undefined)[]): number[] {
  const out = new Array<number>(Math.max(0, count)).fill(0);
  for (const s of sources) {
    if (typeof s !== "string") continue;
    for (let i = 0; i < out.length && i < s.length; i++) {
      const v = s.charCodeAt(i) - 48;
      if (v > out[i] && v <= 3) out[i] = v;
    }
  }
  return out;
}

export const starsString = (list: number[]) => list.map((v) => String(Math.max(0, Math.min(3, v | 0)))).join("");

/** Ghi sao màn `level` (tính từ 1) vào chuỗi, giữ số lớn hơn */
export function withLevelStars(str: string | null | undefined, level: number, value: number) {
  const list = mergeStars(Math.max(level, (str || "").length), str);
  list[level - 1] = Math.max(list[level - 1] || 0, value);
  return starsString(list);
}

/** Màn n mở khi n = 1 hoặc màn n − 1 đã giải */
export const isUnlocked = (stars: number[], level: number) => level === 1 || (level >= 2 && level <= stars.length && stars[level - 2] > 0);

/** Màn chưa giải đầu tiên đang mở (null = đã giải hết) */
export function nextLevel(stars: number[]) {
  for (let i = 0; i < stars.length; i++) if (!stars[i] && isUnlocked(stars, i + 1)) return i + 1;
  return null;
}

export const sumStars = (stars: number[]) => stars.reduce((a, b) => a + b, 0);

export const starText = (n: number) => "★".repeat(Math.max(0, Math.min(3, n))) + "☆".repeat(3 - Math.max(0, Math.min(3, n)));

/** 42 giây → "0:42" */
export function timeText(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Thời gian đọc thành lời */
export function timeSpeech(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} phút ${s % 60} giây` : `${s} giây`;
}

/** "Trắng đi — chiếu hết sau 2 nước" → "Chiếu hết sau 2 nước" (dòng ngắn ở trang Trò chơi) */
export function shortGoal(text: string) {
  const k = text.indexOf("— ");
  const t = k >= 0 ? text.slice(k + 2) : text;
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Người giải quiz: nhiều sao trước, rồi nhanh hơn, rồi giải sớm hơn */
export function sortSolvers(list: Solver[]) {
  return list.slice().sort((a, b) => b.stars - a.stars || (a.ms ?? Infinity) - (b.ms ?? Infinity) || a.at - b.at);
}

/** Có người vừa giải quiz hôm nay (realtime): thêm vào danh sách. null = không đổi gì (ngày khác, đã có trong danh sách) */
export function applyDailyEvent(gs: GameSummary | undefined, evt: DailyEvent, now = Date.now()): GameSummary | null {
  if (!gs || !evt || gs.daily.day !== evt.day || !Number.isFinite(evt.userId)) return null;
  if (gs.daily.solvers.some((x) => x.userId === evt.userId)) return null;
  const row: Solver = { userId: evt.userId, ms: evt.ms ?? null, mistakes: evt.mistakes || 0, hints: 0, stars: evt.stars || 1, at: now };
  return { ...gs, daily: { ...gs.daily, solvers: sortSolvers([...gs.daily.solvers, row]) } };
}

export const levelKey = (game: GameId, level: number) => `${game}|level|${level}`;
export const dailyKey = (game: GameId, day: string) => `${game}|daily|${day}`;

/** Thêm kết quả vào hàng chờ gửi: một màn chỉ giữ lần giải nhiều sao nhất; quiz mỗi ngày chỉ gửi lần giải đầu */
export function addPendingResult(list: PendingResult[], item: PendingResult, starsOf: (x: PendingResult) => number): PendingResult[] {
  const k = list.findIndex((x) => x.key === item.key);
  if (k < 0) return [...list, item].slice(-300);
  if (item.kind === "daily") return list;
  if (starsOf(item) <= starsOf(list[k])) return list;
  return list.map((x, i) => (i === k ? item : x));
}
