'use strict';
/* Câu đố của Cờ vua, Xếp Khối, Cờ caro: "Quiz hằng ngày" (mỗi ngày một câu, cả nhóm cùng giải) và
   "Thử thách nhanh" (200 màn, thêm được). File này chỉ có luật: kiểm tra từng nước người chơi đi,
   máy đáp lại, gợi ý, và kiểm tra cả lời giải (máy chủ dùng để chấm lời giải gửi lên).
   Dùng chung cho trang web, máy chủ (src/puzzles.js) và kiểm thử.
   App Think Beta có bản TypeScript giống hệt: native/src/puzzles/core.ts (có kiểm thử so khớp).

   Dữ liệu màn chơi: public/puzzles/<game>.json (tạo bằng scripts/puzzles/build.js)
     { game, version, chapters: [{ name, size }], levels: [câu đố…], daily: [câu đố…] }
   Câu đố cờ vua:  { id, fen, last, goal: 'mate'|'win', n, moves: [uci của người chơi, uci máy đáp, …] }
   Câu đố Xếp Khối: { id, board: 64 chữ số màu 0–7, pieces: [[hình, màu]…], sol: [[k, hàng, cột]…] }
   Câu đố cờ caro: { id, x: [ô…], o: [ô…], n, moves: [x1, o1, x2, …] } — bạn cầm X, luật tự do. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuzzlesCore = api;
})(typeof self !== 'undefined' ? self : this, (root) => {
  const GAMES = ['chess', 'blocks', 'caro'];
  const NAMES = { chess: 'Cờ vua', blocks: 'Xếp Khối', caro: 'Cờ caro' };
  const TZ = 7 * 3600 * 1000;
  const EPOCH = Date.UTC(2026, 0, 1); // ngày số 0 của quiz hằng ngày

  /* ---------------- Ngày, quiz hằng ngày, sao ---------------- */

  /** Ngày theo giờ Việt Nam, dạng 2026-10-02 */
  const dayKey = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);
  const dayNumber = (day) => Math.round((Date.parse(`${day}T00:00:00Z`) - EPOCH) / 86400000);
  /** Câu đố thứ mấy trong danh sách quiz hằng ngày (cả nhóm cùng một câu mỗi ngày) */
  const dailyIndex = (day, count) => (count > 0 ? ((dayNumber(day) % count) + count) % count : -1);
  /** Số sao: không sai, không gợi ý = 3; sai / gợi ý tổng cộng tối đa 2 lần = 2; còn lại = 1 */
  function stars(mistakes, hints) {
    const bad = Math.max(0, mistakes | 0) + Math.max(0, hints | 0);
    return bad === 0 ? 3 : bad <= 2 ? 2 : 1;
  }

  const req = (name) => (typeof require === 'function' ? require(name) : null);
  const blocksCore = () => (root && root.BlocksCore) || req('./blocks-core.js');

  /* =================== Cờ vua =================== */

  const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
  const applyUci = (c, uci) => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });

  function chessStart(p) {
    return { fen: p.fen, ply: 0, done: false, last: p.last || null, history: [] };
  }

  /** Bên đi trước trong câu đố ('w' | 'b') */
  const chessSide = (p) => (String(p.fen).split(' ')[1] === 'b' ? 'b' : 'w');

  /**
   * Người chơi đi nước `uci`. Đúng: trả về thế cờ sau nước đó (midFen), nước máy đáp (reply) và trạng thái mới.
   * Sai (hoặc không hợp lệ): ok = false, trạng thái giữ nguyên. Nước chiếu hết cuối cùng: chiếu hết kiểu nào cũng được.
   * Chess: lớp Chess của thư viện chess.js (web tải riêng, máy chủ require).
   */
  function chessTry(p, st, uci, Chess) {
    if (!st || st.done || typeof uci !== 'string' || !UCI.test(uci)) return { ok: false, illegal: true, state: st };
    const c = new Chess(st.fen);
    let mv = null;
    try {
      mv = applyUci(c, uci);
    } catch {
      mv = null;
    }
    if (!mv) return { ok: false, illegal: true, state: st };
    const played = `${mv.from}${mv.to}${mv.promotion || ''}`;
    const isLast = st.ply === p.moves.length - 1;
    const ok = played === p.moves[st.ply] || (isLast && p.goal === 'mate' && c.isCheckmate());
    if (!ok) return { ok: false, played, state: st };
    const midFen = c.fen();
    let ply = st.ply + 1;
    let reply = null;
    if (ply < p.moves.length) {
      reply = p.moves[ply];
      applyUci(c, reply);
      ply++;
    }
    const done = ply >= p.moves.length;
    const history = st.history.concat(played, reply ? [reply] : []);
    return { ok: true, played, reply, midFen, done, state: { fen: c.fen(), ply, done, last: reply || played, history } };
  }

  /** Gợi ý: ô của quân cần đi (level 1) hoặc cả nước đi (level 2) */
  function chessHint(p, st, level = 1) {
    if (!st || st.done) return null;
    const m = p.moves[st.ply];
    return level >= 2 ? m : m.slice(0, 2);
  }

  /** Kiểm tra cả lời giải: các nước của người chơi theo thứ tự */
  function chessVerify(p, moves, Chess) {
    if (!Array.isArray(moves)) return false;
    let st = chessStart(p);
    for (const m of moves) {
      const r = chessTry(p, st, m, Chess);
      if (!r.ok) return false;
      st = r.state;
    }
    return st.done;
  }

  function chessGoal(p) {
    const side = chessSide(p) === 'w' ? 'Trắng' : 'Đen';
    if (p.goal === 'mate') return p.n === 1 ? `${side} đi — chiếu hết ngay` : `${side} đi — chiếu hết sau ${p.n} nước`;
    return `${side} đi — tìm nước thắng quân`;
  }

  /* =================== Xếp Khối =================== */

  const pieceOf = (p, k) => (k < p.pieces.length ? { shape: p.pieces[k][0], color: p.pieces[k][1], k } : null);
  const trayFrom = (p, from) => [0, 1, 2].map((j) => pieceOf(p, from + j));

  function blocksStart(p) {
    const board = String(p.board).split('').map(Number);
    return { board, tray: trayFrom(p, 0), next: Math.min(3, p.pieces.length), used: 0, history: [], won: false, lost: false };
  }

  /**
   * Đặt khối ở ô tray[slot] vào (r, c). Đặt hết 3 khối thì hiện 3 khối tiếp theo (theo thứ tự của câu đố).
   * Thắng: đặt hết các khối và bàn trống trơn. Thua: đặt hết mà còn ô, hoặc không khối nào đặt vừa.
   */
  function blocksPlace(p, st, slot, r, c) {
    const B = blocksCore();
    const piece = st && st.tray[slot];
    if (!piece || st.won || st.lost || !Number.isInteger(r) || !Number.isInteger(c) || !B.canPlace(st.board, piece.shape, r, c)) return null;
    const N = B.SIZE;
    const s = B.shapeOf(piece.shape);
    const board = st.board.slice();
    const placed = s.cells.map(([dr, dc]) => (r + dr) * N + c + dc);
    for (const i of placed) board[i] = piece.color;
    const { rows, cols } = B.fullLines(board);
    const cleared = new Set();
    for (const row of rows) for (let j = 0; j < N; j++) cleared.add(row * N + j);
    for (const col of cols) for (let j = 0; j < N; j++) cleared.add(j * N + col);
    const clearedCells = [...cleared].map((i) => ({ i, color: board[i] }));
    for (const i of cleared) board[i] = 0;
    let tray = st.tray.map((x, k) => (k === slot ? null : x));
    let next = st.next;
    let refilled = false;
    if (tray.every((x) => !x) && next < p.pieces.length) {
      tray = trayFrom(p, next);
      next = Math.min(next + 3, p.pieces.length);
      refilled = true;
    }
    const used = st.used + 1;
    const allUsed = used >= p.pieces.length;
    const won = allUsed && board.every((v) => !v);
    const stuck = !allUsed && tray.every((x) => !x || !B.fitsAnywhere(board, x.shape));
    const lost = (allUsed && !won) || stuck;
    const state = { board, tray, next, used, history: st.history.concat([[piece.k, r, c]]), won, lost };
    return { state, placed, rows, cols, clearedCells, lines: rows.length + cols.length, refilled, won, lost, stuck };
  }

  /** Gợi ý nước tiếp theo theo lời giải (chỉ khi đang đi đúng lời giải; lệch rồi thì null: nên làm lại) */
  function blocksHint(p, st) {
    if (!st || st.won || st.lost || !Array.isArray(p.sol)) return null;
    for (let i = 0; i < st.history.length; i++) {
      const a = st.history[i];
      const b = p.sol[i];
      if (!b || a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return null;
    }
    const nx = p.sol[st.history.length];
    if (!nx) return null;
    const slot = st.tray.findIndex((x) => x && x.k === nx[0]);
    return slot < 0 ? null : { slot, k: nx[0], r: nx[1], c: nx[2] };
  }

  function blocksVerify(p, moves) {
    if (!Array.isArray(moves)) return false;
    let st = blocksStart(p);
    for (const m of moves) {
      if (!Array.isArray(m) || m.length !== 3) return false;
      const slot = st.tray.findIndex((x) => x && x.k === m[0]);
      const r = slot < 0 ? null : blocksPlace(p, st, slot, m[1], m[2]);
      if (!r) return false;
      st = r.state;
    }
    return st.won;
  }

  const blocksGoal = (p) => `Đặt hết ${p.pieces.length} khối để dọn sạch bàn`;

  /* =================== Cờ caro =================== */
  // Bàn 15×15, bạn cầm X và đi trước, luật tự do (5 quân trở lên là thắng).
  // Mỗi nước (trừ nước thắng) phải tạo "tứ" — đối phương buộc phải chặn —, đến khi có 5 quân.

  const SIZE = 15;
  const CELLS = SIZE * SIZE;
  const X = 1;
  const O = 2;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const inside = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;

  /** Đặt quân p ở ô trống i thì có 5 quân liền nhau không */
  function makesFive(board, i, p) {
    const r0 = Math.floor(i / SIZE);
    const c0 = i % SIZE;
    for (const [dr, dc] of DIRS) {
      let n = 1;
      for (let k = 1; k < 5 && inside(r0 + dr * k, c0 + dc * k) && board[(r0 + dr * k) * SIZE + c0 + dc * k] === p; k++) n++;
      for (let k = 1; k < 5 && inside(r0 - dr * k, c0 - dc * k) && board[(r0 - dr * k) * SIZE + c0 - dc * k] === p; k++) n++;
      if (n >= 5) return true;
    }
    return false;
  }

  /** Các ô trống mà p đi vào là có 5 quân (cả bàn) */
  function winSquares(board, p) {
    const out = [];
    for (let i = 0; i < CELLS; i++) if (!board[i] && makesFive(board, i, p)) out.push(i);
    return out;
  }

  /** Các ô trống thắng của p trên 4 đường qua ô i (sau khi p vừa đi vào i) — tăng dần */
  function winSquaresThrough(board, p, i) {
    const r0 = Math.floor(i / SIZE);
    const c0 = i % SIZE;
    const out = new Set();
    for (const [dr, dc] of DIRS) {
      for (let k = -4; k <= 4; k++) {
        if (!k) continue;
        const r = r0 + dr * k;
        const c = c0 + dc * k;
        if (!inside(r, c)) continue;
        const j = r * SIZE + c;
        if (!board[j] && makesFive(board, j, p)) out.add(j);
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  /** Ô trống cách một quân X không quá 4 ô theo hàng ngang / dọc / chéo (chỉ những ô này mới tạo được tứ) */
  function nearX(board) {
    const seen = new Uint8Array(CELLS);
    const out = [];
    for (let i = 0; i < CELLS; i++) {
      if (board[i] !== X) continue;
      const r0 = Math.floor(i / SIZE);
      const c0 = i % SIZE;
      for (const [dr, dc] of DIRS) {
        for (let k = -4; k <= 4; k++) {
          const r = r0 + dr * k;
          const c = c0 + dc * k;
          if (!k || !inside(r, c)) continue;
          const j = r * SIZE + c;
          if (!board[j] && !seen[j]) {
            seen[j] = 1;
            out.push(j);
          }
        }
      }
    }
    return out.sort((a, b) => a - b);
  }

  /**
   * Thắng bằng tứ liên tục (VCF): X đi tối đa `budget` nước, nước nào cũng tạo tứ (O buộc phải chặn), nước cuối có 5 quân.
   * Trả về dãy [x1, o1, x2, …, xk] hoặc null. limit: số thế cờ tối đa được xét (tránh nghĩ quá lâu).
   */
  function vcf(board, budget, limit = 50000) {
    const ctx = { left: limit };
    return vcfInner(board.slice(), budget, ctx);
  }
  /** Như vcf, kèm cho biết đã tìm hết chưa (exhausted = hết lượt tìm mà chưa kết luận được) */
  function vcfStatus(board, budget, limit) {
    const ctx = { left: limit };
    const line = vcfInner(board.slice(), budget, ctx);
    return { line, exhausted: !line && ctx.left < 0 };
  }
  function vcfInner(board, budget, ctx) {
    if (budget < 1 || --ctx.left < 0) return null;
    const xw = winSquares(board, X);
    if (xw.length) return [xw[0]];
    if (budget < 2 || winSquares(board, O).length) return null;
    // Thử trước các nước tạo hai tứ cùng lúc (chắc thắng)
    const tries = [];
    for (const c of nearX(board)) {
      board[c] = X;
      const w = winSquaresThrough(board, X, c);
      board[c] = 0;
      if (w.length) tries.push({ c, w });
    }
    tries.sort((a, b) => b.w.length - a.w.length || a.c - b.c);
    for (const { c, w } of tries) {
      board[c] = X;
      const b = w[0];
      board[b] = O;
      const rest = vcfInner(board, budget - 1, ctx);
      board[b] = 0;
      board[c] = 0;
      if (rest) return [c, b, ...rest];
      if (ctx.left < 0) return null;
    }
    return null;
  }

  function caroBoard(p) {
    const board = new Array(CELLS).fill(0);
    for (const i of p.x) board[i] = X;
    for (const i of p.o) board[i] = O;
    return board;
  }

  function caroStart(p) {
    return { board: caroBoard(p), xs: [], history: [], done: false, won: false, last: null };
  }

  const followsSolution = (p, st) => st.history.every((m, i) => p.moves[i] === m);

  /**
   * Người chơi (X) đi vào ô i. Đúng: nước thắng ngay, hoặc tạo tứ mà vẫn thắng được trong số nước còn lại
   * (máy cầm O chặn tứ, trả về ở `reply`). Sai: ok = false, bàn giữ nguyên (reason: 'taken' | 'not-four' | 'no-win').
   * Nước khác lời giải: tìm nhanh (tối đa `limit` thế cờ, để máy yếu không bị đứng); tìm chưa xong thì cho đi tiếp.
   * check = false (máy chủ kiểm tra cả dãy nước): không tìm, chỉ cần mỗi nước tạo tứ và cuối cùng có 5 quân.
   */
  function caroTry(p, st, i, limit = 2000, check = true) {
    if (!st || st.done || !Number.isInteger(i) || i < 0 || i >= CELLS) return { ok: false, reason: 'taken', state: st };
    if (st.board[i]) return { ok: false, reason: 'taken', state: st };
    const left = p.n - st.xs.length; // số nước X còn được đi (tính cả nước này)
    if (left < 1) return { ok: false, reason: 'no-win', state: st };
    const board = st.board.slice();
    const o5 = winSquares(board, O).length > 0;
    board[i] = X;
    if (makesFive(board, i, X)) {
      const state = { board, xs: st.xs.concat(i), history: st.history.concat(i), done: true, won: true, last: i };
      return { ok: true, won: true, done: true, reply: null, state };
    }
    if (o5 || left < 2) return { ok: false, reason: 'no-win', state: st }; // O sắp có 5 / hết nước: phải thắng ngay
    const w = winSquaresThrough(board, X, i);
    if (!w.length) return { ok: false, reason: 'not-four', state: st };
    const b = w[0];
    board[b] = O;
    const onPath = followsSolution(p, st) && p.moves[st.history.length] === i && p.moves[st.history.length + 1] === b;
    if (!onPath && check) {
      const res = vcfStatus(board, left - 1, limit);
      if (!res.line && !res.exhausted) return { ok: false, reason: 'no-win', state: st };
    }
    const state = { board, xs: st.xs.concat(i), history: st.history.concat(i, b), done: false, won: false, last: b };
    return { ok: true, won: false, done: false, reply: b, state };
  }

  /** Gợi ý ô nên đi theo lời giải (đã đi khác lời giải thì null: nên bấm Làm lại) */
  function caroHint(p, st) {
    if (!st || st.done || !followsSolution(p, st)) return null;
    return p.moves[st.history.length];
  }

  function caroVerify(p, xs) {
    if (!Array.isArray(xs) || xs.length > p.n) return false;
    let st = caroStart(p);
    for (const i of xs) {
      const r = caroTry(p, st, i, 0, false);
      if (!r.ok) return false;
      st = r.state;
    }
    return st.won;
  }

  const caroGoal = (p) => (p.n === 1 ? 'Bạn cầm X — tìm nước thắng ngay' : `Bạn cầm X — thắng trong ${p.n} nước`);

  /* =================== Chung =================== */

  function goalText(game, p) {
    if (game === 'chess') return chessGoal(p);
    if (game === 'blocks') return blocksGoal(p);
    return caroGoal(p);
  }

  /** Kiểm tra lời giải của một câu đố (máy chủ dùng). moves: cờ vua = các nước uci; Xếp Khối = [[k, r, c]…]; caro = các ô X */
  function verify(game, p, moves, Chess) {
    try {
      if (game === 'chess') return chessVerify(p, moves, Chess);
      if (game === 'blocks') return blocksVerify(p, moves);
      if (game === 'caro') return caroVerify(p, moves);
    } catch {
      /* lời giải hỏng */
    }
    return false;
  }

  return {
    GAMES,
    NAMES,
    EPOCH,
    dayKey,
    dayNumber,
    dailyIndex,
    stars,
    goalText,
    verify,
    chessStart,
    chessSide,
    chessTry,
    chessHint,
    chessVerify,
    chessGoal,
    blocksStart,
    blocksPlace,
    blocksHint,
    blocksVerify,
    blocksGoal,
    caro: { SIZE, CELLS, X, O, makesFive, winSquares, winSquaresThrough, nearX, vcf, vcfStatus, board: caroBoard },
    caroStart,
    caroTry,
    caroHint,
    caroVerify,
    caroGoal,
  };
});
