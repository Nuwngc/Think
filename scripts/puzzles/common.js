'use strict';
// Dùng chung cho các bộ tạo câu đố (scripts/puzzles/*.js): số ngẫu nhiên lặp lại được, đọc / ghi file dữ liệu.
// Dữ liệu ghi ra hai chỗ giống hệt nhau: public/puzzles/<game>.json (web, máy chủ) và
// native/src/puzzles/data/<game>.json (đóng gói trong App Think Beta).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const WEB = (game) => path.join(ROOT, 'public', 'puzzles', `${game}.json`);
const APP = (game) => path.join(ROOT, 'native', 'src', 'puzzles', 'data', `${game}.json`);

/** Số ngẫu nhiên 0..1 theo hạt giống (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readData(game) {
  try {
    return JSON.parse(fs.readFileSync(WEB(game), 'utf8'));
  } catch {
    return null;
  }
}

/** Ghi gọn: mỗi câu đố một dòng (dễ xem khác biệt khi thêm màn) */
function format(data) {
  const lines = (list) => list.map((p) => `    ${JSON.stringify(p)}`).join(',\n');
  return `{
  "game": ${JSON.stringify(data.game)},
  "version": ${data.version},
  "chapters": [
${lines(data.chapters)}
  ],
  "levels": [
${lines(data.levels)}
  ],
  "daily": [
${lines(data.daily)}
  ]
}
`;
}

function writeData(data) {
  const text = format(data);
  for (const file of [WEB(data.game), APP(data.game)]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return text.length;
}

/** Đọc tham số dòng lệnh dạng --levels 200 --daily 150 --seed 7 --add 50 */
function args(defaults) {
  const out = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)$/.exec(argv[i]);
    if (!m) continue;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) out[m[1]] = true;
    else {
      out[m[1]] = /^-?\d+$/.test(v) ? Number(v) : v;
      i++;
    }
  }
  return out;
}

/**
 * Thêm màn: giữ nguyên các màn cũ (người chơi không bị đổi màn đã qua), thêm màn mới vào cuối thành chương mới.
 * chaptersFor(levels): chia các màn mới thành chương [{ name, size }].
 */
function appendLevels(old, fresh, chaptersFor) {
  return {
    ...old,
    version: (old.version || 1) + 1,
    chapters: old.chapters.concat(chaptersFor(fresh)),
    levels: old.levels.concat(fresh),
  };
}

module.exports = { ROOT, rng, shuffle, readData, writeData, args, appendLevels, format };
