'use strict';
// Tạo câu đố cờ vua: cho máy yếu (js-chess-engine) tự đánh từ các khai cuộc trong sách (src/chess-openings.tsv),
// rồi cho Stockfish xem từng thế cờ để tìm chỗ "chiếu hết sau 1–3 nước" hoặc "thắng quân" mà chỉ có MỘT nước đúng.
// Chiếu hết 1–2 nước được kiểm chứng lại bằng cách thử hết mọi nước (chess.js).
//
//   node scripts/puzzles/chess.js               tạo mới 200 màn + 150 quiz hằng ngày
//   node scripts/puzzles/chess.js --add 50      thêm 50 màn mới vào cuối (giữ nguyên màn cũ)
// Chạy song song cho nhanh (mỗi tiến trình một hạt giống, ghi ra kho tạm), rồi gộp lại:
//   node scripts/puzzles/chess.js --seed 1 --out /tmp/a.json & node scripts/puzzles/chess.js --seed 2 --out /tmp/b.json
//   node scripts/puzzles/chess.js --from /tmp/a.json,/tmp/b.json
const fs = require('node:fs');
const path = require('node:path');
const { Chess } = require('chess.js');
const P = require('../../public/puzzles-core.js');
const { ROOT, rng, shuffle, readData, writeData, args, appendLevels } = require('./common');

const opt = args({ levels: 200, daily: 150, seed: 20261003, add: 0, minutes: 40, depth: 11 });

const PLAN = [
  { name: 'Chiếu hết 1 nước', kind: 'm1', size: 20 },
  { name: 'Chiếu hết 1 nước (tiếp)', kind: 'm1', size: 20 },
  { name: 'Thắng quân', kind: 't', size: 20 },
  { name: 'Chiếu hết 1 nước (khó)', kind: 'm1', size: 20 },
  { name: 'Chiếu hết 2 nước', kind: 'm2', size: 20 },
  { name: 'Chiếu hết 2 nước (tiếp)', kind: 'm2', size: 20 },
  { name: 'Thắng quân (khó)', kind: 't', size: 20 },
  { name: 'Chiếu hết 2 nước (khó)', kind: 'm2', size: 20 },
  { name: 'Chiếu hết 3 nước', kind: 'm3', size: 20 },
  { name: 'Chiếu hết 3 nước (khó)', kind: 'm3', size: 20 },
];
const DAILY = { m2: 0.45, m3: 0.3, t: 0.25 };

/* ---------------- Stockfish (bản WASM trong node_modules/stockfish) ---------------- */

let sf = null;
let waiter = null;
function sfStart() {
  delete globalThis.fetch; // bản WASM cũ: đọc file .wasm từ ổ đĩa
  sf = require('stockfish')();
  sf.onmessage = (line) => {
    const text = typeof line === 'string' ? line : line && line.data;
    if (waiter && typeof text === 'string') waiter(text);
  };
}
const send = (cmd) => sf.postMessage(cmd);
function until(prefix, onLine) {
  return new Promise((resolve) => {
    waiter = (text) => {
      if (onLine) onLine(text);
      if (text.startsWith(prefix)) {
        waiter = null;
        resolve(text);
      }
    };
  });
}
async function sfInit() {
  sfStart();
  const ok = until('uciok');
  send('uci');
  await ok;
  send('setoption name Hash value 32');
}

/** Phân tích: hai dòng tốt nhất { move, cp, mate, pv } theo bên đang đi */
async function analyse(fen, depth = opt.depth, multipv = 2) {
  send(`setoption name MultiPV value ${multipv}`);
  send(`position fen ${fen}`);
  const ready = until('readyok');
  send('isready');
  await ready;
  const lines = new Map();
  const done = until('bestmove', (text) => {
    if (!text.startsWith('info') || !/ pv /.test(text) || / (lower|upper)bound/.test(text)) return;
    const k = Number((/ multipv (\d+)/.exec(text) || [])[1] || 1);
    const cp = / score cp (-?\d+)/.exec(text);
    const mate = / score mate (-?\d+)/.exec(text);
    const d = Number((/ depth (\d+)/.exec(text) || [])[1] || 0);
    const list = / pv (.+)$/.exec(text)[1].trim().split(/\s+/);
    const end = list.findIndex((m) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
    const pv = end < 0 ? list : list.slice(0, end);
    lines.set(k, { cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, depth: d, pv, move: pv[0] });
  });
  send(`go depth ${depth}`);
  await done;
  return [lines.get(1) || null, lines.get(2) || null];
}

/* ---------------- Ván máy tự đánh ---------------- */

const BOOK = fs
  .readFileSync(path.join(ROOT, 'src', 'chess-openings.tsv'), 'utf8')
  .split('\n')
  .map((l) => l.split('\t')[2])
  .filter((m) => m && m.split(' ').length >= 4)
  .map((m) => m.split(' '));

let jce = null;
function jceMove(fen, level, rand) {
  if (!jce) jce = require('js-chess-engine');
  const res = jce.ai(fen, { level, play: false, randomness: Math.floor(rand() * 30) });
  const [from, to] = Object.entries(res.move || {})[0] || [];
  return from && to ? `${from}${to}`.toLowerCase() : null;
}

const uciOf = (m) => `${m.from}${m.to}${m.promotion || ''}`;
function play(c, uci) {
  try {
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  } catch {
    return null;
  }
}

/** Các thế cờ của một ván: { fen, last } (last: nước vừa đi của đối thủ) */
function playGame(rand) {
  const c = new Chess();
  const line = BOOK[Math.floor(rand() * BOOK.length)];
  for (const m of line) if (!play(c, m)) break;
  const lv = { w: 1 + Math.floor(rand() * 2), b: 1 + Math.floor(rand() * 2) };
  const out = [];
  let last = null;
  for (let ply = 0; ply < 120 && !c.isGameOver(); ply++) {
    if (c.history().length >= 12) out.push({ fen: c.fen(), last });
    let uci = null;
    if (rand() < 0.08) {
      const moves = c.moves({ verbose: true });
      uci = uciOf(moves[Math.floor(rand() * moves.length)]);
    } else uci = jceMove(c.fen(), lv[c.turn()], rand);
    const mv = uci && play(c, uci);
    if (!mv) break;
    last = uciOf(mv);
  }
  return out;
}

/* ---------------- Kiểm chứng ---------------- */

const mates = (c) => c.moves().filter((s) => s.endsWith('#'));

/** Mọi nước trả lời của đối phương đều bị chiếu hết ngay */
function forcedMate1(c) {
  const replies = c.moves({ verbose: true });
  if (!replies.length) return c.isCheckmate();
  for (const r of replies) {
    c.move(r);
    const ok = mates(c).length > 0;
    c.undo();
    if (!ok) return false;
  }
  return true;
}

/** Số nước đầu tiên chiếu hết được trong 2 nước (thử hết) */
function mate2Keys(fen) {
  const c = new Chess(fen);
  let keys = 0;
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const ok = c.isCheckmate() || forcedMate1(c);
    c.undo();
    if (ok) keys++;
  }
  return keys;
}

/** Đi theo dãy nước, true nếu cuối cùng chiếu hết */
function endsInMate(fen, line) {
  const c = new Chess(fen);
  for (const m of line) if (!play(c, m)) return false;
  return c.isCheckmate();
}

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function material(c, side) {
  let s = 0;
  for (const row of c.board()) for (const p of row) if (p) s += (p.color === side ? 1 : -1) * VALUE[p.type];
  return s;
}

/** Thử biến một thế cờ thành câu đố. kind: m1 | m2 | m3 | t */
async function toPuzzle(pos, prevEval, [a, b]) {
  if (!a || !a.move) return null;
  const c = new Chess(pos.fen);
  const side = c.turn();
  // Chiếu hết
  if (a.mate && a.mate > 0 && a.mate <= 3) {
    const n = a.mate;
    if (n > 1 && b && b.mate && b.mate > 0 && b.mate <= n) return null; // có nước khác cũng chiếu hết nhanh như vậy
    let line = a.pv.slice(0, 2 * n - 1);
    if (line.length < 2 * n - 1 || !endsInMate(pos.fen, line)) return null;
    if (n === 1) {
      if (mates(c).length > 2) return null;
    } else if (n === 2) {
      if (mate2Keys(pos.fen) !== 1) return null;
    } else {
      // Chiếu hết 3 nước: nước thứ hai của mình cũng phải là nước duy nhất
      const cc = new Chess(pos.fen);
      play(cc, line[0]);
      play(cc, line[1]);
      const [a2, b2] = await analyse(cc.fen(), opt.depth + 2);
      if (!a2 || a2.mate !== 2 || (b2 && b2.mate && b2.mate > 0 && b2.mate <= 2)) return null;
      line = [line[0], line[1], ...a2.pv.slice(0, 3)];
      if (line.length < 5 || !endsInMate(pos.fen, line) || mate2Keys(cc.fen()) !== 1) return null;
    }
    // Ván đã thắng sẵn từ lâu (hơn cả xe) thì không hay
    if (Math.abs(material(c, side)) > 12) return null;
    return { kind: `m${n}`, fen: pos.fen, last: pos.last, goal: 'mate', n, moves: line, check: new Chess(pos.fen).move(line[0]).san.includes('+') };
  }
  // Thắng quân: đối phương vừa đi hỏng (trước đó thế cờ cân bằng), chỉ có một nước trừng phạt
  if (a.cp == null || a.cp < 250 || a.cp > 1200 || !b || (b.mate != null && b.mate > 0) || (b.cp != null && b.cp > Math.min(100, a.cp - 220))) return null;
  if (prevEval == null || Math.abs(prevEval) > 120) return null;
  const key = c.move({ from: a.move.slice(0, 2), to: a.move.slice(2, 4), promotion: a.move[4] || undefined });
  c.undo();
  if (pos.last && key.captured && key.to === pos.last.slice(2, 4)) return null; // chỉ là ăn lại quân: dễ quá
  let line = [a.move];
  if (!key.captured && a.pv.length >= 3) {
    // Nước đầu không ăn quân (bắt đôi, ghim…): thêm nước ăn quân sau khi đối phương đáp
    const cc = new Chess(pos.fen);
    play(cc, a.pv[0]);
    play(cc, a.pv[1]);
    const [a2, b2] = await analyse(cc.fen());
    const cap = a2 && a2.move && cc.moves({ verbose: true }).find((m) => uciOf(m) === a2.move || `${m.from}${m.to}` === a2.move);
    if (!cap || !cap.captured || a2.cp == null || (b2 && b2.cp != null && b2.cp > a2.cp - 150)) return null;
    line = [a.pv[0], a.pv[1], a2.move];
  }
  return { kind: 't', fen: pos.fen, last: pos.last, goal: 'win', n: Math.ceil(line.length / 2), moves: line, check: key.san.includes('+') };
}

/* ---------------- Gom câu đố ---------------- */

async function collect(need, seen, rand) {
  const got = { m1: [], m2: [], m3: [], t: [] };
  const deadline = Date.now() + opt.minutes * 60000;
  const wanted = (k) => got[k].length < (need[k] || 0);
  let games = 0;
  while (Date.now() < deadline && Object.keys(need).some(wanted)) {
    games++;
    let prev = null;
    let taken = 0;
    for (const pos of playGame(rand)) {
      const key = pos.fen.split(' ').slice(0, 2).join(' ');
      if (seen.has(key) || taken >= 2) {
        prev = null;
        continue;
      }
      // Lọc nhanh: Stockfish nông, một dòng; chỉ thế cờ đáng ngờ mới phân tích kỹ (hai dòng, sâu hơn)
      const [quick] = await analyse(pos.fen, 8, 1);
      const before = prev;
      prev = quick && quick.cp != null ? quick.cp : null;
      const c = new Chess(pos.fen);
      const m1 = wanted('m1') && mates(c).length > 0;
      const hot = quick && ((quick.mate && quick.mate > 0 && quick.mate <= 3) || (quick.cp != null && quick.cp >= 230 && before != null && Math.abs(before) <= 140));
      if (!m1 && !hot) continue;
      const p = await toPuzzle(pos, before, await analyse(pos.fen));
      if (!p || !wanted(p.kind)) continue;
      seen.add(key);
      got[p.kind].push(p);
      taken++;
    }
    if (games % 5 === 0) {
      console.log(`  ${games} ván: ${Object.entries(got).map(([k, l]) => `${k} ${l.length}`).join(', ')}`);
      if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(got)); // lưu dần, lỡ bị dừng giữa chừng vẫn còn
    }
  }
  return got;
}

function finish(list, prefix, start) {
  return list.map((p, i) => {
    const out = { id: `${prefix}${start + i + 1}`, fen: p.fen, last: p.last, goal: p.goal, n: p.n, moves: p.moves };
    const mine = out.moves.filter((_, k) => k % 2 === 0);
    if (!P.chessVerify(out, mine, Chess)) throw new Error(`Câu đố ${out.id} không giải được`);
    return out;
  });
}

// Dễ trước: nước đầu là chiếu, ít quân
const easyFirst = (a, b) => Number(b.check) - Number(a.check) || a.fen.split(' ')[0].replace(/[^a-z]/gi, '').length - b.fen.split(' ')[0].replace(/[^a-z]/gi, '').length;

async function main() {
  const rand = rng(opt.seed + (opt.add ? Date.now() % 100000 : 0));
  if (!opt.from) await sfInit();
  const old = opt.add ? readData('chess') : null;
  const seen = new Set();
  if (old) for (const p of [...old.levels, ...old.daily]) seen.add(p.fen.split(' ').slice(0, 2).join(' '));
  if (old) {
    const need = { m2: Math.ceil(opt.add / 2), m3: Math.ceil(opt.add / 4), t: Math.ceil(opt.add / 4) };
    const got = await collect(need, seen, rand);
    const fresh = finish(shuffle([...got.m2, ...got.m3, ...got.t], rand).slice(0, opt.add), 'c', old.levels.length);
    const data = appendLevels(old, fresh, (list) => {
      const out = [];
      for (let i = 0; i < list.length; i += 20) out.push({ name: `Thử thách thêm ${old.chapters.length + out.length - PLAN.length + 1}`, size: Math.min(20, list.length - i) });
      return out;
    });
    console.log(`Đã thêm ${fresh.length} màn (tổng ${data.levels.length}), ${writeData(data)} byte`);
    process.exit(0);
  }
  const need = { m1: 0, m2: 0, m3: 0, t: 0 };
  for (const ch of PLAN) need[ch.kind] += ch.size + 3;
  for (const [k, f] of Object.entries(DAILY)) need[k] += Math.ceil(opt.daily * f) + 2;
  let got;
  if (opt.from) {
    // Gộp các kho tạm (bỏ thế cờ trùng)
    got = { m1: [], m2: [], m3: [], t: [] };
    for (const file of String(opt.from).split(',')) {
      const part = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const k of Object.keys(got)) for (const p of part[k] || []) {
        const key = p.fen.split(' ').slice(0, 2).join(' ');
        if (!seen.has(key)) {
          seen.add(key);
          got[k].push(p);
        }
      }
    }
  } else {
    got = await collect(need, seen, rand);
    if (opt.out) {
      fs.writeFileSync(opt.out, JSON.stringify(got));
      console.log(`Đã ghi kho tạm ${opt.out}: ${Object.entries(got).map(([k, l]) => `${k} ${l.length}`).join(', ')}`);
      process.exit(0);
    }
  }
  for (const k of Object.keys(got)) got[k] = shuffle(got[k], rand);
  // Thiếu loại nào thì lấy loại gần nó bù vào
  const fallback = { m1: ['m2'], m2: ['m1', 'm3'], m3: ['m2'], t: ['m2', 'm1'] };
  const take = (kind) => got[kind].shift() || fallback[kind].map((k) => got[k].shift()).find(Boolean) || null;
  const levels = [];
  const chapters = [];
  for (const ch of PLAN) {
    const list = [];
    for (let i = 0; i < ch.size; i++) {
      const p = take(ch.kind);
      if (p) list.push(p);
    }
    list.sort(easyFirst);
    levels.push(...list);
    chapters.push({ name: ch.name, size: list.length });
  }
  const daily = [];
  for (const [k, f] of Object.entries(DAILY)) for (let i = 0; i < Math.round(opt.daily * f); i++) {
    const p = take(k);
    if (p) daily.push(p);
  }
  const data = {
    game: 'chess',
    version: 1,
    chapters: chapters.filter((c) => c.size),
    levels: finish(levels, 'c', 0),
    daily: finish(shuffle(daily, rand), 'cd', 0),
  };
  console.log(`Cờ vua: ${data.levels.length} màn, ${data.daily.length} quiz hằng ngày, ${writeData(data)} byte`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
