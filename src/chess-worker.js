'use strict';
// Luồng riêng chạy các máy cờ vua, để lúc máy đang nghĩ nước đi thì chat vẫn chạy bình thường.
// Ba máy lấy từ GitHub:
//  - js-chess-engine  https://github.com/josefjadrny/js-chess-engine  (MIT)
//  - GarboChess-JS    https://github.com/glinscott/Garbochess-JS     (BSD, mã trong src/engines/garbochess.js)
//  - Stockfish 11     https://github.com/official-stockfish/Stockfish, bản JS/WASM https://github.com/nmrugg/stockfish.js (GPL-3.0)
// Máy có tính cách (engine 'style', src/chess-bots.js): Stockfish xem vài nước tốt nhất rồi chọn theo gu riêng (runStyle).
const { parentPort, isMainThread } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* ---------------- js-chess-engine ---------------- */

let jce = null;
function runJce({ fen, level, randomness }) {
  if (!jce) jce = require('js-chess-engine');
  const res = jce.ai(fen, { level, play: false, randomness: randomness || 0 });
  const [from, to] = Object.entries(res.move || {})[0] || [];
  if (!from || !to) throw new Error('js-chess-engine không trả về nước đi');
  return `${from}${to}`.toLowerCase(); // phong cấp tự thành Hậu (máy chủ tự thêm)
}

/* ---------------- GarboChess ---------------- */

let garboOut = null;
let garboLoaded = false;
function loadGarbo() {
  const file = path.join(__dirname, 'engines', 'garbochess.js');
  // Bảng băm nhỏ lại (mặc định 4 triệu ô ~ vài chục MB) cho hợp máy chủ miễn phí
  const src = fs.readFileSync(file, 'utf8').replace('var g_hashSize = 1 << 22;', 'var g_hashSize = 1 << 18;');
  globalThis.self = globalThis;
  globalThis.postMessage = (msg) => {
    if (typeof msg === 'string' && !msg.startsWith('pv ') && !msg.startsWith('message ')) garboOut = msg;
  };
  vm.runInThisContext(src, { filename: 'garbochess.js' });
  garboLoaded = true;
}
function runGarbo({ fen, movetime }) {
  if (!garboLoaded) loadGarbo();
  garboOut = null;
  globalThis.self.onmessage({ data: `position ${fen}` });
  globalThis.self.onmessage({ data: `search ${Math.max(50, movetime | 0)}` });
  if (!garboOut || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(garboOut)) throw new Error('GarboChess không trả về nước đi');
  return garboOut;
}

/* ---------------- Stockfish ---------------- */

let sf = null;
let sfWaiter = null;
function startStockfish() {
  // Bản WASM cũ gọi fetch() để đọc file .wasm khi thấy có fetch: tắt đi để nó đọc thẳng từ ổ đĩa
  delete globalThis.fetch;
  const STOCKFISH = require('stockfish');
  sf = STOCKFISH();
  sf.onmessage = (line) => {
    const text = typeof line === 'string' ? line : line && line.data;
    if (sfWaiter && typeof text === 'string') sfWaiter(text);
  };
}
function sfSend(cmd) {
  sf.postMessage(cmd);
}
function sfUntil(prefix, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sfWaiter = null;
      reject(new Error(`Stockfish không trả lời (${prefix})`));
    }, timeoutMs);
    sfWaiter = (text) => {
      if (text.startsWith(prefix)) {
        clearTimeout(timer);
        sfWaiter = null;
        resolve(text);
      }
    };
  });
}
async function ensureStockfish() {
  if (sf) return;
  startStockfish();
  const ok = sfUntil('uciok', 20000);
  sfSend('uci');
  await ok;
}
async function runStockfish({ moves, skill, movetime }) {
  await ensureStockfish();
  sfSend(`setoption name Skill Level value ${Math.max(0, Math.min(20, skill | 0))}`);
  sfSend('setoption name MultiPV value 1');
  sfSend(`position startpos${moves && moves.length ? ` moves ${moves.join(' ')}` : ''}`);
  const ready = sfUntil('readyok', 10000);
  sfSend('isready');
  await ready;
  const done = sfUntil('bestmove', Math.max(5000, movetime * 4 + 5000));
  sfSend(`go movetime ${Math.max(50, movetime | 0)}`);
  const line = await done;
  const move = line.split(/\s+/)[1];
  if (!move || move === '(none)') throw new Error('Stockfish không có nước đi');
  return move;
}

// Đọc một dòng "info ..." của Stockfish: điểm (theo bên đang đi), độ sâu, dãy nước chính
function parseInfo(text) {
  if (!text) return null;
  const out = { move: null, cp: null, mate: null, depth: 0, pv: [] };
  const cp = / score cp (-?\d+)/.exec(text);
  const mate = / score mate (-?\d+)/.exec(text);
  const depth = / depth (\d+)/.exec(text);
  const pv = / pv (.+)$/.exec(text);
  if (cp) out.cp = Number(cp[1]);
  if (mate) out.mate = Number(mate[1]);
  if (depth) out.depth = Number(depth[1]);
  if (pv) {
    // Bản Stockfish này ghi thêm "bmc ..." sau dãy nước: chỉ lấy các nước đi hợp lệ ở đầu
    const list = pv[1].trim().split(/\s+/);
    const end = list.findIndex((m) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
    out.pv = (end < 0 ? list : list.slice(0, end)).slice(0, 6);
    out.move = out.pv[0] || null;
  }
  return out;
}

// Chấm điểm một thế cờ (phân tích ván): nước tốt nhất và điểm đánh giá, tính theo bên đang đi.
// multipv = 2: trả thêm nước tốt thứ nhì (second), để biết nước tốt nhất có phải "nước duy nhất" không.
async function evalStockfish({ fen, moves, movetime, depth, fresh, searchmoves, multipv }) {
  await ensureStockfish();
  sfSend('setoption name Skill Level value 20');
  const lines = Math.max(1, Math.min(3, Number(multipv) || 1));
  sfSend(`setoption name MultiPV value ${lines}`);
  if (fresh) sfSend('ucinewgame');
  // Có danh sách nước từ đầu ván thì gửi cả lịch sử, để máy biết thế cờ lặp lại (hòa 3 lần)
  sfSend(Array.isArray(moves) ? `position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}` : `position fen ${fen}`);
  const ready = sfUntil('readyok', 10000);
  sfSend('isready');
  await ready;
  // Dòng mới nhất cho từng hạng (multipv 1, 2…); dòng "lowerbound/upperbound" là điểm tạm, chỉ dùng khi không có gì khác
  const last = new Map();
  const loose = new Map();
  const seen = []; // mọi dòng "info … pv" đầy đủ, theo thứ tự (bàn phân tích)
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sfWaiter = null;
      reject(new Error('Stockfish không trả lời (phân tích)'));
    }, Math.max(5000, movetime * 4 + 5000));
    sfWaiter = (text) => {
      if (text.startsWith('info') && / score /.test(text) && / pv /.test(text)) {
        const k = Number((/ multipv (\d+)/.exec(text) || [])[1] || 1);
        if (/ (lower|upper)bound/.test(text)) loose.set(k, text);
        else {
          last.set(k, text);
          seen.push(text);
        }
      } else if (text.startsWith('bestmove')) {
        clearTimeout(timer);
        sfWaiter = null;
        resolve(text);
      }
    };
  });
  // searchmoves: chỉ xét các nước này (để chấm đúng nước đã đi, cùng thế cờ gốc với nước tốt nhất)
  const only = Array.isArray(searchmoves) && searchmoves.length ? ` searchmoves ${searchmoves.filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)).join(' ')}` : '';
  sfSend(`go${depth ? ` depth ${depth | 0}` : ''} movetime ${Math.max(30, movetime | 0)}${only}`);
  const line = await done;
  if (lines > 1) sfSend('setoption name MultiPV value 1');
  const best = line.split(/\s+/)[1];
  const top = parseInfo(last.get(1) || loose.get(1));
  const out = { move: best && best !== '(none)' ? best : null, cp: null, mate: null, depth: 0, pv: [] };
  if (top) {
    out.cp = top.cp;
    out.mate = top.mate;
    out.depth = top.depth;
    out.pv = top.pv;
  }
  if (lines > 1) {
    // Bàn phân tích: mọi dòng (nước tốt nhất, nhì, ba…) kèm dãy nước chính. Stockfish in các dòng thành từng đợt
    // (multipv 1, 2, 3 liền nhau, là một lần xếp hạng các nước): lấy đợt đầy đủ cuối cùng, không trộn các đợt với nhau
    const batches = [];
    for (const text of seen) {
      const info = parseInfo(text);
      if (!info || !info.move) continue;
      const k = Number((/ multipv (\d+)/.exec(text) || [])[1] || 1);
      if (k === 1 || !batches.length) batches.push([]);
      batches[batches.length - 1].push(info);
    }
    const most = Math.max(0, ...batches.map((b) => new Set(b.map((i) => i.move)).size));
    const pick = [...batches].reverse().find((b) => b.length >= most && new Set(b.map((i) => i.move)).size === b.length) || [];
    out.lines = pick.map((i) => ({ move: i.move, cp: i.cp, mate: i.mate, depth: i.depth, pv: i.pv }));
    const second = parseInfo(last.get(2) || loose.get(2));
    // Dòng thứ nhì từ lượt tìm nông hơn nhiều (hết giờ giữa chừng) thì điểm chưa đáng tin: bỏ
    if (second && second.move && second.move !== out.move && second.depth >= out.depth - 2) {
      out.second = { move: second.move, cp: second.cp, mate: second.mate, depth: second.depth };
    }
  }
  return out;
}

/* ---------------- Máy có tính cách ---------------- */

// Stockfish xem `lines` nước tốt nhất ở độ sâu `depth`; điểm theo bên đang đi (chiếu hết quy ra điểm rất lớn)
async function sfCandidates({ moves, depth, movetime, lines }) {
  await ensureStockfish();
  sfSend('setoption name Skill Level value 20');
  sfSend(`setoption name MultiPV value ${Math.max(1, Math.min(12, lines | 0))}`);
  sfSend(`position startpos${moves && moves.length ? ` moves ${moves.join(' ')}` : ''}`);
  const ready = sfUntil('readyok', 10000);
  sfSend('isready');
  await ready;
  const last = new Map();
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sfWaiter = null;
      reject(new Error('Stockfish không trả lời (máy có tính cách)'));
    }, Math.max(6000, movetime * 4 + 6000));
    sfWaiter = (text) => {
      if (text.startsWith('info') && / score /.test(text) && / pv /.test(text) && !/ (lower|upper)bound/.test(text)) {
        last.set(Number((/ multipv (\d+)/.exec(text) || [])[1] || 1), text);
      } else if (text.startsWith('bestmove')) {
        clearTimeout(timer);
        sfWaiter = null;
        resolve(text);
      }
    };
  });
  sfSend(`go depth ${Math.max(1, depth | 0)} movetime ${Math.max(60, movetime | 0)}`);
  const line = await done;
  sfSend('setoption name MultiPV value 1');
  const out = [];
  const seen = new Set();
  for (const k of [...last.keys()].sort((a, b) => a - b)) {
    const info = parseInfo(last.get(k));
    if (!info || !info.move || seen.has(info.move)) continue;
    seen.add(info.move);
    out.push({ move: info.move, score: info.mate != null ? (info.mate > 0 ? 100000 - info.mate * 100 : -100000 - info.mate * 100) : info.cp ?? 0, mate: info.mate });
  }
  const best = line.split(/\s+/)[1];
  if (!out.length && best && best !== '(none)') out.push({ move: best, score: 0, mate: null });
  return out;
}

const VAL = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 0 };
const fileIdx = (sq) => sq.charCodeAt(0) - 97;
const rankIdx = (sq) => Number(sq[1]) - 1;
const near = (a, b) => Math.max(Math.abs(fileIdx(a) - fileIdx(b)), Math.abs(rankIdx(a) - rankIdx(b)));

/** Điểm cộng theo gu của máy cho nước `m` (nước dạng chi tiết của chess.js), tính theo 1/100 tốt */
function styleBonus(styleId, m, ctx) {
  const check = m.san.includes('+') || m.san.includes('#');
  const forward = m.color === 'w' ? rankIdx(m.to) - rankIdx(m.from) : rankIdx(m.from) - rankIdx(m.to);
  switch (styleId) {
    case 'pawns':
      return m.piece === 'p' ? 70 + (m.flags.includes('b') ? 15 : 0) : 0;
    case 'knights':
      return m.piece === 'n' ? 80 + (m.captured ? 20 : 0) : 0;
    case 'queen':
      return (m.piece === 'q' ? 70 : 0) + (check ? 40 : 0) + (m.captured ? 30 : 0);
    case 'defend': {
      let v = 0;
      if (m.flags.includes('k') || m.flags.includes('q')) v += 150; // nhập thành
      if (m.captured && m.piece !== 'p' && VAL[m.captured] >= VAL[m.piece]) v += 50; // đổi quân
      if (m.piece === 'q') v -= 30;
      if (forward < 0) v += 10;
      return v;
    }
    case 'trick':
      return (check ? 70 : 0) + (m.captured ? 30 : 0);
    case 'bishops':
      return (m.piece === 'b' ? 60 : 0) + (m.captured === 'b' && m.piece !== 'b' ? -40 : 0);
    case 'storm': {
      let v = 0;
      const d = ctx.enemyKing ? near(m.to, ctx.enemyKing) : 9;
      if (d <= 2) v += 50;
      else if (d <= 3) v += 25;
      if (check) v += 40;
      if (m.piece === 'p' && ctx.enemyKing && Math.abs(fileIdx(m.to) - fileIdx(ctx.enemyKing)) <= 1 && forward > 0) v += 30;
      return v;
    }
    default:
      return 0;
  }
}

/** Chọn ngẫu nhiên theo trọng số */
function pickWeighted(items, weights, random) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

let ChessLib = null;
/**
 * Chọn nước cho máy có tính cách. Trả về { move, cp } (cp: điểm thế cờ theo máy, trước khi đi; null nếu không biết).
 * random: hàm số ngẫu nhiên (kiểm thử truyền hàm cố định).
 */
async function runStyle(job, random = Math.random, candidatesFn = sfCandidates) {
  if (!ChessLib) ChessLib = require('chess.js').Chess;
  const chess = new ChessLib();
  for (const u of job.moves || []) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
  const legal = chess.moves({ verbose: true });
  if (!legal.length) throw new Error('Không còn nước đi');
  const byUci = new Map(legal.map((m) => [`${m.from}${m.to}${m.promotion || ''}`, m]));
  const me = chess.turn();
  let enemyKing = null;
  for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color !== me) enemyKing = p.square;
  const ctx = { enemyKing, ply: (job.moves || []).length };
  const flair = Number.isFinite(job.flair) ? job.flair : 1;
  const bonus = (m) => flair * styleBonus(job.style, m, ctx);

  const cands = (await candidatesFn(job)).filter((c) => byUci.has(c.move) || byUci.has(c.move.slice(0, 4) + 'q'));
  const top = cands[0] || null;
  const cp = top ? (top.mate != null ? (top.mate > 0 ? 2000 : -2000) : top.score) : null;
  // Thấy chiếu hết gần (≤ 2 nước) thì máy từ 1100 ELO trở lên không đi bừa
  const mateSoon = top && top.mate != null && top.mate > 0 && top.mate <= 2;
  if (!cands.length || (random() < (job.blunder || 0) && !(mateSoon && job.elo >= 1100))) {
    // Đi bừa nhưng vẫn theo gu; phong cấp thì vẫn lên Hậu (trừ máy "đi đâu cũng được")
    const pool = job.style === 'random' ? legal : legal.filter((m) => !m.promotion || m.promotion === 'q');
    const weights = pool.map((m) => Math.exp(Math.max(-200, Math.min(300, bonus(m))) / 80));
    const m = pickWeighted(pool, weights, random);
    return { move: `${m.from}${m.to}${m.promotion || ''}`, cp };
  }
  const temp = Math.max(1, job.temp || 1);
  const scored = cands.map((c) => {
    const m = byUci.get(c.move) || byUci.get(c.move.slice(0, 4) + 'q');
    // Đầu ván: thêm chút ngẫu nhiên để mỗi ván một khác
    const noise = ctx.ply < 16 ? (random() - 0.5) * 30 : 0;
    return { uci: `${m.from}${m.to}${m.promotion || ''}`, s: c.score + bonus(m) + noise };
  });
  const max = Math.max(...scored.map((x) => x.s));
  const pick = pickWeighted(scored, scored.map((x) => Math.exp((x.s - max) / temp)), random);
  return { move: pick.uci, cp };
}

/* ---------------- Nhận việc từ máy chủ ---------------- */

// Nạp bằng require (kiểm thử): chỉ xuất hàm, không nghe việc
if (isMainThread) module.exports = { runStyle, styleBonus };
else parentPort.on('message', async (job) => {
  try {
    if (job.engine === 'stockfish-eval') {
      parentPort.postMessage({ id: job.id, result: await evalStockfish(job) });
      return;
    }
    if (job.engine === 'style') {
      parentPort.postMessage({ id: job.id, result: await runStyle(job) });
      return;
    }
    let move;
    if (job.engine === 'jce') move = runJce(job);
    else if (job.engine === 'garbo') move = runGarbo(job);
    else if (job.engine === 'stockfish') move = await runStockfish(job);
    else throw new Error(`Không có máy ${job.engine}`);
    parentPort.postMessage({ id: job.id, move });
  } catch (err) {
    parentPort.postMessage({ id: job.id, error: String((err && err.message) || err) });
  }
});
