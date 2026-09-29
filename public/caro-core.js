'use strict';
/* Luật cờ caro (gomoku) và máy chơi caro: bàn 15×15, X đi trước, ai có 5 quân liền nhau
   (ngang, dọc, chéo) trước thì thắng. Có luật "chặn hai đầu" kiểu Việt Nam: 5 quân mà bị
   quân đối phương chặn cả hai đầu thì không tính thắng.
   Dùng chung cho trang web, máy chủ (kiểm tra nước đi khi chơi với bạn) và để kiểm thử.
   App Think Beta có bản TypeScript giống hệt: native/src/caro/engine.ts */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaroCore = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const SIZE = 15;
  const CELLS = SIZE * SIZE;
  const X = 1;
  const O = 2;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const RULES = ['free', 'block2'];
  const LEVELS = ['easy', 'medium', 'hard'];

  const other = (p) => (p === X ? O : X);
  const inside = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;
  const emptyBoard = () => new Array(CELLS).fill(0);

  /** Quân đi tiếp theo khi đã có n nước */
  const turnAfter = (n) => (n % 2 === 0 ? X : O);

  /**
   * Kiểm tra nước vừa đi ở ô i có tạo thành 5 quân thắng không.
   * Trả về các ô của hàng thắng, hoặc null.
   */
  function winLine(board, i, rule = 'free') {
    const p = board[i];
    if (!p) return null;
    const r0 = Math.floor(i / SIZE);
    const c0 = i % SIZE;
    for (const [dr, dc] of DIRS) {
      const cells = [i];
      let r = r0 + dr;
      let c = c0 + dc;
      while (inside(r, c) && board[r * SIZE + c] === p) {
        cells.push(r * SIZE + c);
        r += dr;
        c += dc;
      }
      const endA = inside(r, c) ? board[r * SIZE + c] : 0;
      r = r0 - dr;
      c = c0 - dc;
      while (inside(r, c) && board[r * SIZE + c] === p) {
        cells.unshift(r * SIZE + c);
        r -= dr;
        c -= dc;
      }
      const endB = inside(r, c) ? board[r * SIZE + c] : 0;
      if (cells.length < 5) continue;
      // Luật chặn hai đầu: bị quân đối phương chặn cả hai đầu thì không thắng (mép bàn không tính là chặn)
      if (rule === 'block2' && endA === other(p) && endB === other(p)) continue;
      return cells;
    }
    return null;
  }

  function newGame(rule = 'free') {
    return { board: emptyBoard(), moves: [], rule: RULES.includes(rule) ? rule : 'free', winner: 0, line: null };
  }

  /** Dựng lại ván từ danh sách nước đi (số ô 0..224) */
  function fromMoves(moves, rule = 'free') {
    let g = newGame(rule);
    for (const m of moves) {
      const next = play(g, m);
      if (!next) break;
      g = next;
    }
    return g;
  }

  /** Đi quân vào ô i. Trả về ván mới, hoặc null nếu nước đi không hợp lệ */
  function play(g, i) {
    if (g.winner || !Number.isInteger(i) || i < 0 || i >= CELLS || g.board[i]) return null;
    const board = g.board.slice();
    const p = turnAfter(g.moves.length);
    board[i] = p;
    const moves = g.moves.concat(i);
    const line = winLine(board, i, g.rule);
    const winner = line ? p : moves.length >= CELLS ? 3 : 0; // 3 = hòa (kín bàn)
    return { board, moves, rule: g.rule, winner, line };
  }

  /* =================== Máy chơi caro =================== */

  // Đánh giá một ô cho người chơi p (giả sử p đi vào ô đó): đếm các "cửa sổ" 5 ô chứa ô này mà
  // không có quân đối phương. 5 quân = thắng; nhiều cửa sổ 4 quân = tứ không chặn (chắc thắng)...
  function threatsAt(board, i, p) {
    const opp = other(p);
    const r0 = Math.floor(i / SIZE);
    const c0 = i % SIZE;
    const t = { five: 0, openFour: 0, four: 0, openThree: 0, three: 0, two: 0, one: 0 };
    for (const [dr, dc] of DIRS) {
      let w4 = 0;
      let w3 = 0;
      let w2 = 0;
      let w1 = 0;
      let five = false;
      for (let s = -4; s <= 0; s++) {
        let own = 0;
        let ok = true;
        for (let k = 0; k < 5; k++) {
          const r = r0 + (s + k) * dr;
          const c = c0 + (s + k) * dc;
          if (!inside(r, c)) {
            ok = false;
            break;
          }
          const j = r * SIZE + c;
          const v = j === i ? p : board[j];
          if (v === opp) {
            ok = false;
            break;
          }
          if (v === p) own++;
        }
        if (!ok) continue;
        if (own === 5) five = true;
        else if (own === 4) w4++;
        else if (own === 3) w3++;
        else if (own === 2) w2++;
        else if (own === 1) w1++;
      }
      if (five) t.five++;
      else if (w4 >= 2) t.openFour++;
      else if (w4 === 1) t.four++;
      else if (w3 >= 3) t.openThree++;
      else if (w3 >= 1) t.three++;
      else if (w2 >= 2) t.two++;
      else if (w1 >= 1) t.one++;
    }
    return t;
  }

  function scoreThreats(t) {
    if (t.five) return 1e9;
    if (t.openFour || t.four >= 2 || (t.four && t.openThree)) return 5e7; // chắc thắng ở nước sau
    if (t.openThree >= 2) return 4e6;
    let s = 0;
    s += t.four * 6e5;
    s += t.openThree * 8e4;
    s += t.three * 6e3;
    s += t.two * 700;
    s += t.one * 40;
    return s;
  }

  /** Các ô trống gần quân đã có (trong vòng 2 ô) — chỉ xét những ô này cho nhanh */
  function candidates(board) {
    const out = [];
    let any = false;
    for (let i = 0; i < CELLS; i++) {
      if (board[i]) {
        any = true;
        continue;
      }
      const r0 = Math.floor(i / SIZE);
      const c0 = i % SIZE;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr++) {
        for (let dc = -2; dc <= 2 && !near; dc++) {
          const r = r0 + dr;
          const c = c0 + dc;
          if ((dr || dc) && inside(r, c) && board[r * SIZE + c]) near = true;
        }
      }
      if (near) out.push(i);
    }
    if (!any) return [Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2)];
    return out;
  }

  // Ưu tiên ô gần giữa bàn một chút khi điểm bằng nhau
  const centerBonus = (i) => {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    const m = (SIZE - 1) / 2;
    return (SIZE - Math.abs(r - m) - Math.abs(c - m)) * 2;
  };

  function rank(board, p, defense) {
    const opp = other(p);
    return candidates(board)
      .map((i) => {
        const attack = scoreThreats(threatsAt(board, i, p));
        const block = scoreThreats(threatsAt(board, i, opp));
        return { i, attack, block, score: attack + block * defense + centerBonus(i) };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Đánh giá cả bàn cờ cho người sắp đi p: cộng điểm mọi cửa sổ 5 ô chỉ có quân một bên
  const WIN = [0, 1, 10, 90, 1500, 1e6];
  function evalBoard(board, p) {
    let mine = 0;
    let theirs = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const [dr, dc] of DIRS) {
          const er = r + 4 * dr;
          const ec = c + 4 * dc;
          if (!inside(er, ec)) continue;
          let a = 0;
          let b = 0;
          for (let k = 0; k < 5; k++) {
            const v = board[(r + k * dr) * SIZE + c + k * dc];
            if (v === p) a++;
            else if (v) b++;
          }
          if (a && !b) mine += WIN[a];
          else if (b && !a) theirs += WIN[b];
        }
      }
    }
    return mine * 1.15 - theirs;
  }

  // Tìm trước vài nước (negamax + cắt tỉa alpha-beta), chỉ xét các nước tốt nhất theo đánh giá nhanh
  function search(board, p, depth, alpha, beta, widths) {
    const list = rank(board, p, 1.0);
    if (!list.length) return 0;
    if (list[0].attack >= 1e9) return 1e9 + depth; // thắng ngay (thắng sớm tốt hơn)
    if (depth === 0) return evalBoard(board, p);
    let best = -Infinity;
    for (const cand of list.slice(0, widths[depth] || 4)) {
      board[cand.i] = p;
      const val = -search(board, other(p), depth - 1, -beta, -alpha, widths);
      board[cand.i] = 0;
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  /**
   * Máy chọn nước đi cho ván g. level: easy | medium | hard. rand để chạy thử có thể lặp lại.
   * Dễ: hay đi lung tung, phòng thủ kém. Vừa: đánh theo đánh giá nhanh. Khó: tính trước 3 nước.
   */
  function bestMove(g, level = 'medium', rand = Math.random) {
    const p = turnAfter(g.moves.length);
    const board = g.board;
    if (!g.moves.length) return Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2);
    if (level === 'easy') {
      const list = rank(board, p, 0.55);
      if (list[0].attack >= 1e9) return list[0].i; // thắng ngay thì vẫn đi
      if (list[0].block >= 1e9 && rand() < 0.75) return list[0].i; // hay (không phải luôn) chặn 5
      const top = list.slice(0, Math.min(6, list.length));
      return top[Math.floor(rand() * top.length)].i;
    }
    const list = rank(board, p, level === 'hard' ? 1.0 : 0.9);
    if (list.length === 1 || list[0].attack >= 1e9) return list[0].i;
    if (level === 'medium') {
      const best = list[0].score;
      const near = list.filter((x) => x.score >= best * 0.97 && x.score > 0).slice(0, 3);
      return (near.length ? near[Math.floor(rand() * near.length)] : list[0]).i;
    }
    // Khó: phải chặn 5 của đối phương thì chặn luôn
    if (list[0].block >= 1e9) return list[0].i;
    const widths = [0, 8, 8, 10];
    const board2 = board.slice();
    let bestI = list[0].i;
    let bestVal = -Infinity;
    let alpha = -Infinity;
    for (const cand of list.slice(0, 12)) {
      board2[cand.i] = p;
      const val = -search(board2, other(p), 2, -Infinity, -alpha, widths) + (rand() - 0.5);
      board2[cand.i] = 0;
      if (val > bestVal) {
        bestVal = val;
        bestI = cand.i;
      }
      if (bestVal > alpha) alpha = bestVal;
    }
    return bestI;
  }

  /** Tên ô kiểu "H8" (cột chữ A–O, hàng số 1–15 tính từ dưới lên) */
  function cellName(i) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    return `${'ABCDEFGHIJKLMNO'[c]}${SIZE - r}`;
  }

  return { SIZE, CELLS, X, O, RULES, LEVELS, other, turnAfter, emptyBoard, winLine, newGame, fromMoves, play, threatsAt, candidates, bestMove, cellName };
});
