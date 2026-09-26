#!/usr/bin/env node
'use strict';
// Mở link HTTPS công khai tạm thời bằng Cloudflare Tunnel để bạn bè dùng thử.
//   npm run share    chạy web + mở link trong cùng một phiên Termux
//   npm run tunnel   chỉ mở link (web đang chạy ở phiên khác)
//
// Dùng giao thức HTTP/2 qua TCP thay cho QUIC (UDP). Android và nhiều nhà mạng hay chặn UDP
// của Termux, gây lỗi "sendmsg: operation not permitted" làm link chết. Tunnel tự mở lại khi bị tắt.
const path = require('node:path');
const { spawn } = require('node:child_process');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* không có .env thì dùng mặc định */
}

const PORT = Number(process.env.PORT) || 3000;
const DEBUG = process.env.TUNNEL_DEBUG === '1';
let child = null;
let stopping = false;
let delay = 3000;
let lastUrl = null;
let lastWarn = 0;

function stop() {
  stopping = true;
  if (child) child.kill('SIGTERM');
}
// Đăng ký trước khi chạy web, để Ctrl+C tắt cả tunnel lẫn web
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const withServer = process.argv.includes('--with-server');
if (withServer) require('../start.js');

function banner(url) {
  const line = '═'.repeat(url.length + 4);
  console.log(`\n╔${line}╗\n║  ${url}  ║\n╚${line}╝`);
  console.log('🔗 Gửi link trên cho bạn bè. Link đổi mỗi khi tunnel khởi động lại.\n');
}

function start() {
  const args = ['tunnel', '--protocol', 'http2', '--no-autoupdate', '--url', `http://localhost:${PORT}`];
  child = spawn('cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const onOutput = (buf) => {
    const text = buf.toString();
    if (DEBUG) process.stdout.write(text);
    const found = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (found && found[0] !== lastUrl) {
      lastUrl = found[0];
      banner(lastUrl);
    }
    if (/Registered tunnel connection/.test(text)) {
      delay = 3000;
      console.log('✅ Tunnel đã kết nối.');
    } else if (/Retrying connection|Serve tunnel error|Failed to dial/.test(text) && Date.now() - lastWarn > 15000) {
      lastWarn = Date.now();
      console.log('⚠️  Mất kết nối tới Cloudflare, đang tự kết nối lại (link vẫn giữ nguyên)…');
    }
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error('❌ Chưa cài cloudflared. Trên Termux chạy: pkg install cloudflared');
      process.exit(1);
    }
    console.error('❌ Không chạy được cloudflared:', err.message);
  });

  child.on('exit', (code) => {
    child = null;
    if (stopping) {
      if (!withServer) process.exit(0); // chạy kèm web thì để web tự tắt (và lưu dữ liệu) xong mới thoát
      return;
    }
    console.log(`⚠️  Tunnel bị tắt (mã ${code}). Mở lại sau ${Math.round(delay / 1000)} giây, link sẽ đổi…`);
    setTimeout(start, delay);
    delay = Math.min(delay * 2, 60000);
  });
}

console.log(`🚇 Đang mở tunnel tới http://localhost:${PORT} (giao thức HTTP/2)…`);
start();
