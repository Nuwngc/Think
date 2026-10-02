'use strict';
// Tạo câu đố Xếp Khối "dọn sạch bàn": dựng ngược từ lời giải.
//   1. Chọn vài hàng / cột sẽ được xóa.
//   2. Đặt các khối (hình trong game) gọn trong những hàng / cột đó, không chồng nhau.
//   3. Các ô còn lại của những hàng / cột đó là ô có sẵn trên bàn.
//   4. Đặt thử theo thứ tự (3 khối một lượt như game thật): phải dọn sạch bàn, không thì làm lại.
// Đúng lời giải gốc thì chắc chắn giải được; người chơi tìm ra cách khác cũng được tính.
//
//   node scripts/puzzles/blocks.js               tạo mới 200 màn + 150 quiz hằng ngày
//   node scripts/puzzles/blocks.js --add 50      thêm 50 màn mới vào cuối (giữ nguyên màn cũ)
const B = require('../../public/blocks-core.js');
const P = require('../../public/puzzles-core.js');
const { rng, shuffle, readData, writeData, args, appendLevels } = require('./common');

const opt = args({ levels: 200, daily: 150, seed: 20261004, add: 0 });
const N = B.SIZE;

// Mỗi chương: số khối, số hàng/cột được xóa, có hàng lẫn cột cắt nhau không
const PLAN = [
  { name: 'Làm quen', pieces: [1, 1], lines: [1, 1], cross: 0 },
  { name: 'Hai khối', pieces: [2, 2], lines: [1, 2], cross: 0 },
  { name: 'Ba khối', pieces: [3, 3], lines: [2, 2], cross: 0.3 },
  { name: 'Hàng cắt cột', pieces: [3, 3], lines: [2, 3], cross: 1 },
  { name: 'Hai lượt khối', pieces: [4, 4], lines: [2, 3], cross: 0.5 },
  { name: 'Năm khối', pieces: [4, 5], lines: [3, 3], cross: 0.6 },
  { name: 'Dọn nhiều hàng', pieces: [5, 5], lines: [3, 4], cross: 0.6 },
  { name: 'Sáu khối', pieces: [6, 6], lines: [3, 4], cross: 0.7 },
  { name: 'Ba lượt khối', pieces: [6, 7], lines: [4, 5], cross: 0.8 },
  { name: 'Cao thủ', pieces: [7, 9], lines: [4, 6], cross: 1 },
];
const DAILY = { pieces: [5, 7], lines: [3, 5], cross: 0.8 };

// Các hình được dùng, kèm độ hay gặp (bớt khối 1 ô cho đỡ dễ)
const SHAPES = B.SHAPES.map((s) => ({ ...s, weight: s.id === 'o1' ? 0.4 : s.weight }));
const TOTAL = SHAPES.reduce((a, s) => a + s.weight, 0);
function pickShape(rand) {
  let x = rand() * TOTAL;
  for (const s of SHAPES) {
    x -= s.weight;
    if (x <= 0) return s;
  }
  return SHAPES[SHAPES.length - 1];
}
const between = ([a, b], rand) => a + Math.floor(rand() * (b - a + 1));

/** Một câu đố theo cấu hình, hoặc null nếu lần thử này không được */
function build(cfg, rand) {
  const K = between(cfg.pieces, rand);
  const nLines = between(cfg.lines, rand);
  // Chọn hàng / cột
  const useCols = rand() < cfg.cross;
  const rows = new Set();
  const cols = new Set();
  for (let i = 0; i < nLines; i++) {
    const asCol = useCols ? (i % 2 === 1 || (rand() < 0.3 && i > 0)) : rand() < 0.35 && nLines === 1;
    const set = asCol ? cols : rows;
    let x = Math.floor(rand() * N);
    for (let t = 0; t < 10 && set.has(x); t++) x = Math.floor(rand() * N);
    set.add(x);
  }
  const inU = new Uint8Array(N * N);
  for (const r of rows) for (let c = 0; c < N; c++) inU[r * N + c] = 1;
  for (const c of cols) for (let r = 0; r < N; r++) inU[r * N + c] = 1;
  const U = inU.reduce((a, v) => a + v, 0);
  // Đặt khối trong vùng sẽ xóa
  const used = new Uint8Array(N * N);
  const placements = [];
  for (let k = 0; k < K; k++) {
    let ok = false;
    for (let t = 0; t < 200 && !ok; t++) {
      const s = pickShape(rand);
      const r = Math.floor(rand() * (N - s.h + 1));
      const c = Math.floor(rand() * (N - s.w + 1));
      const cells = s.cells.map(([dr, dc]) => (r + dr) * N + c + dc);
      if (cells.some((i) => !inU[i] || used[i])) continue;
      for (const i of cells) used[i] = 1;
      placements.push({ shape: s.id, r, c, cells });
      ok = true;
    }
    if (!ok) return null;
  }
  const covered = used.reduce((a, v) => a + v, 0);
  // Khối phải lấp ít nhất 30% vùng sẽ xóa (không thì bàn gần đầy sẵn, dễ quá) và chừa ít nhất 2 ô có sẵn khi nhiều khối
  if (covered < U * 0.3 || (K >= 3 && U - covered < 2)) return null;
  const board = new Array(N * N).fill(0);
  for (let i = 0; i < N * N; i++) if (inU[i] && !used[i]) board[i] = 1 + Math.floor(rand() * B.COLORS);
  // Thứ tự đặt: thử vài cách trộn tới khi đặt lần lượt dọn sạch bàn
  const colorOf = () => 1 + Math.floor(rand() * B.COLORS);
  for (let attempt = 0; attempt < 12; attempt++) {
    const order = shuffle(placements, rand);
    const p = {
      board: board.join(''),
      pieces: order.map((x) => [x.shape, colorOf()]),
      sol: order.map((x, k) => [k, x.r, x.c]),
    };
    // Màu ba khối một lượt khác nhau cho dễ nhìn
    for (let k = 1; k < p.pieces.length; k++) if (p.pieces[k][1] === p.pieces[k - 1][1]) p.pieces[k][1] = (p.pieces[k][1] % B.COLORS) + 1;
    if (!P.blocksVerify(p, p.sol)) continue;
    // Bàn có sẵn mà đã có hàng đầy (chưa đặt gì đã xóa) thì bỏ
    const full = B.fullLines(board);
    if (full.rows.length || full.cols.length) return null;
    // Đặt bất kỳ khối nào ở chỗ "đầu tiên đặt vừa" mà vẫn thắng thì dễ quá: bỏ
    if (K >= 2 && greedyWins(p)) return null;
    return { ...p, lines: nLines, K };
  }
  return null;
}

/** Cách chơi ẩu: lần lượt đặt mỗi khối vào chỗ trống đầu tiên vừa nó. Thắng được thì câu đố quá dễ */
function greedyWins(p) {
  let st = P.blocksStart(p);
  while (!st.won && !st.lost) {
    const slot = st.tray.findIndex(Boolean);
    const piece = st.tray[slot];
    let done = false;
    for (let r = 0; r < N && !done; r++) {
      for (let c = 0; c < N && !done; c++) {
        const res = B.canPlace(st.board, piece.shape, r, c) ? P.blocksPlace(p, st, slot, r, c) : null;
        if (res) {
          st = res.state;
          done = true;
        }
      }
    }
    if (!done) return false;
  }
  return st.won;
}

const keyOf = (p) => `${p.board}|${p.pieces.map((x) => x[0]).join(',')}`;

function make(cfg, count, rand, seen, prefix, start) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries < count * 4000) {
    tries++;
    const p = build(cfg, rand);
    if (!p || seen.has(keyOf(p))) continue;
    seen.add(keyOf(p));
    out.push(p);
  }
  // Trong chương: ít khối, ít hàng trước
  out.sort((a, b) => a.K - b.K || a.lines - b.lines);
  return out.map((p, i) => ({ id: `${prefix}${start + i + 1}`, board: p.board, pieces: p.pieces, sol: p.sol }));
}

function main() {
  const rand = rng(opt.seed + (opt.add ? Date.now() % 100000 : 0));
  const old = opt.add ? readData('blocks') : null;
  const seen = new Set();
  if (old) {
    for (const p of [...old.levels, ...old.daily]) seen.add(keyOf(p));
    const fresh = [];
    while (fresh.length < opt.add) fresh.push(...make(PLAN[PLAN.length - 1], Math.min(20, opt.add - fresh.length), rand, seen, 'b', old.levels.length + fresh.length));
    const data = appendLevels(old, fresh, (list) => {
      const out = [];
      for (let i = 0; i < list.length; i += 20) out.push({ name: `Thử thách thêm ${old.chapters.length + out.length - PLAN.length + 1}`, size: Math.min(20, list.length - i) });
      return out;
    });
    console.log(`Đã thêm ${fresh.length} màn (tổng ${data.levels.length}), ${writeData(data)} byte`);
    return;
  }
  const per = Math.floor(opt.levels / PLAN.length);
  const levels = [];
  const chapters = [];
  for (const cfg of PLAN) {
    const list = make(cfg, per, rand, seen, 'b', levels.length);
    levels.push(...list);
    chapters.push({ name: cfg.name, size: list.length });
  }
  const daily = make(DAILY, opt.daily, rand, seen, 'bd', 0);
  const data = { game: 'blocks', version: 1, chapters, levels, daily: shuffle(daily, rand).map((p, i) => ({ ...p, id: `bd${i + 1}` })) };
  console.log(`Xếp Khối: ${levels.length} màn, ${daily.length} quiz hằng ngày, ${writeData(data)} byte`);
}

main();
