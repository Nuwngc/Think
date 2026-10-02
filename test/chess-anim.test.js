'use strict';
// Kiểm thử chuyển động quân cờ (public/chess-anim.js): quân nào trượt, quân nào bị ăn (chạy: npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const { Chess } = require('chess.js');
const A = require('../public/chess-anim.js');

/** Đi lần lượt các nước (dạng e2e4), trả về thế cờ trước và sau nước cuối */
function play(...uci) {
  const c = new Chess();
  let prev = c.fen();
  for (const m of uci) {
    prev = c.fen();
    c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined });
  }
  return { prev, fen: c.fen(), last: uci[uci.length - 1] };
}

test('nước thường: một quân trượt, không quân nào biến mất', () => {
  const { prev, fen, last } = play('e2e4');
  assert.deepEqual(A.plan(prev, fen, last), { moves: [{ from: 'e2', to: 'e4', code: 'wP' }], gone: [], appear: [] });
});

test('ăn quân: quân đi trượt tới, quân bị ăn mờ dần', () => {
  const { prev, fen, last } = play('e2e4', 'd7d5', 'e4d5');
  assert.deepEqual(A.plan(prev, fen, last), { moves: [{ from: 'e4', to: 'd5', code: 'wP' }], gone: [{ sq: 'd5', code: 'bP' }], appear: [] });
});

test('nhập thành: vua và xe cùng trượt', () => {
  const { prev, fen, last } = play('e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1');
  const p = A.plan(prev, fen, last);
  assert.deepEqual(
    p.moves.sort((a, b) => a.from.localeCompare(b.from)),
    [
      { from: 'e1', to: 'g1', code: 'wK' },
      { from: 'h1', to: 'f1', code: 'wR' },
    ],
  );
  assert.deepEqual(p.gone, []);
});

test('bắt tốt qua đường: tốt bị ăn ở ô khác ô đến', () => {
  const { prev, fen, last } = play('e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6');
  assert.deepEqual(A.plan(prev, fen, last), { moves: [{ from: 'e5', to: 'd6', code: 'wP' }], gone: [{ sq: 'd5', code: 'bP' }], appear: [] });
});

test('phong cấp: tốt trượt lên rồi thành hậu, quân bị ăn ở ô đến mờ dần', () => {
  const prev = '1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const c = new Chess(prev);
  c.move({ from: 'a7', to: 'b8', promotion: 'q' });
  assert.deepEqual(A.plan(prev, c.fen(), 'a7b8q'), { moves: [{ from: 'a7', to: 'b8', code: 'wQ' }], gone: [{ sq: 'b8', code: 'bN' }], appear: [] });
});

test('xem lại ván nhảy nhiều nước: quân cùng loại ghép ô gần nhất, không có thì hiện mới', () => {
  const start = new Chess().fen();
  const { fen } = play('e2e4', 'e7e5', 'g1f3');
  const p = A.plan(start, fen, 'g1f3');
  assert.deepEqual(
    p.moves.sort((a, b) => a.from.localeCompare(b.from)),
    [
      { from: 'e2', to: 'e4', code: 'wP' },
      { from: 'e7', to: 'e5', code: 'bP' },
      { from: 'g1', to: 'f3', code: 'wN' },
    ],
  );
  // Lùi về đầu ván: mọi quân trượt về chỗ cũ
  assert.equal(A.plan(fen, start, null).moves.length, 3);
  // Thế cờ khác hẳn: quân không ghép được thì hiện mới / mờ đi
  const p2 = A.plan('4k3/8/8/8/8/8/8/4K2R w - - 0 1', '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1', null);
  assert.deepEqual(p2, { moves: [], gone: [{ sq: 'h1', code: 'wR' }], appear: [{ sq: 'g1', code: 'wN' }] });
});

test('độ lệch theo chiều xem, thời gian trượt', () => {
  assert.deepEqual(A.offset('e2', 'e4', 'w'), { dx: 0, dy: 2 });
  assert.equal(A.offset('e2', 'e4', 'b').dy, -2);
  assert.deepEqual(A.offset('a1', 'h8', 'b'), { dx: 7, dy: -7 });
  assert.deepEqual(A.offset('a1', 'h8', 'w'), { dx: -7, dy: 7 });
  assert.equal(A.duration([{ from: 'e2', to: 'e4' }]), 178);
  assert.equal(A.duration([{ from: 'a1', to: 'h8' }]), 260);
  assert.ok(A.duration([]) >= 150);
});
