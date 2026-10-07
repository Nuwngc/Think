'use strict';
// Kiểm thử tin 24 giờ (src/stories.js) — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-stories-'));
const express = require('express');
const { run, get } = require('../src/db');
const { setupStories, storyAlive } = require('../src/stories');

const events = []; // { to, ev, data }
const removed = [];
const uploads = new Map(); // url -> userId (ảnh vừa tải lên, chưa dùng)
const messages = [];
const io = {
  emit: (ev, data) => events.push({ to: 'all', ev, data }),
  to: (room) => ({ emit: (ev, data) => events.push({ to: room, ev, data }) }),
};
const last = (ev) => [...events].reverse().find((e) => e.ev === ev);

let base;
let srv;
let stories;
const call = async (uid, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-user': String(uid) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

test.before(async () => {
  for (const [id, u, n] of [[1, 'an', 'An'], [2, 'binh', 'Bình'], [3, 'chi', 'Chi'], [4, 'dung', 'Dũng']]) {
    run('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, 0)', id, u, n, 'x');
  }
  const app = express();
  app.use(express.json());
  const fakeAuth = (req, res, next) => {
    req.user = { id: Number(req.get('x-user')), role: Number(req.get('x-user')) === 4 ? 'admin' : 'member' };
    next();
  };
  stories = setupStories({
    app,
    io,
    requireAuth: fakeAuth,
    requireReady: (q, s, n) => n(),
    takeUpload: (url, uid) => {
      if (uploads.get(url) !== uid) return false;
      uploads.delete(url);
      return true;
    },
    removeUpload: (url) => removed.push(url),
    ensureDm: (a, b) => {
      const key = [a, b].sort((x, y) => x - y).join(':');
      const row = get('SELECT id FROM conversations WHERE dm_key = ?', key);
      if (row) return row.id;
      const id = Number(run("INSERT INTO conversations (type, dm_key, created_at) VALUES ('dm', ?, 0)", key).lastInsertRowid);
      run('INSERT INTO members (conversation_id, user_id) VALUES (?, ?)', id, a);
      run('INSERT INTO members (conversation_id, user_id) VALUES (?, ?)', id, b);
      return id;
    },
    postMessage: (convId, senderId, text, story) => {
      const m = { id: messages.length + 1, conversationId: convId, senderId, text, story };
      messages.push(m);
      return m;
    },
  });
  await new Promise((resolve) => {
    srv = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv?.close());

let textStory;
let photoStory;

test('đăng tin chữ và tin ảnh; kiểm tra dữ liệu', async () => {
  assert.equal((await call(1, 'POST', '/api/stories', {})).status, 400); // trống
  assert.equal((await call(1, 'POST', '/api/stories', { text: 'a'.repeat(251) })).status, 400); // dài quá
  let r = await call(1, 'POST', '/api/stories', { text: '  Chào cả nhà 👋  ', bg: 'ocean' });
  assert.equal(r.status, 200);
  textStory = r.data.story;
  assert.equal(textStory.kind, 'text');
  assert.equal(textStory.text, 'Chào cả nhà 👋');
  assert.equal(textStory.bg, 'ocean');
  assert.equal(textStory.seen, true); // tin của mình
  assert.equal(textStory.views, 0);
  assert.ok(Math.abs(textStory.expiresAt - textStory.createdAt - 24 * 3600_000) < 5);
  const ev = last('story:new');
  assert.equal(ev.to, 'all');
  assert.equal(ev.data.story.seen, false); // người khác nhận bản chưa xem
  assert.equal('views' in ev.data.story, false);
  // Màu lạ thì dùng màu đầu tiên
  r = await call(2, 'POST', '/api/stories', { text: 'Tin của Bình', bg: 'hồng' });
  assert.equal(r.data.story.bg, 'jade');
  // Ảnh: phải là ảnh mình vừa tải lên
  assert.equal((await call(1, 'POST', '/api/stories', { image: '/uploads/img/a.jpg' })).status, 400);
  uploads.set('/uploads/img/a.jpg', 1);
  assert.equal((await call(2, 'POST', '/api/stories', { image: '/uploads/img/a.jpg' })).status, 400); // ảnh của người khác
  r = await call(1, 'POST', '/api/stories', { image: '/uploads/img/a.jpg', text: 'Đi biển 🏖️', bg: 'night' });
  assert.equal(r.status, 200);
  photoStory = r.data.story;
  assert.equal(photoStory.kind, 'image');
  assert.equal(photoStory.image, '/uploads/img/a.jpg');
  assert.equal(photoStory.text, 'Đi biển 🏖️');
  assert.equal(photoStory.bg, null);
});

test('xem tin: người đăng thấy số người xem, ai đã xem', async () => {
  let list = (await call(2, 'GET', '/api/stories')).data.stories;
  const mine = list.filter((s) => s.userId === 1);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((s) => s.seen === false && !('views' in s)));
  assert.equal((await call(2, 'POST', `/api/stories/${textStory.id}/view`)).status, 200);
  assert.deepEqual(last('story:viewed'), { to: 'user:1', ev: 'story:viewed', data: { storyId: textStory.id, views: 1 } });
  const before = events.length;
  await call(2, 'POST', `/api/stories/${textStory.id}/view`); // xem lại: không tính thêm
  assert.equal(events.length, before);
  await call(1, 'POST', `/api/stories/${textStory.id}/view`); // người đăng xem tin của mình: không tính
  list = (await call(2, 'GET', '/api/stories')).data.stories;
  assert.equal(list.find((s) => s.id === textStory.id).seen, true);
  assert.equal(list.find((s) => s.id === photoStory.id).seen, false);
  const own = (await call(1, 'GET', '/api/stories')).data.stories.find((s) => s.id === textStory.id);
  assert.equal(own.views, 1);
  // Chỉ người đăng (và admin) xem được danh sách
  assert.equal((await call(3, 'GET', `/api/stories/${textStory.id}/viewers`)).status, 403);
  const v = await call(1, 'GET', `/api/stories/${textStory.id}/viewers`);
  assert.deepEqual(v.data.viewers.map((x) => x.userId), [2]);
  assert.equal((await call(4, 'GET', `/api/stories/${textStory.id}/viewers`)).status, 200);
});

test('thả cảm xúc, trả lời: gửi tin nhắn riêng có ảnh nhỏ của tin', async () => {
  assert.equal((await call(1, 'POST', `/api/stories/${textStory.id}/reply`, { emoji: '❤️' })).status, 400); // tin của mình
  assert.equal((await call(3, 'POST', `/api/stories/${textStory.id}/reply`, { emoji: '🍕' })).status, 400); // cảm xúc lạ
  assert.equal((await call(3, 'POST', `/api/stories/${textStory.id}/reply`, { text: '   ' })).status, 400);
  let r = await call(3, 'POST', `/api/stories/${photoStory.id}/reply`, { emoji: '😂' });
  assert.equal(r.status, 200);
  const dm = get("SELECT id FROM conversations WHERE dm_key = '1:3'").id;
  assert.equal(r.data.conversationId, dm);
  assert.deepEqual(r.data.message.story, { id: photoStory.id, ownerId: 1, kind: 'image', image: '/uploads/img/a.jpg', text: 'Đi biển 🏖️', bg: null, reaction: true });
  assert.equal(r.data.message.text, '😂');
  assert.deepEqual(last('story:viewed').data, { storyId: photoStory.id, views: 1, reaction: { userId: 3, emoji: '😂' } });
  r = await call(3, 'POST', `/api/stories/${photoStory.id}/reply`, { text: 'Đẹp quá!' });
  assert.equal(r.data.message.text, 'Đẹp quá!');
  assert.equal(r.data.message.story.reaction, false);
  // Trả lời chữ không xóa cảm xúc đã thả; người thả cảm xúc lên đầu danh sách
  const v = (await call(1, 'GET', `/api/stories/${photoStory.id}/viewers`)).data.viewers;
  assert.deepEqual(v[0], { userId: 3, viewedAt: v[0].viewedAt, reaction: '😂' });
  assert.equal((await call(1, 'GET', '/api/stories')).data.stories.find((s) => s.id === photoStory.id).reactions, 1);
  assert.equal((await call(3, 'GET', '/api/stories')).data.stories.find((s) => s.id === photoStory.id).myReaction, '😂');
});

test('xóa tin: chỉ người đăng hoặc admin, ảnh bị xóa theo', async () => {
  assert.equal((await call(2, 'DELETE', `/api/stories/${photoStory.id}`)).status, 403);
  assert.equal((await call(1, 'DELETE', `/api/stories/${photoStory.id}`)).status, 200);
  assert.deepEqual(removed, ['/uploads/img/a.jpg']);
  assert.deepEqual(last('story:deleted').data, { storyId: photoStory.id, userId: 1, reason: 'deleted' });
  assert.equal(storyAlive(photoStory.id), false);
  assert.equal((await call(2, 'POST', `/api/stories/${photoStory.id}/view`)).status, 404);
  assert.equal((await call(2, 'POST', `/api/stories/${photoStory.id}/reply`, { emoji: '❤️' })).status, 404);
});

test('hết 24 giờ: không còn trong danh sách, máy chủ dọn tin và ảnh', async () => {
  uploads.set('/uploads/img/b.jpg', 2);
  const b = (await call(2, 'POST', '/api/stories', { image: '/uploads/img/b.jpg' })).data.story;
  assert.equal(storyAlive(textStory.id), true);
  run('UPDATE stories SET expires_at = ? WHERE id IN (?, ?)', Date.now() - 1, textStory.id, b.id);
  assert.equal(storyAlive(textStory.id), false);
  const ids = (await call(3, 'GET', '/api/stories')).data.stories.map((s) => s.id);
  assert.ok(!ids.includes(textStory.id) && !ids.includes(b.id));
  assert.equal((await call(3, 'POST', `/api/stories/${b.id}/view`)).status, 404);
  assert.equal(stories.sweep(), 2);
  assert.ok(removed.includes('/uploads/img/b.jpg'));
  assert.equal(get('SELECT COUNT(*) AS n FROM story_views WHERE story_id = ?', textStory.id).n, 0); // xóa luôn lượt xem
  assert.equal(last('story:deleted').data.reason, 'expired');
});

test('tài khoản bị khóa: tin bị ẩn', async () => {
  const s = (await call(3, 'POST', '/api/stories', { text: 'Tin của Chi' })).data.story;
  run('UPDATE users SET disabled = 1 WHERE id = 3');
  assert.ok(!(await call(1, 'GET', '/api/stories')).data.stories.some((x) => x.id === s.id));
  assert.equal((await call(1, 'POST', `/api/stories/${s.id}/view`)).status, 404);
  run('UPDATE users SET disabled = 0 WHERE id = 3');
});
