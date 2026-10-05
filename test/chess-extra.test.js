'use strict';
// Kiểm thử cờ vua 2.7 (src/chess-extra.js, cờ theo ngày trong src/chess.js): bàn phân tích, cờ theo ngày,
// thống kê, câu nói nhanh — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Chess } = require('chess.js');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-chess27-'));
// Thu nhỏ thời gian: 1 ngày ≈ 1,7 giây (cờ theo ngày hết hạn nhanh trong kiểm thử)
process.env.THINK_CHESS_TIME_SCALE = '0.00002';
const DAY = 24 * 60 * 60000 * 0.00002;
const express = require('express');
const { run } = require('../src/db');
const engine = require('../src/chess-engine');

function startServer() {
  const app = express();
  app.use(express.json());
  const fakeAuth = (req, res, next) => {
    req.user = { id: Number(req.get('x-user')) };
    next();
  };
  const io = { to: () => ({ emit: () => {} }) };
  const pushes = [];
  const { setupChess } = require('../src/chess');
  setupChess({
    app, io, requireAuth: fakeAuth, requireReady: (q, s, n) => n(), isActive: () => false,
    notify: async (uid, p) => pushes.push({ uid, ...p }), nameOf: (id) => `U${id}`,
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, pushes }));
  });
}

let base;
let pushes;
let srv;
const call = async (uid, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-user': String(uid) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  for (const [id, name] of [[80, 'a'], [81, 'b'], [82, 'c']]) {
    run('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, 0)', id, name, name.toUpperCase(), 'x');
  }
  const s = await startServer();
  srv = s.server;
  pushes = s.pushes;
  base = `http://127.0.0.1:${s.server.address().port}`;
});
test.after(() => {
  srv?.close();
  engine.stop();
});

test('bàn phân tích: 3 dòng tốt nhất, ký hiệu nước, tên khai cuộc, thế cờ kết thúc, chặn ván đang chơi', { timeout: 60000 }, async () => {
  let r = await call(80, 'POST', '/api/chess/eval', { moves: ['e2e4', 'e7e5'] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ev = r.data.eval;
  assert.ok(ev.lines.length >= 2 && ev.lines.length <= 3);
  assert.ok(ev.wp > 0 && ev.wp < 100);
  assert.equal(r.data.turn, 'w');
  assert.ok(r.data.opening && /King's Pawn/.test(r.data.opening.name), JSON.stringify(r.data.opening));
  for (const l of ev.lines) {
    assert.ok(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(l.move));
    assert.ok(Array.isArray(l.pv) && l.pv.length >= 1 && typeof l.pv[0] === 'string');
  }
  assert.equal(ev.best, ev.lines[0].move);
  assert.equal(ev.bestSan, ev.lines[0].pv[0]);
  // Lần hai lấy từ bộ nhớ đệm
  r = await call(80, 'POST', '/api/chess/eval', { moves: ['e2e4', 'e7e5'] });
  assert.equal(r.data.cached, true);
  // Điểm theo góc nhìn của Trắng: Đen vừa mất Hậu thì Trắng hơn nhiều
  r = await call(80, 'POST', '/api/chess/eval', { moves: ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5e5', 'g1e2', 'e5e4', 'c3e4'] });
  assert.equal(r.data.turn, 'b');
  assert.ok(r.data.eval.cp > 500, String(r.data.eval.cp));
  // Chiếu hết
  r = await call(80, 'POST', '/api/chess/eval', { moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] });
  assert.equal(r.data.eval.end, 'checkmate');
  assert.equal(r.data.eval.wp, 0);
  assert.equal((await call(80, 'POST', '/api/chess/eval', { moves: ['e2e5'] })).status, 400);
  assert.equal((await call(80, 'POST', '/api/chess/eval', { moves: 'e2e4' })).status, 400);
  // Ván đang chơi: không phân tích đúng thế cờ hiện tại
  const g = (await call(80, 'POST', '/api/chess/bot', { bot: 'custom-300', base: 0, inc: 0, color: 'white' })).data.game;
  const blocked = await call(80, 'POST', '/api/chess/eval', { moves: g.moves });
  assert.equal(blocked.status, 403);
  await call(80, 'POST', `/api/chess/games/${g.id}/resign`);
  // Gửi dồn: lượt sau phải chờ lượt trước
  const [a, b] = await Promise.all([
    call(81, 'POST', '/api/chess/eval', { moves: ['d2d4'] }),
    call(81, 'POST', '/api/chess/eval', { moves: ['c2c4'] }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 429]);
});

test('cờ theo ngày: thách đấu, đồng hồ mỗi nước, nhắc, hết hạn thì thua', { timeout: 30000 }, async () => {
  assert.equal((await call(80, 'POST', '/api/chess/challenges', { opponentId: 81, days: 5, color: 'white' })).status, 400);
  const ch = await call(80, 'POST', '/api/chess/challenges', { opponentId: 81, days: 1, color: 'white', rated: false });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  assert.equal(ch.data.game.daily, Math.round(DAY));
  assert.ok(ch.data.game.expiresAt - ch.data.game.createdAt >= 2 * DAY - 5);
  const home = await call(80, 'GET', '/api/chess');
  assert.deepEqual(home.data.dailyDays, [1, 2, 3, 7]);
  assert.ok(home.data.phrases.length >= 10);
  const acc = await call(81, 'POST', `/api/chess/challenges/${ch.data.game.id}/accept`);
  const id = acc.data.game.id;
  assert.equal(acc.data.game.status, 'active');
  assert.equal(acc.data.game.firstMoveDeadline, null); // không có luật 1 phút đi nước đầu
  assert.ok(acc.data.game.clocks.w <= DAY && acc.data.game.clocks.w > DAY - 500);
  let r = await call(80, 'POST', `/api/chess/games/${id}/move`, { move: 'e2e4', ply: 0 });
  assert.equal(r.status, 200);
  r = await call(81, 'POST', `/api/chess/games/${id}/move`, { move: 'e7e5', ply: 1 });
  assert.equal(r.status, 200);
  assert.ok(r.data.game.clocks.w > DAY - 500, 'đồng hồ bên Trắng đầy lại sau mỗi nước');
  // Trắng không đi: hết 1 "ngày" thì thua
  await sleep(DAY + 600);
  const g = (await call(80, 'GET', `/api/chess/games/${id}`)).data.game;
  assert.equal(g.status, 'finished');
  assert.equal(g.result, '0-1');
  assert.equal(g.reason, 'timeout');
  // Đấu lại vẫn là cờ theo ngày
  const re = await call(80, 'POST', `/api/chess/games/${id}/rematch`);
  assert.equal(re.data.game.daily, Math.round(DAY));
  await call(80, 'POST', `/api/chess/challenges/${re.data.game.id}/cancel`);
  assert.ok(Array.isArray(pushes));
});

test('câu nói nhanh: chỉ trong ván với bạn, chọn trong danh sách, không nói dồn', async () => {
  const ch = await call(80, 'POST', '/api/chess/challenges', { opponentId: 82, base: 0, inc: 0, color: 'white', rated: false });
  const g = (await call(82, 'POST', `/api/chess/challenges/${ch.data.game.id}/accept`)).data.game;
  let r = await call(80, 'POST', `/api/chess/games/${g.id}/say`, { phrase: 'gl' });
  assert.equal(r.status, 200);
  assert.equal(r.data.game.chat.color, 'w');
  assert.equal(r.data.game.chat.text, 'Chúc may mắn!');
  assert.equal((await call(80, 'POST', `/api/chess/games/${g.id}/say`, { phrase: 'hi' })).status, 429);
  assert.equal((await call(82, 'POST', `/api/chess/games/${g.id}/say`, { phrase: 'tự gõ' })).status, 400);
  r = await call(82, 'POST', `/api/chess/games/${g.id}/say`, { phrase: 'thanks' });
  assert.equal(r.data.game.chat.color, 'b');
  assert.equal((await call(81, 'POST', `/api/chess/games/${g.id}/say`, { phrase: 'hi' })).status, 404);
  const bot = (await call(80, 'POST', '/api/chess/bot', { bot: 'custom-300', base: 0, inc: 0, color: 'white' })).data.game;
  assert.equal((await call(80, 'POST', `/api/chess/games/${bot.id}/say`, { phrase: 'hi' })).status, 403);
  await call(80, 'POST', `/api/chess/games/${bot.id}/resign`);
  await call(80, 'POST', `/api/chess/games/${g.id}/resign`);
});

test('thống kê: thắng / hòa / thua, ELO theo thời gian, đối đầu, khai cuộc, chuỗi thắng', async () => {
  const moves = (list) => list.join(' ');
  const ins = (w, b, result, reason, mv, extra = {}) =>
    run(
      `INSERT INTO chess_games (status, white_id, black_id, bot, rated, moves, fen, result, reason, white_rating, black_rating, white_delta, black_delta,
         created_at, started_at, ended_at, updated_at) VALUES ('finished', ?, ?, ?, ?, ?, 'x', ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`,
      w, b, extra.bot || null, extra.rated ? 1 : 0, mv, result, reason, extra.wr ?? null, extra.br ?? null, extra.wd ?? null, extra.bd ?? null,
      extra.t || 1, extra.t || 1
    );
  // Người 90 mới: 2 thắng xếp hạng với 91, 1 thua, 1 hòa với máy, 1 thắng máy chiếu hết nhanh
  for (const [id, name] of [[90, 'x'], [91, 'y']]) run('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, 0)', id, name, name, 'x');
  ins(90, 91, '1-0', 'resign', moves(['e2e4', 'c7c5']), { rated: true, wr: 1200, br: 1200, wd: 20, bd: -20, t: 100 });
  ins(91, 90, '0-1', 'checkmate', moves(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']), { rated: true, wr: 1180, br: 1220, wd: -18, bd: 18, t: 200 });
  ins(90, 91, '0-1', 'timeout', moves(['d2d4', 'd7d5']), { rated: true, wr: 1238, br: 1162, wd: -22, bd: 22, t: 300 });
  ins(90, null, '1/2-1/2', 'stalemate', moves(['e2e4', 'e7e5']), { bot: 'ma', t: 400 });
  ins(null, 90, '0-1', 'checkmate', moves(['f2f3', 'e7e5', 'g2g4', 'd8h4']), { bot: 'mam', t: 500 });
  const r = await call(90, 'GET', '/api/chess/stats/me');
  assert.equal(r.status, 200);
  const st = r.data.stats;
  assert.equal(st.games, 5);
  assert.deepEqual(st.totals.all, { win: 3, draw: 1, loss: 1 });
  assert.deepEqual(st.totals.white, { win: 1, draw: 1, loss: 1 });
  assert.deepEqual(st.totals.black, { win: 2, draw: 0, loss: 0 });
  assert.deepEqual(st.totals.bots, { win: 1, draw: 1, loss: 0 });
  assert.deepEqual(st.totals.rated, { win: 2, draw: 0, loss: 1 });
  assert.deepEqual(st.history.map((h) => h.r), [1200, 1220, 1238, 1216]);
  assert.equal(st.opponents[0].userId, 91);
  assert.equal(st.opponents[0].name, 'U91');
  assert.deepEqual([st.opponents[0].win, st.opponents[0].loss], [2, 1]);
  assert.equal(st.bots.find((b) => b.bot === 'mam').name, 'Mầm Non');
  assert.deepEqual(st.streak, { best: 2, current: 1 });
  assert.deepEqual(st.fastestMate.moves, 2);
  assert.equal(st.reasons.checkmate, 2);
  assert.ok(st.openings.length === 5 && st.openings.some((o) => o.name === 'Sicilian Defense' && o.win === 1), JSON.stringify(st.openings));
  // Xem thống kê người khác
  const other = await call(80, 'GET', '/api/chess/stats/91');
  assert.equal(other.data.stats.games, 3);
  assert.equal((await call(80, 'GET', '/api/chess/stats/abc')).status, 400);
});
