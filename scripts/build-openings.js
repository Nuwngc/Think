#!/usr/bin/env node
'use strict';
// Tạo src/chess-openings.tsv (sách khai cuộc dùng khi phân tích ván) từ bộ dữ liệu lichess-org/chess-openings (CC0).
// Chạy: git clone --depth 1 https://github.com/lichess-org/chess-openings /tmp/co && node scripts/build-openings.js /tmp/co
// Mỗi dòng: mã ECO <tab> tên khai cuộc <tab> các nước dạng UCI (vd "e2e4 e7e5 g1f3")
const fs = require('node:fs');
const path = require('node:path');
const { Chess } = require('chess.js');

const dir = process.argv[2];
if (!dir) {
  console.error('Cần đường dẫn tới thư mục chess-openings');
  process.exit(1);
}
const out = [];
for (const file of ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv']) {
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    const chess = new Chess();
    const uci = [];
    for (const tok of pgn.split(/\s+/)) {
      if (!tok || /^\d+\.+$/.test(tok)) continue;
      const m = chess.move(tok);
      uci.push(`${m.from}${m.to}${m.promotion || ''}`);
    }
    out.push(`${eco}\t${name}\t${uci.join(' ')}`);
  }
}
const target = path.join(__dirname, '..', 'src', 'chess-openings.tsv');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${out.join('\n')}\n`);
console.log(`Đã ghi ${out.length} khai cuộc vào ${target}`);
