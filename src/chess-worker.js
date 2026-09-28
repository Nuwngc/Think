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
async function runStockfish({ moves, skill, movetime }) {
  if (!sf) {
    startStockfish();
    const ok = sfUntil('uciok', 20000);
    sfSend('uci');
    await ok;
  }
  sfSend(`setoption name Skill Level value ${Math.max(0, Math.min(20, skill | 0))}`);
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

/* ---------------- Nhận việc từ máy chủ ---------------- */

parentPort.on('message', async (job) => {
  try {
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
