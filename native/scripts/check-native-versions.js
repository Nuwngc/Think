#!/usr/bin/env node
/* global __dirname */
// Kiểm tra phiên bản các thư viện có phần Android (native) có khớp với bản Expo đang dùng không.
//
// Vì sao cần: npm tự cài "peer dependency" bản MỚI NHẤT. Ví dụ expo-audio khai báo cần expo-asset "*",
// npm liền cài expo-asset của bản Expo đời sau, không chạy được với Expo 54 → app build được
// nhưng mở lên là tắt ngay (lỗi NoClassDefFoundError ... AnyTypeCache). Lỗi này đã làm các bản
// APK 0.1.4 – 0.1.6 bị crash trên mọi máy. Script này chặn lỗi đó từ lúc build.
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const bundled = require(path.join(nm, 'expo', 'bundledNativeModules.json'));

const problems = [];
const versionAt = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

// 1) Thư viện cài ở node_modules/ (bản được đưa vào app) phải đúng bản Expo quy định
for (const [name, range] of Object.entries(bundled)) {
  const v = versionAt(path.join(nm, name));
  if (!v) continue;
  if (!semver.satisfies(v, range)) problems.push(`${name}@${v} không khớp bản Expo cần (${range})`);
}

// 2) Không có hai bản khác nhau của cùng một thư viện native (vd node_modules/expo/node_modules/expo-asset)
function walk(dir, depth) {
  if (depth > 4 || !fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (entry.startsWith('@')) {
      walk(full, depth);
      continue;
    }
    const nested = path.join(full, 'node_modules');
    if (!fs.existsSync(nested)) continue;
    for (const inner of fs.readdirSync(nested)) {
      const names = inner.startsWith('@') ? fs.readdirSync(path.join(nested, inner)).map((n) => `${inner}/${n}`) : [inner];
      for (const n of names) {
        if (!bundled[n]) continue;
        const top = versionAt(path.join(nm, n));
        const v = versionAt(path.join(nested, n));
        if (v && top && v !== top && fs.existsSync(path.join(nested, n, 'android'))) {
          problems.push(`${n} có 2 bản: ${top} (node_modules) và ${v} (${path.relative(root, path.join(nested, n))})`);
        }
      }
    }
    walk(nested, depth + 1);
  }
}
walk(nm, 0);

if (problems.length) {
  console.error('\n❌ Thư viện native không khớp bản Expo — app sẽ crash khi mở:\n');
  for (const p of problems) console.error(`   - ${p}`);
  console.error('\nSửa: thêm đúng phiên bản vào package.json (xem expo/bundledNativeModules.json) rồi chạy lại npm install.\n');
  process.exit(1);
}
console.log('✅ Thư viện native khớp bản Expo.');
