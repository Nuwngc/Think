'use strict';
// Luồng riêng chạy các máy cờ vua, để lúc máy đang nghĩ nước đi thì chat vẫn chạy bình thường.
// Ba máy lấy từ GitHub:
//  - js-chess-engine  https://github.com/josefjadrny/js-chess-engine  (MIT)
//  - GarboChess-JS    https://github.com/glinscott/Garbochess-JS     (BSD, mã trong src/engines/garbochess.js)
//  - Stockfish 11     https://github.com/official-stockfish/Stockfish, bản JS/WASM https://github.com/nmrugg/stockfish.js (GPL-3.0)
const { parentPort } = require('node:worker_threads');
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
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sfWaiter = null;
      reject(new Error('Stockfish không trả lời (phân tích)'));
    }, Math.max(5000, movetime * 4 + 5000));
    sfWaiter = (text) => {
      if (text.startsWith('info') && / score /.test(text) && / pv /.test(text)) {
        const k = Number((/ multipv (\d+)/.exec(text) || [])[1] || 1);
        if (/ (lower|upper)bound/.test(text)) loose.set(k, text);
        else last.set(k, text);
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
    const second = parseInfo(last.get(2) || loose.get(2));
    // Dòng thứ nhì từ lượt tìm nông hơn nhiều (hết giờ giữa chừng) thì điểm chưa đáng tin: bỏ
    if (second && second.move && second.move !== out.move && second.depth >= out.depth - 2) {
      out.second = { move: second.move, cp: second.cp, mate: second.mate, depth: second.depth };
    }
  }
  return out;
}

/* ---------------- Nhận việc từ máy chủ ---------------- */

parentPort.on('message', async (job) => {
  try {
    if (job.engine === 'stockfish-eval') {
      parentPort.postMessage({ id: job.id, result: await evalStockfish(job) });
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
