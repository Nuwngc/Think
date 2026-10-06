'use strict';
// Kiểm thử khóa cuộc trò chuyện bằng mật khẩu (src/chat-lock.js) và thông báo đẩy không lộ nội dung — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-lock-'));
const express = require('express');
const { run, get } = require('../src/db');
const auth = require('../src/auth');
const lock = require('../src/chat-lock');
const fcm = require('../src/fcm');

let base;
let srv;
const events = [];
const call = async (uid, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-user': String(uid) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

test.before(async () => {
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (1, 'an', 'An', ?, 0)", await auth.hashPassword('dangnhap123'));
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (2, 'binh', 'Bình', 'x', 0)");
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (3, 'chi', 'Chi', 'x', 0)");
  run("INSERT INTO conversations (id, type, dm_key, created_at) VALUES (101, 'dm', '1:2', 0)");
  run("INSERT INTO conversations (id, type, name, created_at) VALUES (102, 'group', 'Nhóm', 0)");
  for (const [c, u] of [[101, 1], [101, 2], [102, 1], [102, 2], [102, 3]]) run('INSERT INTO members (conversation_id, user_id, last_read_id) VALUES (?, ?, 0)', c, u);
  const app = express();
  app.use(express.json());
  const fakeAuth = (req, res, next) => {
    req.user = { id: Number(req.get('x-user')) };
    next();
  };
  lock.setupChatLock({
    app,
    requireAuth: fakeAuth,
    requireReady: (q, s, n) => n(),
    emitConvChanged: (convId, uids) => events.push({ convId, uids }),
    getConv: (convId, uid) => ({ id: convId, locked: Boolean(get('SELECT lock_hash FROM members WHERE conversation_id = ? AND user_id = ?', convId, uid).lock_hash) }),
  });
  await new Promise((resolve) => {
    srv = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv?.close());

test('đặt khóa, đổi mật khẩu, chỉ riêng mình bị khóa', async () => {
  assert.equal((await call(1, 'PUT', '/api/conversations/101/lock', { password: 'abc' })).status, 400); // quá ngắn
  assert.equal((await call(1, 'PUT', '/api/conversations/101/lock', { password: 'x'.repeat(33) })).status, 400); // quá dài
  assert.equal((await call(3, 'PUT', '/api/conversations/101/lock', { password: 'abcd' })).status, 404); // không ở trong cuộc trò chuyện
  const r = await call(1, 'PUT', '/api/conversations/101/lock', { password: 'abcd' });
  assert.equal(r.status, 200);
  assert.equal(r.data.conversation.locked, true);
  assert.deepEqual(events.at(-1), { convId: 101, uids: [1] }); // báo các máy khác của chính mình
  assert.deepEqual([...lock.lockedMembers(101)], [1]); // Bình vẫn xem bình thường
  assert.ok(get('SELECT lock_hash FROM members WHERE conversation_id = 101 AND user_id = 1').lock_hash.startsWith('scrypt$')); // không lưu mật khẩu thật
  // Đổi mật khẩu phải nhập mật khẩu cũ
  assert.equal((await call(1, 'PUT', '/api/conversations/101/lock', { password: 'wxyz' })).status, 400);
  assert.equal((await call(1, 'PUT', '/api/conversations/101/lock', { password: 'wxyz', current: 'abcd' })).status, 200);
  assert.equal((await call(1, 'POST', '/api/conversations/101/unlock', { password: 'abcd' })).status, 400);
  assert.equal((await call(1, 'POST', '/api/conversations/101/unlock', { password: 'wxyz' })).status, 200);
  // Cuộc trò chuyện chưa khóa: mở khóa luôn được
  assert.equal((await call(2, 'POST', '/api/conversations/101/unlock', { password: '' })).status, 200);
});

test('sai quá 5 lần thì chặn; quên mật khẩu thì bỏ khóa bằng mật khẩu đăng nhập', async () => {
  await call(1, 'PUT', '/api/conversations/102/lock', { password: 'nhom2024' });
  const first = await call(1, 'POST', '/api/conversations/102/unlock', { password: 'sai1' });
  assert.equal(first.status, 400);
  assert.match(first.data.error, /Còn 4 lần thử/);
  for (let i = 0; i < 4; i++) await call(1, 'POST', '/api/conversations/102/unlock', { password: 'sai' });
  const blocked = await call(1, 'POST', '/api/conversations/102/unlock', { password: 'nhom2024' }); // đúng nhưng đang bị chặn
  assert.equal(blocked.status, 429);
  assert.equal((await call(1, 'DELETE', '/api/conversations/102/lock', { password: 'nhom2024' })).status, 429);
  assert.equal((await call(1, 'DELETE', '/api/conversations/102/lock', { accountPassword: 'sai-mat-khau' })).status, 400);
  const off = await call(1, 'DELETE', '/api/conversations/102/lock', { accountPassword: 'dangnhap123' });
  assert.equal(off.status, 200);
  assert.equal(off.data.conversation.locked, false);
  assert.equal(lock.lockedMembers(102).size, 0);
  // Khóa lại: lượt sai cũ đã được xóa
  await call(1, 'PUT', '/api/conversations/102/lock', { password: 'moi12345' });
  assert.equal((await call(1, 'POST', '/api/conversations/102/unlock', { password: 'moi12345' })).status, 200);
  // Bỏ khóa bằng chính mật khẩu khóa
  assert.equal((await call(1, 'DELETE', '/api/conversations/102/lock', { password: 'moi12345' })).status, 200);
});

test('thông báo đẩy của cuộc trò chuyện đã khóa không có nút Trả lời', () => {
  const normal = fcm.toData({ type: 'message', conversationId: 1, convTitle: 'An', senderName: 'An', text: 'bí mật', isGroup: false });
  assert.equal(normal.categoryId, 'message');
  assert.match(normal.message, /bí mật/);
  const hidden = fcm.toData({ type: 'message', conversationId: 1, convTitle: 'Think', senderName: '🔒 Think', text: 'Có tin nhắn mới trong cuộc trò chuyện đã khóa', isGroup: false, locked: true });
  assert.equal(hidden.categoryId, undefined);
  assert.equal(JSON.parse(hidden.body).locked, 1);
  assert.doesNotMatch(JSON.stringify(hidden), /bí mật/);
});
