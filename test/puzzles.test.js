'use strict';
// Kiểm thử câu đố (Quiz hằng ngày + Thử thách nhanh): dữ liệu giải được, luật từng game, máy chủ chấm lời giải (chạy: npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-puzzles-'));
const { Chess } = require('chess.js');
const { run } = require('../src/db');
const P = require('../public/puzzles-core.js');
const S = require('../src/puzzles');
const streaks = require('../src/streaks');

const ROOT = path.join(__dirname, '..');
const data = (g) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'puzzles', `${g}.json`), 'utf8'));
const solution = (g, p) => (g === 'blocks' ? p.sol : p.moves.filter((_, i) => i % 2 === 0));

test('dữ liệu: đủ màn, chương khớp số màn, mã không trùng, bản web và bản app giống hệt, câu nào cũng giải được', () => {
  for (const g of P.GAMES) {
    const d = data(g);
    assert.equal(d.game, g);
    assert.ok(d.levels.length >= 200, `${g}: phải có ít nhất 200 màn`);
    assert.ok(d.daily.length >= 30, `${g}: quiz hằng ngày quá ít`);
    assert.equal(d.chapters.reduce((a, c) => a + c.size, 0), d.levels.length, `${g}: tổng số màn các chương phải bằng số màn`);
    const ids = [...d.levels, ...d.daily].map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${g}: mã câu đố bị trùng`);
    const app = fs.readFileSync(path.join(ROOT, 'native', 'src', 'puzzles', 'data', `${g}.json`), 'utf8');
    assert.equal(app, fs.readFileSync(path.join(ROOT, 'public', 'puzzles', `${g}.json`), 'utf8'), `${g}: bản trong app khác bản web (chạy lại scripts/puzzles)`);
    for (const p of [...d.levels, ...d.daily]) assert.ok(P.verify(g, p, solution(g, p), Chess), `${g} ${p.id}: lời giải gốc không đúng`);
  }
});

test('quiz hằng ngày: cả nhóm cùng một câu mỗi ngày, xoay vòng', () => {
  assert.equal(P.dayNumber('2026-01-01'), 0);
  assert.equal(P.dayNumber('2026-10-02'), 274);
  assert.equal(P.dailyIndex('2026-10-02', 150), 124);
  assert.equal(P.dailyIndex('2025-12-31', 150), 149); // trước mốc vẫn ra số hợp lệ
  assert.equal(P.dailyIndex('2026-10-02', 0), -1);
  assert.equal(P.dayKey(Date.parse('2026-10-02T17:00:00Z')), '2026-10-03');
  assert.deepEqual([P.stars(0, 0), P.stars(1, 0), P.stars(1, 1), P.stars(2, 1), P.stars(-5, 0)], [3, 2, 2, 1, 3]);
});

test('cờ vua: đi sai thì giữ nguyên, đi đúng thì máy đáp; nước chiếu hết cuối cùng kiểu nào cũng được', () => {
  // Chiếu hết 1 nước có hai cách: Hậu hoặc Xe chiếu hết ở hàng 8
  const p = { id: 't1', fen: '6k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1', goal: 'mate', n: 1, moves: ['e1e8'] };
  let st = P.chessStart(p);
  const wrong = P.chessTry(p, st, 'd1d7', Chess);
  assert.equal(wrong.ok, false);
  assert.equal(P.chessTry(p, st, 'e2e4', Chess).illegal, true);
  const alt = P.chessTry(p, st, 'd1d8', Chess);
  assert.equal(alt.ok, true);
  assert.equal(alt.done, true);
  // Chiếu hết 2 nước: máy đáp theo lời giải
  const p2 = data('chess').levels.find((x) => x.n === 2 && x.goal === 'mate');
  if (p2) {
    st = P.chessStart(p2);
    const r = P.chessTry(p2, st, p2.moves[0], Chess);
    assert.equal(r.ok, true);
    assert.equal(r.reply, p2.moves[1]);
    assert.equal(r.done, false);
    assert.equal(P.chessHint(p2, r.state), p2.moves[2].slice(0, 2));
    assert.equal(P.chessVerify(p2, [p2.moves[0]], Chess), false); // chưa xong
  }
});

test('Xếp Khối: ba khối một lượt, đặt hết mà còn ô là thua, gợi ý theo lời giải', () => {
  const p = data('blocks').levels.find((x) => x.pieces.length >= 4);
  let st = P.blocksStart(p);
  assert.equal(st.tray.filter(Boolean).length, 3);
  assert.deepEqual(P.blocksHint(p, st), { slot: st.tray.findIndex((x) => x && x.k === p.sol[0][0]), k: p.sol[0][0], r: p.sol[0][1], c: p.sol[0][2] });
  for (let i = 0; i < 3; i++) {
    const [k, r, c] = p.sol[i];
    const res = P.blocksPlace(p, st, st.tray.findIndex((x) => x && x.k === k), r, c);
    assert.ok(res);
    st = res.state;
  }
  assert.equal(st.next > 3 || st.used === p.pieces.length, true); // lượt khối mới
  assert.ok(st.tray.some(Boolean));
  // Đặt bừa vào góc: lời giải lệch thì không còn gợi ý
  const one = data('blocks').levels[0];
  let s1 = P.blocksStart(one);
  const B = require('../public/blocks-core.js');
  outer: for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if ([r, c].join() === [one.sol[0][1], one.sol[0][2]].join() || !B.canPlace(s1.board, s1.tray[0].shape, r, c)) continue;
    const res = P.blocksPlace(one, s1, 0, r, c);
    s1 = res.state;
    break outer;
  }
  assert.equal(s1.lost, !s1.won); // một khối duy nhất đặt sai chỗ: thua
  assert.equal(P.blocksVerify(one, [[0, 9, 9]]), false);
});

test('cờ caro: nước không tạo tứ là sai, máy chặn tứ, cách thắng khác cũng được tính', () => {
  const d = data('caro');
  const p = d.levels.find((x) => x.n === 3);
  let st = P.caroStart(p);
  // Một ô trống xa: không phải tứ
  const far = st.board.findIndex((v, i) => !v && P.caro.nearX(st.board).indexOf(i) < 0);
  assert.equal(P.caroTry(p, st, far).reason, 'not-four');
  assert.equal(P.caroTry(p, st, p.x[0]).reason, 'taken');
  const r = P.caroTry(p, st, p.moves[0]);
  assert.equal(r.ok, true);
  assert.equal(r.reply, p.moves[1]);
  st = r.state;
  assert.equal(P.caroHint(p, st), p.moves[2]);
  // Đi hết lời giải
  for (let i = 2; i < p.moves.length; i += 2) st = P.caroTry(p, st, p.moves[i]).state;
  assert.equal(st.won, true);
  // Mọi câu: dãy X dài hơn số nước cho phép không được tính
  assert.equal(P.caroVerify(p, [...solution('caro', p), 0]), false);
  // Thắng ngay: ô thắng nào cũng được
  const one = d.levels.find((x) => x.n === 1);
  const wins = P.caro.winSquares(P.caro.board(one), P.caro.X);
  assert.ok(wins.length >= 1);
  for (const w of wins) assert.equal(P.caroVerify(one, [w]), true);
});

test('máy chủ: mở màn lần lượt, chấm lời giải, giữ số sao cao nhất, quiz chỉ tính lần giải đầu, ghi chuỗi', () => {
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (801, 'pz', 'Pz', 'x', 0)");
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (802, 'pz2', 'Pz2', 'x', 0)");
  const lv = (g, n) => data(g).levels[n - 1];
  const now = Date.parse('2026-10-02T05:00:00Z');
  assert.throws(() => S.solveLevel(801, 'caro', { level: 2, moves: solution('caro', lv('caro', 2)) }, now), /chưa mở/);
  assert.throws(() => S.solveLevel(801, 'caro', { level: 1, moves: [0] }, now), /không đúng/);
  assert.throws(() => S.solveLevel(801, 'caro', { level: 999, moves: [] }, now), /Không có màn/);
  assert.throws(() => S.solveLevel(801, 'tetris', { level: 1 }, now), /Không có game/);
  let sum = S.solveLevel(801, 'caro', { level: 1, moves: solution('caro', lv('caro', 1)), mistakes: 2, hints: 0, ms: 9000 }, now);
  assert.equal(sum.stars[0], '2');
  sum = S.solveLevel(801, 'caro', { level: 1, moves: solution('caro', lv('caro', 1)), mistakes: 0, ms: 5000 }, now);
  sum = S.solveLevel(801, 'caro', { level: 1, moves: solution('caro', lv('caro', 1)), mistakes: 5, ms: 1000 }, now);
  assert.equal(sum.stars[0], '3'); // giữ số sao cao nhất
  assert.equal(sum.solved, 1);
  assert.equal(sum.totalStars, 3);
  assert.equal(sum.stars.length, data('caro').levels.length);
  assert.deepEqual(sum.board.map((x) => [x.userId, x.stars]), [[801, 3]]);
  S.solveLevel(801, 'blocks', { level: 1, moves: lv('blocks', 1).sol }, now);
  S.solveLevel(801, 'chess', { level: 1, moves: solution('chess', lv('chess', 1)) }, now);
  const st = streaks.summaryOf(801, now);
  assert.deepEqual(st.games.filter((g) => g.today).map((g) => g.id).sort(), ['blocks', 'caro', 'chess']);

  // Quiz hằng ngày
  const day = P.dayKey(Date.now());
  for (const g of P.GAMES) {
    const { puzzle } = S.dailyOf(g, day);
    assert.throws(() => S.solveDaily(801, g, { day, moves: [] }), /không đúng/);
    const a = S.solveDaily(801, g, { day, id: puzzle.id, moves: solution(g, puzzle), mistakes: 1, ms: 40000 });
    assert.equal(a.first, true);
    const b = S.solveDaily(801, g, { day, id: puzzle.id, moves: solution(g, puzzle), mistakes: 0, ms: 10000 });
    assert.equal(b.first, false); // lần giải đầu mới tính
    assert.deepEqual([b.summary.daily.mine.stars, b.summary.daily.mine.ms], [2, 40000]);
    S.solveDaily(802, g, { day, id: puzzle.id, moves: solution(g, puzzle), mistakes: 0, ms: 90000 });
    assert.deepEqual(S.gameSummary(802, g).daily.solvers.map((x) => x.userId), [802, 801]); // 3 sao xếp trên
  }
  assert.throws(() => S.solveDaily(801, 'caro', { day: '2026-01-01', moves: [] }), /đã đóng/);
  // Thời gian quá nhỏ (gửi bừa ms: 1) không được tin
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (803, 'pz3', 'Pz3', 'x', 0)");
  const cp = S.dailyOf('caro', day).puzzle;
  const fast = S.solveDaily(803, 'caro', { day, id: cp.id, moves: solution('caro', cp), ms: 1 });
  assert.ok(fast.summary.daily.mine.ms >= 600 * solution('caro', cp).length);
  // Xếp Khối: tọa độ không nguyên không được nhận
  const b1 = data('blocks').levels[0];
  assert.equal(P.blocksVerify(b1, b1.sol.map(([k, r, c]) => [k, r + 0.001, c])), false);
  assert.throws(() => S.solveDaily(801, 'caro', { day, id: 'kd-cu', moves: [] }), /đã đổi/);
  const all = S.summary(801);
  assert.deepEqual(Object.keys(all.games), ['chess', 'blocks', 'caro']);
});
