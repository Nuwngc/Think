// Kiểu dữ liệu chuỗi hằng ngày (giống máy chủ: src/streaks.js)

export type Streak = {
  current: number;
  best: number;
  /** Hôm nay đã chơi */
  today: boolean;
  /** Hôm nay chưa chơi mà chuỗi vẫn còn (chơi hôm nay để giữ chuỗi) */
  atRisk: boolean;
  /** 7 ngày gần nhất (cũ → mới, ngày cuối là hôm nay) */
  week: boolean[];
  last: string | null;
};

export type GameStreak = Streak & { id: string; name: string };

export type StreakSummary = {
  today: string;
  /** Thứ của ngày đầu tiên trong `week` (0 = thứ Hai … 6 = Chủ nhật) */
  weekStartDay: number;
  games: GameStreak[];
  overall: Streak;
  remind: boolean;
  milestones: number[];
};

/** Sự kiện realtime "streak:update": vừa ghi ngày chơi mới */
export type StreakEvent = {
  game: string;
  name: string;
  days: string[];
  isToday: boolean;
  current: number;
  best: number;
  milestone: number | null;
  overallMilestone: number | null;
  summary: StreakSummary;
};
