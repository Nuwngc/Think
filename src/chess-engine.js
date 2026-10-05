'use strict';
// Gửi việc "tìm nước đi" sang luồng máy cờ (src/chess-worker.js), từng việc một để không chiếm hết CPU.
const path = require('node:path');
const { Worker } = require('node:worker_threads');

let worker = null;
let seq = 0;
const pending = new Map(); // id -> { resolve, reject, timer }
let chain = Promise.resolve();

function failAll(err) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
    pending.delete(id);
  }
}

function ensureWorker() {
  if (worker) return worker;
  const w = new Worker(path.join(__dirname, 'chess-worker.js'), { resourceLimits: { maxOldGenerationSizeMb: 192 } });
  w.unref();
  w.on('message', (msg) => {
    const p = pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result !== undefined ? msg.result : msg.move);
  });
  // Luồng cũ (đã bị dừng vì treo) báo lỗi / thoát muộn: không được làm hỏng việc của luồng mới
  w.on('error', (err) => {
    console.warn('[chess] Luồng máy cờ lỗi:', err.message);
    if (worker !== w) return;
    worker = null;
    failAll(err);
  });
  w.on('exit', () => {
    if (worker !== w) return;
    worker = null;
    failAll(new Error('Luồng máy cờ đã dừng'));
  });
  worker = w;
  return w;
}

function runJob(job, timeoutMs) {
  return new Promise((resolve, reject) => {
    const w = ensureWorker();
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Máy cờ nghĩ quá lâu'));
      // Máy bị treo: dừng luồng, lần sau tạo lại
      if (worker === w) worker = null;
      w.terminate().catch(() => {});
    }, timeoutMs);
    timer.unref?.(); // việc đang chờ không giữ tiến trình sống (máy chủ đã có kết nối mạng giữ rồi)
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ ...job, id });
  });
}

/** Tìm nước đi (dạng UCI, vd "e2e4"). Các việc được xếp hàng, chạy lần lượt. */
function bestMove(job) {
  const timeoutMs = (job.movetime || 1000) + 15000;
  const result = chain.then(() => runJob(job, timeoutMs));
  chain = result.catch(() => {});
  return result;
}

/**
 * Chấm điểm một thế cờ bằng Stockfish mạnh nhất: { move, cp, mate, depth, pv, second? } (điểm theo bên đang đi).
 * multipv: 2 để lấy thêm nước tốt thứ nhì (second).
 */
function evaluate({ fen, moves, movetime, depth, fresh, searchmoves, multipv }) {
  return bestMove({ engine: 'stockfish-eval', fen, moves, movetime, depth, fresh, searchmoves, multipv });
}

function stop() {
  if (worker) worker.terminate().catch(() => {});
  worker = null;
  failAll(new Error('Đã dừng máy cờ'));
}

module.exports = { bestMove, evaluate, stop };
