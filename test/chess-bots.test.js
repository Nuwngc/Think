'use strict';
// Kiểm thử máy cờ (src/chess-bots.js, máy có tính cách trong src/chess-worker.js) và các tính năng ván với máy:
// câu nói của máy, gợi ý, đi lại, tên khai cuộc, vương miện thắng máy — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Chess } = require('chess.js');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-bots-'));
const express = require('express');
const { run, get } = require('../src/db');
const bots = require('../src/chess-bots');
const { runStyle, styleBonus } = require('../src/chess-worker');
const engine = require('../src/chess-engine');

/** Số giả ngẫu nhiên lặp lại được */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

test('danh sách máy: id không trùng, ELO tăng dần, đủ thông tin, máy tự chọn sức', () => {
  const ids = bots.BOTS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(bots.BOTS.length >= 16);
  for (let i = 1; i < bots.BOTS.length; i++) assert.ok(bots.BOTS[i].elo > bots.BOTS[i - 1].elo, bots.BOTS[i].id);
  for (const b of bots.BOTS) {
    const p = bots.botPublic(b);
    assert.ok(p.name && p.about && p.source && p.source.url, b.id);
    assert.ok(bots.TIERS.some((t) => t.id === p.tier), b.id);
    assert.equal(bots.botById(b.id), b);
    const job = bots.jobFor(b);
    assert.ok(['jce', 'garbo', 'stockfish', 'style'].includes(job.engine), b.id);
  }
  // Mã cũ của các ván đang chơi vẫn còn
  for (const id of ['jce-1', 'jce-2', 'jce-3', 'sf-3', 'garbo', 'sf-8', 'sf-14', 'sf-20']) assert.ok(bots.botById(id), id);
  const c = bots.botById('custom-1500');
  assert.equal(c.elo, 1500);
  assert.equal(c.engine, 'style');
  assert.equal(bots.botPublic(c).custom, true);
  for (const bad of ['custom-1525', 'custom-100', 'custom-9999', 'custom-abc', 'xyz', '']) assert.equal(bots.botById(bad), null, bad);
});

test('máy càng mạnh càng nhìn sâu, càng ít đi bừa', () => {
  let prev = bots.levelFor(200);
  for (let elo = 300; elo <= 2800; elo += 50) {
    const l = bots.levelFor(elo);
    assert.ok(l.depth >= prev.depth && l.temp <= prev.temp && l.blunder <= prev.blunder, String(elo));
    prev = l;
  }
});

test('máy nói: câu cho mọi sự kiện của mọi máy', () => {
  const r = rng(3);
  for (const b of [...bots.BOTS, bots.customBot(1200)]) {
    for (const ev of ['hello', 'check', 'capture', 'promote', 'blunder', 'losing', 'win', 'lose', 'draw']) {
      const line = bots.lineFor(b, ev, r);
      assert.equal(typeof line, 'string', `${b.id} ${ev}`);
      assert.ok(line.length > 0 && line.length < 80);
    }
  }
});

test('gu chơi: mỗi máy có tính cách thích đúng kiểu nước của mình', () => {
  const chess = new Chess();
  const moves = chess.moves({ verbose: true });
  const best = (styleId) => moves.slice().sort((a, b) => styleBonus(styleId, b, {}) - styleBonus(styleId, a, {}))[0];
  assert.equal(best('pawns').piece, 'p');
  assert.equal(best('knights').piece, 'n');
  // Nhập thành được cộng nhiều điểm với máy phòng thủ
  const c2 = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const castle = c2.moves({ verbose: true }).find((m) => m.san === 'O-O');
  assert.ok(styleBonus('defend', castle, {}) >= 150);
  // Bão Táp thích nước tiến sát Vua đối phương
  const c3 = new Chess('6k1/8/8/8/8/8/8/Q5K1 w - - 0 1');
  const ms = c3.moves({ verbose: true });
  const near = ms.find((m) => m.to === 'g7') || ms.find((m) => m.to === 'f7');
  const far = ms.find((m) => m.to === 'a2');
  assert.ok(styleBonus('storm', near, { enemyKing: 'g8' }) > styleBonus('storm', far, { enemyKing: 'g8' }));
});

test('máy có tính cách chọn nước hợp lệ, theo gu, không đi bừa khi thấy chiếu hết', async () => {
  // Máy giả: ba nước tốt nhất ngang điểm nhau, máy mê mã phải chọn nước mã
  const fake = async () => [
    { move: 'e2e4', score: 30, mate: null },
    { move: 'g1f3', score: 28, mate: null },
    { move: 'd2d4', score: 29, mate: null },
  ];
  const r = rng(5);
  let knight = 0;
  for (let i = 0; i < 40; i++) {
    const out = await runStyle({ style: 'knights', moves: [], temp: 30, blunder: 0, elo: 900 }, r, fake);
    if (out.move === 'g1f3') knight++;
    assert.equal(out.cp, 30);
  }
  assert.ok(knight >= 34, `chọn nước mã ${knight}/40`);
  // Đi bừa vẫn là nước hợp lệ; phong cấp thì lên Hậu
  const promo = ['a2a4', 'h7h5', 'a4a5', 'h5h4', 'a5a6', 'h4h3', 'a6b7', 'h3g2'];
  const legalAfter = new Chess();
  for (const u of promo) legalAfter.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  const legal = new Set(legalAfter.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ''}`));
  for (let i = 0; i < 30; i++) {
    const out = await runStyle({ style: 'pawns', moves: promo, temp: 50, blunder: 1, elo: 650 }, r, async () => []);
    assert.ok(legal.has(out.move), out.move);
    if (out.move.length === 5) assert.ok(out.move.endsWith('q'), out.move);
  }
  // Có chiếu hết trong 1 nước: máy từ 1100 trở lên không đi bừa
  const mate = async () => [{ move: 'd8h4', score: 99900, mate: 1 }];
  for (let i = 0; i < 10; i++) {
    const out = await runStyle({ style: 'neutral', moves: ['f2f3', 'e7e5', 'g2g4'], temp: 10, blunder: 1, elo: 1200 }, r, mate);
    assert.equal(out.move, 'd8h4');
  }
});

/* ---------------- Ván với máy qua API ---------------- */

function startServer() {
  const app = express();
  app.use(express.json());
  const fakeAuth = (req, res, next) => {
    req.user = { id: Number(req.get('x-user')) };
    next();
  };
  const io = { to: () => ({ emit: () => {} }) };
  const { setupChess } = require('../src/chess');
  setupChess({ app, io, requireAuth: fakeAuth, requireReady: (q, s, n) => n(), isActive: () => true, notify: async () => {}, nameOf: (id) => `U${id}` });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('ván với máy: lời chào, máy đi, gợi ý, đi lại, tên khai cuộc, vương miện', { timeout: 120000 }, async (t) => {
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (70, 'bot1', 'B', 'x', 0)");
  const server = await startServer();
  t.after(() => {
    server.close();
    engine.stop();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-user': '70' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  const waitTurn = async (id, color) => {
    for (let i = 0; i < 200; i++) {
      const { data } = await call('GET', `/api/chess/games/${id}`);
      if (data.game.turn === color || data.game.status !== 'active') return data.game;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Máy không đi');
  };

  const home = await call('GET', '/api/chess');
  assert.equal(home.status, 200);
  assert.ok(home.data.bots.length >= 16 && home.data.botTiers.length === 4);
  assert.deepEqual(home.data.customElo, { min: 300, max: 2800, step: 50 });
  assert.deepEqual(home.data.beaten, []);

  // Máy tự chọn sức, mình cầm Trắng: có lời chào
  const created = await call('POST', '/api/chess/bot', { bot: 'custom-800', base: 0, inc: 0, color: 'white' });
  assert.equal(created.status, 200);
  const id = created.data.game.id;
  assert.equal(created.data.game.bot.name, 'Máy tùy chỉnh 800');
  assert.equal(created.data.game.botSay.event, 'hello');
  assert.equal(created.data.game.opening, null);
  assert.equal((await call('POST', '/api/chess/bot', { bot: 'custom-805', base: 0, inc: 0 })).status, 400);

  // Chưa đi nước nào: không đi lại được
  assert.equal((await call('POST', `/api/chess/games/${id}/takeback`)).status, 409);
  let mv = await call('POST', `/api/chess/games/${id}/move`, { move: 'e2e4', ply: 0 });
  assert.equal(mv.status, 200);
  assert.equal(mv.data.game.opening.name.startsWith("King's Pawn"), true);
  let g = await waitTurn(id, 'w');
  assert.equal(g.moves.length, 2);

  // Gợi ý: một nước hợp lệ, đếm số lần dùng
  const hint = await call('POST', `/api/chess/games/${id}/hint`);
  assert.equal(hint.status, 200);
  const board = new Chess();
  for (const m of g.moves) board.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  assert.ok(board.moves({ verbose: true }).some((m) => `${m.from}${m.to}${m.promotion || ''}` === hint.data.move));
  assert.equal(hint.data.game.hints, 1);

  // Đi lại: bỏ nước máy + nước mình
  const back = await call('POST', `/api/chess/games/${id}/takeback`);
  assert.equal(back.status, 200);
  assert.deepEqual(back.data.game.moves, []);
  assert.equal(back.data.game.takebacks, 1);
  assert.equal(back.data.game.fen, new Chess().fen());

  // Đi lại khi máy đang nghĩ: chỉ bỏ nước của mình, máy không đi nước cũ
  mv = await call('POST', `/api/chess/games/${id}/move`, { move: 'd2d4', ply: 0 });
  const quick = await call('POST', `/api/chess/games/${id}/takeback`);
  assert.equal(quick.status, 200);
  assert.deepEqual(quick.data.game.moves, []);
  mv = await call('POST', `/api/chess/games/${id}/move`, { move: 'g1f3', ply: 0 });
  assert.equal(mv.status, 200);
  g = await waitTurn(id, 'w');
  assert.equal(g.moves[0], 'g1f3');
  assert.equal(g.moves.length, 2);

  // Ván khác: thắng máy (giả lập ván đã xong) thì có vương miện; ván dùng gợi ý thì không
  run(
    `INSERT INTO chess_games (status, white_id, bot, moves, fen, result, created_at, updated_at) VALUES ('finished', 70, 'ma', '', 'x', '1-0', 0, 0)`
  );
  run(
    `INSERT INTO chess_games (status, white_id, bot, moves, fen, result, hints, created_at, updated_at) VALUES ('finished', 70, 'cao', '', 'x', '1-0', 2, 0, 0)`
  );
  run(
    `INSERT INTO chess_games (status, black_id, bot, moves, fen, result, created_at, updated_at) VALUES ('finished', 70, 'custom-900', '', 'x', '0-1', 0, 0)`
  );
  assert.deepEqual((await call('GET', '/api/chess')).data.beaten, ['ma']);
  const A = require('../src/achievements');
  assert.equal(A.valuesOf(70).bots, 1);

  // Đầu hàng: máy nói câu thắng
  const resign = await call('POST', `/api/chess/games/${id}/resign`);
  assert.equal(resign.data.game.botSay.event, 'win');
  // Ván với người: không có gợi ý
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (71, 'bot2', 'C', 'x', 0)");
  const pvp = Number(
    run(
      `INSERT INTO chess_games (status, white_id, black_id, moves, fen, created_at, updated_at, turn_started_at) VALUES ('active', 70, 71, '', ?, 0, 0, 0)`,
      new Chess().fen()
    ).lastInsertRowid
  );
  assert.equal((await call('POST', `/api/chess/games/${pvp}/hint`)).status, 403);
  assert.equal((await call('POST', `/api/chess/games/${pvp}/takeback`)).status, 403);
  assert.ok(get('SELECT id FROM chess_games WHERE id = ?', pvp));
});
