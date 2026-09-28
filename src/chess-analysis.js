'use strict';
// Phân tích ván cờ đã xong bằng Stockfish (chạy trên máy chủ, lần lượt từng ván):
// chấm điểm từng thế cờ, tìm nước tốt nhất, xếp loại từng nước (tốt nhất / thiếu chính xác / sai lầm / sai lầm nghiêm trọng)
// và tính độ chính xác của mỗi bên. Kết quả lưu vào bảng chess_analysis nên mỗi ván chỉ phân tích một lần.
const { Chess } = require('chess.js');
const { get, all, run } = require('./db');
const engine = require('./chess-engine');

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
// Thời gian máy nghĩ cho mỗi thế cờ (ms); cả ván tối đa khoảng 90 giây
const PER_POSITION = Math.max(20, Number(process.env.THINK_CHESS_ANALYSIS_MS) || 400);
const TOTAL_BUDGET = Math.max(2000, Number(process.env.THINK_CHESS_ANALYSIS_BUDGET_MS) || 90000);
const MAX_QUEUE = 20;
const MAX_PER_USER = 3;

/* ---------------- Tính toán (dùng chung cho kiểm thử) ---------------- */

/** Khả năng thắng của Trắng (0–100) theo điểm máy chấm (cách tính của lichess) */
function winPercent({ cp, mate }) {
  if (mate != null) return mate > 0 ? 100 : 0;
  const c = Math.max(-1000, Math.min(1000, cp || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Độ chính xác của một nước theo mức tụt khả năng thắng (0–100) */
function moveAccuracy(loss) {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

/** Xếp loại nước đi theo mức tụt khả năng thắng của bên vừa đi */
function classify(loss, isBest) {
  if (isBest) return 'best';
  if (loss >= 15) return 'blunder';
  if (loss >= 10) return 'mistake';
  if (loss >= 5) return 'inaccuracy';
  return 'good';
}

/**
 * Gộp điểm từng thế cờ thành kết quả phân tích.
 * positions[i]: thế cờ sau i nước. wp = khả năng thắng của Trắng nếu đi nước tốt nhất (best, dạng UCI) từ thế đó;
 * playedWp = khả năng thắng của Trắng sau nước thực sự đã đi, máy chấm từ cùng thế cờ đó (nếu khác nước tốt nhất).
 */
function summarize(moves, positions) {
  const chess = new Chess();
  const out = [];
  const acc = { w: [], b: [] };
  const counts = { w: { best: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, b: { best: 0, inaccuracy: 0, mistake: 0, blunder: 0 } };
  for (let i = 0; i < moves.length; i++) {
    const color = chess.turn();
    const before = positions[i];
    const after = positions[i + 1];
    const p = UCI.exec(moves[i]);
    const r = chess.move({ from: p[1], to: p[2], promotion: p[3] });
    const isBest = before.best != null && before.best === moves[i];
    // Nước đã đi được chấm cùng thế cờ gốc với nước tốt nhất nên so sánh công bằng (không lệch vì độ sâu tìm kiếm)
    const afterWp = isBest ? before.wp : before.playedWp != null ? before.playedWp : after.wp;
    const wBefore = color === 'w' ? before.wp : 100 - before.wp;
    const wAfter = color === 'w' ? afterWp : 100 - afterWp;
    const loss = Math.max(0, wBefore - wAfter);
    const cls = classify(loss, isBest);
    const a = moveAccuracy(loss);
    acc[color].push(a);
    if (counts[color][cls] != null) counts[color][cls]++;
    out.push({ ply: i + 1, uci: moves[i], san: r.san, color, cls, loss: Math.round(loss * 10) / 10, accuracy: Math.round(a) });
  }
  const mean = (list) => (list.length ? Math.round(list.reduce((s, x) => s + x, 0) / list.length) : null);
  return { moves: out, accuracy: { w: mean(acc.w), b: mean(acc.b) }, counts };
}

/* ---------------- Cài vào máy chủ ---------------- */

function setupAnalysis({ app, auth, handle, mine, ChessError, emitTo, humanIds, movesOf }) {
  const queue = []; // id ván chờ phân tích
  let busy = false;

  const rowOf = (id) => get('SELECT * FROM chess_analysis WHERE game_id = ?', Number(id));

  function publicOf(row) {
    if (!row) return { status: 'none', progress: 0, total: 0 };
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
    emitTo(humanIds(g), 'chess:analysis', { gameId: g.id, analysis: publicOf(row) });
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
        const r = await engine.evaluate({ fen: chess.fen(), moves: history, movetime, fresh: i === 0 });
        // Máy chấm theo bên đang đi: đổi về góc nhìn của Trắng
        const sign = turn === 'w' ? 1 : -1;
        const cp = r.cp != null ? r.cp * sign : null;
        const mate = r.mate != null ? r.mate * sign : null;
        let bestSan = null;
        if (r.move) {
          try {
            const probe = new Chess(chess.fen());
            const p = UCI.exec(r.move);
            bestSan = probe.move({ from: p[1], to: p[2], promotion: p[3] }).san;
          } catch {
            bestSan = null;
          }
        }
        pos = { cp: cp == null && mate == null ? 0 : cp, mate, wp: 0, best: r.move, bestSan, depth: r.depth };
        pos.wp = winPercent(pos);
        // Nước thực sự đã đi khác nước tốt nhất: chấm riêng nước đó từ cùng thế cờ
        const played = moves[i];
        if (played && played !== r.move) {
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
    const summary = summarize(moves, positions);
    const data = {
      version: 1,
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
    const g = mine(req, req.params.id);
    res.json({ analysis: publicOf(rowOf(g.id)) });
  }));

  app.post('/api/chess/games/:id/analysis', ...auth, handle((req, res) => {
    const g = mine(req, req.params.id);
    if (g.white_id !== req.user.id && g.black_id !== req.user.id) throw new ChessError(403, 'Bạn không chơi ván này.');
    if (g.status !== 'finished') throw new ChessError(409, 'Chỉ phân tích được ván đã kết thúc.');
    if (movesOf(g).length < 2) throw new ChessError(409, 'Ván này chưa có đủ nước đi để phân tích.');
    const row = rowOf(g.id);
    if (row && (row.status === 'done' || row.status === 'queued' || row.status === 'running')) {
      return res.json({ analysis: publicOf(row) });
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
    const out = publicOf(rowOf(g.id));
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

module.exports = { setupAnalysis, winPercent, moveAccuracy, classify, summarize };
