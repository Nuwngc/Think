// Dữ liệu cờ caro máy chủ trả về (xem src/caro.js ở máy chủ) và ván chơi với máy lưu trên máy
import type { Level, Rule } from "./engine";

export type Side = "x" | "o";

export type CaroStatus = "challenge" | "active" | "finished" | "aborted" | "declined" | "cancelled" | "expired";

export type CaroReason = "five" | "resign" | "timeout" | "full" | "no-start" | "aborted";

export type CaroGame = {
  id: number;
  status: CaroStatus;
  xId: number | null;
  oId: number | null;
  challengerId: number | null;
  opponentId: number | null;
  sidePref: Side | "random";
  rule: Rule;
  /** Thời gian mỗi nước (ms), 0 = không giới hạn */
  turnMs: number;
  rated: boolean;
  moves: number[];
  turn: Side;
  result: Side | "draw" | null;
  reason: CaroReason | null;
  winLine: number[] | null;
  xRating: number | null;
  oRating: number | null;
  xDelta: number | null;
  oDelta: number | null;
  turnStartedAt: number | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
  /** Giờ máy chủ lúc gửi (để chạy đồng hồ đúng dù giờ điện thoại lệch) */
  serverTime: number;
  turnLeftMs?: number;
};

export type CaroRating = {
  userId: number;
  rating: number;
  peak: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
};

export type CaroOptions = { turnSeconds: number[]; rules: Rule[] };

/** Ván chơi với máy (chạy hẳn trên điện thoại, lưu trong máy). Giống bản web. */
export type BotGame = {
  v: 1;
  id: number;
  level: Level;
  /** Bên của mình */
  side: Side;
  /** Bên đã chọn lúc tạo ván (có thể là ngẫu nhiên) */
  pref: Side | "random";
  rule: Rule;
  moves: number[];
  result: "win" | "loss" | "draw" | null;
  startedAt: number;
  updatedAt: number;
};

export type BotPrefs = { level: Level; side: Side | "random"; rule: Rule };

export type BotRecord = { win: number; loss: number; draw: number };
/** Thành tích với máy của một người, theo mức */
export type BotStats = Record<Level, BotRecord>;
