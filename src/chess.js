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
const DAY = 24 * 60 * MINUTE;
const DAILY_DAYS = [1, 2, 3, 7]; // cờ theo ngày: số ngày mỗi nước
const DAILY_CHALLENGE_TTL = 2 * DAY; // lời thách đấu cờ theo ngày chờ được 2 ngày
const DAILY_REMIND_MS = 2 * 60 * MINUTE; // cờ theo ngày: còn 2 giờ thì nhắc
const FIRST_MOVE_MS = MINUTE; // ván có giờ: mỗi bên phải đi nước đầu trong 1 phút, không thì hủy ván
const DEFAULT_RATING = 1200;
const MAX_ACTIVE = 20;
const MAX_PENDING = 6;

/* ---------------- Máy cờ (AI) ---------------- */

// Danh sách máy, gu chơi, câu nói: src/chess-bots.js
const bots = require('./chess-bots');
const { BOTS, botPublic } = bots;
const botById = { get: (id) => bots.botById(id) };
const openings = require('./chess-openings');
const { setupChessExtra, PHRASES } = require('./chess-extra');
const { setupTournaments } = require('./chess-tournaments');

/* ---------------- Tiện ích ---------------- */

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const movesOf = (g) => (g.moves ? g.moves.split(' ') : []);
const turnOf = (g) => (movesOf(g).length % 2 === 0 ? 'w' : 'b');
const other = (c) => (c === 'w' ? 'b' : 'w');
const colorOf = (g, uid) => (g.white_id === uid ? 'w' : g.black_id === uid ? 'b' : null);
const playerId = (g, color) => (color === 'w' ? g.white_id : g.black_id);
const isBotSide = (g, color) => Boolean(g.bot) && playerId(g, color) == null;
const humanIds = (g) => [g.white_id, g.black_id, g.challenger_id, g.opponent_id].filter((x, i, a) => x != null && a.indexOf(x) === i);

const ttlOf = (g) => (g.daily_ms ? DAILY_CHALLENGE_TTL : CHALLENGE_TTL);

function tcLabel(g) {
  if (g.daily_ms) return `${Math.round(g.daily_ms / DAY)} ngày mỗi nước`;
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
  if (g.daily_ms) {
    // Cờ theo ngày: mỗi nước có daily_ms, bên đang đi đếm lùi từ lúc tới lượt
    const clocks = { w: g.daily_ms, b: g.daily_ms };
    if (g.status === 'active') {
      const t = turnOf(g);
      clocks[t] = Math.max(0, g.daily_ms - (now - g.turn_started_at));
    } else if (g.white_ms != null && g.black_ms != null) {
      return { w: g.white_ms, b: g.black_ms };
    }
    return clocks;
  }
  if (!g.base_ms) return null;
  const clocks = { w: g.white_ms, b: g.black_ms };
  if (g.status === 'active' && movesOf(g).length >= 2) {
    const t = turnOf(g);
    clocks[t] = Math.max(0, clocks[t] - (now - g.turn_started_at));
  }
  return clocks;
}

// Tên khai cuộc của ván (sách khai cuộc lichess, src/chess-openings.js): thế cờ có tên gần nhất trong 30 nước đầu
const OPENING_PLIES = 30;
const openingCache = new Map();
function openingOf(moves) {
  if (!moves.length) return null;
  const key = moves.slice(0, OPENING_PLIES).join(' ');
  if (openingCache.has(key)) return openingCache.get(key);
  let found = null;
  try {
    const book = openings.load();
    const board = new openings.Board();
    for (const m of moves.slice(0, OPENING_PLIES)) {
      board.move(m);
      const fen = board.key();
      if (!book.has(fen)) break; // ra khỏi sách: giữ tên gần nhất
      const n = book.name(fen);
      if (n) found = { eco: n.eco, name: n.name };
    }
  } catch {
    found = null;
  }
  if (openingCache.size > 2000) openingCache.delete(openingCache.keys().next().value);
  openingCache.set(key, found);
  return found;
}

function readSay(text) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v.text === 'string' ? { ply: Number(v.ply) || 0, text: v.text, event: v.event || null } : null;
  } catch {
    return null;
  }
}

// Tên giải đấu (đọc lại khi cần, giữ sẵn vì gửi ván rất thường xuyên)
const tNames = new Map();
function tournamentName(id) {
  if (!tNames.has(id)) {
    const row = get('SELECT name FROM chess_tournaments WHERE id = ?', id);
    if (tNames.size > 500) tNames.clear();
    tNames.set(id, row ? row.name : 'Giải đấu');
  }
  return tNames.get(id);
}

function readChat(text) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && (v.color === 'w' || v.color === 'b') && typeof v.text === 'string' ? { color: v.color, text: v.text, ply: Number(v.ply) || 0, at: Number(v.at) || 0 } : null;
  } catch {
    return null;
  }
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
    // Cờ theo ngày: thời gian mỗi nước (ms), 0 = ván thường
    daily: g.daily_ms || 0,
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
    expiresAt: g.status === 'challenge' ? g.created_at + ttlOf(g) : null,
    opening: openingOf(moves),
    // Ván với máy: câu máy vừa nói, số lần dùng gợi ý / đi lại
    botSay: bot ? readSay(g.bot_say) : null,
    // Ván người với người: câu nói nhanh gần nhất ({ color, text, ply, at })
    chat: !bot ? readChat(g.chat) : null,
    // Bên đang xin đi lại (ván giao hữu với bạn)
    takebackOffer: g.takeback_offer || null,
    // Ván thuộc giải đấu nào
    tournament: g.tournament_id ? { id: g.tournament_id, name: tournamentName(g.tournament_id) } : null,
    hints: g.hints || 0,
    takebacks: g.takebacks || 0,
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
  let tournaments = null; // src/chess-tournaments.js (gắn ở cuối hàm)

  const emitTo = (ids, event, payload) => {
    for (const uid of new Set(ids)) if (uid != null) io.to(`user:${uid}`).emit(event, payload);
  };
  const emitGame = (g) => emitTo(humanIds(g), 'chess:game', { game: serialize(g) });
  const pushIfAway = (uid, payload) => {
    if (uid == null || isActive(uid)) return;
    notify(uid, { type: 'chess', ...payload }).catch((err) => console.warn('[push]', err.message));
  };

  /* ----- Máy nói ----- */

  // Điều máy nhớ trong ván đang chơi: điểm thế cờ lần trước (để biết bạn vừa đi hớ), đã than "khó quá" chưa
  const botMemory = new Map();
  function sayJson(g, event, ply) {
    const bot = g.bot ? botById.get(g.bot) : null;
    const text = bot ? bots.lineFor(bot, event) : null;
    return text ? JSON.stringify({ ply, text, event }) : null;
  }
  function botSay(g, event, ply) {
    const json = sayJson(g, event, ply);
    if (json) run('UPDATE chess_games SET bot_say = ? WHERE id = ?', json, g.id);
    return Boolean(json);
  }

  /** Sau nước của máy: chọn câu để nói (nếu có). cp: điểm thế cờ theo máy trước khi đi (máy có tính cách mới có) */
  function botReact(g, played, cp, ply) {
    const mem = botMemory.get(g.id) || { cp: null, sadSaid: false };
    let event = null;
    if (cp != null && mem.cp != null && cp - mem.cp >= 250 && cp >= 150) event = 'blunder';
    else if (cp != null && cp <= -350 && !mem.sadSaid) {
      event = 'losing';
      mem.sadSaid = true;
    } else if (played.promotion) event = 'promote';
    else if (played.san.includes('+') && Math.random() < 0.6) event = 'check';
    else if (played.captured && played.captured !== 'p' && Math.random() < 0.6) event = 'capture';
    if (cp != null) mem.cp = cp;
    botMemory.set(g.id, mem);
    if (event && botSay(g, event, ply)) return true;
    return false;
  }

  /* ----- Kết thúc ván, cập nhật ELO ----- */

  function finish(g, result, reason, now = Date.now()) {
    clearTimer(g.id);
    boards.delete(g.id);
    botMemory.delete(g.id);
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
      // Máy nói câu cuối ván (thắng / thua / hòa)
      let say = null;
      if (g.bot && !aborted) {
        const botWhite = g.white_id == null;
        const ev = result === '1/2-1/2' ? 'draw' : (result === '1-0') === botWhite ? 'win' : 'lose';
        say = sayJson(g, ev, movesOf(g).length);
      }
      run(
        `UPDATE chess_games SET status = ?, result = ?, reason = ?, ended_at = ?, updated_at = ?, draw_offer = NULL,
           white_ms = ?, black_ms = ?, white_rating = ?, black_rating = ?, white_delta = ?, black_delta = ?,
           bot_say = COALESCE(?, bot_say)
         WHERE id = ?`,
        aborted ? 'aborted' : 'finished', result, reason, now, now,
        clocks ? clocks.w : g.white_ms, clocks ? clocks.b : g.black_ms, wr, br, dw, db, say, g.id
      );
    });
    const done = loadGame(g.id);
    emitGame(done);
    if (done.tournament_id && tournaments) {
      try {
        tournaments.onGameFinished(done.tournament_id);
      } catch (err) {
        console.warn('[chess] Cập nhật giải đấu lỗi:', err.message);
      }
    }
    return done;
  }

  /* ----- Đồng hồ ----- */

  function clearTimer(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    clearTimeout(reminders.get(id));
    reminders.delete(id);
  }

  function arm(g) {
    clearTimer(g.id);
    if (g.status === 'active' && g.daily_ms) {
      armDaily(g);
      return;
    }
    if (g.status !== 'active' || !g.base_ms) return;
    const ply = movesOf(g).length;
    const turn = turnOf(g);
    const left = ply < 2 ? FIRST_MOVE_MS : turn === 'w' ? g.white_ms : g.black_ms;
    const wait = Math.max(0, g.turn_started_at + left - Date.now()) + 50;
    const t = setTimeout(() => checkClock(g.id), Math.min(wait, 2 ** 31 - 1));
    t.unref?.();
    timers.set(g.id, t);
  }

  /* Cờ theo ngày: hẹn giờ hết hạn nước đi (và nhắc khi còn 2 giờ) */
  const reminders = new Map();
  function armDaily(g) {
    clearTimeout(reminders.get(g.id));
    reminders.delete(g.id);
    const deadline = g.turn_started_at + g.daily_ms;
    const wait = Math.max(0, deadline - Date.now()) + 50;
    const t = setTimeout(() => checkClock(g.id), Math.min(wait, 2 ** 31 - 1));
    t.unref?.();
    timers.set(g.id, t);
    const remindAt = deadline - DAILY_REMIND_MS;
    if (g.daily_ms > DAILY_REMIND_MS * 2 && remindAt > Date.now()) {
      const r = setTimeout(() => {
        reminders.delete(g.id);
        const cur = loadGame(g.id);
        if (!cur || cur.status !== 'active' || cur.moves !== g.moves) return;
        const color = turnOf(cur);
        const uid = playerId(cur, color);
        if (uid == null) return;
        notify(uid, {
          type: 'chess',
          title: '⏰ Sắp hết giờ đi nước',
          body: `Còn khoảng 2 giờ để đi nước trong ván cờ với ${sideName(cur, other(color))}.`,
          tag: `chess-g-${cur.id}`,
          url: `/#/chess/g/${cur.id}`,
          gameId: cur.id,
        }).catch((err) => console.warn('[push]', err.message));
      }, Math.min(remindAt - Date.now(), 2 ** 31 - 1));
      r.unref?.();
      reminders.set(g.id, r);
    }
  }

  function checkClock(id) {
    timers.delete(id);
    const g = loadGame(id);
    if (!g || g.status !== 'active') return;
    if (g.daily_ms) {
      const now = Date.now();
      if (now - g.turn_started_at < g.daily_ms) {
        arm(g);
        return;
      }
      if (movesOf(g).length < 2 && !g.tournament_id) {
        // Chưa ai đi đủ nước đầu: hủy ván, không ai mất điểm (ván trong giải thì bên tới lượt thua)
        const done = finish(g, null, 'no-start', now);
        for (const uid of humanIds(done)) pushIfAway(uid, { title: 'Ván cờ đã bị hủy', body: 'Hết hạn đi nước đầu tiên.', tag: `chess-g-${id}`, url: `/#/chess/g/${id}`, gameId: id });
        return;
      }
      flag(g, turnOf(g), now);
      return;
    }
    if (!g.base_ms) return;
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

  /** Ván dạng PGN: tiêu đề (tên hai bên, ngày, kết quả, thời gian) + các nước */
  function pgnOf(g) {
    const chess = new Chess();
    for (const m of movesOf(g)) {
      const p = UCI.exec(m);
      chess.move({ from: p[1], to: p[2], promotion: p[3] });
    }
    const d = new Date((g.started_at || g.created_at) + 7 * 3600000); // giờ Việt Nam
    const date = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
    const result = g.status === 'active' ? '*' : g.result || '*';
    chess.setHeader('Event', g.tournament_id ? tournamentName(g.tournament_id) : g.bot ? 'Chơi với máy' : g.rated ? 'Ván tính điểm' : 'Ván giao hữu');
    chess.setHeader('Site', 'Think');
    chess.setHeader('Date', date);
    chess.setHeader('White', sideName(g, 'w'));
    chess.setHeader('Black', sideName(g, 'b'));
    chess.setHeader('Result', result);
    if (g.daily_ms) chess.setHeader('TimeControl', `1/${Math.round(g.daily_ms / 1000)}`);
    else if (g.base_ms) chess.setHeader('TimeControl', `${Math.round(g.base_ms / 1000)}+${Math.round(g.inc_ms / 1000)}`);
    if (g.reason) chess.setHeader('Termination', reasonEn(g.reason));
    const body = chess.pgn();
    // chess.js chỉ ghi kết quả khi ván kết thúc trên bàn cờ; đầu hàng / hết giờ cũng phải có ở cuối
    return /(1-0|0-1|1\/2-1\/2|\*)\s*$/.test(body) ? body : `${body} ${result}`;
  }
  const reasonEn = (r) => ({ checkmate: 'Normal', resign: 'Normal', timeout: 'Time forfeit', agreement: 'Normal', stalemate: 'Normal' }[r] || 'Normal');
  /** Người chơi xem mọi lúc; người khác xem được ván đang chơi / đã xong */
  function viewableGame(req, id) {
    const g = loadGame(id);
    if (g && ['active', 'finished', 'aborted'].includes(g.status)) return g;
    return mine(req, id);
  }

  const sideName = (g, color) => {
    const uid = playerId(g, color);
    if (uid != null) return nameOf(uid);
    return botById.get(g.bot)?.name || 'Máy';
  };

  /* ----- Đi một nước ----- */

  /** onPlayed(played, ply): gọi ngay sau khi ghi nước đi, trước khi báo cho hai bên (máy chọn câu nói ở đây) */
  function applyMove(g, uci, color, now = Date.now(), onPlayed = null) {
    if (g.status !== 'active') throw new ChessError(409, 'Ván cờ đã kết thúc.');
    const chess = boardOf(g);
    if (chess.turn() !== color) throw new ChessError(409, 'Chưa tới lượt bạn.');
    const p = UCI.exec(String(uci || ''));
    if (!p) throw new ChessError(400, 'Nước đi không hợp lệ.');
    const ply = movesOf(g).length;

    let whiteMs = g.white_ms;
    let blackMs = g.black_ms;
    if (g.daily_ms && now - g.turn_started_at >= g.daily_ms) {
      checkClock(g.id);
      throw new ChessError(409, 'Đã hết hạn đi nước này.');
    }
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
      `UPDATE chess_games SET moves = ?, fen = ?, white_ms = ?, black_ms = ?, turn_started_at = ?, draw_offer = ?, updated_at = ?,
         takeback_offer = NULL, takeback_ply = NULL
       WHERE id = ?`,
      moves, chess.fen(), whiteMs, blackMs, now, drawOffer, now, g.id
    );
    if (onPlayed) {
      try {
        onPlayed(played, ply + 1);
      } catch (err) {
        console.warn('[chess] Lỗi sau nước đi:', err.message);
      }
    }
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
      return { game: next, san: played.san, played };
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
    return { game: next, san: played.san, played };
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
      let cp = null;
      let movetime = bot.movetime;
      if (g.base_ms && ply >= 2) {
        const left = (color === 'w' ? g.white_ms : g.black_ms) - (Date.now() - g.turn_started_at);
        movetime = Math.max(80, Math.min(bot.movetime, Math.floor(left / 30 + g.inc_ms * 0.7)));
      }
      try {
        const r = await engine.bestMove({ ...bots.jobFor(bot), fen: g.fen, moves: movesOf(g), movetime });
        if (r && typeof r === 'object') {
          uci = r.move;
          cp = Number.isFinite(r.cp) ? r.cp : null;
        } else uci = r;
      } catch (err) {
        console.warn('[chess] Máy cờ lỗi, đi nước ngẫu nhiên:', err.message);
      }
      // Đi nhanh quá trông không tự nhiên: chờ ít nhất 0,6 giây
      const wait = 600 - (Date.now() - startedAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      botTimers.delete(g.id);
      const fresh = loadGame(g.id);
      if (!fresh || fresh.status !== 'active') return;
      if (fresh.moves !== g.moves) {
        // Ván đã đổi trong lúc máy nghĩ (người chơi đi lại nước rồi đi nước khác): xem lại có tới lượt máy không
        scheduleBot(fresh);
        return;
      }
      const react = (played, n) => botReact(fresh, played, cp, n);
      try {
        applyMove(fresh, uci || randomMove(fresh), color, Date.now(), react);
      } catch (err) {
        try {
          const again = loadGame(g.id);
          if (again && again.status === 'active' && again.moves === g.moves) applyMove(again, randomMove(again), color, Date.now(), react);
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

  function readTimeControl(body, { daily = false } = {}) {
    if (daily && body?.days != null) {
      const days = Number(body.days);
      if (!DAILY_DAYS.includes(days)) throw new ChessError(400, 'Cờ theo ngày: chọn 1, 2, 3 hoặc 7 ngày mỗi nước.');
      return { base_ms: 0, inc_ms: 0, daily_ms: Math.round(days * DAY) };
    }
    const base = Number(body?.base);
    const inc = Number(body?.inc ?? 0);
    if (!BASE_MINUTES.includes(base)) throw new ChessError(400, 'Chọn thời gian cho ván cờ.');
    if (!Number.isInteger(inc) || inc < 0 || inc > MAX_INC) throw new ChessError(400, 'Thời gian cộng thêm mỗi nước từ 0 đến 60 giây.');
    return { base_ms: Math.round(base * MINUTE), inc_ms: base ? Math.round(inc * 1000 * SCALE) : 0, daily_ms: 0 };
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
      botTiers: bots.TIERS.map((t) => ({ id: t.id, name: t.name })),
      customElo: { min: bots.CUSTOM_MIN, max: bots.CUSTOM_MAX, step: 50 },
      beaten: beatenBots(uid),
      baseMinutes: BASE_MINUTES,
      dailyDays: DAILY_DAYS,
      phrases: PHRASES,
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
    const tc = readTimeControl(body, { daily: true });
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
        `INSERT INTO chess_games (status, challenger_id, opponent_id, color_pref, rated, base_ms, inc_ms, daily_ms, moves, fen, created_at, updated_at)
         VALUES ('challenge', ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
        uid, oppId, readColor(body?.color), rated ? 1 : 0, tc.base_ms, tc.inc_ms, tc.daily_ms, START_FEN, now, now
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
    if (now - g.created_at > ttlOf(g)) {
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
    botSay({ id, bot: bot.id }, 'hello', 0);
    const g = loadGame(id);
    arm(g);
    emitGame(g);
    scheduleBot(g);
    return g;
  }

  /** Các máy người này đã thắng mà không dùng gợi ý / đi lại (vương miện trong danh sách máy) */
  function beatenBots(uid) {
    return all(
      `SELECT DISTINCT bot FROM chess_games WHERE bot IS NOT NULL AND status = 'finished' AND hints = 0 AND takebacks = 0
         AND ((white_id = ? AND result = '1-0') OR (black_id = ? AND result = '0-1'))`,
      uid, uid
    ).map((r) => r.bot).filter((id) => !id.startsWith('custom-'));
  }

  /** Ván với máy của người này, đang tới lượt họ (gợi ý / đi lại) */
  function myBotGame(req) {
    const g = mine(req, req.params.id);
    const color = colorOf(g, req.user.id);
    if (!color || g.status !== 'active') throw new ChessError(409, 'Ván cờ đã kết thúc.');
    if (!g.bot) throw new ChessError(403, 'Chỉ dùng được khi chơi với máy.');
    return { g, color };
  }

  // Gợi ý nước đi (Stockfish mạnh nhất nghĩ nhanh). Ván dùng gợi ý không được tính vương miện thắng máy.
  app.post('/api/chess/games/:id/hint', ...auth, handle(async (req, res) => {
    const { g, color } = myBotGame(req);
    if (turnOf(g) !== color) throw new ChessError(409, 'Chờ máy đi xong đã nhé.');
    const moves = movesOf(g);
    let move = null;
    try {
      const r = await engine.evaluate({ fen: g.fen, moves, movetime: 700 });
      move = r && r.move;
    } catch (err) {
      console.warn('[chess] Gợi ý lỗi:', err.message);
    }
    if (!move || !UCI.test(move)) throw new ChessError(503, 'Máy gợi ý đang bận. Thử lại sau giây lát.');
    const fresh = loadGame(g.id);
    if (!fresh || fresh.moves !== g.moves || fresh.status !== 'active') throw new ChessError(409, 'Bàn cờ vừa thay đổi.');
    run('UPDATE chess_games SET hints = hints + 1, updated_at = ? WHERE id = ?', Date.now(), g.id);
    const next = loadGame(g.id);
    emitGame(next);
    res.json({ move, game: serialize(next) });
  }));

  // Đi lại: bỏ nước vừa đi của mình (và nước máy đáp lại nếu có) để đi lại nước khác
  /** Bỏ `drop` nước cuối của ván (đi lại), ghi lại thế cờ, báo hai bên */
  function rollBack(g, drop, now = Date.now()) {
    const keep = movesOf(g).slice(0, movesOf(g).length - drop);
    const chess = new Chess();
    for (const m of keep) {
      const p = UCI.exec(m);
      chess.move({ from: p[1], to: p[2], promotion: p[3] });
    }
    boards.delete(g.id);
    botMemory.delete(g.id);
    run(
      `UPDATE chess_games SET moves = ?, fen = ?, turn_started_at = ?, draw_offer = NULL, bot_say = NULL,
         takeback_offer = NULL, takeback_ply = NULL, takebacks = takebacks + 1, updated_at = ? WHERE id = ?`,
      keep.join(' '), chess.fen(), now, now, g.id
    );
    const next = loadGame(g.id);
    arm(next);
    emitGame(next);
    scheduleBot(next);
    return next;
  }

  // Đi lại. Ván với máy: bỏ nước vừa đi của mình (và nước máy đáp) ngay.
  // Ván giao hữu với bạn: { action: 'offer' } xin đi lại, bạn { action: 'accept' | 'decline' }. Đi tiếp là bỏ lời xin.
  app.post('/api/chess/games/:id/takeback', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    const color = colorOf(g, req.user.id);
    if (!color || g.status !== 'active') throw new ChessError(409, 'Ván cờ đã kết thúc.');
    const moves = movesOf(g);
    const now = Date.now();
    if (g.bot) {
      // Tới lượt mình: bỏ 2 nước (máy + mình). Máy đang nghĩ: bỏ 1 nước (của mình)
      const drop = turnOf(g) === color ? 2 : 1;
      if (moves.length < drop || (moves.length - drop) % 2 !== (color === 'w' ? 0 : 1)) {
        throw new ChessError(409, 'Chưa có nước nào của bạn để đi lại.');
      }
      return res.json({ game: serialize(rollBack(g, drop, now)) });
    }
    if (g.rated || g.tournament_id) throw new ChessError(409, 'Ván tính điểm hoặc trong giải đấu không xin đi lại được.');
    const action = String(req.body?.action || 'offer');
    if (action === 'offer') {
      // Phải có nước của mình để đi lại
      const mineMoves = moves.filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === color).length;
      if (!mineMoves) throw new ChessError(409, 'Chưa có nước nào của bạn để đi lại.');
      if (g.takeback_offer === color) return res.json({ game: serialize(g) });
      run('UPDATE chess_games SET takeback_offer = ?, takeback_ply = ?, updated_at = ? WHERE id = ?', color, moves.length, now, g.id);
      const next = loadGame(g.id);
      emitGame(next);
      pushIfAway(playerId(g, other(color)), { title: 'Xin đi lại', body: `${nameOf(req.user.id)} xin đi lại nước vừa rồi.`, tag: `chess-g-${g.id}`, url: `/#/chess/g/${g.id}`, gameId: g.id });
      return res.json({ game: serialize(next) });
    }
    if (g.takeback_offer !== other(color)) throw new ChessError(409, 'Không có lời xin đi lại nào.');
    if (action === 'decline') {
      run('UPDATE chess_games SET takeback_offer = NULL, takeback_ply = NULL, updated_at = ? WHERE id = ?', now, g.id);
      const next = loadGame(g.id);
      emitGame(next);
      return res.json({ game: serialize(next) });
    }
    if (action !== 'accept') throw new ChessError(400, 'Yêu cầu không hợp lệ.');
    if (g.takeback_ply !== moves.length) throw new ChessError(409, 'Bàn cờ đã đổi, lời xin đi lại không còn nữa.');
    // Bỏ tới khi lại tới lượt người xin: họ vừa đi (1 nước) hoặc mình đã đáp lại (2 nước)
    const asker = g.takeback_offer;
    const drop = turnOf(g) === asker ? 2 : 1;
    if (moves.length < drop) throw new ChessError(409, 'Không còn nước để đi lại.');
    const next = rollBack(g, drop, now);
    pushIfAway(playerId(g, asker), { title: 'Đã đồng ý đi lại', body: `${nameOf(req.user.id)} cho bạn đi lại.`, tag: `chess-g-${g.id}`, url: `/#/chess/g/${g.id}`, gameId: g.id });
    res.json({ game: serialize(next) });
  }));

  // Ván bạn bè đang đánh (người với người, không có mình) để vào xem
  app.get('/api/chess/live', ...auth, handle((req, res) => {
    const uid = req.user.id;
    const rows = all(
      `SELECT * FROM chess_games WHERE status = 'active' AND bot IS NULL AND white_id != ? AND black_id != ?
        ORDER BY updated_at DESC LIMIT 20`,
      uid, uid
    );
    const now = Date.now();
    res.json({ games: rows.map((g) => serialize(g, now)) });
  }));

  // Ván dạng PGN (để dán vào các trang cờ khác hoặc bàn phân tích)
  app.get('/api/chess/games/:id/pgn', ...auth, handle((req, res) => {
    const g = viewableGame(req, req.params.id);
    res.type('text/plain; charset=utf-8').send(pgnOf(g));
  }));

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
    if (movesOf(g).length < 2 && !g.tournament_id) {
      // Chưa ai đi: coi như hủy ván, không ai mất điểm (ván trong giải thì vẫn tính thua)
      return res.json({ game: serialize(finish(g, null, 'aborted')) });
    }
    const done = finish(g, color === 'w' ? '0-1' : '1-0', 'resign');
    pushIfAway(playerId(done, other(color)), { title: 'Bạn thắng!', body: `${nameOf(req.user.id)} đã đầu hàng.`, tag: `chess-g-${g.id}`, url: `/#/chess/g/${g.id}`, gameId: g.id });
    res.json({ game: serialize(done) });
  }));

  app.post('/api/chess/games/:id/abort', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    if (!colorOf(g, req.user.id) || g.status !== 'active') throw new ChessError(409, 'Ván cờ đã kết thúc.');
    if (g.tournament_id) throw new ChessError(409, 'Ván trong giải đấu không hủy được. Bạn có thể đầu hàng.');
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
      days: g.daily_ms ? Math.round(g.daily_ms / DAY) : undefined,
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
      if (now - g.created_at <= ttlOf(g)) continue; // lời thách cờ theo ngày chờ lâu hơn
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

  // Giải đấu vòng tròn (src/chess-tournaments.js)
  tournaments = setupTournaments({
    app, auth, handle, ChessError, emitTo, pushIfAway, nameOf, arm, startFen: START_FEN, dailyDays: DAILY_DAYS, dayMs: DAY,
  });

  // Bàn phân tích, thống kê, câu nói nhanh (src/chess-extra.js)
  setupChessExtra({
    app, auth, handle, ChessError, mine, loadGame, serialize, emitGame, colorOf, movesOf, openingOf, ratingOf, ratingPublic, nameOf,
  });

  // Ván cờ gọn để hiện trong bài đăng / tin nhắn chia sẻ
  function gameForShare(id) {
    const g = loadGame(id);
    return g ? serialize(g) : null;
  }

  return { serialize, BOTS, gameForShare };
}

module.exports = { setupChess, eloDeltas, cannotMate, BOTS, BASE_MINUTES, START_FEN, DAILY_DAYS };
