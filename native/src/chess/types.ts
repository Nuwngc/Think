// Dữ liệu cờ vua máy chủ trả về (xem src/chess.js ở máy chủ)

export type Color = "w" | "b";

export type ChessBot = {
  id: string;
  name: string;
  elo: number;
  about: string;
  source: { name: string; url: string; license: string };
  /** Biểu tượng (emoji) của máy có tính cách; null = hình máy */
  avatar?: string | null;
  /** Gu chơi, vd "Mê đẩy tốt" */
  style?: string | null;
  /** Nhóm sức cờ: new | mid | adv | pro */
  tier?: string;
  /** Máy tự chọn sức */
  custom?: boolean;
};

/** Câu máy vừa nói trong ván (ply: số nước lúc nói) */
export type BotSay = { ply: number; text: string; event: string | null };

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
  /** Cờ theo ngày: thời gian mỗi nước (ms), 0 = ván thường */
  daily?: number;
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
  /** Tên khai cuộc (sách khai cuộc lichess) */
  opening?: { eco: string; name: string } | null;
  botSay?: BotSay | null;
  /** Câu nói nhanh gần nhất trong ván người với người */
  chat?: { color: Color; text: string; ply: number; at: number } | null;
  /** Số lần dùng gợi ý / đi lại (ván với máy) */
  hints?: number;
  takebacks?: number;
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

/** Xếp loại một nước đi khi phân tích (giống "Game Review" của các trang cờ lớn) */
export type MoveClass =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder"
  | "forced";

/** Một thế cờ đã được máy chấm (điểm theo góc nhìn của Trắng) */
export type AnalysedPosition = {
  cp: number | null;
  mate: number | null;
  /** Khả năng thắng của Trắng 0–100 */
  wp: number;
  best: string | null;
  bestSan: string | null;
  end?: "checkmate" | "draw";
  /** Nước tốt thứ nhì */
  second?: { move: string; san: string | null; cp: number | null; mate: number | null; wp: number };
};

export type AnalysedMove = {
  ply: number;
  uci: string;
  san: string;
  color: Color;
  cls: MoveClass;
  loss: number;
  accuracy: number;
  /** Quân vừa thí (nước thiên tài) */
  sac?: string | null;
  /** Nước duy nhất: nước tốt thứ nhì kém bao nhiêu */
  gap?: number;
  /** Sau nước này đối thủ chiếu hết được sau n nước */
  allowsMate?: number;
  /** Đã có đường chiếu hết sau n nước mà bỏ lỡ */
  missedMate?: number;
};

export type AnalysisResult = {
  version?: number;
  engine: string;
  positions: AnalysedPosition[];
  moves: AnalysedMove[];
  accuracy: { w: number | null; b: number | null };
  counts: Record<Color, Partial<Record<MoveClass, number>>>;
  opening?: { eco: string; name: string; ply: number } | null;
};

export type ChessAnalysis = {
  status: "none" | "queued" | "running" | "done" | "error";
  progress: number;
  total: number;
  /** Thứ tự trong hàng đợi */
  position?: number;
  error?: string;
  result?: AnalysisResult;
};

/** Câu nói nhanh (máy chủ gửi danh sách) */
export type ChessPhrase = { id: string; text: string };

/** Một dòng máy phân tích: điểm theo góc nhìn của Trắng, dãy nước dạng ký hiệu */
export type EvalLine = { move: string; cp: number | null; mate: number | null; wp: number; depth: number; pv: string[] };

export type EvalResult = {
  cp: number | null;
  mate: number | null;
  wp: number;
  depth: number;
  best: string | null;
  bestSan: string | null;
  end?: "checkmate" | "draw";
  lines: EvalLine[];
};

type WDL = { win: number; draw: number; loss: number };

/** Thống kê cờ vua của một người (GET /api/chess/stats/<người>) */
export type ChessStats = {
  userId: number;
  rating: ChessRating;
  games: number;
  totals: { all: WDL; white: WDL; black: WDL; rated: WDL; friends: WDL; bots: WDL };
  reasons: { checkmate: number; resign: number; timeout: number; other: number };
  streak: { best: number; current: number };
  fastestMate: { moves: number; gameId: number } | null;
  history: { t: number; r: number; d?: number }[];
  opponents: (WDL & { userId: number; name: string; last: number })[];
  bots: (WDL & { bot: string; name: string; elo: number | null; avatar: string | null })[];
  openings: (WDL & { name: string; eco: string; games: number })[];
};
