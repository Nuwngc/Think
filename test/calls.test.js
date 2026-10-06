'use strict';
// Kiểm thử gọi thoại / gọi video (src/calls.js) với Socket.IO giả — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-calls-'));
delete process.env.TURN_URLS;
delete process.env.CF_TURN_KEY_ID;
const express = require('express');
const { run, get, all } = require('../src/db');
const { setupCalls } = require('../src/calls');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = []; // { to, ev, data }
const pushes = [];
const sockets = new Map();
let seq = 0;

// Socket.IO giả: phòng "user:<id>" = mọi kết nối của người đó
const io = {
  to: (room) => ({
    emit: (ev, data) => sent.push({ to: room, ev, data }),
    except: (id) => ({ emit: (ev, data) => sent.push({ to: room, except: id, ev, data }) }),
  }),
  sockets: { sockets },
};
function connect(userId) {
  const handlers = {};
  const socket = {
    id: `s${++seq}`,
    data: { userId },
    on: (ev, fn) => (handlers[ev] = fn),
    emit: (ev, data) => sent.push({ to: socket.id, ev, data }),
    call: (ev, data) => new Promise((resolve) => handlers[ev](data, resolve)),
    drop: () => {
      sockets.delete(socket.id);
      handlers.disconnect?.();
    },
  };
  sockets.set(socket.id, socket);
  calls.attach(socket);
  return socket;
}
const last = (ev, to) => [...sent].reverse().find((e) => e.ev === ev && (!to || e.to === to));
const sysMessages = (convId) => all("SELECT text FROM messages WHERE conversation_id = ? AND kind = 'system' ORDER BY id", convId).map((r) => JSON.parse(r.text));

let calls;
let base;
let srv;
const activeUsers = new Set();
test.before(async () => {
  for (const [id, u, n] of [[1, 'an', 'An'], [2, 'binh', 'Bình'], [3, 'chi', 'Chi']]) {
    run('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, 0)', id, u, n, 'x');
  }
  run("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (9, 'think.ai', 'Think AI', '!', 'bot', 0)");
  run("INSERT INTO conversations (id, type, dm_key, created_at) VALUES (201, 'dm', '1:2', 0)");
  run("INSERT INTO conversations (id, type, dm_key, created_at) VALUES (202, 'dm', '1:3', 0)");
  run("INSERT INTO conversations (id, type, dm_key, created_at) VALUES (203, 'dm', '1:9', 0)");
  run("INSERT INTO conversations (id, type, name, created_at) VALUES (204, 'group', 'Nhóm', 0)");
  for (const [c, u] of [[201, 1], [201, 2], [202, 1], [202, 3], [203, 1], [203, 9], [204, 1], [204, 2]]) run('INSERT INTO members (conversation_id, user_id) VALUES (?, ?)', c, u);
  const app = express();
  app.use(express.json());
  const pass = (req, res, next) => {
    req.user = { id: Number(req.get('x-user') || 1), role: 'admin' };
    next();
  };
  calls = setupCalls({
    app,
    io,
    requireAuth: pass,
    requireReady: pass,
    requireAdmin: pass,
    membership: (c, u) => get('SELECT 1 AS x FROM members WHERE conversation_id = ? AND user_id = ?', c, u),
    memberIds: (c) => all('SELECT user_id FROM members WHERE conversation_id = ?', c).map((r) => r.user_id),
    systemMessage: (convId, actorId, data) =>
      Number(run("INSERT INTO messages (conversation_id, sender_id, kind, text, created_at) VALUES (?, ?, 'system', ?, ?)", convId, actorId, JSON.stringify(data), Date.now()).lastInsertRowid),
    emitMessage: (id, uids) => sent.push({ to: 'members', ev: 'message:new', data: { id, uids } }),
    isActive: (uid) => activeUsers.has(uid),
    isBot: (uid) => uid === 9,
    notify: async (uid, p) => pushes.push({ uid, ...p }),
    ringMs: 300,
    resumeMs: 200,
  });
  await new Promise((resolve) => {
    srv = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv?.close());

test('gọi video, trả lời, chuyển dữ liệu kết nối, kết thúc', async () => {
  const an = connect(1);
  const binhPhone = connect(2);
  const binhWeb = connect(2);
  const r = await an.call('call:start', { conversationId: 201, video: true });
  assert.ok(r.call, r.error);
  assert.equal(r.call.video, true);
  assert.equal(r.call.callee.displayName, 'Bình');
  assert.ok(r.call.iceServers.some((s) => String(s.urls).includes('stun:')));
  const incoming = last('call:incoming', 'user:2');
  assert.equal(incoming.data.id, r.call.id);
  // Bình không mở app: có thông báo đẩy "đang gọi"
  const ring = pushes.find((p) => p.type === 'call' && p.uid === 2);
  assert.equal(ring.callId, r.call.id);
  assert.equal(ring.tag, 'call-201');
  // Đang gọi thì không gọi thêm được
  assert.match((await connect(3).call('call:start', { conversationId: 202 })).error, /bận/);
  // Bình trả lời trên điện thoại: máy web thôi đổ chuông
  const acc = await binhPhone.call('call:accept', { callId: r.call.id });
  assert.equal(acc.call.state, 'active');
  assert.equal(last('call:accepted', an.id).data.callId, r.call.id);
  const elsewhere = last('call:ended', 'user:2');
  assert.equal(elsewhere.except, binhPhone.id);
  assert.equal(elsewhere.data.reason, 'elsewhere');
  assert.match((await binhWeb.call('call:accept', { callId: r.call.id })).error, /máy khác/);
  // Trao đổi SDP / ICE chỉ giữa hai máy đang gọi
  await an.call('call:signal', { callId: r.call.id, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
  assert.equal(last('call:signal', binhPhone.id).data.data.sdp.type, 'offer');
  await binhPhone.call('call:signal', { callId: r.call.id, data: { candidate: { candidate: 'x' } } });
  assert.ok(last('call:signal', an.id).data.data.candidate);
  assert.match((await binhWeb.call('call:signal', { callId: r.call.id, data: { sdp: {} } })).error, /máy khác/);
  assert.match((await connect(3).call('call:signal', { callId: r.call.id, data: {} })).error, /kết thúc/);
  await binhPhone.call('call:media', { callId: r.call.id, muted: true, camera: false });
  assert.deepEqual(last('call:media', an.id).data, { callId: r.call.id, userId: 2, muted: true, camera: false });
  assert.equal((await (await fetch(`${base}/api/calls/current`, { headers: { 'x-user': '2' } })).json()).call.id, r.call.id);
  await sleep(1100);
  await an.call('call:end', { callId: r.call.id });
  const ended = last('call:ended', 'user:1');
  assert.equal(ended.data.reason, 'ended');
  assert.ok(ended.data.duration >= 1);
  const sys = sysMessages(201).at(-1);
  assert.deepEqual({ ...sys, duration: sys.duration >= 1 }, { event: 'call', video: true, status: 'ended', duration: true, to: 2 });
  assert.equal(calls.active(), 0);
  assert.equal((await (await fetch(`${base}/api/calls/current`, { headers: { 'x-user': '2' } })).json()).call, null);
});

test('không ai trả lời: cuộc gọi nhỡ + thông báo; từ chối; không gọi được nhóm và Think AI', async () => {
  const an = connect(1);
  const chi = connect(3);
  const r = await an.call('call:start', { conversationId: 202, video: false });
  await sleep(400);
  assert.equal(last('call:ended', 'user:3').data.reason, 'missed');
  assert.deepEqual(sysMessages(202).at(-1), { event: 'call', video: false, status: 'missed', duration: 0, to: 3 });
  const missed = pushes.find((p) => p.type === 'call_missed' && p.uid === 3);
  assert.equal(missed.body, '📞 Cuộc gọi thoại nhỡ');
  // Từ chối
  const r2 = await an.call('call:start', { conversationId: 202 });
  assert.notEqual(r2.call.id, r.call.id);
  await chi.call('call:decline', { callId: r2.call.id });
  assert.equal(last('call:ended', 'user:1').data.reason, 'declined');
  assert.equal(sysMessages(202).at(-1).status, 'declined');
  // Người gọi hủy trước khi bên kia nghe = cuộc gọi nhỡ
  const r3 = await an.call('call:start', { conversationId: 202 });
  await an.call('call:end', { callId: r3.call.id });
  assert.equal(last('call:ended', 'user:3').data.reason, 'canceled');
  assert.equal(sysMessages(202).at(-1).status, 'missed');
  assert.match((await an.call('call:start', { conversationId: 204 })).error, /cuộc trò chuyện riêng/);
  assert.match((await an.call('call:start', { conversationId: 203 })).error, /Think AI/);
  assert.match((await chi.call('call:start', { conversationId: 201 })).error, /Không tìm thấy/);
});

test('mở app khi đang có người gọi: hiện cuộc gọi đến; mất kết nối thì đợi nối lại', async () => {
  activeUsers.add(2);
  const before = pushes.length;
  const an = connect(1);
  const r = await an.call('call:start', { conversationId: 201 });
  assert.equal(pushes.length, before); // Bình đang mở app: không cần thông báo đẩy
  const late = connect(2);
  assert.equal(last('call:incoming', late.id).data.id, r.call.id);
  await late.call('call:accept', { callId: r.call.id });
  // An rớt mạng rồi nối lại kịp
  an.drop();
  const an2 = connect(1);
  const back = await an2.call('call:rejoin', { callId: r.call.id });
  assert.equal(back.call.state, 'active');
  await sleep(300);
  assert.equal(calls.active(), 1);
  await late.call('call:signal', { callId: r.call.id, data: { sdp: { type: 'answer' } } });
  assert.equal(last('call:signal', an2.id).data.data.sdp.type, 'answer');
  // Bình rớt mạng hẳn: cuộc gọi tự kết thúc
  late.drop();
  await sleep(300);
  assert.equal(calls.active(), 0);
  assert.equal(last('call:ended', 'user:1').data.reason, 'dropped');
  activeUsers.delete(2);
});

test('admin đặt máy chủ TURN (mật khẩu không gửi lại)', async () => {
  const put = async (body) => {
    const res = await fetch(`${base}/api/admin/calls`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  assert.equal((await put({ turnUrls: 'http://x' })).status, 400);
  const ok = await put({ turnUrls: 'turn:turn.example.com:3478, turns:turn.example.com:443?transport=tcp', turnUsername: 'u1', turnCredential: 'secret-pass' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.calls.hasCredential, true);
  assert.equal(JSON.stringify(ok.data).includes('secret-pass'), false);
  const ice = await (await fetch(`${base}/api/calls/ice`)).json();
  const turn = ice.iceServers.find((s) => s.username === 'u1');
  assert.deepEqual(turn.urls, ['turn:turn.example.com:3478', 'turns:turn.example.com:443?transport=tcp']);
  assert.equal(turn.credential, 'secret-pass');
  await put({ turnUrls: '' });
  assert.equal((await (await fetch(`${base}/api/calls/ice`)).json()).iceServers.length, 1);
});
