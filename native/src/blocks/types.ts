// Bảng xếp hạng Xếp Khối máy chủ trả về (xem src/games.js ở máy chủ)

export type BlocksRow = { userId: number; score: number; at: number; games: number };

export type BlocksBoard = {
  game: string;
  weekStart: number;
  me: { best: number; bestAt: number | null; games: number; lines: number; weekBest: number; rank: number | null; weekRank: number | null };
  leaderboard: { all: BlocksRow[]; week: BlocksRow[] };
};

/** Một ván đã chơi xong, chờ gửi lên máy chủ (uid = người chơi, null nếu chưa đăng nhập) */
export type PendingScore = { id: string; score: number; moves: number; lines: number; durationMs: number; playedAt: number; uid: number | null };
