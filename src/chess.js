'use strict';
// Cờ vua: thách đấu, đồng hồ, điểm ELO, bảng xếp hạng, chơi với máy.
// Máy chủ giữ luật (chess.js) và đồng hồ; máy người chơi chỉ gửi nước đi.
const { Chess } = require('chess.js');
const { get, all, run, transaction } = require('./db');
const streaks = require('./streaks');
const engine = require('./chess-engine');
const { setupAnalysis } = require('./chess-analysis');

const START_FEN = new Chess().fen();
// Chỉ dùng khi chạy kiểm thử tự động: thu nhỏ mọi mốc thời gian (vd 0.01 = 1 phút thành 0,6 giây)
const SCALE = Number(process.env.THINK_CHESS_TIME_SCALE) > 0 ? Number(process.env.THINK_CHESS_TIME_SCALE) : 1;
const MINUTE = 60000 * SCALE;
const BASE_MINUTES = [0, 1, 2, 3, 5, 10, 15, 30, 60]; // 0 = không giới hạn thời gian
const MAX_INC = 60; // giây cộng thêm mỗi nước
const CHALLENGE_TTL = 15 * MINUTE;
const FIRST_MOVE_MS = MINUTE; // ván có giờ: mỗi bên phải đi nước đầu trong 1 phút, không thì hủy ván
const DEFAULT_RATING = 1200;
const MAX_ACTIVE = 12;
const MAX_PENDING = 6;

/* ---------------- Máy cờ (AI) ---------------- */

const SOURCES = {
  jce: { name: 'js-chess-engine', url: 'https://github.com/josefjadrny/js-chess-engine', license: 'MIT' },
  garbo: { name: 'GarboChess-JS', url: 'https://github.com/glinscott/Garbochess-JS', license: 'BSD' },
  stockfish: { name: 'Stockfish 11', url: 'https://github.com/official-stockfish/Stockfish', license: 'GPL-3.0' },
};

const BOTS = [
  { id: 'jce-1', name: 'Gà Mờ', elo: 500, engine: 'jce', level: 1, randomness: 120, movetime: 600, about: 'Mới học đi quân, hay đi nước ngẫu hứng.' },
  { id: 'jce-2', name: 'Tập Sự', elo: 800, engine: 'jce', level: 2, randomness: 40, movetime: 700, about: 'Biết ăn quân, ít nhìn xa.' },
  { id: 'jce-3', name: 'Học Trò', elo: 1000, engine: 'jce', level: 3, randomness: 20, movetime: 800, about: 'Đánh cẩn thận hơn, hợp để luyện tập.' },
  { id: 'sf-3', name: 'Stockfish · Dễ', elo: 1300, engine: 'stockfish', skill: 3, movetime: 400, about: 'Máy mạnh nhất thế giới, đã giảm sức.' },
  { id: 'garbo', name: 'GarboChess', elo: 1600, engine: 'garbo', movetime: 900, about: 'Máy cờ JavaScript cổ điển của Gary Linscott.' },
  { id: 'sf-8', name: 'Stockfish · Vừa', elo: 1800, engine: 'stockfish', skill: 8, movetime: 700, about: 'Đánh chắc tay, ít sai lầm lớn.' },
  { id: 'sf-14', name: 'Stockfish · Khó', elo: 2300, engine: 'stockfish', skill: 14, movetime: 1000, about: 'Mạnh cỡ kiện tướng.' },
  { id: 'sf-20', name: 'Stockfish · Mạnh nhất', elo: 3000, engine: 'stockfish', skill: 20, movetime: 1500, about: 'Hết sức. Thắng được là huyền thoại.' },
];
const botById = new Map(BOTS.map((b) => [b.id, b]));
const botPublic = (b) => ({ id: b.id, name: b.name, elo: b.elo, about: b.about, source: SOURCES[b.engine] });

/* ---------------- Tiện ích ---------------- */

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const movesOf = (g) => (g.moves ? g.moves.split(' ') : []);
const turnOf = (g) => (movesOf(g).length % 2 === 0 ? 'w' : 'b');
const other = (c) => (c === 'w' ? 'b' : 'w');
const colorOf = (g, uid) => (g.white_id === uid ? 'w' : g.black_id === uid ? 'b' : null);
const playerId = (g, color) => (color === 'w' ? g.white_id : g.black_id);
const isBotSide = (g, color) => Boolean(g.bot) && playerId(g, color) == null;
const humanIds = (g) => [g.white_id, g.black_id, g.challenger_id, g.opponent_id].filter((x, i, a) => x != null && a.indexOf(x) === i);

function tcLabel(g) {
  if (!g.base_ms) return 'không giới hạn thời gian';
  return `${Math.round(g.base_ms / MINUTE)}+${Math.round(g.inc_ms / 1000 / SCALE)}`;
}

class ChessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const loadGame = (id) => get('SELECT * FROM chess_games WHERE id = ?', Number(id));

// Bàn cờ dựng lại từ danh sách nước đi (để biết lặp lại 3 lần), giữ sẵn cho ván đang chơi
const boards = new Map();
function boardOf(g) {
  const moves = movesOf(g);
  const cached = boards.get(g.id);
  if (cached && cached.history().length === moves.length) return cached;
  const chess = new Chess();
  for (const m of moves) {
    const p = UCI.exec(m);
    chess.move({ from: p[1], to: p[2], promotion: p[3] });
  }
  boards.set(g.id, chess);
  return chess;
}

function clocksOf(g, now) {
  if (!g.base_ms) return null;
  const clocks = { w: g.white_ms, b: g.black_ms };
  if (g.status === 'active' && movesOf(g).length >= 2) {
    const t = turnOf(g);
    clocks[t] = Math.max(0, clocks[t] - (now - g.turn_started_at));
  }
  return clocks;
}

function serialize(g, now = Date.now()) {
  const moves = movesOf(g);
  const active = g.status === 'active';
  const bot = g.bot ? botById.get(g.bot) : null;
  return {
    id: g.id,
    status: g.status,
    rated: Boolean(g.rated),
    whiteId: g.white_id,
    blackId: g.black_id,
    bot: bot ? botPublic(bot) : null,
    botColor: bot ? (g.white_id == null ? 'w' : 'b') : null,
    challengerId: g.challenger_id,
    opponentId: g.opponent_id,
    colorPref: g.color_pref,
    base: g.base_ms,
    inc: g.inc_ms,
    moves,
    fen: g.fen,
    turn: moves.length % 2 === 0 ? 'w' : 'b',
    clocks: clocksOf(g, now),
    serverNow: now,
    firstMoveDeadline: active && g.base_ms && moves.length < 2 ? g.turn_started_at + FIRST_MOVE_MS : null,
    drawOffer: g.draw_offer || null,
    result: g.result || null,
    reason: g.reason || null,
    ratings: { w: g.white_rating ?? null, b: g.black_rating ?? null },
    // Điểm hiện tại của hai bên (máy thì ghi mức ELO ước lượng)
    live: { w: liveRating(g, 'w', bot), b: liveRating(g, 'b', bot) },
    deltas: { w: g.white_delta ?? null, b: g.black_delta ?? null },
    createdAt: g.created_at,
    startedAt: g.started_at || null,
    endedAt: g.ended_at || null,
    expiresAt: g.status === 'challenge' ? g.created_at + CHALLENGE_TTL : null,
  };
}

function liveRating(g, color, bot) {
  const uid = color === 'w' ? g.white_id : g.black_id;
  if (uid != null) return ratingOf(uid).rating;
  if (bot && (g.status === 'active' || g.status === 'finished' || g.status === 'aborted')) return bot.elo;
  return null;
}

function ratingOf(uid) {
  return (
    get('SELECT * FROM chess_ratings WHERE user_id = ?', uid) || {
      user_id: uid, rating: DEFAULT_RATING, peak: DEFAULT_RATING, games: 0, wins: 0, draws: 0, losses: 0,
    }
  );
}
const ratingPublic = (r) => ({
  userId: r.user_id, rating: r.rating, peak: r.peak, games: r.games, wins: r.wins, draws: r.draws, losses: r.losses,
  provisional: r.games < 10,
});

/** Điểm ELO mới: hệ số K = 40 cho người mới (dưới 20 ván xếp hạng), sau đó 20 */
function eloDeltas(ra, rb, scoreA, gamesA, gamesB) {
  const expectA = 1 / (1 + 10 ** ((rb - ra) / 400));
  const kA = gamesA < 20 ? 40 : 20;
  const kB = gamesB < 20 ? 40 : 20;
  return { a: Math.round(kA * (scoreA - expectA)), b: Math.round(kB * ((1 - scoreA) - (1 - expectA))) };
}

// Bên còn lại chỉ còn Vua, hoặc Vua + 1 Mã / 1 Tượng: không thể chiếu hết, hết giờ thì hòa
function cannotMate(chess, color) {
  const pieces = chess.board().flat().filter((sq) => sq && sq.color === color && sq.type !== 'k');
  return pieces.length === 0 || (pieces.length === 1 && (pieces[0].type === 'n' || pieces[0].type === 'b'));
}

/* ---------------- Cài vào máy chủ ---------------- */

function setupChess({ app, io, requireAuth, requireReady, isActive, notify, nameOf }) {
  const timers = new Map();
  const botTimers = new Map();

  const emitTo = (ids, event, payload) => {
    for (const uid of new Set(ids)) if (uid != null) io.to(`user:${uid}`).emit(event, payload);
  };
  const emitGame = (g) => emitTo(humanIds(g), 'chess:game', { game: serialize(g) });
  const pushIfAway = (uid, payload) => {
    if (uid == null || isActive(uid)) return;
    notify(uid, { type: 'chess', ...payload }).catch((err) => console.warn('[push]', err.message));
  };

  /* ----- Kết thúc ván, cập nhật ELO ----- */

  function finish(g, result, reason, now = Date.now()) {
    clearTimer(g.id);
    boards.delete(g.id);
    const clocks = clocksOf(g, now);
    const aborted = result == null;
    const rated = !aborted && g.rated && !g.bot && g.white_id != null && g.black_id != null;
    transaction(() => {
      let wr = null;
      let br = null;
      let dw = null;
      let db = null;
      if (rated) {
        const w = ratingOf(g.white_id);
        const b = ratingOf(g.black_id);
        const score = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
        const d = eloDeltas(w.rating, b.rating, score, w.games, b.games);
        wr = w.rating;
        br = b.rating;
        dw = d.a;
        db = d.b;
        const save = (r, delta, s) => {
          const next = Math.max(100, r.rating + delta);
          run(
            `INSERT INTO chess_ratings (user_id, rating, peak, games, wins, draws, losses, updated_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, peak = MAX(chess_ratings.peak, excluded.rating),
               games = chess_ratings.games + 1, wins = chess_ratings.wins + excluded.wins,
               draws = chess_ratings.draws + excluded.draws, losses = chess_ratings.losses + excluded.losses,
               updated_at = excluded.updated_at`,
            r.user_id, next, Math.max(r.peak, next), s === 1 ? 1 : 0, s === 0.5 ? 1 : 0, s === 0 ? 1 : 0, now
          );
        };
        save(w, dw, score);
        save(b, db, 1 - score);
      }
      run(
        `UPDATE chess_games SET status = ?, result = ?, reason = ?, ended_at = ?, updated_at = ?, draw_offer = NULL,
           white_ms = ?, black_ms = ?, white_rating = ?, black_rating = ?, white_delta = ?, black_delta = ?
         WHERE id = ?`,
        aborted ? 'aborted' : 'finished', result, reason, now, now,
        clocks ? clocks.w : g.white_ms, clocks ? clocks.b : g.black_ms, wr, br, dw, db, g.id
      );
    });
    const done = loadGame(g.id);
    emitGame(done);
    return done;
  }

  /* ----- Đồng hồ ----- */

  function clearTimer(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }

  function arm(g) {
    clearTimer(g.id);
    if (g.status !== 'active' || !g.base_ms) return;
    const ply = movesOf(g).length;
    const turn = turnOf(g);
    const left = ply < 2 ? FIRST_MOVE_MS : turn === 'w' ? g.white_ms : g.black_ms;
    const wait = Math.max(0, g.turn_started_at + left - Date.now()) + 50;
    const t = setTimeout(() => checkClock(g.id), Math.min(wait, 2 ** 31 - 1));
    t.unref?.();
    timers.set(g.id, t);
  }

  function checkClock(id) {
    timers.delete(id);
    const g = loadGame(id);
    if (!g || g.status !== 'active' || !g.base_ms) return;
    const now = Date.now();
    const ply = movesOf(g).length;
    const turn = turnOf(g);
    if (ply < 2) {
      if (now - g.turn_started_at >= FIRST_MOVE_MS) {
        const done = finish(g, null, 'no-start', now);
        for (const uid of humanIds(done)) pushIfAway(uid, { title: 'Ván cờ đã bị hủy', body: 'Không ai đi nước đầu tiên trong 1 phút.', tag: `chess-g-${id}`, url: `/#/chess/g/${id}`, gameId: id });
        return;
      }
      arm(g);
      return;
    }
    const left = (turn === 'w' ? g.white_ms : g.black_ms) - (now - g.turn_started_at);
    if (left > 0) {
      arm(g);
      return;
    }
    flag(g, turn, now);
  }

  function flag(g, loser, now) {
    const chess = boardOf(g);
    const winner = other(loser);
    const draw = cannotMate(chess, winner);
    const done = finish(g, draw ? '1/2-1/2' : winner === 'w' ? '1-0' : '0-1', 'timeout', now);
    const loserId = playerId(done, loser);
    const winnerId = playerId(done, winner);
    pushIfAway(loserId, { title: 'Hết giờ!', body: `Bạn đã hết giờ trong ván cờ với ${sideName(done, winner)}.`, tag: `chess-g-${g.id}`, url: `/#/chess/g/${g.id}`, gameId: g.id });
    pushIfAway(winnerId, { title: 'Bạn thắng!', body: `${sideName(done, loser)} đã hết giờ.`, tag: `chess-g-${g.id}`, url: `/#/chess/g/${g.id}`, gameId: g.id });
    return done;
  }

  const sideName = (g, color) => {
    const uid = playerId(g, color);
    if (uid != null) return nameOf(uid);
    return botById.get(g.bot)?.name || 'Máy';
  };

  /* ----- Đi một nước ----- */

  function applyMove(g, uci, color, now = Date.now()) {
    if (g.status !== 'active') throw new ChessError(409, 'Ván cờ đã kết thúc.');
    const chess = boardOf(g);
    if (chess.turn() !== color) throw new ChessError(409, 'Chưa tới lượt bạn.');
    const p = UCI.exec(String(uci || ''));
    if (!p) throw new ChessError(400, 'Nước đi không hợp lệ.');
    const ply = movesOf(g).length;

    let whiteMs = g.white_ms;
    let blackMs = g.black_ms;
    if (g.base_ms) {
      if (ply < 2) {
        if (now - g.turn_started_at >= FIRST_MOVE_MS) {
          finish(g, null, 'no-start', now);
          throw new ChessError(409, 'Quá 1 phút chưa đi nước đầu, ván cờ đã bị hủy.');
        }
      } else {
        const left = (color === 'w' ? whiteMs : blackMs) - (now - g.turn_started_at);
        if (left <= 0) {
          flag(g, color, now);
          throw new ChessError(409, 'Bạn đã hết giờ.');
        }
        if (color === 'w') whiteMs = left + g.inc_ms;
        else blackMs = left + g.inc_ms;
      }
    }

    // Tốt đi tới hàng cuối mà không chọn quân: phong Hậu
    const piece = chess.get(p[1]);
    const lastRank = p[2][1] === '8' || p[2][1] === '1';
    const promotion = p[3] || (piece && piece.type === 'p' && lastRank ? 'q' : undefined);
    let played;
    try {
      played = chess.move({ from: p[1], to: p[2], promotion });
    } catch {
      throw new ChessError(400, 'Nước đi không hợp lệ.');
    }
    const moveText = `${played.from}${played.to}${played.promotion || ''}`;
    const moves = [...movesOf(g), moveText].join(' ');
    const drawOffer = g.draw_offer && g.draw_offer !== color ? null : g.draw_offer; // đi tiếp là từ chối lời mời hòa
    run(
      `UPDATE chess_games SET moves = ?, fen = ?, white_ms = ?, black_ms = ?, turn_started_at = ?, draw_offer = ?, updated_at = ?
       WHERE id = ?`,
      moves, chess.fen(), whiteMs, blackMs, now, drawOffer, now, g.id
    );
    let next = loadGame(g.id);

    let result = null;
    let reason = null;
    if (chess.isCheckmate()) {
      result = color === 'w' ? '1-0' : '0-1';
      reason = 'checkmate';
    } else if (chess.isStalemate()) {
      result = '1/2-1/2';
      reason = 'stalemate';
    } else if (chess.isInsufficientMaterial()) {
      result = '1/2-1/2';
      reason = 'insufficient';
    } else if (chess.isThreefoldRepetition()) {
      result = '1/2-1/2';
      reason = 'repetition';
    } else if (chess.isDrawByFiftyMoves()) {
      result = '1/2-1/2';
      reason = 'fifty';
    }
    if (result) {
      next = finish(next, result, reason, now);
      const oppId = playerId(next, other(color));
      if (reason === 'checkmate') pushIfAway(oppId, { title: 'Chiếu hết!', body: `${sideName(next, color)} đã chiếu hết bạn.`, tag: `chess-g-${g.id}`, url: `/#/chess/g/${g.id}`, gameId: g.id });
      return { game: next, san: played.san };
    }
    arm(next);
    emitGame(next);
    const oppId = playerId(next, other(color));
    if (oppId != null) {
      pushIfAway(oppId, {
        title: `Cờ vua với ${sideName(next, color)}`,
        body: `${sideName(next, color)} vừa đi ${played.san}. Đến lượt bạn.`,
        tag: `chess-g-${g.id}`,
        url: `/#/chess/g/${g.id}`,
        gameId: g.id,
      });
    }
    scheduleBot(next);
    return { game: next, san: played.san };
  }

  /* ----- Máy đi ----- */

  function scheduleBot(g) {
    if (!g || g.status !== 'active' || !g.bot) return;
    const color = turnOf(g);
    if (!isBotSide(g, color)) return;
    if (botTimers.has(g.id)) return;
    const ply = movesOf(g).length;
    const bot = botById.get(g.bot);
    if (!bot) {
      // Máy này đã bị bỏ khỏi danh sách: hủy ván, không ai mất điểm
      try {
        finish(g, null, 'aborted');
      } catch (err) {
        console.warn('[chess] Không hủy được ván của máy cũ:', err.message);
      }
      return;
    }
    const startedAt = Date.now();
    const timer = setTimeout(() => botTurn().catch((err) => {
      botTimers.delete(g.id);
      console.warn('[chess] Lượt của máy lỗi:', err.message);
    }), 50);
    botTimers.set(g.id, timer);

    async function botTurn() {
      let uci = null;
      let movetime = bot.movetime;
      if (g.base_ms && ply >= 2) {
        const left = (color === 'w' ? g.white_ms : g.black_ms) - (Date.now() - g.turn_started_at);
        movetime = Math.max(80, Math.min(bot.movetime, Math.floor(left / 30 + g.inc_ms * 0.7)));
      }
      try {
        uci = await engine.bestMove({
          engine: bot.engine, fen: g.fen, moves: movesOf(g), level: bot.level, randomness: bot.randomness, skill: bot.skill, movetime,
        });
      } catch (err) {
        console.warn('[chess] Máy cờ lỗi, đi nước ngẫu nhiên:', err.message);
      }
      // Đi nhanh quá trông không tự nhiên: chờ ít nhất 0,6 giây
      const wait = 600 - (Date.now() - startedAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      botTimers.delete(g.id);
      const fresh = loadGame(g.id);
      if (!fresh || fresh.status !== 'active' || movesOf(fresh).length !== ply) return;
      try {
        applyMove(fresh, uci || randomMove(fresh), color);
      } catch (err) {
        try {
          const again = loadGame(g.id);
          if (again && again.status === 'active' && movesOf(again).length === ply) applyMove(again, randomMove(again), color);
        } catch (err2) {
          console.warn('[chess] Máy không đi được:', err.message, err2.message);
        }
      }
    }
  }

  function randomMove(g) {
    const list = boardOf(g).moves({ verbose: true });
    const m = list[Math.floor(Math.random() * list.length)];
    return `${m.from}${m.to}${m.promotion || ''}`;
  }

  /* ----- Kiểm tra dữ liệu gửi lên ----- */

  function readTimeControl(body) {
    const base = Number(body?.base);
    const inc = Number(body?.inc ?? 0);
    if (!BASE_MINUTES.includes(base)) throw new ChessError(400, 'Chọn thời gian cho ván cờ.');
    if (!Number.isInteger(inc) || inc < 0 || inc > MAX_INC) throw new ChessError(400, 'Thời gian cộng thêm mỗi nước từ 0 đến 60 giây.');
    return { base_ms: Math.round(base * MINUTE), inc_ms: base ? Math.round(inc * 1000 * SCALE) : 0 };
  }
  const readColor = (v) => (v === 'white' || v === 'black' ? v : 'random');

  function activeCount(uid) {
    return get("SELECT COUNT(*) AS n FROM chess_games WHERE status = 'active' AND (white_id = ? OR black_id = ?)", uid, uid).n;
  }

  function mine(req, id) {
    const g = loadGame(id);
    if (!g || (g.white_id !== req.user.id && g.black_id !== req.user.id && g.challenger_id !== req.user.id && g.opponent_id !== req.user.id)) {
      throw new ChessError(404, 'Không tìm thấy ván cờ.');
    }
    return g;
  }

  const handle = (fn) => (req, res) => {
    try {
      const out = fn(req, res);
      if (out && typeof out.then === 'function') {
        out.catch((err) => sendError(res, err));
      }
    } catch (err) {
      sendError(res, err);
    }
  };
  function sendError(res, err) {
    if (res.headersSent) return;
    if (err instanceof ChessError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.' });
  }

  const auth = [requireAuth, requireReady];

  /* ----- API ----- */

  // Tổng quan: điểm của tôi, lời thách đấu, ván đang chơi, ván gần đây, danh sách máy
  app.get('/api/chess', ...auth, handle((req, res) => {
    const uid = req.user.id;
    const now = Date.now();
    const challenges = all(
      "SELECT * FROM chess_games WHERE status = 'challenge' AND (challenger_id = ? OR opponent_id = ?) ORDER BY created_at DESC",
      uid, uid
    );
    const active = all(
      "SELECT * FROM chess_games WHERE status = 'active' AND (white_id = ? OR black_id = ?) ORDER BY updated_at DESC",
      uid, uid
    );
    const recent = all(
      `SELECT * FROM chess_games WHERE status IN ('finished', 'aborted') AND (white_id = ? OR black_id = ?)
        ORDER BY ended_at DESC LIMIT 30`,
      uid, uid
    );
    res.json({
      rating: ratingPublic(ratingOf(uid)),
      bots: BOTS.map(botPublic),
      baseMinutes: BASE_MINUTES,
      challenges: challenges.map((g) => serialize(g, now)),
      active: active.map((g) => serialize(g, now)),
      recent: recent.map((g) => serialize(g, now)),
    });
  }));

  app.get('/api/chess/leaderboard', ...auth, handle((req, res) => {
    const rows = all(
      `SELECT r.* FROM chess_ratings r JOIN users u ON u.id = r.user_id
        WHERE u.disabled = 0 AND r.games > 0 ORDER BY r.rating DESC, r.games DESC LIMIT 200`
    );
    res.json({ players: rows.map(ratingPublic), me: ratingPublic(ratingOf(req.user.id)) });
  }));

  // Xem một ván: người chơi xem mọi lúc; người khác xem được ván đang chơi / đã xong (ván được chia sẻ)
  function viewable(req, id) {
    const g = loadGame(id);
    if (g && ['active', 'finished', 'aborted'].includes(g.status)) return g;
    return mine(req, id);
  }

  app.get('/api/chess/games/:id', ...auth, handle((req, res) => {
    res.json({ game: serialize(viewable(req, req.params.id)) });
  }));

  // Lịch sử các ván đã xong của tôi, mới nhất trước (?before=<endedAt>&limit=30)
  app.get('/api/chess/history', ...auth, handle((req, res) => {
    const uid = req.user.id;
    const before = Number(req.query.before) > 0 ? Number(req.query.before) : Number.MAX_SAFE_INTEGER;
    // Nhiều ván xong cùng một lúc: dùng thêm id để trang sau không bỏ sót ván nào
    // (không gửi beforeId thì lấy các ván xong trước hẳn mốc thời gian đó, như bản app cũ)
    const beforeId = Number(req.query.beforeId) > 0 ? Number(req.query.beforeId) : 0;
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 30));
    const rows = all(
      `SELECT * FROM chess_games WHERE status IN ('finished', 'aborted') AND (white_id = ? OR black_id = ?)
         AND (ended_at < ? OR (ended_at = ? AND id < ?))
        ORDER BY ended_at DESC, id DESC LIMIT ?`,
      uid, uid, before, before, beforeId, limit + 1
    );
    const now = Date.now();
    res.json({ games: rows.slice(0, limit).map((g) => serialize(g, now)), hasMore: rows.length > limit });
  }));

  // Phân tích ván đã xong bằng Stockfish (src/chess-analysis.js)
  setupAnalysis({ app, auth, handle, mine, viewable, ChessError, emitTo, humanIds, movesOf });

  // Gửi lời thách đấu
  function createChallenge(uid, body) {
    const oppId = Number(body?.opponentId);
    if (!Number.isInteger(oppId) || oppId === uid) throw new ChessError(400, 'Chọn một người để thách đấu.');
    const opp = get('SELECT id, disabled FROM users WHERE id = ?', oppId);
    if (!opp || opp.disabled) throw new ChessError(404, 'Không tìm thấy người này.');
    const tc = readTimeControl(body);
    const pending = get("SELECT COUNT(*) AS n FROM chess_games WHERE status = 'challenge' AND challenger_id = ?", uid).n;
    if (pending >= MAX_PENDING) throw new ChessError(429, 'Bạn đang chờ quá nhiều lời thách đấu. Hủy bớt rồi thử lại.');
    if (activeCount(uid) >= MAX_ACTIVE) throw new ChessError(429, 'Bạn đang chơi quá nhiều ván cùng lúc.');
    const now = Date.now();
    // Thách lại cùng người: bỏ lời thách cũ chưa được trả lời
    const old = all("SELECT * FROM chess_games WHERE status = 'challenge' AND challenger_id = ? AND opponent_id = ?", uid, oppId);
    for (const o of old) run("UPDATE chess_games SET status = 'cancelled', updated_at = ? WHERE id = ?", now, o.id);
    const rated = body?.rated !== false && body?.rated !== 'false';
    const id = Number(
      run(
        `INSERT INTO chess_games (status, challenger_id, opponent_id, color_pref, rated, base_ms, inc_ms, moves, fen, created_at, updated_at)
         VALUES ('challenge', ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
        uid, oppId, readColor(body?.color), rated ? 1 : 0, tc.base_ms, tc.inc_ms, START_FEN, now, now
      ).lastInsertRowid
    );
    const g = loadGame(id);
    for (const o of old) emitTo([uid, oppId], 'chess:challenge', { game: serialize(loadGame(o.id)) });
    emitTo([uid, oppId], 'chess:challenge', { game: serialize(g) });
    pushIfAway(oppId, {
      title: '♟ Thách đấu cờ vua',
      body: `${nameOf(uid)} thách bạn một ván ${tcLabel(g)}${rated ? ', có tính điểm ELO' : ''}.`,
      tag: `chess-ch-${id}`,
      url: '/#/chess',
      gameId: id,
    });
    return g;
  }

  app.post('/api/chess/challenges', ...auth, handle((req, res) => res.json({ game: serialize(createChallenge(req.user.id, req.body)) })));

  function answerChallenge(req, action) {
    const g = mine(req, req.params.id);
    if (g.status !== 'challenge') throw new ChessError(409, 'Lời thách đấu này không còn nữa.');
    const now = Date.now();
    if (now - g.created_at > CHALLENGE_TTL) {
      run("UPDATE chess_games SET status = 'expired', updated_at = ? WHERE id = ?", now, g.id);
      emitTo([g.challenger_id, g.opponent_id], 'chess:challenge', { game: serialize(loadGame(g.id)) });
      throw new ChessError(409, 'Lời thách đấu đã hết hạn.');
    }
    if (action === 'cancel') {
      if (g.challenger_id !== req.user.id) throw new ChessError(403, 'Chỉ người gửi mới hủy được.');
      run("UPDATE chess_games SET status = 'cancelled', updated_at = ? WHERE id = ?", now, g.id);
    } else if (action === 'decline') {
      if (g.opponent_id !== req.user.id) throw new ChessError(403, 'Lời thách đấu này không phải gửi cho bạn.');
      run("UPDATE chess_games SET status = 'declined', updated_at = ? WHERE id = ?", now, g.id);
      pushIfAway(g.challenger_id, { title: 'Cờ vua', body: `${nameOf(req.user.id)} đã từ chối lời thách đấu.`, tag: `chess-ch-${g.id}`, url: '/#/chess', gameId: g.id });
    } else {
      if (g.opponent_id !== req.user.id) throw new ChessError(403, 'Lời thách đấu này không phải gửi cho bạn.');
      if (activeCount(req.user.id) >= MAX_ACTIVE) throw new ChessError(429, 'Bạn đang chơi quá nhiều ván cùng lúc.');
      const challengerOk = get('SELECT disabled FROM users WHERE id = ?', g.challenger_id);
      if (!challengerOk || challengerOk.disabled) throw new ChessError(409, 'Người thách đấu không còn dùng Think nữa.');
      const challengerWhite = g.color_pref === 'white' ? true : g.color_pref === 'black' ? false : Math.random() < 0.5;
      run(
        `UPDATE chess_games SET status = 'active', white_id = ?, black_id = ?, white_ms = ?, black_ms = ?,
           started_at = ?, turn_started_at = ?, updated_at = ? WHERE id = ?`,
        challengerWhite ? g.challenger_id : g.opponent_id,
        challengerWhite ? g.opponent_id : g.challenger_id,
        g.base_ms || null, g.base_ms || null, now, now, now, g.id
      );
      const started = loadGame(g.id);
      arm(started);
      emitGame(started);
      pushIfAway(g.challenger_id, {
        title: '♟ Vào chơi thôi!',
        body: `${nameOf(req.user.id)} đã nhận lời thách đấu (${tcLabel(started)}).`,
        tag: `chess-g-${g.id}`,
        url: `/#/chess/g/${g.id}`,
        gameId: g.id,
      });
      return started;
    }
    const updated = loadGame(g.id);
    emitTo([g.challenger_id, g.opponent_id], 'chess:challenge', { game: serialize(updated) });
    return updated;
  }

  app.post('/api/chess/challenges/:id/accept', ...auth, handle((req, res) => res.json({ game: serialize(answerChallenge(req, 'accept')) })));
  app.post('/api/chess/challenges/:id/decline', ...auth, handle((req, res) => res.json({ game: serialize(answerChallenge(req, 'decline')) })));
  app.post('/api/chess/challenges/:id/cancel', ...auth, handle((req, res) => res.json({ game: serialize(answerChallenge(req, 'cancel')) })));

  // Chơi với máy (không tính điểm ELO)
  function createBotGame(uid, body) {
    const bot = botById.get(String(body?.bot || ''));
    if (!bot) throw new ChessError(400, 'Chọn một máy để chơi.');
    const tc = readTimeControl(body);
    if (activeCount(uid) >= MAX_ACTIVE) throw new ChessError(429, 'Bạn đang chơi quá nhiều ván cùng lúc.');
    const pref = readColor(body?.color);
    const white = pref === 'white' ? true : pref === 'black' ? false : Math.random() < 0.5;
    const now = Date.now();
    const id = Number(
      run(
        `INSERT INTO chess_games (status, white_id, black_id, bot, challenger_id, color_pref, rated, base_ms, inc_ms, moves, fen,
           white_ms, black_ms, created_at, started_at, turn_started_at, updated_at)
         VALUES ('active', ?, ?, ?, ?, ?, 0, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
        white ? uid : null, white ? null : uid, bot.id, uid, pref, tc.base_ms, tc.inc_ms, START_FEN,
        tc.base_ms || null, tc.base_ms || null, now, now, now, now
      ).lastInsertRowid
    );
    const g = loadGame(id);
    arm(g);
    emitGame(g);
    scheduleBot(g);
    return g;
  }

  app.post('/api/chess/bot', ...auth, handle((req, res) => res.json({ game: serialize(createBotGame(req.user.id, req.body)) })));

  app.post('/api/chess/games/:id/move', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    const color = colorOf(g, req.user.id);
    if (!color) throw new ChessError(403, 'Bạn không chơi ván này.');
    const ply = Number(req.body?.ply);
    if (Number.isInteger(ply) && ply !== movesOf(g).length) {
      return res.status(409).json({ error: 'Bàn cờ vừa thay đổi, đã cập nhật lại.', game: serialize(g) });
    }
    try {
      const out = applyMove(g, req.body?.move, color);
      streaks.record(req.user.id, 'chess'); // chuỗi hằng ngày (src/streaks.js)
      res.json({ game: serialize(out.game), san: out.san });
    } catch (err) {
      if (err instanceof ChessError) {
        const fresh = loadGame(g.id);
        return res.status(err.status).json({ error: err.message, game: fresh ? serialize(fresh) : undefined });
      }
      throw err;
    }
  }));

  app.post('/api/chess/games/:id/resign', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    const color = colorOf(g, req.user.id);
    if (!color || g.status !== 'active') throw new ChessError(409, 'Ván cờ đã kết thúc.');
    if (movesOf(g).length < 2) {
      // Chưa ai đi: coi như hủy ván, không ai mất điểm
      return res.json({ game: serialize(finish(g, null, 'aborted')) });
    }
    const done = finish(g, color === 'w' ? '0-1' : '1-0', 'resign');
    pushIfAway(playerId(done, other(color)), { title: 'Bạn thắng!', body: `${nameOf(req.user.id)} đã đầu hàng.`, tag: `chess-g-${g.id}`, url: `/#/chess/g/${g.id}`, gameId: g.id });
    res.json({ game: serialize(done) });
  }));

  app.post('/api/chess/games/:id/abort', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    if (!colorOf(g, req.user.id) || g.status !== 'active') throw new ChessError(409, 'Ván cờ đã kết thúc.');
    if (movesOf(g).length >= 2) throw new ChessError(409, 'Hai bên đã đi rồi, không hủy được nữa. Bạn có thể đầu hàng hoặc mời hòa.');
    res.json({ game: serialize(finish(g, null, 'aborted')) });
  }));

  app.post('/api/chess/games/:id/draw', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    const color = colorOf(g, req.user.id);
    if (!color || g.status !== 'active') throw new ChessError(409, 'Ván cờ đã kết thúc.');
    const action = String(req.body?.action || 'offer');
    const now = Date.now();
    if (g.bot) {
      if (action === 'offer') throw new ChessError(409, `${botById.get(g.bot)?.name || 'Máy'} không nhận hòa. Đánh tiếp nào!`);
      throw new ChessError(400, 'Không có lời mời hòa nào.');
    }
    if (action === 'accept' || (action === 'offer' && g.draw_offer === other(color))) {
      if (g.draw_offer !== other(color)) throw new ChessError(409, 'Đối thủ chưa mời hòa.');
      return res.json({ game: serialize(finish(g, '1/2-1/2', 'agreement', now)) });
    }
    if (action === 'decline') {
      if (g.draw_offer !== other(color)) throw new ChessError(409, 'Không có lời mời hòa nào.');
      run('UPDATE chess_games SET draw_offer = NULL, updated_at = ? WHERE id = ?', now, g.id);
    } else if (action === 'offer') {
      if (movesOf(g).length < 2) throw new ChessError(409, 'Đi vài nước rồi hẵng mời hòa nhé.');
      if (g.draw_offer === color) return res.json({ game: serialize(g) }); // đã mời rồi, không báo lại
      run('UPDATE chess_games SET draw_offer = ?, updated_at = ? WHERE id = ?', color, now, g.id);
      pushIfAway(playerId(g, other(color)), { title: 'Mời hòa', body: `${nameOf(req.user.id)} mời bạn hòa ván cờ.`, tag: `chess-g-${g.id}`, url: `/#/chess/g/${g.id}`, gameId: g.id });
    } else {
      throw new ChessError(400, 'Yêu cầu không hợp lệ.');
    }
    const next = loadGame(g.id);
    emitGame(next);
    res.json({ game: serialize(next) });
  }));

  // Đấu lại: đổi màu quân, cùng thời gian
  app.post('/api/chess/games/:id/rematch', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    const color = colorOf(g, req.user.id);
    if (!color || (g.status !== 'finished' && g.status !== 'aborted')) throw new ChessError(409, 'Ván cờ chưa kết thúc.');
    const body = {
      base: Math.round(g.base_ms / MINUTE),
      inc: Math.round(g.inc_ms / 1000 / SCALE),
      color: color === 'w' ? 'black' : 'white',
      rated: Boolean(g.rated),
      bot: g.bot,
      opponentId: playerId(g, other(color)),
    };
    const next = g.bot ? createBotGame(req.user.id, body) : createChallenge(req.user.id, body);
    res.json({ game: serialize(next) });
  }));

  /* ----- Dọn lời thách đấu hết hạn, khởi động lại đồng hồ ----- */

  function expireChallenges() {
    const now = Date.now();
    const rows = all("SELECT * FROM chess_games WHERE status = 'challenge' AND created_at < ?", now - CHALLENGE_TTL);
    for (const g of rows) {
      run("UPDATE chess_games SET status = 'expired', updated_at = ? WHERE id = ?", now, g.id);
      emitTo([g.challenger_id, g.opponent_id], 'chess:challenge', { game: serialize(loadGame(g.id)) });
    }
  }
  const sweep = setInterval(expireChallenges, Math.min(60 * 1000, CHALLENGE_TTL / 4));
  sweep.unref?.();

  // Máy chủ vừa khởi động lại: chạy tiếp đồng hồ và lượt của máy trong các ván đang dở
  for (const g of all("SELECT * FROM chess_games WHERE status = 'active'")) {
    arm(g);
    scheduleBot(g);
  }

  // Ván cờ gọn để hiện trong bài đăng / tin nhắn chia sẻ
  function gameForShare(id) {
    const g = loadGame(id);
    return g ? serialize(g) : null;
  }

  return { serialize, BOTS, gameForShare };
}

module.exports = { setupChess, eloDeltas, cannotMate, BOTS, BASE_MINUTES, START_FEN };
