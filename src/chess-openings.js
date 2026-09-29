'use strict';
// Sách khai cuộc: các thế cờ "theo sách" và tên khai cuộc, lấy từ lichess-org/chess-openings (CC0).
// Dữ liệu gọn trong src/chess-openings.tsv (tạo bằng scripts/build-openings.js). Chỉ nạp khi phân tích ván đầu tiên.
// Các nước trong sách đều hợp lệ sẵn nên đi thẳng trên bàn cờ đơn giản (nhanh hơn chess.js hàng trăm lần,
// không làm máy chủ khựng lại lúc nạp).
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'chess-openings.tsv');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let book = null;

/** Khóa của một thế cờ: vị trí quân, bên đi, quyền nhập thành (bỏ ô bắt tốt qua đường và số nước) */
function keyOf(fen) {
  return String(fen).split(' ').slice(0, 3).join(' ');
}

const sqIndex = (sq) => (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97); // a8 = 0 … h1 = 63

/** Bàn cờ tối giản: chỉ đủ để đi các nước đã biết là hợp lệ và ghi ra khóa thế cờ */
class Board {
  constructor() {
    this.sq = new Array(64).fill(null);
    const rows = START.split(' ')[0].split('/');
    rows.forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else this.sq[r * 8 + f++] = ch;
      }
    });
    this.turn = 'w';
    this.castle = 'KQkq';
  }

  move(uci) {
    const from = sqIndex(uci.slice(0, 2));
    const to = sqIndex(uci.slice(2, 4));
    const piece = this.sq[from];
    if (!piece) throw new Error(`Không có quân ở ${uci.slice(0, 2)}`);
    const lower = piece.toLowerCase();
    const white = piece === piece.toUpperCase();
    // Bắt tốt qua đường: tốt đi chéo vào ô trống
    if (lower === 'p' && from % 8 !== to % 8 && !this.sq[to]) this.sq[to + (white ? 8 : -8)] = null;
    // Nhập thành: vua đi hai ô, xe nhảy qua
    if (lower === 'k' && Math.abs((from % 8) - (to % 8)) === 2) {
      const rowStart = to - (to % 8);
      const kingSide = to % 8 === 6;
      const rookFrom = rowStart + (kingSide ? 7 : 0);
      const rookTo = rowStart + (kingSide ? 5 : 3);
      this.sq[rookTo] = this.sq[rookFrom];
      this.sq[rookFrom] = null;
    }
    this.sq[to] = uci[4] ? (white ? uci[4].toUpperCase() : uci[4]) : piece;
    this.sq[from] = null;
    // Quyền nhập thành mất khi vua đi, hoặc xe rời / bị ăn ở góc
    const lose = (chars) => { for (const ch of chars) this.castle = this.castle.replace(ch, ''); };
    if (piece === 'K') lose('KQ');
    if (piece === 'k') lose('kq');
    for (const idx of [from, to]) {
      if (idx === 63) lose('K');
      if (idx === 56) lose('Q');
      if (idx === 7) lose('k');
      if (idx === 0) lose('q');
    }
    this.turn = this.turn === 'w' ? 'b' : 'w';
  }

  key() {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.sq[r * 8 + f];
        if (!p) empty++;
        else {
          if (empty) row += empty;
          empty = 0;
          row += p;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return `${rows.join('/')} ${this.turn} ${this.castle || '-'}`;
  }
}

function load() {
  if (book) return book;
  const positions = new Set();
  const names = new Map();
  let text = '';
  try {
    text = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    console.warn('[chess] Không đọc được sách khai cuộc:', err.message);
  }
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [eco, name, moves] = line.split('\t');
    if (!moves) continue;
    const board = new Board();
    let key = null;
    try {
      for (const m of moves.split(' ')) {
        board.move(m);
        key = board.key();
        positions.add(key);
      }
    } catch {
      continue;
    }
    // Cùng một thế cờ có nhiều tên (đến bằng thứ tự nước khác nhau): giữ tên ngắn gọn nhất
    const prev = names.get(key);
    if (!prev || name.length < prev.name.length) names.set(key, { eco, name });
  }
  book = {
    size: names.size,
    has: (fen) => positions.has(keyOf(fen)),
    name: (fen) => names.get(keyOf(fen)) || null,
  };
  return book;
}

module.exports = { load, keyOf, Board };
