'use strict';
// Cờ caro chơi với bạn bè: thách đấu, lượt đi có giới hạn thời gian, điểm ELO, bảng xếp hạng.
// Máy chủ giữ luật (public/caro-core.js, dùng chung với web và app) và đồng hồ; máy người chơi chỉ gửi nước đi.
// Chơi với máy thì chạy hẳn trên điện thoại / trình duyệt (không cần mạng), máy chủ không tham gia.
const { db, get, all, run, transaction } = require('./db');
const Caro = require('../public/caro-core.js');
const { eloDeltas } = require('./chess');

// Chỉ dùng khi chạy kiểm thử tự động: thu nhỏ mọi mốc thời gian
const SCALE = Number(process.env.THINK_CARO_TIME_SCALE) > 0 ? Number(process.env.THINK_CARO_TIME_SCALE) : 1;
const SECOND = 1000 * SCALE;
const TURN_SECONDS = [0, 15, 30, 60, 120]; // thời gian mỗi nước, 0 = không giới hạn
const CHALLENGE_TTL = 15 * 60 * SECOND;
const IDLE_TTL = 3 * 24 * 3600 * SECOND; // ván không giới hạn thời gian mà 3 ngày không ai đi: xử thua người tới lượt
const DEFAULT_RATING = 1200;
const MAX_ACTIVE = 12;
const MAX_PENDING = 6;

db.exec(`
  CREATE TABLE IF NOT EXISTS caro_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    x_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    o_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    challenger_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    opponent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    side_pref TEXT NOT NULL DEFAULT 'random',
    rule TEXT NOT NULL DEFAULT 'free',
    turn_ms INTEGER NOT NULL DEFAULT 0,
    rated INTEGER NOT NULL DEFAULT 1,
    moves TEXT NOT NULL DEFAULT '',
    result TEXT,
    reason TEXT,
    win_line TEXT,
    x_rating INTEGER,
    o_rating INTEGER,
    x_delta INTEGER,
    o_delta INTEGER,
    turn_started_at INTEGER,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_caro_status ON caro_games(status);
  CREATE INDEX IF NOT EXISTS idx_caro_x ON caro_games(x_id, status);
  CREATE INDEX IF NOT EXISTS idx_caro_o ON caro_games(o_id, status);
  CREATE INDEX IF NOT EXISTS idx_caro_ended ON caro_games(ended_at);

  CREATE TABLE IF NOT EXISTS caro_ratings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL DEFAULT 1200,
    peak INTEGER NOT NULL DEFAULT 1200,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER
  );
`);

class CaroError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const movesOf = (g) => (g.moves ? g.moves.split(',').map(Number) : []);
const loadGame = (id) => get('SELECT * FROM caro_games WHERE id = ?', Number(id));
const sideOf = (g, uid) => (g.x_id === uid ? 'x' : g.o_id === uid ? 'o' : null);
const turnOf = (g) => (movesOf(g).length % 2 === 0 ? 'x' : 'o');
const playerId = (g, side) => (side === 'x' ? g.x_id : g.o_id);
const otherSide = (s) => (s === 'x' ? 'o' : 'x');
const humanIds = (g) => [g.x_id, g.o_id, g.challenger_id, g.opponent_id].filter((v, i, a) => v != null && a.indexOf(v) === i);

function ratingOf(uid) {
  return get('SELECT * FROM caro_ratings WHERE user_id = ?', uid) || { user_id: uid, rating: DEFAULT_RATING, peak: DEFAULT_RATING, games: 0, wins: 0, draws: 0, losses: 0 };
}

const ruleLabel = (r) => (r === 'block2' ? 'chặn hai đầu' : 'tự do');
const turnLabel = (ms) => (ms ? `${Math.round(ms / SECOND)} giây mỗi nước` : 'không giới hạn thời gian');

function serialize(g, now = Date.now()) {
  const moves = movesOf(g);
  const out = {
    id: g.id,
    status: g.status,
    xId: g.x_id,
    oId: g.o_id,
    challengerId: g.challenger_id,
    opponentId: g.opponent_id,
    sidePref: g.side_pref,
    rule: g.rule,
    turnMs: g.turn_ms,
    rated: Boolean(g.rated),
    moves,
    turn: moves.length % 2 === 0 ? 'x' : 'o',
    result: g.result,
    reason: g.reason,
    winLine: g.win_line ? g.win_line.split(',').map(Number) : null,
    xRating: g.x_rating,
    oRating: g.o_rating,
    xDelta: g.x_delta,
    oDelta: g.o_delta,
    turnStartedAt: g.turn_started_at,
    createdAt: g.created_at,
    startedAt: g.started_at,
    endedAt: g.ended_at,
    updatedAt: g.updated_at,
    serverTime: now,
  };
  if (g.status === 'active' && g.turn_ms) out.turnLeftMs = Math.max(0, g.turn_started_at + g.turn_ms - now);
  return out;
}

function setupCaro({ app, io, requireAuth, requireReady, isActive, notify, nameOf }) {
  const auth = [requireAuth, requireReady];
  const timers = new Map();

  const emitTo = (ids, event, payload) => {
    for (const uid of new Set(ids)) if (uid != null) io.to(`user:${uid}`).emit(event, payload);
  };
  const emitGame = (g) => emitTo(humanIds(g), 'caro:game', { game: serialize(g) });
  const pushIfAway = (uid, payload) => {
    if (uid == null || isActive(uid)) return;
    notify(uid, { type: 'caro', ...payload }).catch((err) => console.warn('[push]', err.message));
  };

  const handle = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof CaroError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.' });
    }
  };

  /* ----- Kết thúc ván, cập nhật ELO ----- */
  function finish(g, result, reason, line = null, now = Date.now()) {
    clearTimer(g.id);
    const aborted = result == null;
    const rated = !aborted && g.rated && g.x_id != null && g.o_id != null;
    transaction(() => {
      let xr = null;
      let or = null;
      let dx = null;
      let dO = null;
      if (rated) {
        const x = ratingOf(g.x_id);
        const o = ratingOf(g.o_id);
        const score = result === 'x' ? 1 : result === 'o' ? 0 : 0.5;
        const d = eloDeltas(x.rating, o.rating, score, x.games, o.games);
        xr = x.rating;
        or = o.rating;
        dx = d.a;
        dO = d.b;
        const save = (r, delta, s) => {
          const next = Math.max(100, r.rating + delta);
          run(
            `INSERT INTO caro_ratings (user_id, rating, peak, games, wins, draws, losses, updated_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, peak = MAX(caro_ratings.peak, excluded.rating),
               games = caro_ratings.games + 1, wins = caro_ratings.wins + excluded.wins,
               draws = caro_ratings.draws + excluded.draws, losses = caro_ratings.losses + excluded.losses,
               updated_at = excluded.updated_at`,
            r.user_id, next, Math.max(r.peak, next), s === 1 ? 1 : 0, s === 0.5 ? 1 : 0, s === 0 ? 1 : 0, now
          );
        };
        save(x, dx, score);
        save(o, dO, 1 - score);
      }
      run(
        `UPDATE caro_games SET status = ?, result = ?, reason = ?, win_line = ?, ended_at = ?, updated_at = ?,
           x_rating = ?, o_rating = ?, x_delta = ?, o_delta = ? WHERE id = ?`,
        aborted ? 'aborted' : 'finished', result, reason, line ? line.join(',') : null, now, now, xr, or, dx, dO, g.id
      );
    });
    const done = loadGame(g.id);
    emitGame(done);
    return done;
  }

  /* ----- Đồng hồ mỗi nước ----- */
  function clearTimer(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
  function arm(g) {
    clearTimer(g.id);
    if (g.status !== 'active') return;
    const limit = g.turn_ms || IDLE_TTL;
    const wait = Math.max(0, g.turn_started_at + limit - Date.now()) + 50;
    const t = setTimeout(() => checkClock(g.id), Math.min(wait, 2 ** 31 - 1));
    t.unref?.();
    timers.set(g.id, t);
  }
  function checkClock(id) {
    timers.delete(id);
    const g = loadGame(id);
    if (!g || g.status !== 'active') return;
    const now = Date.now();
    const limit = g.turn_ms || IDLE_TTL;
    if (now - g.turn_started_at < limit) return arm(g);
    const moves = movesOf(g);
    if (moves.length < 2) {
      finish(g, null, 'no-start', null, now);
      return;
    }
    const loser = turnOf(g);
    const winner = otherSide(loser);
    const done = finish(g, winner, 'timeout', null, now);
    pushIfAway(playerId(done, loser), { title: 'Hết giờ!', body: `Bạn đã hết giờ trong ván caro với ${nameOf(playerId(done, winner))}.`, tag: `caro-g-${id}`, url: `/#/caro/g/${id}`, gameId: id });
    pushIfAway(playerId(done, winner), { title: 'Bạn thắng ván caro!', body: `${nameOf(playerId(done, loser))} đã hết giờ.`, tag: `caro-g-${id}`, url: `/#/caro/g/${id}`, gameId: id });
  }

  function activeCount(uid) {
    return get("SELECT COUNT(*) AS n FROM caro_games WHERE status = 'active' AND (x_id = ? OR o_id = ?)", uid, uid).n;
  }

  function mine(req, id) {
    const g = loadGame(id);
    if (!g || !humanIds(g).includes(req.user.id)) throw new CaroError(404, 'Không tìm thấy ván caro này.');
    return g;
  }

  const publicRating = (r) => ({ userId: r.user_id, rating: r.rating, peak: r.peak, games: r.games, wins: r.wins, draws: r.draws, losses: r.losses });

  function leaderboard() {
    return all(
      `SELECT r.* FROM caro_ratings r JOIN users u ON u.id = r.user_id WHERE u.disabled = 0 AND r.games > 0
       ORDER BY r.rating DESC, r.wins DESC LIMIT 50`
    ).map(publicRating);
  }

  /* ----- Xem ----- */
  app.get('/api/caro', ...auth, handle((req, res) => {
    const uid = req.user.id;
    const live = all(
      `SELECT * FROM caro_games WHERE (status IN ('active', 'challenge') AND (x_id = ? OR o_id = ? OR challenger_id = ? OR opponent_id = ?))
       ORDER BY updated_at DESC`,
      uid, uid, uid, uid
    );
    const recent = all(
      `SELECT * FROM caro_games WHERE status = 'finished' AND (x_id = ? OR o_id = ?) ORDER BY ended_at DESC LIMIT 20`,
      uid, uid
    );
    res.json({
      games: [...live, ...recent].map((g) => serialize(g)),
      me: publicRating(ratingOf(uid)),
      leaderboard: leaderboard(),
      options: { turnSeconds: TURN_SECONDS, rules: Caro.RULES },
    });
  }));

  app.get('/api/caro/games/:id', ...auth, handle((req, res) => {
    const g = loadGame(req.params.id);
    // Ván đã xong thì ai cũng xem được (chia sẻ), ván đang chơi chỉ người trong ván xem
    if (!g || (g.status !== 'finished' && !humanIds(g).includes(req.user.id))) throw new CaroError(404, 'Không tìm thấy ván caro này.');
    res.json({ game: serialize(g) });
  }));

  /* ----- Thách đấu ----- */
  function createChallenge(uid, body) {
    const oppId = Number(body?.opponentId);
    if (!Number.isInteger(oppId) || oppId === uid) throw new CaroError(400, 'Chọn một người để thách đấu.');
    const opp = get('SELECT id, disabled FROM users WHERE id = ?', oppId);
    if (!opp || opp.disabled) throw new CaroError(404, 'Không tìm thấy người này.');
    const seconds = Number(body?.turnSeconds ?? 30);
    if (!TURN_SECONDS.includes(seconds)) throw new CaroError(400, 'Thời gian mỗi nước không hợp lệ.');
    const rule = Caro.RULES.includes(body?.rule) ? body.rule : 'free';
    const side = ['x', 'o', 'random'].includes(body?.side) ? body.side : 'random';
    const pending = get("SELECT COUNT(*) AS n FROM caro_games WHERE status = 'challenge' AND challenger_id = ?", uid).n;
    if (pending >= MAX_PENDING) throw new CaroError(429, 'Bạn đang chờ quá nhiều lời thách đấu. Hủy bớt rồi thử lại.');
    if (activeCount(uid) >= MAX_ACTIVE) throw new CaroError(429, 'Bạn đang chơi quá nhiều ván cùng lúc.');
    const now = Date.now();
    const old = all("SELECT * FROM caro_games WHERE status = 'challenge' AND challenger_id = ? AND opponent_id = ?", uid, oppId);
    for (const o of old) run("UPDATE caro_games SET status = 'cancelled', updated_at = ? WHERE id = ?", now, o.id);
    const rated = body?.rated !== false;
    const id = Number(
      run(
        `INSERT INTO caro_games (status, challenger_id, opponent_id, side_pref, rule, turn_ms, rated, created_at, updated_at)
         VALUES ('challenge', ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid, oppId, side, rule, seconds * SECOND, rated ? 1 : 0, now, now
      ).lastInsertRowid
    );
    const g = loadGame(id);
    for (const o of old) emitTo([uid, oppId], 'caro:challenge', { game: serialize(loadGame(o.id)) });
    emitTo([uid, oppId], 'caro:challenge', { game: serialize(g) });
    pushIfAway(oppId, {
      title: '⭕ Thách đấu cờ caro',
      body: `${nameOf(uid)} thách bạn một ván caro (${turnLabel(g.turn_ms)}, luật ${ruleLabel(rule)}).`,
      tag: `caro-ch-${id}`,
      url: '/#/caro',
      gameId: id,
    });
    return g;
  }

  app.post('/api/caro/challenges', ...auth, handle((req, res) => res.json({ game: serialize(createChallenge(req.user.id, req.body)) })));

  function answer(req, action) {
    const g = mine(req, req.params.id);
    if (g.status !== 'challenge') throw new CaroError(409, 'Lời thách đấu này không còn nữa.');
    const now = Date.now();
    if (now - g.created_at > CHALLENGE_TTL) {
      run("UPDATE caro_games SET status = 'expired', updated_at = ? WHERE id = ?", now, g.id);
      emitTo([g.challenger_id, g.opponent_id], 'caro:challenge', { game: serialize(loadGame(g.id)) });
      throw new CaroError(409, 'Lời thách đấu đã hết hạn.');
    }
    if (action === 'cancel') {
      if (g.challenger_id !== req.user.id) throw new CaroError(403, 'Chỉ người gửi mới hủy được.');
      run("UPDATE caro_games SET status = 'cancelled', updated_at = ? WHERE id = ?", now, g.id);
    } else if (action === 'decline') {
      if (g.opponent_id !== req.user.id) throw new CaroError(403, 'Lời thách đấu này không phải gửi cho bạn.');
      run("UPDATE caro_games SET status = 'declined', updated_at = ? WHERE id = ?", now, g.id);
      pushIfAway(g.challenger_id, { title: 'Cờ caro', body: `${nameOf(req.user.id)} đã từ chối lời thách đấu.`, tag: `caro-ch-${g.id}`, url: '/#/caro', gameId: g.id });
    } else {
      if (g.opponent_id !== req.user.id) throw new CaroError(403, 'Lời thách đấu này không phải gửi cho bạn.');
      if (activeCount(req.user.id) >= MAX_ACTIVE) throw new CaroError(429, 'Bạn đang chơi quá nhiều ván cùng lúc.');
      const ch = get('SELECT disabled FROM users WHERE id = ?', g.challenger_id);
      if (!ch || ch.disabled) throw new CaroError(409, 'Người thách đấu không còn dùng Think nữa.');
      const challengerX = g.side_pref === 'x' ? true : g.side_pref === 'o' ? false : Math.random() < 0.5;
      run(
        `UPDATE caro_games SET status = 'active', x_id = ?, o_id = ?, started_at = ?, turn_started_at = ?, updated_at = ? WHERE id = ?`,
        challengerX ? g.challenger_id : g.opponent_id,
        challengerX ? g.opponent_id : g.challenger_id,
        now, now, now, g.id
      );
      const started = loadGame(g.id);
      arm(started);
      emitGame(started);
      pushIfAway(g.challenger_id, {
        title: '⭕ Vào chơi caro thôi!',
        body: `${nameOf(req.user.id)} đã nhận lời thách đấu.`,
        tag: `caro-g-${g.id}`,
        url: `/#/caro/g/${g.id}`,
        gameId: g.id,
      });
      return started;
    }
    const updated = loadGame(g.id);
    emitTo([g.challenger_id, g.opponent_id], 'caro:challenge', { game: serialize(updated) });
    return updated;
  }

  app.post('/api/caro/challenges/:id/accept', ...auth, handle((req, res) => res.json({ game: serialize(answer(req, 'accept')) })));
  app.post('/api/caro/challenges/:id/decline', ...auth, handle((req, res) => res.json({ game: serialize(answer(req, 'decline')) })));
  app.post('/api/caro/challenges/:id/cancel', ...auth, handle((req, res) => res.json({ game: serialize(answer(req, 'cancel')) })));

  /* ----- Đi quân ----- */
  app.post('/api/caro/games/:id/move', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    if (g.status !== 'active') throw new CaroError(409, 'Ván caro đã kết thúc.');
    const side = sideOf(g, req.user.id);
    if (!side) throw new CaroError(403, 'Bạn không chơi ván này.');
    const moves = movesOf(g);
    // Máy gửi lại cùng nước (mạng chập chờn): trả ván hiện tại
    const ply = Number(req.body?.ply);
    const index = Number(req.body?.index);
    if (Number.isInteger(ply) && ply < moves.length) {
      if (moves[ply] === index) return res.json({ game: serialize(g) });
      throw new CaroError(409, 'Ván đã có nước khác, đang tải lại.');
    }
    if (turnOf(g) !== side) throw new CaroError(409, 'Chưa tới lượt bạn.');
    const now = Date.now();
    if (g.turn_ms && now - g.turn_started_at > g.turn_ms + 1500) {
      checkClock(g.id);
      throw new CaroError(409, 'Bạn đã hết giờ.');
    }
    const state = Caro.fromMoves(moves, g.rule);
    const next = Caro.play(state, index);
    if (!next) throw new CaroError(400, 'Ô này đã có quân hoặc không hợp lệ.');
    run('UPDATE caro_games SET moves = ?, turn_started_at = ?, updated_at = ? WHERE id = ?', next.moves.join(','), now, now, g.id);
    let updated = loadGame(g.id);
    if (next.winner === 1 || next.winner === 2) {
      updated = finish(updated, next.winner === 1 ? 'x' : 'o', 'five', next.line, now);
      const loser = otherSide(side);
      pushIfAway(playerId(updated, loser), { title: 'Ván caro kết thúc', body: `${nameOf(req.user.id)} đã thắng với 5 quân liền.`, tag: `caro-g-${g.id}`, url: `/#/caro/g/${g.id}`, gameId: g.id });
    } else if (next.winner === 3) {
      updated = finish(updated, 'draw', 'full', null, now);
    } else {
      arm(updated);
      emitGame(updated);
      const oppId = playerId(updated, otherSide(side));
      pushIfAway(oppId, { title: '⭕ Tới lượt bạn', body: `${nameOf(req.user.id)} vừa đi ${Caro.cellName(index)} trong ván caro.`, tag: `caro-g-${g.id}`, url: `/#/caro/g/${g.id}`, gameId: g.id });
    }
    res.json({ game: serialize(updated) });
  }));

  app.post('/api/caro/games/:id/resign', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    const side = sideOf(g, req.user.id);
    if (g.status !== 'active' || !side) throw new CaroError(409, 'Ván caro đã kết thúc.');
    // Chưa ai đi nước nào: hủy ván, không tính điểm
    const done = movesOf(g).length < 2 ? finish(g, null, 'aborted') : finish(g, otherSide(side), 'resign');
    pushIfAway(playerId(done, otherSide(side)), {
      title: done.status === 'aborted' ? 'Ván caro đã hủy' : 'Bạn thắng ván caro!',
      body: done.status === 'aborted' ? `${nameOf(req.user.id)} đã hủy ván.` : `${nameOf(req.user.id)} đã đầu hàng.`,
      tag: `caro-g-${g.id}`,
      url: `/#/caro/g/${g.id}`,
      gameId: g.id,
    });
    res.json({ game: serialize(done) });
  }));

  app.post('/api/caro/games/:id/rematch', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    const side = sideOf(g, req.user.id);
    if (!side || (g.status !== 'finished' && g.status !== 'aborted')) throw new CaroError(409, 'Ván caro chưa kết thúc.');
    const next = createChallenge(req.user.id, {
      opponentId: playerId(g, otherSide(side)),
      turnSeconds: Math.round(g.turn_ms / SECOND),
      rule: g.rule,
      side: otherSide(side), // đổi bên: ván trước đi O thì ván này đi X
      rated: Boolean(g.rated),
    });
    res.json({ game: serialize(next) });
  }));

  /* ----- Dọn lời thách đấu hết hạn, chạy lại đồng hồ khi máy chủ khởi động lại ----- */
  function expireChallenges() {
    const now = Date.now();
    for (const g of all("SELECT * FROM caro_games WHERE status = 'challenge' AND created_at < ?", now - CHALLENGE_TTL)) {
      run("UPDATE caro_games SET status = 'expired', updated_at = ? WHERE id = ?", now, g.id);
      emitTo([g.challenger_id, g.opponent_id], 'caro:challenge', { game: serialize(loadGame(g.id)) });
    }
  }
  const sweep = setInterval(expireChallenges, Math.min(60 * 1000, CHALLENGE_TTL / 4));
  sweep.unref?.();
  for (const g of all("SELECT * FROM caro_games WHERE status = 'active'")) arm(g);
}

/** Thành tích caro của một người (trang cá nhân) */
function caroStatsOf(uid) {
  const r = get('SELECT rating, games, wins FROM caro_ratings WHERE user_id = ?', uid);
  return r && r.games > 0 ? { rating: r.rating, games: r.games, wins: r.wins } : null;
}

module.exports = { setupCaro, caroStatsOf, TURN_SECONDS };
