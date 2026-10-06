'use strict';
// Kiểm thử cờ vua 2.8: giải đấu vòng tròn (src/chess-tournaments.js), xin đi lại với bạn, ván đang diễn ra, PGN — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Chess } = require('chess.js');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-chess28-'));
process.env.THINK_CHESS_TIME_SCALE = '0.00002'; // 1 ngày ≈ 1,7 giây
const DAY = 24 * 60 * 60000 * 0.00002;
const express = require('express');
const { run } = require('../src/db');
const engine = require('../src/chess-engine');
const T = require('../src/chess-tournaments');

let base;
let srv;
const pushes = [];
const events = [];
const call = async (uid, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-user': String(uid) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  for (const [id, name] of [[1, 'An'], [2, 'Binh'], [3, 'Chi'], [4, 'Dung'], [5, 'Em']]) {
    run('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, 0)', id, name.toLowerCase(), name, 'x');
  }
  const app = express();
  app.use(express.json());
  const fakeAuth = (req, res, next) => {
    req.user = { id: Number(req.get('x-user')) };
    next();
  };
  const io = { to: (room) => ({ emit: (ev, data) => events.push({ room, ev, data }) }) };
  const { setupChess } = require('../src/chess');
  setupChess({
    app, io, requireAuth: fakeAuth, requireReady: (q, s, n) => n(), isActive: () => false,
    notify: async (uid, p) => pushes.push({ uid, ...p }), nameOf: (id) => ['', 'An', 'Bình', 'Chi', 'Dũng', 'Em'][id] || `U${id}`,
  });
  await new Promise((resolve) => {
    srv = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => {
  srv?.close();
  engine.stop();
});

test('cặp đấu vòng tròn và bảng xếp hạng (hệ số Sonneborn-Berger)', () => {
  const p4 = T.pairingsOf([1, 2, 3, 4]);
  assert.equal(p4.length, 6);
  const whites = new Map();
  for (const [w] of p4) whites.set(w, (whites.get(w) || 0) + 1);
  assert.ok([...whites.values()].every((n) => n >= 1 && n <= 2), 'màu quân chia đều');
  assert.equal(T.pairingsOf([1, 2, 3], 2).length, 6);
  // 1 thắng 2, 2 thắng 3, 3 thắng 1 → bằng điểm; 1–4 hòa, 2 thắng 4, 3 thắng 4
  const g = (w, b, result) => ({ white_id: w, black_id: b, status: 'finished', result });
  const st = T.standingsOf([1, 2, 3, 4], [g(1, 2, '1-0'), g(2, 3, '1-0'), g(3, 1, '1-0'), g(1, 4, '1/2-1/2'), g(2, 4, '1-0'), g(4, 3, '0-1')]);
  assert.deepEqual(st.map((r) => [r.userId, r.points]), [[2, 2], [3, 2], [1, 1.5], [4, 0.5]]);
  assert.equal(st[0].rank, 1);
  assert.equal(st[1].rank, 2); // bằng điểm nhưng SB thấp hơn
  assert.ok(st[0].sb > st[1].sb);
  // Bằng hết: cùng hạng
  const tie = T.standingsOf([1, 2], [g(1, 2, '1/2-1/2')]);
  assert.deepEqual(tie.map((r) => r.rank), [1, 1]);
});

test('giải đấu: mời, nhận lời, tự bắt đầu, đủ ván, xong giải có nhà vô địch', { timeout: 30000 }, async () => {
  assert.equal((await call(1, 'POST', '/api/chess/tournaments', { name: 'Thiếu người', players: [2], days: 1 })).status, 400);
  assert.equal((await call(1, 'POST', '/api/chess/tournaments', { players: [2, 3], days: 5 })).status, 400);
  const c = await call(1, 'POST', '/api/chess/tournaments', { name: 'Cúp Think', players: [2, 3, 4], days: 1, rated: false });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const t = c.data.tournament;
  assert.equal(t.status, 'open');
  assert.deepEqual(t.players.map((p) => p.status), ['joined', 'invited', 'invited', 'invited']);
  assert.equal(pushes.filter((p) => /Mời vào giải/.test(p.title)).length, 3);
  assert.equal((await call(5, 'POST', `/api/chess/tournaments/${t.id}/join`)).status, 403);
  assert.equal((await call(2, 'POST', `/api/chess/tournaments/${t.id}/start`)).status, 403);
  // Chưa đủ 3 người nhận lời: chưa bắt đầu được
  assert.equal((await call(1, 'POST', `/api/chess/tournaments/${t.id}/start`)).status, 409);
  await call(2, 'POST', `/api/chess/tournaments/${t.id}/join`);
  await call(4, 'POST', `/api/chess/tournaments/${t.id}/decline`);
  // Người cuối trả lời → đủ 3 người → tự bắt đầu
  const j = await call(3, 'POST', `/api/chess/tournaments/${t.id}/join`);
  assert.equal(j.data.tournament.status, 'active');
  const games = j.data.tournament.games;
  assert.equal(games.length, 3);
  assert.ok(pushes.some((p) => /Giải đấu bắt đầu/.test(p.title)));
  // Ván trong giải: là cờ theo ngày, có tên giải, không hủy được
  const g0 = (await call(games[0].whiteId, 'GET', `/api/chess/games/${games[0].id}`)).data.game;
  assert.equal(g0.tournament.name, 'Cúp Think');
  assert.equal(g0.daily, Math.round(DAY));
  assert.equal((await call(g0.whiteId, 'POST', `/api/chess/games/${g0.id}/abort`)).status, 409);
  // Ván 1: đầu hàng ngay từ đầu vẫn tính thua
  const r1 = await call(games[0].blackId, 'POST', `/api/chess/games/${games[0].id}/resign`);
  assert.equal(r1.data.game.result, '1-0');
  // Ván 2: chiếu hết nhanh
  const g1 = games[1];
  for (const [i, m] of ['f2f3', 'e7e5', 'g2g4', 'd8h4'].entries()) {
    const r = await call(i % 2 === 0 ? g1.whiteId : g1.blackId, 'POST', `/api/chess/games/${g1.id}/move`, { move: m, ply: i });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  // Ván 3: Trắng không đi nước đầu → hết hạn thì thua (không bị hủy như ván thường)
  await sleep(DAY + 700);
  const done = (await call(1, 'GET', `/api/chess/tournaments/${t.id}`)).data.tournament;
  assert.equal(done.status, 'finished', JSON.stringify(done.games));
  const g2 = done.games[2];
  assert.equal(g2.result, '0-1');
  assert.equal(g2.reason, 'timeout');
  assert.ok(done.winners.length >= 1);
  assert.equal(done.standings.reduce((n, s) => n + s.played, 0), 6);
  assert.ok(pushes.some((p) => /Giải đấu kết thúc/.test(p.title)));
  assert.ok(events.some((e) => e.ev === 'chess:tournament'));
  // Thành tựu "Nhà vô địch"
  const A = require('../src/achievements');
  for (const w of done.winners) assert.equal(A.valuesOf(w).cups, 1);
  // Danh sách giải của tôi
  const mine = await call(2, 'GET', '/api/chess/tournaments');
  assert.equal(mine.data.tournaments[0].id, t.id);
  assert.equal((await call(4, 'GET', '/api/chess/tournaments')).data.tournaments.length, 0);
  // Hủy giải đang mời
  const c2 = await call(1, 'POST', '/api/chess/tournaments', { players: [2, 3], days: 3 });
  assert.equal((await call(1, 'POST', `/api/chess/tournaments/${c2.data.tournament.id}/cancel`)).data.tournament.status, 'cancelled');
});

test('xin đi lại trong ván giao hữu, ván đang diễn ra, PGN', async () => {
  const ch = await call(4, 'POST', '/api/chess/challenges', { opponentId: 5, base: 0, inc: 0, color: 'white', rated: false });
  const g = (await call(5, 'POST', `/api/chess/challenges/${ch.data.game.id}/accept`)).data.game;
  // Chưa đi: không xin được
  assert.equal((await call(4, 'POST', `/api/chess/games/${g.id}/takeback`, { action: 'offer' })).status, 409);
  await call(4, 'POST', `/api/chess/games/${g.id}/move`, { move: 'e2e4', ply: 0 });
  await call(5, 'POST', `/api/chess/games/${g.id}/move`, { move: 'e7e5', ply: 1 });
  await call(4, 'POST', `/api/chess/games/${g.id}/move`, { move: 'g1f3', ply: 2 });
  // Trắng xin đi lại Nf3 (Đen chưa đáp): bỏ 1 nước
  let r = await call(4, 'POST', `/api/chess/games/${g.id}/takeback`, { action: 'offer' });
  assert.equal(r.data.game.takebackOffer, 'w');
  assert.ok(pushes.some((p) => p.uid === 5 && /Xin đi lại/.test(p.title)));
  assert.equal((await call(4, 'POST', `/api/chess/games/${g.id}/takeback`, { action: 'accept' })).status, 409); // tự đồng ý không được
  r = await call(5, 'POST', `/api/chess/games/${g.id}/takeback`, { action: 'accept' });
  assert.deepEqual(r.data.game.moves, ['e2e4', 'e7e5']);
  assert.equal(r.data.game.takebackOffer, null);
  assert.equal(r.data.game.takebacks, 1);
  // Đen xin đi lại sau khi Trắng đã đáp: bỏ 2 nước; Trắng đi tiếp là lời xin mất
  await call(4, 'POST', `/api/chess/games/${g.id}/move`, { move: 'd2d4', ply: 2 });
  r = await call(5, 'POST', `/api/chess/games/${g.id}/takeback`, { action: 'offer' });
  assert.equal(r.data.game.takebackOffer, 'b');
  r = await call(4, 'POST', `/api/chess/games/${g.id}/takeback`, { action: 'decline' });
  assert.equal(r.data.game.takebackOffer, null);
  await call(5, 'POST', `/api/chess/games/${g.id}/takeback`, { action: 'offer' });
  r = await call(4, 'POST', `/api/chess/games/${g.id}/takeback`, { action: 'accept' });
  assert.deepEqual(r.data.game.moves, ['e2e4']);
  // Ván tính điểm: không xin được
  const rated = await call(4, 'POST', '/api/chess/challenges', { opponentId: 5, base: 0, inc: 0, color: 'white', rated: true });
  const gr = (await call(5, 'POST', `/api/chess/challenges/${rated.data.game.id}/accept`)).data.game;
  await call(4, 'POST', `/api/chess/games/${gr.id}/move`, { move: 'e2e4', ply: 0 });
  assert.equal((await call(4, 'POST', `/api/chess/games/${gr.id}/takeback`, { action: 'offer' })).status, 409);
  // Ván đang diễn ra: người khác thấy, người chơi không thấy ván của mình
  const live = await call(1, 'GET', '/api/chess/live');
  assert.ok(live.data.games.some((x) => x.id === g.id) && live.data.games.some((x) => x.id === gr.id));
  assert.ok(!(await call(4, 'GET', '/api/chess/live')).data.games.some((x) => x.id === g.id));
  // PGN: tiêu đề, nước đi, kết quả; nạp lại được bằng chess.js
  await call(5, 'POST', `/api/chess/games/${gr.id}/move`, { move: 'c7c5', ply: 1 });
  await call(4, 'POST', `/api/chess/games/${gr.id}/resign`);
  const pgn = (await call(1, 'GET', `/api/chess/games/${gr.id}/pgn`)).data;
  assert.match(pgn, /\[White "Dũng"\]/);
  assert.match(pgn, /\[Result "0-1"\]/);
  assert.match(pgn, /1\. e4 c5 0-1\s*$/s);
  const c = new Chess();
  c.loadPgn(pgn);
  assert.equal(c.history().length, 2);
  const pgn2 = (await call(1, 'GET', `/api/chess/games/${g.id}/pgn`)).data;
  assert.match(pgn2, /\*\s*$/);
});
