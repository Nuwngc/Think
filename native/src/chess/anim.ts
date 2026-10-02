// Chuyển động quân cờ (kiểu chess.com): so hai thế cờ để biết quân nào trượt từ ô nào sang ô nào,
// quân nào bị ăn (mờ dần), quân nào mới hiện. Giống hệt bản web public/chess-anim.js (có kiểm thử so khớp).

const FILES = "abcdefgh";

export type AnimMove = { from: string; to: string; code: string };
export type AnimPiece = { sq: string; code: string };
export type AnimPlan = { moves: AnimMove[]; gone: AnimPiece[]; appear: AnimPiece[] };

/** Thế cờ (FEN) → Map ô → quân ("wP", "bK"…) */
export function squares(fen: string) {
  const out = new Map<string, string>();
  const rows = String(fen || "")
    .split(" ")[0]
    .split("/");
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r] || "") {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        if (f < 8) out.set(`${FILES[f]}${8 - r}`, ch === ch.toUpperCase() ? `w${ch}` : `b${ch.toUpperCase()}`);
        f++;
      }
    }
  }
  return out;
}

const dist = (a: string, b: string) => Math.hypot(FILES.indexOf(a[0]) - FILES.indexOf(b[0]), Number(a[1]) - Number(b[1]));

/** Kế hoạch chuyển động từ thế cờ prevFen sang nextFen (lastMove, vd e7e8q: nước vừa đi) */
export function plan(prevFen: string, nextFen: string, lastMove?: string | null): AnimPlan {
  const a = squares(prevFen);
  const b = squares(nextFen);
  const missing: AnimPiece[] = [];
  const added: AnimPiece[] = [];
  for (const [sq, code] of a) if (b.get(sq) !== code) missing.push({ sq, code });
  for (const [sq, code] of b) if (a.get(sq) !== code) added.push({ sq, code });
  const moves: AnimMove[] = [];
  const used = new Set<AnimPiece>();
  const placed = new Set<AnimPiece>();
  // Nước vừa đi: ghép đúng ô đi → ô đến (kể cả tốt phong cấp thành quân khác)
  if (lastMove && /^[a-h][1-8][a-h][1-8]/.test(lastMove)) {
    const from = lastMove.slice(0, 2);
    const to = lastMove.slice(2, 4);
    const m = missing.find((x) => x.sq === from);
    const n = added.find((x) => x.sq === to);
    if (m && n && m.code[0] === n.code[0] && (m.code === n.code || m.code[1] === "P")) {
      moves.push({ from, to, code: n.code });
      used.add(m);
      placed.add(n);
    }
  }
  // Còn lại: quân cùng loại, ghép ô gần nhất (nhập thành, xem lại ván nhảy nhiều nước)
  for (const n of added) {
    if (placed.has(n)) continue;
    let best: AnimPiece | null = null;
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

/** Thời gian trượt (ms): đi xa thì lâu hơn một chút */
export function duration(moves: AnimMove[]) {
  let far = 0;
  for (const m of moves) far = Math.max(far, dist(m.from, m.to));
  return Math.round(Math.min(260, 150 + far * 14));
}

/** Góc trên trái của ô (theo chiều đang xem), tính bằng điểm ảnh */
export function squareXY(sq: string, cell: number, orientation: "w" | "b") {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return { x: (orientation === "w" ? f : 7 - f) * cell, y: (orientation === "w" ? 7 - r : r) * cell };
}

/** Ô ở vị trí (x, y) trên bàn cờ (null nếu ngoài bàn) */
export function squareAt(x: number, y: number, cell: number, orientation: "w" | "b") {
  const col = Math.floor(x / cell);
  const row = Math.floor(y / cell);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const f = orientation === "w" ? col : 7 - col;
  const r = orientation === "w" ? 7 - row : row;
  return `${FILES[f]}${r + 1}`;
}
