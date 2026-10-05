'use strict';
// Cờ vua 2.7: bàn phân tích (Stockfish chấm thế cờ bất kỳ), thống kê của một người, câu nói nhanh trong ván với bạn.
// src/chess.js gọi setupChessExtra() và truyền các hàm dùng chung.
const { Chess } = require('chess.js');
const { all, run } = require('./db');
const engine = require('./chess-engine');
const { winPercent } = require('./chess-analysis');
const bots = require('./chess-bots');

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const MAX_PLIES = 600;
const EVAL_MS = 700; // Stockfish nghĩ bao lâu mỗi thế cờ
const EVAL_PER_MIN = 40;
const CACHE_SIZE = 600;

/** Câu nói nhanh trong ván người với người (chỉ chọn trong danh sách, không gõ tự do). Emoji cũ cho Android 7–9. */
const PHRASES = [
  { id: 'hi', text: 'Chào bạn! 👋' },
  { id: 'gl', text: 'Chúc may mắn!' },
  { id: 'nice', text: 'Nước hay đấy! 👏' },
  { id: 'oops', text: 'Ối, nhầm mất rồi 😅' },
  { id: 'think', text: 'Để mình nghĩ chút…' },
  { id: 'hurry', text: 'Nhanh lên nào ⏰' },
  { id: 'wow', text: '😲' },
  { id: 'lol', text: '😂' },
  { id: 'fire', text: '🔥' },
  { id: 'gg', text: 'Ván hay lắm!' },
  { id: 'thanks', text: 'Cảm ơn ván cờ! 🙏' },
  { id: 'again', text: 'Đấu lại nhé?' },
];
const phraseById = new Map(PHRASES.map((p) => [p.id, p]));
const SAY_GAP_MS = 3000; // mỗi người tối đa một câu mỗi 3 giây trong một ván
const SAY_AFTER_END_MS = 30 * 60 * 1000; // xong ván rồi vẫn nói được 30 phút (cảm ơn, rủ đấu lại)

/** Dựng thế cờ từ danh sách nước đi; nước sai luật thì trả null */
function replay(moves) {
  const chess = new Chess();
  for (const m of moves) {
    const p = UCI.exec(m);
    if (!p) return null;
    try {
      chess.move({ from: p[1], to: p[2], promotion: p[3] });
    } catch {
      return null;
    }
  }
  return chess;
}

/** Dãy nước dạng e2e4 → ký hiệu (e4, Nf3…) từ thế cờ `fen` */
function sanLine(fen, pv) {
  const c = new Chess(fen);
  const out = [];
  for (const m of pv || []) {
    try {
      out.push(c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined }).san);
    } catch {
      break;
    }
  }
  return out;
}

/** Thống kê cờ vua của một người từ các ván đã xong */
function statsOf(uid, { movesOf, openingOf, ratingOf, ratingPublic }) {
  const games = all(
    `SELECT * FROM chess_games WHERE status = 'finished' AND (white_id = ? OR black_id = ?)
      ORDER BY ended_at ASC, id ASC LIMIT 3000`,
    uid, uid
  );
  const blank = () => ({ win: 0, draw: 0, loss: 0 });
  const totals = { all: blank(), white: blank(), black: blank(), rated: blank(), friends: blank(), bots: blank() };
  const opponents = new Map();
  const vsBots = new Map();
  const opens = new Map();
  const reasons = { checkmate: 0, resign: 0, timeout: 0, other: 0 };
  const history = [];
  let bestStreak = 0;
  let streak = 0;
  let fastest = null;
  for (const g of games) {
    const color = g.white_id === uid ? 'w' : 'b';
    const outcome = g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === (color === 'w') ? 'win' : 'loss';
    const add = (t) => t[outcome]++;
    add(totals.all);
    add(color === 'w' ? totals.white : totals.black);
    if (g.bot) {
      add(totals.bots);
      const b = vsBots.get(g.bot) || { bot: g.bot, ...blank() };
      add(b);
      vsBots.set(g.bot, b);
    } else {
      add(totals.friends);
      if (g.rated) add(totals.rated);
      const oppId = color === 'w' ? g.black_id : g.white_id;
      if (oppId != null) {
        const o = opponents.get(oppId) || { userId: oppId, ...blank(), last: 0 };
        add(o);
        o.last = Math.max(o.last, g.ended_at || 0);
        opponents.set(oppId, o);
      }
      // Điểm ELO sau ván xếp hạng
      const before = color === 'w' ? g.white_rating : g.black_rating;
      const delta = color === 'w' ? g.white_delta : g.black_delta;
      if (g.rated && before != null && delta != null) {
        if (!history.length) history.push({ t: g.started_at || g.created_at, r: before });
        history.push({ t: g.ended_at, r: Math.max(100, before + delta), d: delta });
      }
    }
    if (outcome === 'win') {
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      if (g.reason in reasons) reasons[g.reason]++;
      else reasons.other++;
      const plies = movesOf(g).length;
      if (g.reason === 'checkmate' && (!fastest || plies < fastest.plies)) fastest = { plies, moves: Math.ceil(plies / 2), gameId: g.id };
    } else if (outcome === 'loss') streak = 0;
    const op = openingOf(movesOf(g));
    if (op) {
      // Gộp theo tên khai cuộc chính (phần trước dấu ":")
      const name = op.name.split(':')[0].trim();
      const o = opens.get(name) || { name, eco: op.eco, games: 0, ...blank() };
      o.games++;
      add(o);
      opens.set(name, o);
    }
  }
  const byGames = (a, b) => b.win + b.draw + b.loss - (a.win + a.draw + a.loss);
  return {
    userId: uid,
    rating: ratingPublic(ratingOf(uid)),
    games: games.length,
    totals,
    reasons,
    streak: { best: bestStreak, current: streak },
    fastestMate: fastest ? { moves: fastest.moves, gameId: fastest.gameId } : null,
    history: history.slice(-300),
    opponents: [...opponents.values()].sort(byGames).slice(0, 30),
    bots: [...vsBots.values()]
      .map((b) => {
        const bot = bots.botById(b.bot);
        return { ...b, name: bot ? bot.name : b.bot, elo: bot ? bot.elo : null, avatar: bot ? bot.avatar || null : null };
      })
      .sort(byGames)
      .slice(0, 30),
    openings: [...opens.values()].sort((a, b) => b.games - a.games).slice(0, 6),
  };
}

function setupChessExtra({ app, auth, handle, ChessError, mine, loadGame, serialize, emitGame, colorOf, movesOf, openingOf, ratingOf, ratingPublic, nameOf }) {
  /* ---------------- Bàn phân tích ---------------- */

  const cache = new Map();
  const usage = new Map(); // uid -> { busy, times[] }

  app.post('/api/chess/eval', ...auth, handle(async (req, res) => {
    const uid = req.user.id;
    const moves = Array.isArray(req.body?.moves) ? req.body.moves.map(String) : null;
    if (!moves || moves.length > MAX_PLIES) throw new ChessError(400, 'Thế cờ không hợp lệ.');
    const lines = Math.max(1, Math.min(3, Number(req.body?.lines) || 3));
    const chess = replay(moves);
    if (!chess) throw new ChessError(400, 'Có nước đi sai luật.');
    // Không cho phân tích đúng thế cờ của ván mình đang chơi (tránh nhờ máy đánh hộ)
    const key = moves.join(' ');
    const playing = all("SELECT id, moves FROM chess_games WHERE status = 'active' AND (white_id = ? OR black_id = ?)", uid, uid);
    if (playing.some((g) => g.moves === key)) throw new ChessError(403, 'Ván này đang chơi, chưa phân tích được. Xong ván rồi phân tích nhé!');
    const opening = openingOf(moves);
    const turn = chess.turn();
    if (chess.isGameOver()) {
      const mate = chess.isCheckmate();
      const wp = mate ? (turn === 'w' ? 0 : 100) : 50;
      return res.json({ eval: { end: mate ? 'checkmate' : 'draw', cp: null, mate: null, wp, depth: 0, best: null, bestSan: null, lines: [] }, opening, turn });
    }
    const ck = `${key}|${lines}`;
    if (cache.has(ck)) {
      const hit = cache.get(ck);
      cache.delete(ck);
      cache.set(ck, hit);
      return res.json({ eval: hit, opening, turn, cached: true });
    }
    const u = usage.get(uid) || { busy: false, times: [] };
    const now = Date.now();
    u.times = u.times.filter((t) => now - t < 60000);
    if (u.busy) throw new ChessError(429, 'Máy đang tính thế cờ trước, chờ chút nhé.');
    if (u.times.length >= EVAL_PER_MIN) throw new ChessError(429, 'Bạn phân tích nhanh quá, nghỉ một phút rồi tiếp nhé.');
    u.busy = true;
    u.times.push(now);
    usage.set(uid, u);
    let r;
    try {
      r = await engine.evaluate({ fen: chess.fen(), moves, movetime: EVAL_MS, multipv: lines });
    } catch (err) {
      console.warn('[chess] Bàn phân tích lỗi:', err.message);
      throw new ChessError(503, 'Máy phân tích đang bận. Thử lại sau giây lát.');
    } finally {
      u.busy = false;
    }
    // Điểm theo góc nhìn của Trắng (giống phân tích ván)
    const white = (v) => (v == null ? null : turn === 'w' ? v : -v);
    const fen = chess.fen();
    const list = (r.lines && r.lines.length ? r.lines : [{ move: r.move, cp: r.cp, mate: r.mate, depth: r.depth, pv: r.pv }])
      .filter((l) => l.move)
      .map((l) => {
        const cp = white(l.cp);
        const mate = white(l.mate);
        return { move: l.move, cp, mate, wp: winPercent({ cp, mate }), depth: l.depth || 0, pv: sanLine(fen, l.pv && l.pv.length ? l.pv : [l.move]) };
      });
    const top = list[0] || { cp: white(r.cp), mate: white(r.mate), move: r.move, pv: [] };
    const out = {
      cp: top.cp ?? null,
      mate: top.mate ?? null,
      wp: winPercent({ cp: top.cp, mate: top.mate }),
      depth: r.depth || 0,
      best: top.move || null,
      bestSan: top.pv && top.pv[0] ? top.pv[0] : null,
      lines: list,
    };
    cache.set(ck, out);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    res.json({ eval: out, opening, turn });
  }));

  /* ---------------- Thống kê ---------------- */

  app.get('/api/chess/stats/:userId', ...auth, handle((req, res) => {
    const uid = req.params.userId === 'me' ? req.user.id : Number(req.params.userId);
    if (!Number.isInteger(uid) || uid <= 0) throw new ChessError(400, 'Không tìm thấy người này.');
    const stats = statsOf(uid, { movesOf, openingOf, ratingOf, ratingPublic });
    for (const o of stats.opponents) o.name = nameOf(o.userId);
    res.json({ stats });
  }));

  /* ---------------- Câu nói nhanh ---------------- */

  const lastSay = new Map(); // `${gameId}:${uid}` -> thời điểm

  app.post('/api/chess/games/:id/say', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    const color = colorOf(g, req.user.id);
    if (!color) throw new ChessError(403, 'Bạn không chơi ván này.');
    if (g.bot) throw new ChessError(403, 'Máy không nghe được đâu, nói với bạn bè nhé!');
    const now = Date.now();
    const open = g.status === 'active' || ((g.status === 'finished' || g.status === 'aborted') && now - (g.ended_at || 0) < SAY_AFTER_END_MS);
    if (!open) throw new ChessError(409, 'Ván cờ đã kết thúc từ lâu.');
    const phrase = phraseById.get(String(req.body?.phrase || ''));
    if (!phrase) throw new ChessError(400, 'Chọn một câu trong danh sách.');
    const k = `${g.id}:${req.user.id}`;
    if (now - (lastSay.get(k) || 0) < SAY_GAP_MS) throw new ChessError(429, 'Từ từ thôi, đợi vài giây nhé.');
    lastSay.set(k, now);
    if (lastSay.size > 5000) lastSay.delete(lastSay.keys().next().value);
    run('UPDATE chess_games SET chat = ? WHERE id = ?', JSON.stringify({ color, text: phrase.text, ply: movesOf(g).length, at: now }), g.id);
    const next = loadGame(g.id);
    emitGame(next);
    res.json({ game: serialize(next) });
  }));

  return { PHRASES };
}

module.exports = { setupChessExtra, statsOf, PHRASES, sanLine };
