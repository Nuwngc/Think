'use strict';
/* Chuyển động quân cờ (kiểu chess.com): so hai thế cờ để biết quân nào trượt từ ô nào sang ô nào,
   quân nào bị ăn (mờ dần), quân nào mới hiện. Dùng chung cho web (public/chess-ui.js) và
   App Think Beta (native/src/chess/anim.ts làm y hệt, có kiểm thử so khớp hai bản). */
(function (root) {
  const FILES = 'abcdefgh';

  /** Thế cờ (FEN) → Map ô → quân ('wP', 'bK'…) */
  function squares(fen) {
    const out = new Map();
    const rows = String(fen || '').split(' ')[0].split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r] || '') {
        if (/\d/.test(ch)) f += Number(ch);
        else {
          if (f < 8) out.set(`${FILES[f]}${8 - r}`, ch === ch.toUpperCase() ? `w${ch}` : `b${ch.toUpperCase()}`);
          f++;
        }
      }
    }
    return out;
  }

  const dist = (a, b) => Math.hypot(FILES.indexOf(a[0]) - FILES.indexOf(b[0]), Number(a[1]) - Number(b[1]));

  /**
   * Kế hoạch chuyển động từ thế cờ `prevFen` sang `nextFen`.
   * lastMove (vd e7e8q): nước vừa đi, để ghép đúng quân phong cấp.
   * Trả về { moves: [{from, to, code}], gone: [{sq, code}], appear: [{sq, code}] }
   */
  function plan(prevFen, nextFen, lastMove) {
    const a = squares(prevFen);
    const b = squares(nextFen);
    const missing = [];
    const added = [];
    for (const [sq, code] of a) if (b.get(sq) !== code) missing.push({ sq, code });
    for (const [sq, code] of b) if (a.get(sq) !== code) added.push({ sq, code });
    const moves = [];
    const used = new Set();
    const placed = new Set();
    // Nước vừa đi: ghép đúng ô đi → ô đến (kể cả tốt phong cấp thành quân khác)
    if (lastMove && /^[a-h][1-8][a-h][1-8]/.test(lastMove)) {
      const from = lastMove.slice(0, 2);
      const to = lastMove.slice(2, 4);
      const m = missing.find((x) => x.sq === from);
      const n = added.find((x) => x.sq === to);
      if (m && n && m.code[0] === n.code[0] && (m.code === n.code || m.code[1] === 'P')) {
        moves.push({ from, to, code: n.code });
        used.add(m);
        placed.add(n);
      }
    }
    // Còn lại: quân cùng loại, ghép ô gần nhất (nhập thành, xem lại ván nhảy nhiều nước)
    for (const n of added) {
      if (placed.has(n)) continue;
      let best = null;
      let bd = Infinity;
      for (const m of missing) {
        if (used.has(m) || m.code !== n.code) continue;
        const d = dist(m.sq, n.sq);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (best) {
        moves.push({ from: best.sq, to: n.sq, code: n.code });
        used.add(best);
        placed.add(n);
      }
    }
    return {
      moves,
      gone: missing.filter((m) => !used.has(m)).map(({ sq, code }) => ({ sq, code })),
      appear: added.filter((n) => !placed.has(n)).map(({ sq, code }) => ({ sq, code })),
    };
  }

  /** Độ lệch (tính bằng số ô, theo chiều đang xem) từ ô `to` về ô `from` */
  function offset(from, to, orientation) {
    const s = orientation === 'b' ? -1 : 1;
    return {
      dx: (FILES.indexOf(from[0]) - FILES.indexOf(to[0])) * s,
      dy: (Number(to[1]) - Number(from[1])) * s,
    };
  }

  /** Thời gian trượt (ms): đi xa thì lâu hơn một chút, như chess.com */
  function duration(moves) {
    let far = 0;
    for (const m of moves) far = Math.max(far, dist(m.from, m.to));
    return Math.round(Math.min(260, 150 + far * 14));
  }

  const api = { plan, squares, offset, duration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThinkChessAnim = api;
})(typeof window !== 'undefined' ? window : null);
