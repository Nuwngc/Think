'use strict';
// Kiểm thử thành tựu trên trang cá nhân (src/achievements.js) — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-ach-'));
const { run } = require('../src/db');
require('../src/games');
require('../src/caro');
require('../src/puzzles');
require('../src/social');
require('../src/farm');
const A = require('../src/achievements');
const streaks = require('../src/streaks');

test('bậc Đồng / Bạc / Vàng theo mốc', () => {
  assert.deepEqual([A.tierOf(0, [1, 10, 50]), A.tierOf(1, [1, 10, 50]), A.tierOf(49, [1, 10, 50]), A.tierOf(50, [1, 10, 50]), A.tierOf(999, [1, 10, 50])], [0, 1, 2, 3, 3]);
  assert.equal(new Set(A.DEFS.map((d) => d.id)).size, A.DEFS.length);
  for (const d of A.DEFS) assert.ok(d.goals.length === 3 && d.goals[0] < d.goals[1] && d.goals[1] < d.goals[2], d.id);
});

test('tính từ dữ liệu thật; chủ trang thấy huy hiệu mới một lần, người khác không thấy', () => {
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (60, 'ach', 'Ach', 'x', 0)");
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (61, 'ach2', 'Ach2', 'x', 0)");
  const now = Date.now();
  // Chuỗi 3 ngày, 1 ván cờ thắng, 12 tin nhắn trong đó 2 tin thoại, 1 bài được 1 người khác thích, kỷ lục Xếp Khối 5200
  const today = streaks.dayKey(now);
  streaks.recordDays(60, 'chess', [streaks.addDays(today, -2), streaks.addDays(today, -1), today], now);
  run("INSERT INTO chess_games (status, white_id, black_id, moves, fen, result, created_at, updated_at) VALUES ('finished', 60, 61, '', 'x', '1-0', 0, 0)");
  run("INSERT INTO chess_games (status, white_id, black_id, moves, fen, result, created_at, updated_at) VALUES ('finished', 61, 60, '', 'x', '1-0', 0, 0)");
  run("INSERT INTO conversations (id, type, name, created_at) VALUES (60, 'group', 'G', 0)");
  for (let i = 0; i < 10; i++) run("INSERT INTO messages (conversation_id, sender_id, text, created_at) VALUES (60, 60, 'hi', 0)");
  for (let i = 0; i < 2; i++) run("INSERT INTO messages (conversation_id, sender_id, kind, audio, created_at) VALUES (60, 60, 'voice', '/uploads/audio/x.webm', 0)");
  const post = Number(run("INSERT INTO posts (user_id, text, created_at, updated_at) VALUES (60, 'xin chào', 0, 0)").lastInsertRowid);
  run('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, 61, 0)', post);
  run('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, 60, 0)', post); // tự thích không tính
  run("INSERT INTO game_bests (user_id, game, best, best_at, games, lines, updated_at) VALUES (60, 'blocks', 5200, 0, 3, 0, 0)");

  const v = A.valuesOf(60);
  assert.deepEqual([v.streak, v['chess-wins'], v.messages, v.voice, v.posts, v.likes, v.blocks], [3, 1, 12, 2, 1, 1, 5200]);
  const other = A.achievementsOf(60, 61);
  assert.equal(other.list.some((a) => a.isNew), false);
  const mine = A.achievementsOf(60, 60);
  const by = Object.fromEntries(mine.list.map((a) => [a.id, a]));
  assert.deepEqual([by.streak.tier, by['chess-wins'].tier, by.blocks.tier, by.voice.tier, by.posts.tier, by.messages.tier], [1, 1, 2, 1, 1, 0]);
  assert.equal(by.blocks.tierName, 'Bạc');
  assert.equal(by.blocks.next, 20000);
  assert.equal(by.messages.progress, 0.12);
  assert.ok(by.streak.isNew && by.blocks.isNew);
  assert.equal(mine.earned, 6);
  assert.equal(mine.total, A.DEFS.length * 3);
  assert.equal(mine.list[0].tier, 2); // đã đạt bậc cao xếp trước
  assert.equal(A.achievementsOf(60, 60).list.some((a) => a.isNew), false); // xem lại: hết "Mới"
  // ELO: tiến độ tính từ 1200
  run('INSERT INTO chess_ratings (user_id, rating, peak, games, wins) VALUES (60, 1250, 1250, 1, 1)');
  assert.equal(A.achievementsOf(60, 61).list.find((a) => a.id === 'chess-elo').progress, 0.5);
});
