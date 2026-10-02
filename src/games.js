'use strict';
// Trò chơi nhỏ chơi trên máy (hiện có Xếp Khối): máy chủ chỉ giữ điểm để làm bảng xếp hạng.
// Game chạy hẳn trên điện thoại / trình duyệt nên chơi được cả khi mất mạng; điểm các ván chơi lúc offline
// được gửi lên theo lô khi có mạng lại (mỗi ván có mã riêng nên gửi lại nhiều lần cũng không bị tính trùng).
const { db, get, all, run, transaction } = require('./db');
const streaks = require('./streaks');

const GAMES = {
  // Mỗi nước đặt khối được tối đa 9 ô + ăn 6 hàng với combo x10 + dọn sạch bàn: dưới 1700 điểm
  blocks: { name: 'Xếp Khối', maxPerMove: 1700 },
};
const MAX_BATCH = 50;
const ACCEPT_DAYS = 30; // nhận ván chơi trong vòng 30 ngày (chơi lúc mất mạng rồi lâu mới có mạng)
const KEEP_DAYS = 45; // điểm từng ván giữ lâu hơn hạn nhận, để gửi lại ván cũ không bị tính trùng; kỷ lục mỗi người giữ mãi
const TOP = 50;
const TZ_OFFSET = 7 * 3600 * 1000; // tuần tính theo giờ Việt Nam, bắt đầu 0 giờ thứ Hai

db.exec(`
  CREATE TABLE IF NOT EXISTS game_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    client_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    lines INTEGER NOT NULL DEFAULT 0,
    moves INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    played_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, game, client_id)
  );
  CREATE INDEX IF NOT EXISTS idx_game_scores_week ON game_scores(game, played_at);

  CREATE TABLE IF NOT EXISTS game_bests (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    best INTEGER NOT NULL DEFAULT 0,
    best_at INTEGER,
    games INTEGER NOT NULL DEFAULT 0,
    lines INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, game)
  );
`);

class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function rateLimit(n, ms) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < ms);
    if (list.length >= n) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

/** 0 giờ thứ Hai của tuần chứa thời điểm t (giờ Việt Nam), dạng mili giây UTC */
function weekStart(t = Date.now()) {
  const local = new Date(t + TZ_OFFSET);
  const day = (local.getUTCDay() + 6) % 7; // thứ Hai = 0
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return midnight - day * 86400000 - TZ_OFFSET;
}

const int = (v) => (Number.isSafeInteger(v) ? v : Number.isFinite(v) ? Math.round(v) : NaN);

/** Kiểm tra một ván gửi lên; trả về bản đã làm sạch hoặc lý do bỏ qua */
function cleanScore(game, s, now = Date.now()) {
  if (!s || typeof s !== 'object') return { error: 'Dữ liệu ván không hợp lệ.' };
  const id = String(s.id || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return { error: 'Mã ván không hợp lệ.' };
  const score = int(Number(s.score));
  const moves = int(Number(s.moves));
  const lines = int(Number(s.lines || 0));
  const durationMs = int(Number(s.durationMs || 0));
  const playedAt = int(Number(s.playedAt));
  if (!(score >= 0 && score <= 10_000_000)) return { error: 'Điểm không hợp lệ.' };
  if (!(moves >= 0 && moves <= 100_000) || !(lines >= 0 && lines <= 100_000)) return { error: 'Số nước không hợp lệ.' };
  if (score > Math.max(1, moves) * GAMES[game].maxPerMove) return { error: 'Điểm cao bất thường so với số nước đi.' };
  if (lines > moves * 6) return { error: 'Số hàng không hợp lệ.' };
  if (!(playedAt > now - ACCEPT_DAYS * 86400000 && playedAt < now + 10 * 60000)) return { error: 'Ván đã quá cũ hoặc thời gian chơi không hợp lệ.' };
  return { id, score, moves, lines, durationMs: Math.max(0, Math.min(durationMs || 0, 7 * 86400000)), playedAt };
}

function setupGames({ app, io, requireAuth, requireReady, nameOf }) {
  const auth = [requireAuth, requireReady];
  const submitLimit = rateLimit(30, 10 * 60 * 1000);

  const handle = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.' });
    }
  };
  const gameOf = (req) => {
    const game = String(req.params.game || '');
    if (!GAMES[game]) throw new GameError(404, 'Không có trò chơi này.');
    return game;
  };

  // Bảng xếp hạng: kỷ lục mọi lúc, và điểm cao nhất trong tuần này. Ẩn tài khoản đã khóa.
  function boards(game, uid) {
    const since = weekStart();
    const allTime = all(
      `SELECT b.user_id, b.best, b.best_at, b.games FROM game_bests b JOIN users u ON u.id = b.user_id
       WHERE b.game = ? AND b.best > 0 AND u.disabled = 0 ORDER BY b.best DESC, b.best_at ASC LIMIT ?`,
      game, TOP
    ).map((r) => ({ userId: r.user_id, score: r.best, at: r.best_at, games: r.games }));
    const week = all(
      `SELECT s.user_id, MAX(s.score) AS best, s.played_at AS at, COUNT(*) AS games FROM game_scores s JOIN users u ON u.id = s.user_id
       WHERE s.game = ? AND s.played_at >= ? AND u.disabled = 0 GROUP BY s.user_id HAVING best > 0 ORDER BY best DESC, at ASC LIMIT ?`,
      game, since, TOP
    ).map((r) => ({ userId: r.user_id, score: r.best, at: r.at, games: r.games }));
    const mine = get('SELECT best, best_at, games, lines FROM game_bests WHERE user_id = ? AND game = ?', uid, game);
    const myWeek = get('SELECT MAX(score) AS best FROM game_scores WHERE user_id = ? AND game = ? AND played_at >= ?', uid, game, since);
    const rankOf = (list) => list.findIndex((r) => r.userId === uid) + 1 || null;
    return {
      game,
      weekStart: since,
      me: {
        best: mine ? mine.best : 0,
        bestAt: mine ? mine.best_at : null,
        games: mine ? mine.games : 0,
        lines: mine ? mine.lines : 0,
        weekBest: (myWeek && myWeek.best) || 0,
        rank: rankOf(allTime),
        weekRank: rankOf(week),
      },
      leaderboard: { all: allTime, week },
    };
  }

  app.get('/api/games/:game', ...auth, handle((req, res) => {
    const game = gameOf(req);
    res.json(boards(game, req.user.id));
  }));

  // Gửi điểm các ván đã chơi (có thể nhiều ván chơi lúc offline). Ván đã gửi rồi thì bỏ qua, không tính trùng.
  app.post('/api/games/:game/scores', ...auth, handle((req, res) => {
    const game = gameOf(req);
    const list = Array.isArray(req.body && req.body.scores) ? req.body.scores : [];
    if (!list.length) throw new GameError(400, 'Chưa có ván nào để gửi.');
    if (list.length > MAX_BATCH) throw new GameError(400, `Gửi tối đa ${MAX_BATCH} ván một lần.`);
    if (!submitLimit(req.user.id)) throw new GameError(429, 'Gửi điểm nhiều quá. Thử lại sau ít phút nhé.');
    const uid = req.user.id;
    const now = Date.now();
    const before = get('SELECT best FROM game_bests WHERE user_id = ? AND game = ?', uid, game);
    const prevBest = before ? before.best : 0;
    const leaderOf = () => get(
      `SELECT b.user_id FROM game_bests b JOIN users u ON u.id = b.user_id WHERE b.game = ? AND b.best > 0 AND u.disabled = 0
       ORDER BY b.best DESC, b.best_at ASC LIMIT 1`,
      game
    );
    const prevLeader = leaderOf();
    const accepted = [];
    const rejected = [];
    const playedDays = new Set();
    transaction(() => {
      for (const raw of list) {
        const s = cleanScore(game, raw, now);
        if (s.error) {
          rejected.push({ id: raw && raw.id, error: s.error });
          continue;
        }
        const r = run(
          `INSERT OR IGNORE INTO game_scores (user_id, game, client_id, score, lines, moves, duration_ms, played_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          uid, game, s.id, s.score, s.lines, s.moves, s.durationMs, s.playedAt, now
        );
        accepted.push(s.id); // đã có từ trước cũng coi như nhận rồi (máy người dùng xóa khỏi hàng chờ)
        if (!r.changes) continue;
        playedDays.add(streaks.dayKey(s.playedAt));
        run(
          `INSERT INTO game_bests (user_id, game, best, best_at, games, lines, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(user_id, game) DO UPDATE SET
             best_at = CASE WHEN excluded.best > game_bests.best THEN excluded.best_at ELSE game_bests.best_at END,
             best = MAX(game_bests.best, excluded.best),
             games = game_bests.games + 1,
             lines = game_bests.lines + excluded.lines,
             updated_at = excluded.updated_at`,
          uid, game, s.score, s.playedAt, s.lines, now
        );
      }
      // Dọn điểm từng ván quá cũ (kỷ lục vẫn giữ trong game_bests)
      run('DELETE FROM game_scores WHERE game = ? AND played_at < ?', game, now - KEEP_DAYS * 86400000);
    });
    // Chuỗi hằng ngày: ngày của các ván vừa gửi (kể cả ván chơi lúc mất mạng)
    if (playedDays.size) streaks.recordDays(uid, game, [...playedDays], now);
    const out = boards(game, uid);
    const newBest = out.me.best > prevBest;
    if (newBest) {
      // Báo cả nhóm để bảng xếp hạng cập nhật ngay; ai vừa lên số 1 thì mọi người thấy thông báo nhỏ
      const leader = leaderOf();
      const newLeader = Boolean(leader && leader.user_id === uid && (!prevLeader || prevLeader.user_id !== uid));
      io.emit('games:score', { game, userId: uid, name: nameOf(uid), best: out.me.best, previousBest: prevBest, rank: out.me.rank, newLeader });
    }
    res.json({ ...out, accepted, rejected, newBest, previousBest: prevBest });
  }));
}

/** Kỷ lục của một người (hiện trên trang cá nhân) */
function bestOf(uid, game = 'blocks') {
  const r = get('SELECT best, games FROM game_bests WHERE user_id = ? AND game = ?', uid, game);
  return r && r.best > 0 ? { best: r.best, games: r.games } : null;
}

module.exports = { setupGames, cleanScore, weekStart, bestOf, GAMES };
