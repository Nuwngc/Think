// Dữ liệu cờ vua máy chủ trả về (xem src/chess.js ở máy chủ)

export type Color = "w" | "b";

export type ChessBot = {
  id: string;
  name: string;
  elo: number;
  about: string;
  source: { name: string; url: string; license: string };
};

export type ChessStatus = "challenge" | "active" | "finished" | "aborted" | "declined" | "cancelled" | "expired";

export type ChessGame = {
  id: number;
  status: ChessStatus;
  rated: boolean;
  whiteId: number | null;
  blackId: number | null;
  bot: ChessBot | null;
  botColor: Color | null;
  challengerId: number | null;
  opponentId: number | null;
  colorPref: "random" | "white" | "black";
  /** Thời gian mỗi bên (ms), 0 = không giới hạn */
  base: number;
  inc: number;
  moves: string[];
  fen: string;
  turn: Color;
  clocks: { w: number; b: number } | null;
  serverNow: number;
  firstMoveDeadline: number | null;
  drawOffer: Color | null;
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  reason: string | null;
  ratings: { w: number | null; b: number | null };
  deltas: { w: number | null; b: number | null };
  live: { w: number | null; b: number | null };
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  expiresAt: number | null;
};

export type ChessRating = {
  userId: number;
  rating: number;
  peak: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  provisional: boolean;
};
