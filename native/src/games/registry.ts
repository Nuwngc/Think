// Mã các game trên trang Trò chơi của app. Game nào cũng có chuỗi hằng ngày: mã phải có trong GAMES của src/streaks.js
// ở máy chủ (test/streaks.test.js kiểm tra). Thẻ game (GameCard trong GamesHome.tsx) tự hiện huy hiệu chuỗi theo mã này.
export const GAME_IDS = ["farm", "blocks", "chess", "caro"] as const;

export type GameId = (typeof GAME_IDS)[number];
