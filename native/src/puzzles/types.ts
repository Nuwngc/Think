// Kiểu dữ liệu câu đố (Quiz hằng ngày + Thử thách nhanh). Máy chủ: src/puzzles.js (GET /api/puzzles…)
import type { BlocksState, CaroState, ChessState, GameId, Puzzle } from "./core";

/** Một người đã giải quiz hôm nay */
export type Solver = { userId: number; ms: number | null; mistakes: number; hints: number; stars: number; at: number };

export type DailyMine = { ms: number | null; mistakes: number; hints: number; stars: number };

/** Một dòng bảng xếp hạng thử thách (10 người nhiều sao nhất) */
export type BoardRow = { userId: number; stars: number; solved: number; at: number };

export type GameSummary = {
  count: number;
  version: number;
  /** Mỗi màn một chữ số '0'–'3' (số sao) */
  stars: string;
  solved: number;
  totalStars: number;
  daily: { day: string; index: number; id: string | null; mine: DailyMine | null; solvers: Solver[] };
  board: BoardRow[];
};

export type PuzzleSummary = { today: string; games: Partial<Record<GameId, GameSummary>> };

/** Sự kiện realtime "puzzle:daily": có người vừa giải quiz hôm nay */
export type DailyEvent = { game: GameId; day: string; userId: number; ms: number | null; mistakes: number; stars: number };

/* ---------------- Lưu trên máy (theo người dùng) ---------------- */

/** Quiz đã giải trên máy này */
export type DailyLocal = { day: string; id: string; ms: number; mistakes: number; hints: number; stars: number; at: number };

export type PendingLevel = {
  kind: "level";
  key: string;
  game: GameId;
  level: number;
  moves: unknown[];
  mistakes: number;
  hints: number;
  ms: number;
  playedAt: number;
  /** Số lần máy chủ báo "màn chưa mở" (409) */
  tries?: number;
};

export type PendingDaily = {
  kind: "daily";
  key: string;
  game: GameId;
  day: string;
  id: string;
  moves: unknown[];
  mistakes: number;
  hints: number;
  ms: number;
  playedAt: number;
};

export type PendingResult = PendingLevel | PendingDaily;

export type LocalData = {
  /** Sao từng màn (gộp máy này + máy chủ, lấy số lớn hơn) */
  levels: Partial<Record<GameId, string>>;
  daily: Partial<Record<GameId, DailyLocal>>;
  /** Đã bấm "Xem lời giải" quiz của ngày này: hôm nay không giải được nữa trên máy này */
  revealed: Partial<Record<GameId, { day: string; id: string }>>;
  /** Kết quả chờ gửi lên máy chủ (theo thứ tự giải) */
  pending: PendingResult[];
  /** Bản tóm tắt lần tải gần nhất (xem được khi mất mạng) */
  summary: PuzzleSummary | null;
};

/* ---------------- Màn hình ---------------- */

export type Play = { kind: "level"; level: number } | { kind: "daily" };

/** Đang ở đâu: bản đồ màn của một game và/hoặc đang giải một câu; from = mục cần quay về (hub, chess, caro, blocks) */
export type Route = { game: GameId; map: boolean; play: Play | null; from: string };

export type Hint =
  | { kind: "square"; sq: string }
  | { kind: "move"; uci: string }
  | { kind: "cell"; i: number }
  | { kind: "blocks"; slot: number; r: number; c: number; cells: number[] };

export type Finished = { stars: number; ms: number; mistakes: number; hints: number; revealed: boolean };

export type Tone = "info" | "good" | "bad";

/** Một lượt giải câu đố (giữ trong cửa hàng dữ liệu: rời màn hình một lúc rồi quay lại vẫn còn) */
export type Session = {
  key: string;
  game: GameId;
  kind: "level" | "daily";
  level: number | null;
  day: string | null;
  puzzle: Puzzle;
  chapter: string | null;
  state: ChessState | BlocksState | CaroState;
  mistakes: number;
  hints: number;
  /** Cờ vua: lần gợi ý thứ mấy ở nước này (1 = ô quân cần đi, 2 = cả nước đi) */
  hintLevel: number;
  hint: Hint | null;
  startedAt: number;
  moved: boolean;
  /** Đã bấm "Xem lời giải": máy tự đi, không tính sao, không gửi */
  revealed: boolean;
  finished: Finished | null;
  status: string;
  tone: Tone;
};
