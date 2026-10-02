'use strict';
// Tạo câu đố cờ caro: cho máy tự đánh với nhau (public/caro-core.js, nhiều mức), ở mỗi thế cờ tìm cách
// "thắng bằng tứ liên tục" (VCF) ngắn nhất cho bên sắp đi. Bên đó luôn được đổi thành X (bạn cầm X).
// Chỉ giữ thế cờ có ít cách thắng (1–2 nước đầu đúng) để câu đố không quá dễ.
//
//   node scripts/puzzles/caro.js                 tạo mới 200 màn + 150 quiz hằng ngày
//   node scripts/puzzles/caro.js --add 50        thêm 50 màn mới vào cuối (giữ nguyên màn cũ)
const CC = require('../../public/caro-core.js');
const P = require('../../public/puzzles-core.js');
const { rng, shuffle, readData, writeData, args, appendLevels } = require('./common');

const { X, O, CELLS, SIZE, winSquares, winSquaresThrough, makesFive, nearX, vcf } = P.caro;
const opt = args({ levels: 200, daily: 150, seed: 20261002, add: 0, minutes: 20 });

// Số màn mỗi chương (thử thách nhanh) theo số nước cần đi để thắng
const PLAN = [
  { name: 'Thắng ngay', n: [1], size: 20 },
  { name: 'Thắng trong 2 nước', n: [2], size: 20 },
  { name: 'Thắng trong 2 nước (khó hơn)', n: [2], size: 20 },
  { name: 'Thắng trong 3 nước', n: [3], size: 20 },
  { name: 'Thắng trong 3 nước (khó hơn)', n: [3], size: 20 },
  { name: 'Thắng trong 4 nước', n: [4], size: 20 },
  { name: 'Thắng trong 4 nước (khó hơn)', n: [4], size: 20 },
  { name: 'Thắng trong 5 nước', n: [5], size: 20 },
  { name: 'Thắng trong 5 nước (khó hơn)', n: [5, 6], size: 20 },
  { name: 'Cao thủ: 6–7 nước', n: [6, 7, 5], size: 20 },
];
const DAILY_N = [3, 4, 5];
const MAX_N = 7;

const swap = (board) => board.map((v) => (v === X ? O : v === O ? X : 0));

function randomNear(board, rand) {
  const list = CC.candidates(board);
  return list[Math.floor(rand() * list.length)];
}

/** Một ván máy tự đánh, trả về các thế cờ (đã đổi để bên sắp đi là X) */
function playGame(rand) {
  const levels = ['easy', 'easy', 'easy', 'medium', 'medium', 'hard'];
  const lv = { [X]: levels[Math.floor(rand() * levels.length)], [O]: levels[Math.floor(rand() * levels.length)] };
  let g = CC.newGame('free');
  const opening = 2 + Math.floor(rand() * 5);
  const out = [];
  while (!g.winner && g.moves.length < 110) {
    const side = CC.turnAfter(g.moves.length);
    if (g.moves.length >= 8) out.push(side === X ? g.board.slice() : swap(g.board));
    const move = g.moves.length === 0 ? 7 * SIZE + 7 : g.moves.length < opening ? randomNear(g.board, rand) : CC.bestMove(g, lv[side], rand);
    const next = CC.play(g, move);
    if (!next) break;
    g = next;
  }
  return out;
}

/** Số nước đầu tiên dẫn tới thắng trong n nước (để đo độ khó) */
function countSolutions(board, n) {
  if (n === 1) return winSquares(board, X).length;
  let count = 0;
  for (const c of nearX(board)) {
    const b = board.slice();
    b[c] = X;
    if (makesFive(board, c, X)) {
      count++;
      continue;
    }
    const w = winSquaresThrough(b, X, c);
    if (!w.length) continue;
    b[w[0]] = O;
    if (vcf(b, n - 1, 20000)) count++;
    if (count > 2) break;
  }
  return count;
}

function analyse(board) {
  if (winSquares(board, O).length) return null; // đối phương sắp có 5: phải chặn, không phải câu đố
  for (let n = 1; n <= MAX_N; n++) {
    const line = vcf(board, n, 20000);
    if (line) {
      const sols = countSolutions(board, n);
      if (n === 1 ? sols !== 1 : sols > (n >= 4 ? 3 : 2) || sols < 1) return null;
      const x = [];
      const o = [];
      board.forEach((v, i) => (v === X ? x.push(i) : v === O ? o.push(i) : 0));
      return { x, o, n, moves: line, sols };
    }
  }
  return null;
}

const keyOf = (p) => `${p.x.join(',')}|${p.o.join(',')}`;

function collect(need, seen, rand) {
  const byN = new Map();
  const deadline = Date.now() + opt.minutes * 60000;
  const wanted = (n) => (need.get(n) || 0) > (byN.get(n) || []).length;
  let games = 0;
  while (Date.now() < deadline && [...need.keys()].some(wanted)) {
    games++;
    const perGame = new Map();
    for (const board of playGame(rand)) {
      const p = analyse(board);
      if (!p || !wanted(p.n)) continue;
      const k = keyOf(p);
      if (seen.has(k) || (perGame.get(p.n) || 0) >= 1) continue;
      seen.add(k);
      perGame.set(p.n, (perGame.get(p.n) || 0) + 1);
      if (!byN.has(p.n)) byN.set(p.n, []);
      byN.get(p.n).push(p);
    }
    if (games % 20 === 0) console.log(`  ${games} ván: ${[...byN].map(([n, l]) => `${n} nước: ${l.length}`).join(', ')}`);
  }
  return byN;
}

/** Kiểm tra lại từng câu đố bằng chính luật dùng trong game */
function check(p) {
  const xs = p.moves.filter((_, i) => i % 2 === 0);
  if (!P.caroVerify(p, xs)) throw new Error(`Câu đố ${p.id} không giải được`);
  if (p.n > 1 && vcf(P.caro.board(p), p.n - 1, 200000)) throw new Error(`Câu đố ${p.id} thắng được sớm hơn`);
}

function finish(list, prefix, start) {
  return list.map((p, i) => {
    const out = { id: `${prefix}${start + i + 1}`, x: p.x, o: p.o, n: p.n, moves: p.moves };
    check(out);
    return out;
  });
}

// Trong một chương: dễ trước (nhiều cách thắng, ít quân trên bàn)
const easyFirst = (a, b) => b.sols - a.sols || a.x.length + a.o.length - (b.x.length + b.o.length);

function main() {
  const rand = rng(opt.seed + (opt.add ? Date.now() % 100000 : 0));
  const old = opt.add ? readData('caro') : null;
  const seen = new Set();
  if (old) for (const p of [...old.levels, ...old.daily]) seen.add(keyOf(p));

  if (old) {
    // Thêm màn: các chương khó (5–7 nước)
    const need = new Map([[5, Math.ceil(opt.add / 2)], [6, Math.ceil(opt.add / 4)], [7, Math.ceil(opt.add / 4)]]);
    const byN = collect(need, seen, rand);
    const fresh = finish([5, 6, 7].flatMap((n) => (byN.get(n) || []).slice(0, need.get(n))).slice(0, opt.add), 'k', old.levels.length);
    const data = appendLevels(old, fresh, (list) => {
      const out = [];
      for (let i = 0; i < list.length; i += 20) out.push({ name: `Thử thách thêm ${old.chapters.length + out.length - PLAN.length + 1}`, size: Math.min(20, list.length - i) });
      return out;
    });
    console.log(`Đã thêm ${fresh.length} màn (tổng ${data.levels.length}), ${writeData(data)} byte`);
    return;
  }

  const need = new Map();
  for (const ch of PLAN) for (const n of ch.n) need.set(n, (need.get(n) || 0) + Math.ceil(ch.size / ch.n.length) + 4);
  for (const n of DAILY_N) need.set(n, (need.get(n) || 0) + Math.ceil(opt.daily / DAILY_N.length) + 2);
  const byN = collect(need, seen, rand);
  for (const [n, l] of byN) byN.set(n, shuffle(l, rand));

  const levels = [];
  const chapters = [];
  for (const ch of PLAN) {
    const take = [];
    for (let k = 0; take.length < ch.size && k < ch.size * 2; k++) {
      const n = ch.n[k % ch.n.length];
      const l = byN.get(n) || [];
      if (l.length) take.push(l.shift());
    }
    take.sort(easyFirst);
    levels.push(...take);
    chapters.push({ name: ch.name, size: take.length });
  }
  // Quiz hằng ngày: chỉ những thế cờ có đúng một cách thắng, trộn lẫn độ khó
  const daily = [];
  for (let k = 0; daily.length < opt.daily && k < opt.daily * 4; k++) {
    const l = byN.get(DAILY_N[k % DAILY_N.length]) || [];
    const i = l.findIndex((p) => p.sols === 1);
    if (i >= 0) daily.push(l.splice(i, 1)[0]);
    else if (l.length) daily.push(l.shift());
  }
  const data = {
    game: 'caro',
    version: 1,
    chapters: chapters.filter((c) => c.size),
    levels: finish(levels, 'k', 0),
    daily: finish(shuffle(daily, rand), 'kd', 0),
  };
  console.log(`Cờ caro: ${data.levels.length} màn, ${data.daily.length} quiz hằng ngày, ${writeData(data)} byte`);
}

main();
