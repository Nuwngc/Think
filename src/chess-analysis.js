'use strict';
// Phân tích ván cờ đã xong bằng Stockfish (chạy trên máy chủ, lần lượt từng ván), kiểu "Game Review" của các trang cờ lớn:
// chấm điểm từng thế cờ (kèm nước tốt thứ nhì), tìm nước tốt nhất, xếp loại từng nước
// (thiên tài / tuyệt vời / tốt nhất / rất tốt / tốt / theo sách / thiếu chính xác / sai lầm / bỏ lỡ / sai lầm nghiêm trọng),
// nhận ra khai cuộc, và tính độ chính xác của mỗi bên. Kết quả lưu vào bảng chess_analysis nên mỗi ván chỉ phân tích một lần.
const { Chess } = require('chess.js');
const { get, all, run } = require('./db');
const engine = require('./chess-engine');
const openings = require('./chess-openings');

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
// Thời gian máy nghĩ cho mỗi thế cờ (ms); cả ván tối đa khoảng 90 giây
const PER_POSITION = Math.max(20, Number(process.env.THINK_CHESS_ANALYSIS_MS) || 400);
const TOTAL_BUDGET = Math.max(2000, Number(process.env.THINK_CHESS_ANALYSIS_BUDGET_MS) || 90000);
const MAX_QUEUE = 20;
const MAX_PER_USER = 3;

/* ---------------- Tính toán (dùng chung cho kiểm thử) ---------------- */

const VERSION = 2;
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// Các loại nước đi (giống trang cờ lớn), theo thứ tự hiện trong bảng tổng kết
const CLASSES = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

/** Khả năng thắng của Trắng (0–100) theo điểm máy chấm (cách tính của lichess) */
function winPercent({ cp, mate }) {
  if (mate != null) return mate > 0 ? 100 : 0;
  const c = Math.max(-1000, Math.min(1000, cp || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Độ chính xác của một nước theo mức tụt khả năng thắng (0–100), công thức của lichess */
function moveAccuracy(loss) {
  if (loss <= 0) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

/**
 * Xếp loại cơ bản theo mức tụt khả năng thắng của bên vừa đi (thang 0–100, giống ngưỡng "điểm kỳ vọng"):
 * tốt nhất · rất tốt < 2 · tốt < 5 · thiếu chính xác < 10 · sai lầm < 20 · sai lầm nghiêm trọng
 */
function classify(loss, isBest) {
  if (isBest || loss < 0.25) return 'best';
  if (loss < 2) return 'excellent';
  if (loss < 5) return 'good';
  if (loss < 10) return 'inaccuracy';
  if (loss < 20) return 'mistake';
  return 'blunder';
}

/**
 * Bên vừa đi có đang "thí quân" không: đối thủ ăn ngay được bao nhiêu quân (Mã/Tượng/Xe/Hậu, tính cả việc bị ăn lại),
 * trừ đi quân mình vừa ăn được bằng nước này. Trả về { net, piece }.
 */
function sacrificeOf(chessAfter, capturedValue, skipSquare = null) {
  let worst = 0;
  let piece = null;
  for (const m of chessAfter.moves({ verbose: true })) {
    if (!m.captured || m.captured === 'p' || m.captured === 'k' || m.to === skipSquare) continue;
    chessAfter.move({ from: m.from, to: m.to, promotion: m.promotion });
    const back = chessAfter.moves({ verbose: true }).some((r) => r.to === m.to);
    chessAfter.undo();
    const net = VALUE[m.captured] - (back ? VALUE[m.piece] : 0);
    if (net > worst) {
      worst = net;
      piece = m.captured;
    }
  }
  return { net: worst - capturedValue, piece };
}

/**
 * Quân khác (không phải quân sắp đi, ở ô from) của bên sắp đi đang bị bỏ ngỏ sẵn trước nước đi:
 * nếu bên đó "bỏ lượt" thì đối thủ ăn được bao nhiêu. Để không coi việc cứu một quân khỏi đòn bắt đôi
 * (quân kia vẫn mất) là "thí quân"; còn quân đang bị dọa mà cố tình đi vào chỗ khác cũng bị ăn thì vẫn là thí.
 */
function hangingBefore(chessBefore, fromSquare = null) {
  if (chessBefore.inCheck()) return 0; // đang bị chiếu thì không "bỏ lượt" được
  const parts = chessBefore.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  try {
    return Math.max(0, sacrificeOf(new Chess(parts.join(' ')), 0, fromSquare).net);
  } catch {
    return 0;
  }
}

/** Độ chính xác cả ván (cách của lichess): trung bình có trọng số theo độ biến động + trung bình điều hòa */
function gameAccuracy(wps, perMove) {
  const n = perMove.length;
  const out = { w: null, b: null };
  if (!n) return out;
  const size = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows = [];
  const head = wps.slice(0, size);
  for (let i = 0; i < size - 2; i++) windows.push(head);
  for (let i = 0; i + size <= wps.length; i++) windows.push(wps.slice(i, i + size));
  const std = (xs) => {
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  };
  const weights = windows.map((xs) => Math.max(0.5, Math.min(12, std(xs))));
  for (const color of ['w', 'b']) {
    let sw = 0;
    let swa = 0;
    let inv = 0;
    let count = 0;
    perMove.forEach((m, i) => {
      if (m.color !== color) return;
      const w = weights[Math.min(i, weights.length - 1)] || 1;
      sw += w;
      swa += w * m.acc;
      inv += 1 / Math.max(1, m.acc);
      count++;
    });
    if (!count) continue;
    const weighted = swa / sw;
    const harmonic = count / inv;
    out[color] = Math.round((weighted + harmonic) / 2);
  }
  return out;
}

const emptyCounts = () => Object.fromEntries(CLASSES.map((k) => [k, 0]));

/**
 * Gộp điểm từng thế cờ thành kết quả phân tích.
 * positions[i]: thế cờ sau i nước. wp = khả năng thắng của Trắng nếu đi nước tốt nhất (best, dạng UCI) từ thế đó;
 * second = nước tốt thứ nhì (cùng điểm wp của Trắng); playedWp = điểm sau nước thực sự đã đi, chấm từ cùng thế cờ đó.
 * book: sách khai cuộc (src/chess-openings.js) để nhận ra nước "theo sách" và tên khai cuộc.
 */
function summarize(moves, positions, { book = null } = {}) {
  const chess = new Chess();
  const out = [];
  const perMove = [];
  const counts = { w: emptyCounts(), b: emptyCounts() };
  let inBook = Boolean(book);
  let opening = null;
  let lastCapture = null; // ô vừa bị ăn quân ở nước trước (để nhận ra nước "ăn lại")
  for (let i = 0; i < moves.length; i++) {
    const color = chess.turn();
    const pov = (wp) => (color === 'w' ? wp : 100 - wp);
    const before = positions[i];
    const after = positions[i + 1];
    const legal = chess.moves().length;
    const p = UCI.exec(moves[i]);
    const threatened = legal > 1 ? hangingBefore(chess, p[1]) : 0;
    const r = chess.move({ from: p[1], to: p[2], promotion: p[3] });
    const fenAfter = chess.fen();
    const isBest = before.best != null && before.best === moves[i];
    const second = before.second && before.second.wp != null ? before.second : null;
    // Nước đã đi được chấm cùng thế cờ gốc với nước tốt nhất nên so sánh công bằng (không lệch vì độ sâu tìm kiếm)
    const playedWp = isBest
      ? before.wp
      : second && second.move === moves[i]
        ? second.wp
        : before.playedWp != null
          ? before.playedWp
          : after.wp;
    const wBefore = pov(before.wp);
    const wAfter = pov(playedWp);
    const loss = Math.max(0, wBefore - wAfter);
    let cls = classify(loss, isBest);
    const m = { ply: i + 1, uci: moves[i], san: r.san, color, cls, loss: Math.round(loss * 10) / 10 };

    // Nước theo sách khai cuộc (liền mạch từ đầu ván)
    if (inBook) {
      if (book.has(fenAfter) && cls !== 'blunder') {
        cls = 'book';
        const name = book.name(fenAfter);
        if (name) opening = { eco: name.eco, name: name.name, ply: i + 1 };
      } else inBook = false;
    }

    if (legal === 1) cls = 'forced';
    else if (cls !== 'book') {
      // Thiên tài: nước tốt nhất (hoặc gần như vậy) mà thí quân, sau đó thế cờ vẫn ổn,
      // và không phải thế đằng nào cũng thắng dễ (đi nước khác vẫn thắng đậm)
      if ((cls === 'best' || cls === 'excellent') && !r.promotion) {
        // Thí quân thật: sau nước đi mất thêm quân so với trước (trừ quân vừa ăn và quân đã bị dọa sẵn)
        const sac = sacrificeOf(chess, (r.captured ? VALUE[r.captured] : 0) + threatened);
        const easy = second ? pov(second.wp) >= 90 : wBefore >= 95;
        if (sac.net >= 2 && wAfter >= 45 && !easy) {
          cls = 'brilliant';
          m.sac = sac.piece;
        }
      }
      // Tuyệt vời: nước duy nhất giữ được thế cờ (nước tốt thứ nhì kém hẳn),
      // trừ nước ăn lại quân vừa bị ăn, nước ăn không một quân đang bị bỏ ngỏ và nước chiếu hết ngay (ai cũng thấy)
      if (cls === 'best' && second && !chess.isCheckmate()) {
        const gap = wBefore - pov(second.wp);
        const recapture = lastCapture === p[2];
        const freeGrab = r.captured && VALUE[r.captured] >= 3 && !chess.moves({ verbose: true }).some((x) => x.to === p[2]);
        if (gap >= 15 && !recapture && !freeGrab) {
          cls = 'great';
          m.gap = Math.round(gap);
        }
      }
      // Bỏ lỡ: đối thủ vừa đi sai mà mình không tận dụng (thế cờ trở lại như trước khi họ sai),
      // hoặc đang có đường chiếu hết mà đi nước khác
      if (cls === 'mistake' || cls === 'blunder' || cls === 'inaccuracy') {
        const prev = out[i - 1];
        const hadMate = before.mate != null && (color === 'w' ? before.mate > 0 : before.mate < 0);
        if (cls !== 'inaccuracy' && prev && prev.loss >= 10 && wAfter >= pov(positions[i - 1].wp) - 5) cls = 'miss';
        else if (hadMate && wAfter >= 60) cls = 'miss';
        if (hadMate) m.missedMate = Math.abs(before.mate);
      }
    }
    // Sau nước này đối thủ có đường chiếu hết (điểm của nước đã đi, theo Trắng)
    const playedMate = isBest ? before.mate : second && second.move === moves[i] ? second.mate : before.playedMate !== undefined ? before.playedMate : after.mate;
    if (playedMate != null && (color === 'w' ? playedMate < 0 : playedMate > 0) && !chess.isCheckmate()) m.allowsMate = Math.abs(playedMate);

    m.cls = cls;
    const acc = cls === 'book' || cls === 'forced' ? 100 : moveAccuracy(loss);
    m.accuracy = Math.round(acc);
    perMove.push({ color, acc });
    if (counts[color][cls] != null) counts[color][cls]++;
    out.push(m);
    lastCapture = r.captured ? p[2] : null;
  }
  return { moves: out, accuracy: gameAccuracy(positions.map((x) => x.wp), perMove), counts, opening };
}

/* ---------------- Cài vào máy chủ ---------------- */

function setupAnalysis({ app, auth, handle, mine, viewable, ChessError, emitTo, humanIds, movesOf }) {
  const queue = []; // id ván chờ phân tích
  let busy = false;

  const rowOf = (id) => get('SELECT * FROM chess_analysis WHERE game_id = ?', Number(id));

  // Kết quả phân tích bản cũ (1.8–1.9): xếp loại lại theo cách mới từ điểm đã lưu, rồi ghi lại
  function upgrade(row, g) {
    if (!row || row.status !== 'done' || !row.data || !g) return row;
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      return row;
    }
    if (data.version >= VERSION) return row;
    try {
      const summary = summarize(movesOf(g), data.positions, { book: openings.load() });
      const next = JSON.stringify({ ...data, ...summary, version: VERSION });
      run('UPDATE chess_analysis SET data = ? WHERE game_id = ?', next, row.game_id);
      return { ...row, data: next };
    } catch (err) {
      console.warn('[chess] Không nâng cấp được phân tích cũ:', err.message);
      return row;
    }
  }

  function publicOf(row, g) {
    if (!row) return { status: 'none', progress: 0, total: 0 };
    row = upgrade(row, g);
    const out = { status: row.status, progress: row.progress, total: row.total };
    if (row.status === 'queued') out.position = queue.indexOf(row.game_id) + 1;
    if (row.status === 'error') out.error = row.error || 'Phân tích bị lỗi.';
    if (row.status === 'done' && row.data) {
      try {
        out.result = JSON.parse(row.data);
      } catch {
        out.status = 'error';
        out.error = 'Dữ liệu phân tích hỏng.';
      }
    }
    return out;
  }

  function emit(g, row) {
    emitTo(humanIds(g), 'chess:analysis', { gameId: g.id, analysis: publicOf(row, g) });
  }

  function positionOf(chess) {
    // Hết ván ngay tại thế này: không cần máy chấm
    if (chess.isCheckmate()) return { cp: null, mate: null, wp: chess.turn() === 'w' ? 0 : 100, best: null, bestSan: null, end: 'checkmate' };
    if (chess.isDraw() || chess.isStalemate()) return { cp: 0, mate: null, wp: 50, best: null, bestSan: null, end: 'draw' };
    return null;
  }

  async function analyse(id) {
    const g = get('SELECT * FROM chess_games WHERE id = ?', id);
    if (!g) {
      run('DELETE FROM chess_analysis WHERE game_id = ?', id);
      return;
    }
    const moves = movesOf(g);
    const total = moves.length + 1;
    // Mỗi thế cờ chấm tối đa 2 lần (nước tốt nhất + nước đã đi)
    const movetime = Math.max(60, Math.min(PER_POSITION, Math.floor(TOTAL_BUDGET / (2 * moves.length + 1))));
    run("UPDATE chess_analysis SET status = 'running', progress = 0, total = ?, updated_at = ? WHERE game_id = ?", total, Date.now(), id);
    emit(g, rowOf(id));

    const chess = new Chess();
    const positions = [];
    let lastEmit = 0;
    for (let i = 0; i <= moves.length; i++) {
      if (i > 0) {
        const p = UCI.exec(moves[i - 1]);
        chess.move({ from: p[1], to: p[2], promotion: p[3] });
      }
      let pos = positionOf(chess);
      if (!pos) {
        const turn = chess.turn();
        const history = moves.slice(0, i);
        // Hai nước tốt nhất (MultiPV 2): biết được nước tốt nhất có phải "nước duy nhất" không
        const r = await engine.evaluate({ fen: chess.fen(), moves: history, movetime, fresh: i === 0, multipv: 2 });
        // Máy chấm theo bên đang đi: đổi về góc nhìn của Trắng
        const sign = turn === 'w' ? 1 : -1;
        const cp = r.cp != null ? r.cp * sign : null;
        const mate = r.mate != null ? r.mate * sign : null;
        const sanOf = (uci) => {
          if (!uci) return null;
          try {
            const probe = new Chess(chess.fen());
            const p = UCI.exec(uci);
            return probe.move({ from: p[1], to: p[2], promotion: p[3] }).san;
          } catch {
            return null;
          }
        };
        pos = { cp: cp == null && mate == null ? 0 : cp, mate, wp: 0, best: r.move, bestSan: sanOf(r.move), depth: r.depth };
        pos.wp = winPercent(pos);
        if (r.second && (r.second.cp != null || r.second.mate != null)) {
          const sc = r.second.cp != null ? r.second.cp * sign : null;
          const sm = r.second.mate != null ? r.second.mate * sign : null;
          pos.second = { move: r.second.move, san: sanOf(r.second.move), cp: sc, mate: sm, wp: Math.round(winPercent({ cp: sc, mate: sm }) * 10) / 10 };
        }
        // Nước thực sự đã đi khác hai nước máy chọn: chấm riêng nước đó từ cùng thế cờ
        const played = moves[i];
        if (played && played !== r.move && !(pos.second && pos.second.move === played)) {
          const q = await engine.evaluate({ fen: chess.fen(), moves: history, movetime, searchmoves: [played] });
          if (q.cp != null || q.mate != null) {
            pos.playedCp = q.cp != null ? q.cp * sign : null;
            pos.playedMate = q.mate != null ? q.mate * sign : null;
            pos.playedWp = Math.round(winPercent({ cp: pos.playedCp, mate: pos.playedMate }) * 10) / 10;
          }
        }
      }
      pos.wp = Math.round(pos.wp * 10) / 10;
      positions.push(pos);
      const now = Date.now();
      if (now - lastEmit > 700 || i === moves.length) {
        lastEmit = now;
        run('UPDATE chess_analysis SET progress = ?, updated_at = ? WHERE game_id = ?', i + 1, now, id);
        emit(g, rowOf(id));
      }
    }
    const summary = summarize(moves, positions, { book: openings.load() });
    const data = {
      version: VERSION,
      engine: 'Stockfish 11',
      movetime,
      positions,
      ...summary,
    };
    run("UPDATE chess_analysis SET status = 'done', progress = total, data = ?, error = NULL, updated_at = ? WHERE game_id = ?", JSON.stringify(data), Date.now(), id);
    emit(g, rowOf(id));
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const id = queue[0];
        try {
          await analyse(id);
        } catch (err) {
          console.warn('[chess] Phân tích ván lỗi:', err.message);
          run("UPDATE chess_analysis SET status = 'error', error = ?, updated_at = ? WHERE game_id = ?", 'Máy phân tích gặp lỗi. Thử lại sau nhé.', Date.now(), id);
          const g = get('SELECT * FROM chess_games WHERE id = ?', id);
          if (g) emit(g, rowOf(id));
        }
        queue.shift();
        // Báo lại vị trí trong hàng đợi cho các ván còn chờ
        for (const other of queue) {
          const g = get('SELECT * FROM chess_games WHERE id = ?', other);
          if (g) emit(g, rowOf(other));
        }
      }
    } finally {
      busy = false;
    }
  }

  // Chạy hàng đợi; lỗi bất ngờ chỉ ghi log, không làm sập máy chủ
  function run_() {
    pump().catch((err) => {
      busy = false;
      console.warn('[chess] Hàng đợi phân tích lỗi:', err.message);
    });
  }

  app.get('/api/chess/games/:id/analysis', ...auth, handle((req, res) => {
    // Ván được chia sẻ: ai xem ván cũng xem được phân tích (chỉ người chơi mới yêu cầu phân tích)
    const g = viewable(req, req.params.id);
    res.json({ analysis: publicOf(rowOf(g.id), g) });
  }));

  app.post('/api/chess/games/:id/analysis', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    if (g.white_id !== req.user.id && g.black_id !== req.user.id) throw new ChessError(403, 'Bạn không chơi ván này.');
    if (g.status !== 'finished') throw new ChessError(409, 'Chỉ phân tích được ván đã kết thúc.');
    if (movesOf(g).length < 2) throw new ChessError(409, 'Ván này chưa có đủ nước đi để phân tích.');
    const row = rowOf(g.id);
    if (row && (row.status === 'done' || row.status === 'queued' || row.status === 'running')) {
      return res.json({ analysis: publicOf(row, g) });
    }
    if (queue.length >= MAX_QUEUE) throw new ChessError(429, 'Máy đang bận phân tích nhiều ván. Thử lại sau ít phút nhé.');
    const mineQueued = get(
      "SELECT COUNT(*) AS n FROM chess_analysis WHERE requested_by = ? AND status IN ('queued', 'running')",
      req.user.id
    ).n;
    if (mineQueued >= MAX_PER_USER) throw new ChessError(429, 'Bạn đang chờ phân tích 3 ván rồi. Đợi xong rồi thêm ván khác nhé.');
    const now = Date.now();
    run(
      `INSERT INTO chess_analysis (game_id, status, progress, total, requested_by, created_at, updated_at)
       VALUES (?, 'queued', 0, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET status = 'queued', progress = 0, total = excluded.total, error = NULL, data = NULL,
         requested_by = excluded.requested_by, updated_at = excluded.updated_at`,
      g.id, movesOf(g).length + 1, req.user.id, now, now
    );
    queue.push(g.id);
    const out = publicOf(rowOf(g.id), g);
    emit(g, rowOf(g.id));
    run_();
    res.json({ analysis: out });
  }));

  // Máy chủ vừa khởi động lại: phân tích tiếp các ván đang chờ
  for (const row of all("SELECT game_id FROM chess_analysis WHERE status IN ('queued', 'running') ORDER BY created_at")) {
    run("UPDATE chess_analysis SET status = 'queued', progress = 0 WHERE game_id = ?", row.game_id);
    queue.push(row.game_id);
  }
  if (queue.length) setTimeout(run_, 3000).unref?.();
}

module.exports = { setupAnalysis, winPercent, moveAccuracy, classify, summarize, sacrificeOf, hangingBefore, gameAccuracy, CLASSES, VERSION };
