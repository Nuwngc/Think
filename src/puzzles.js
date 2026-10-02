'use strict';
// Câu đố của Cờ vua, Xếp Khối, Cờ caro:
//  - "Quiz hằng ngày": mỗi game một câu mỗi ngày (giờ Việt Nam), cả nhóm cùng giải, xem ai giải nhanh nhất.
//  - "Thử thách nhanh": 200 màn mỗi game (thêm được bằng scripts/puzzles/*.js --add N), mở dần từng màn, 1–3 sao.
// Dữ liệu câu đố: public/puzzles/<game>.json (web tải thẳng, app đóng gói sẵn). Luật: public/puzzles-core.js.
// Máy chủ chỉ ghi kết quả sau khi tự đi lại lời giải để kiểm tra (không tin máy người dùng).
// Giải câu đố cũng tính là có chơi game đó trong ngày (chuỗi hằng ngày, src/streaks.js).
const fs = require('node:fs');
const path = require('node:path');
const { Chess } = require('chess.js');
const { db, get, all, run } = require('./db');
const P = require('../public/puzzles-core.js');
const streaks = require('./streaks');

const DATA_DIR = path.join(__dirname, '..', 'public', 'puzzles');
const BOARD_SIZE = 10; // bảng xếp hạng thử thách: 10 người nhiều sao nhất
const SYNC_DAYS = 2; // quiz giải lúc mất mạng: nhận kết quả của hôm nay và hôm qua

db.exec(`
  CREATE TABLE IF NOT EXISTS puzzle_levels (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    level INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    best_ms INTEGER,
    solved_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, game, level)
  );
  CREATE TABLE IF NOT EXISTS puzzle_daily (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    day TEXT NOT NULL,
    ms INTEGER,
    mistakes INTEGER NOT NULL DEFAULT 0,
    hints INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL,
    solved_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, game, day)
  );
  CREATE INDEX IF NOT EXISTS idx_puzzle_daily_day ON puzzle_daily(game, day);
`);

/* ---------------- Dữ liệu câu đố ---------------- */

const DATA = {};
function load(game) {
  if (!DATA[game]) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${game}.json`), 'utf8'));
    DATA[game] = { version: raw.version, levels: raw.levels, daily: raw.daily, chapters: raw.chapters };
  }
  return DATA[game];
}

/** Câu đố quiz hằng ngày của một ngày */
function dailyOf(game, day) {
  const d = load(game);
  const index = P.dailyIndex(day, d.daily.length);
  return { index, puzzle: d.daily[index] };
}

class PuzzleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------------- Tóm tắt cho một người ---------------- */

const intOr = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);
/** Thời gian giải (ms): không tin số quá nhỏ — mỗi nước đi tối thiểu 0,6 giây */
const msOf = (body) => {
  const ms = intOr(body?.ms, null);
  const moves = Array.isArray(body?.moves) ? body.moves.length : 1;
  return ms == null ? null : Math.min(Math.max(ms, 600 * Math.max(1, moves)), 24 * 3600 * 1000);
};

function gameSummary(uid, game, day = P.dayKey()) {
  const d = load(game);
  const rows = all('SELECT level, stars, best_ms FROM puzzle_levels WHERE user_id = ? AND game = ?', uid, game);
  const stars = new Array(d.levels.length).fill('0');
  let total = 0;
  for (const r of rows) {
    if (r.level >= 1 && r.level <= d.levels.length) stars[r.level - 1] = String(r.stars);
    total += r.stars;
  }
  const daily = dailyOf(game, day);
  const mine = get('SELECT ms, mistakes, hints, stars FROM puzzle_daily WHERE user_id = ? AND game = ? AND day = ?', uid, game, day);
  const solvers = all(
    `SELECT p.user_id AS userId, p.ms, p.mistakes, p.hints, p.stars, p.solved_at AS at FROM puzzle_daily p JOIN users u ON u.id = p.user_id
      WHERE p.game = ? AND p.day = ? AND u.disabled = 0 ORDER BY p.stars DESC, COALESCE(p.ms, 1e12) ASC, p.solved_at ASC LIMIT 50`,
    game, day
  );
  const board = all(
    `SELECT l.user_id AS userId, SUM(l.stars) AS stars, COUNT(*) AS solved, MAX(l.solved_at) AS at FROM puzzle_levels l JOIN users u ON u.id = l.user_id
      WHERE l.game = ? AND u.disabled = 0 AND l.level <= ? GROUP BY l.user_id ORDER BY stars DESC, solved DESC, at ASC LIMIT ?`,
    game, d.levels.length, BOARD_SIZE
  );
  return {
    count: d.levels.length,
    version: d.version,
    stars: stars.join(''),
    solved: rows.length,
    totalStars: total,
    daily: { day, index: daily.index, id: daily.puzzle ? daily.puzzle.id : null, mine: mine || null, solvers },
    board,
  };
}

function summary(uid, day = P.dayKey()) {
  const games = {};
  for (const g of P.GAMES) games[g] = gameSummary(uid, g, day);
  return { today: day, games };
}

/* ---------------- Ghi kết quả ---------------- */

function checkGame(game) {
  if (!P.GAMES.includes(game)) throw new PuzzleError(404, 'Không có game này.');
}

/** Giải xong màn `level` (tính từ 1) của thử thách nhanh */
function solveLevel(uid, game, body, now = Date.now()) {
  checkGame(game);
  const d = load(game);
  const level = Number(body?.level);
  if (!Number.isInteger(level) || level < 1 || level > d.levels.length) throw new PuzzleError(400, 'Không có màn này.');
  if (level > 1 && !get('SELECT 1 FROM puzzle_levels WHERE user_id = ? AND game = ? AND level = ?', uid, game, level - 1)) {
    throw new PuzzleError(409, 'Màn này chưa mở: giải màn trước đã.');
  }
  if (!P.verify(game, d.levels[level - 1], body?.moves, Chess)) throw new PuzzleError(400, 'Lời giải không đúng.');
  const stars = P.stars(body?.mistakes, body?.hints);
  const ms = msOf(body);
  run(
    `INSERT INTO puzzle_levels (user_id, game, level, stars, best_ms, solved_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, game, level) DO UPDATE SET stars = MAX(stars, excluded.stars),
       best_ms = CASE WHEN best_ms IS NULL THEN excluded.best_ms WHEN excluded.best_ms IS NULL THEN best_ms ELSE MIN(best_ms, excluded.best_ms) END`,
    uid, game, level, stars, ms, now
  );
  streaks.record(uid, game, playedAt(body, now), now);
  return gameSummary(uid, game);
}

/**
 * Lúc người chơi giải (giải lúc mất mạng thì gửi muộn, tối đa 2 ngày trước); không cho ở tương lai.
 * Máy gửi kèm `now` (giờ điện thoại lúc gửi) thì đổi sang giờ máy chủ: điện thoại để sai giờ / sai ngày vẫn tính đúng ngày.
 */
function playedAt(body, now) {
  const t = Number(body?.playedAt) + (streaks.clockSkew(body?.now, now) || 0);
  return Number.isFinite(t) && t >= now - SYNC_DAYS * 86400000 && t <= now ? t : now;
}

/** Giải xong quiz hằng ngày của ngày `day` (hôm nay, hoặc hôm qua nếu giải lúc mất mạng) */
function solveDaily(uid, game, body, now = Date.now()) {
  checkGame(game);
  const today = P.dayKey(now);
  const day = typeof body?.day === 'string' ? body.day : today;
  const age = P.dayNumber(today) - P.dayNumber(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(age >= 0 && age < SYNC_DAYS)) throw new PuzzleError(400, 'Quiz của ngày này đã đóng.');
  const { puzzle } = dailyOf(game, day);
  if (!puzzle || (body?.id && body.id !== puzzle.id)) throw new PuzzleError(409, 'Quiz hôm nay đã đổi, tải lại nhé.');
  if (!P.verify(game, puzzle, body?.moves, Chess)) throw new PuzzleError(400, 'Lời giải không đúng.');
  const mistakes = intOr(body?.mistakes, 0);
  const hints = intOr(body?.hints, 0);
  const ms = msOf(body);
  const r = run(
    `INSERT OR IGNORE INTO puzzle_daily (user_id, game, day, ms, mistakes, hints, stars, solved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    uid, game, day, ms, mistakes, hints, P.stars(mistakes, hints), now
  );
  // Chuỗi: tính theo lúc giải thật (giờ máy chủ); máy cũ không gửi giờ điện thoại thì theo ngày của quiz
  const known = streaks.clockSkew(body?.now, now) != null;
  streaks.record(uid, game, known || day === today ? playedAt(body, now) : Date.parse(`${day}T05:00:00Z`), now);
  return { first: r.changes > 0, day, summary: gameSummary(uid, game, today) };
}

/* ---------------- API ---------------- */

function setupPuzzles({ app, io, requireAuth, requireReady }) {
  const auth = [requireAuth, requireReady];
  const handle = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof PuzzleError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.' });
    }
  };

  app.get('/api/puzzles', ...auth, handle((req, res) => res.json(summary(req.user.id))));

  app.post('/api/puzzles/:game/level', ...auth, handle((req, res) => {
    res.json({ game: req.params.game, summary: solveLevel(req.user.id, req.params.game, req.body) });
  }));

  app.post('/api/puzzles/:game/daily', ...auth, handle((req, res) => {
    const out = solveDaily(req.user.id, req.params.game, req.body);
    const mine = out.summary.daily.mine;
    // Cả nhóm thấy ngay ai vừa giải quiz hôm nay (danh sách người giải tự cập nhật)
    if (out.first && io && out.day === out.summary.daily.day) {
      io.emit('puzzle:daily', { game: req.params.game, day: out.day, userId: req.user.id, ms: mine?.ms ?? null, mistakes: mine?.mistakes ?? 0, stars: mine?.stars ?? 1 });
    }
    res.json({ game: req.params.game, first: out.first, summary: out.summary });
  }));
}

module.exports = { setupPuzzles, summary, gameSummary, solveLevel, solveDaily, dailyOf, load, PuzzleError };
