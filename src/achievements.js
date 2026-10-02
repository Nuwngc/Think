'use strict';
// Thành tựu trên trang cá nhân: huy hiệu Đồng / Bạc / Vàng tính từ dữ liệu có sẵn (chuỗi, cờ vua, cờ caro, Xếp Khối,
// câu đố, nông trại, bài đăng, tin nhắn). Máy chủ tự tính mỗi lần mở trang cá nhân, không cần lưu điểm riêng.
// Chủ trang mở trang của mình thì huy hiệu vừa đạt được đánh dấu "Mới" một lần (bảng achievement_seen).
// Thêm thành tựu: thêm một dòng vào DEFS và cách tính vào valuesOf.
const { db, get, all, run } = require('./db');
const streaks = require('./streaks');

const DEFS = [
  { id: 'streak', icon: '🔥', name: 'Lửa bền bỉ', goals: [3, 7, 30], text: (n) => `Chơi game ${n} ngày liên tiếp` },
  { id: 'chess-wins', icon: '♟️', name: 'Kỳ thủ', goals: [1, 10, 50], text: (n) => `Thắng ${n} ván cờ vua` },
  { id: 'chess-elo', icon: '👑', name: 'Cao thủ cờ vua', goals: [1300, 1500, 1800], base: 1200, text: (n) => `Đạt ${n} điểm ELO cờ vua` },
  { id: 'caro-wins', icon: '🎯', name: 'Vua caro', goals: [1, 10, 50], text: (n) => `Thắng ${n} ván cờ caro với bạn bè` },
  { id: 'blocks', icon: '🧱', name: 'Thợ xếp khối', goals: [1000, 5000, 20000], text: (n) => `Đạt ${n.toLocaleString('vi-VN')} điểm một ván Xếp Khối` },
  { id: 'puzzle-stars', icon: '⭐', name: 'Nhà giải đố', goals: [30, 150, 450], text: (n) => `Gom ${n} sao Thử thách nhanh` },
  { id: 'quiz', icon: '🧩', name: 'Quiz mỗi ngày', goals: [1, 10, 50], text: (n) => `Giải ${n} quiz hằng ngày` },
  { id: 'farm', icon: '🌾', name: 'Nhà nông', goals: [5, 15, 30], text: (n) => `Nông trại lên cấp ${n}` },
  { id: 'posts', icon: '✍️', name: 'Người kể chuyện', goals: [1, 10, 50], text: (n) => `Đăng ${n} bài lên trang cá nhân` },
  { id: 'likes', icon: '❤️', name: 'Được yêu mến', goals: [10, 50, 200], text: (n) => `Nhận ${n} lượt thích` },
  { id: 'messages', icon: '💬', name: 'Tám chuyện', goals: [100, 1000, 10000], text: (n) => `Gửi ${n.toLocaleString('vi-VN')} tin nhắn` },
  { id: 'voice', icon: '🎤', name: 'Giọng nói quen thuộc', goals: [1, 20, 100], text: (n) => `Gửi ${n} tin nhắn thoại` },
];
const TIERS = ['', 'Đồng', 'Bạc', 'Vàng'];

db.exec(`
  CREATE TABLE IF NOT EXISTS achievement_seen (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    tier INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
`);

const one = (sql, ...args) => {
  try {
    const r = get(sql, ...args);
    return r ? Number(Object.values(r)[0]) || 0 : 0;
  } catch {
    return 0; // bảng của game chưa có (máy chủ mới / kiểm thử): coi như 0
  }
};

/** Số liệu của một người cho từng thành tựu */
function valuesOf(uid) {
  const farm = one('SELECT xp FROM farms WHERE user_id = ?', uid);
  let farmLevel = 0;
  if (farm) {
    try {
      farmLevel = require('./farm-logic').levelInfo(farm).level;
    } catch {
      farmLevel = 0;
    }
  }
  return {
    streak: streaks.bestOverall(uid),
    'chess-wins': one(
      `SELECT COUNT(*) FROM chess_games WHERE status = 'finished'
         AND ((white_id = ? AND result = '1-0') OR (black_id = ? AND result = '0-1'))`,
      uid, uid
    ),
    'chess-elo': one('SELECT MAX(peak, rating) FROM chess_ratings WHERE user_id = ?', uid),
    'caro-wins': one(
      `SELECT COUNT(*) FROM caro_games WHERE status = 'finished' AND ((x_id = ? AND result = 'x') OR (o_id = ? AND result = 'o'))`,
      uid, uid
    ),
    blocks: one("SELECT best FROM game_bests WHERE user_id = ? AND game = 'blocks'", uid),
    'puzzle-stars': one('SELECT COALESCE(SUM(stars), 0) FROM puzzle_levels WHERE user_id = ?', uid),
    quiz: one('SELECT COUNT(*) FROM puzzle_daily WHERE user_id = ?', uid),
    farm: farmLevel,
    posts: one('SELECT COUNT(*) FROM posts WHERE user_id = ?', uid),
    likes: one('SELECT COUNT(*) FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ? AND l.user_id <> ?', uid, uid),
    messages: one("SELECT COUNT(*) FROM messages WHERE sender_id = ? AND kind IN ('text', 'voice', 'poll')", uid),
    voice: one("SELECT COUNT(*) FROM messages WHERE sender_id = ? AND kind = 'voice'", uid),
  };
}

const tierOf = (value, goals) => goals.filter((g) => value >= g).length;

/**
 * Thành tựu của `uid`. viewerId === uid: đánh dấu huy hiệu mới đạt (isNew) rồi ghi nhớ là đã xem.
 * Trả về { list, earned, total } — list xếp: đã đạt (bậc cao trước), rồi chưa đạt (gần xong trước).
 */
function achievementsOf(uid, viewerId = null) {
  const values = valuesOf(uid);
  const seen = new Map(all('SELECT id, tier FROM achievement_seen WHERE user_id = ?', uid).map((r) => [r.id, r.tier]));
  const mine = viewerId === uid;
  const list = DEFS.map((d, order) => {
    const value = values[d.id] || 0;
    const tier = tierOf(value, d.goals);
    const next = tier < d.goals.length ? d.goals[tier] : null;
    return {
      id: d.id,
      icon: d.icon,
      name: d.name,
      tier,
      tierName: TIERS[tier] || '',
      value,
      goals: d.goals,
      next,
      /** Việc đã làm được (bậc hiện tại) hoặc việc cần làm tiếp */
      text: d.text(next ?? d.goals[d.goals.length - 1]),
      done: tier ? d.text(d.goals[tier - 1]) : null,
      progress: next ? Math.min(1, Math.max(0, (value - (d.base || 0)) / (next - (d.base || 0)))) : 1,
      isNew: mine && tier > (seen.get(d.id) || 0),
      order,
    };
  });
  if (mine) {
    for (const a of list) {
      if (a.isNew) {
        run('INSERT INTO achievement_seen (user_id, id, tier) VALUES (?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET tier = excluded.tier', uid, a.id, a.tier);
      }
    }
  }
  list.sort((a, b) => b.tier - a.tier || (a.tier ? a.order - b.order : b.progress - a.progress || a.order - b.order));
  return {
    list: list.map(({ order: _o, ...a }) => a),
    earned: list.reduce((n, a) => n + a.tier, 0),
    total: DEFS.length * 3,
  };
}

module.exports = { DEFS, achievementsOf, valuesOf, tierOf };
