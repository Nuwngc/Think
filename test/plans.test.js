'use strict';
// Kiểm thử 2.16.0: kèo (src/events.js), hẹn giờ gửi tin (src/scheduled.js), giữ máy chủ thức (src/keep-awake.js),
// công thức toán / hóa (public/formula-core.js) — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-plans-'));
const express = require('express');
const { run, get, all } = require('../src/db');
const { setupEvents, eventData, eventSummary, eventText, remindAtFor, vnWhen, leftText } = require('../src/events');
const { setupScheduled } = require('../src/scheduled');
const { setupKeepAwake } = require('../src/keep-awake');
const { cleanMentions } = require('../src/chat-plus');
const F = require('../public/formula-core.js');

const sent = []; // socket: { to, ev, data }
const pushes = []; // { uid, payload }
const posted = []; // tin do máy chủ gửi thay (hẹn giờ)
const notified = []; // notifyMembers
const io = { to: (room) => ({ emit: (ev, data) => sent.push({ to: room, ev, data }) }) };
const lastTo = (room, ev) => [...sent].reverse().find((e) => e.to === room && e.ev === ev);

let base;
let srv;
let events;
let scheduled;
let groupId;
const call = async (uid, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-user': String(uid) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const membership = (convId, uid) => get('SELECT last_read_id FROM members WHERE conversation_id = ? AND user_id = ?', convId, uid);
const memberIds = (convId) => all('SELECT user_id FROM members WHERE conversation_id = ?', convId).map((r) => r.user_id);
const loadMessage = (id) => {
  const m = get('SELECT * FROM messages WHERE id = ?', id);
  if (!m) return null;
  const out = { id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, kind: m.kind, text: m.text, deleted: Boolean(m.deleted), createdAt: m.created_at };
  if (m.kind === 'event' && !m.deleted) out.event = eventData(m.id);
  if (m.mentions) out.mentions = m.mentions.split(',').map(Number);
  return out;
};
const systemMessage = (convId, actorId, data) =>
  Number(run("INSERT INTO messages (conversation_id, sender_id, kind, text, created_at) VALUES (?, ?, 'system', ?, ?)", convId, actorId, JSON.stringify(data), Date.now()).lastInsertRowid);

test.before(async () => {
  for (const [id, u, n] of [[1, 'an', 'An'], [2, 'binh', 'Bình'], [3, 'chi', 'Chi'], [4, 'dung', 'Dũng'], [5, 'admin', 'Admin']]) {
    run('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, 0)', id, u, n, 'x');
  }
  groupId = Number(run("INSERT INTO conversations (type, name, created_at) VALUES ('group', 'Hội bạn', 0)").lastInsertRowid);
  for (const uid of [1, 2, 3]) run('INSERT INTO members (conversation_id, user_id) VALUES (?, ?)', groupId, uid);
  const app = express();
  app.use(express.json());
  const fakeAuth = (req, res, next) => {
    const id = Number(req.get('x-user'));
    req.user = { id, role: id === 5 ? 'admin' : 'member' };
    next();
  };
  const common = { app, io, requireAuth: fakeAuth, requireReady: (q, s, n) => n(), membership, memberIds, loadMessage };
  events = setupEvents({
    ...common,
    systemMessage,
    emitMessage: (id, uids) => uids.forEach((uid) => sent.push({ to: `user:${uid}`, ev: 'message:new', data: loadMessage(id) })),
    notifyMembers: async (conv, message, members) => notified.push({ conv: conv.id, message, members }),
    notify: async (uid, payload) => pushes.push({ uid, payload }),
  });
  scheduled = setupScheduled({
    ...common,
    cleanMentions,
    postMessage: (convId, senderId, { text, mentions, ai }) => {
      const m = { conversationId: convId, senderId, text, mentions, ai };
      posted.push(m);
      return m;
    },
  });
  await new Promise((resolve) => {
    srv = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv?.close());

/* ---------------- Kèo ---------------- */

test('giờ nhắc kèo: trước 1 tiếng, kèo gấp thì 15 phút, gấp hơn thì không nhắc', () => {
  const now = 1_000_000_000_000;
  assert.equal(remindAtFor(now + 3 * 3600_000, now), now + 2 * 3600_000);
  assert.equal(remindAtFor(now + 65 * 60_000, now), now + 5 * 60_000);
  assert.equal(remindAtFor(now + 40 * 60_000, now), now + 25 * 60_000);
  assert.equal(remindAtFor(now + 10 * 60_000, now), null);
  assert.equal(leftText(3600_000), '1 tiếng');
  assert.equal(leftText(15 * 60_000), '15 phút');
  assert.equal(leftText(80 * 60_000), '1 tiếng 20 phút');
  // Giờ Việt Nam: 2026-10-10 13:00 UTC = 20:00 thứ Bảy 10/10
  const sat = Date.UTC(2026, 9, 10, 13, 0);
  assert.equal(vnWhen(sat, sat - 3600_000), '20:00 hôm nay');
  assert.equal(vnWhen(sat, sat - 86400_000), '20:00 ngày mai');
  assert.equal(vnWhen(sat, sat - 3 * 86400_000), '20:00 thứ Bảy 10/10');
});

let keo;
test('tạo kèo: kiểm tra dữ liệu, người tạo tự chọn Đi, cả nhóm nhận tin', async () => {
  const at = Date.now() + 3 * 3600_000;
  assert.equal((await call(4, 'POST', `/api/conversations/${groupId}/events`, { title: 'Lẩu', startsAt: at })).status, 404); // không trong nhóm
  assert.equal((await call(1, 'POST', `/api/conversations/${groupId}/events`, { title: '  ', startsAt: at })).status, 400);
  assert.equal((await call(1, 'POST', `/api/conversations/${groupId}/events`, { title: 'a'.repeat(101), startsAt: at })).status, 400);
  assert.equal((await call(1, 'POST', `/api/conversations/${groupId}/events`, { title: 'Lẩu', startsAt: Date.now() - 1000 })).status, 400);
  assert.equal((await call(1, 'POST', `/api/conversations/${groupId}/events`, { title: 'Lẩu', startsAt: Date.now() + 400 * 86400_000 })).status, 400);
  const r = await call(1, 'POST', `/api/conversations/${groupId}/events`, { title: ' Đi ăn\nlẩu ', place: 'Quán cũ', startsAt: at });
  assert.equal(r.status, 200);
  keo = r.data.message;
  assert.equal(keo.kind, 'event');
  assert.equal(keo.text, 'Đi ăn lẩu');
  assert.deepEqual(keo.event, { place: 'Quán cũ', startsAt: at, canceled: false, yes: [1], maybe: [], no: [] });
  for (const uid of [1, 2, 3]) assert.ok(lastTo(`user:${uid}`, 'message:new'));
  assert.equal(notified.at(-1).message.id, keo.id);
  assert.match(eventSummary(keo), /^📅 Kèo: Đi ăn lẩu · \d\d:\d\d (hôm nay|ngày mai) · Quán cũ$/);
  assert.match(eventText(keo.id, keo.text), /^\[kèo\] Đi ăn lẩu · .+ · Quán cũ$/);
  assert.equal(get('SELECT remind_at FROM events WHERE message_id = ?', keo.id).remind_at, at - 3600_000);
});

test('Đi / Có thể / Không đi, bỏ chọn; người ngoài nhóm không chọn được', async () => {
  assert.equal((await call(2, 'POST', `/api/messages/${keo.id}/rsvp`, { status: 'sure' })).status, 400);
  assert.equal((await call(4, 'POST', `/api/messages/${keo.id}/rsvp`, { status: 'yes' })).status, 404);
  let r = await call(2, 'POST', `/api/messages/${keo.id}/rsvp`, { status: 'maybe' });
  assert.deepEqual([r.data.message.event.yes, r.data.message.event.maybe], [[1], [2]]);
  assert.equal(lastTo('user:3', 'message:updated').data.message.id, keo.id);
  r = await call(3, 'POST', `/api/messages/${keo.id}/rsvp`, { status: 'no' });
  assert.deepEqual(r.data.message.event.no, [3]);
  r = await call(3, 'POST', `/api/messages/${keo.id}/rsvp`, { status: 'yes' });
  assert.deepEqual([r.data.message.event.yes, r.data.message.event.no], [[1, 3], []]);
  r = await call(3, 'POST', `/api/messages/${keo.id}/rsvp`, { status: null });
  assert.deepEqual(r.data.message.event.yes, [1]);
  await call(3, 'POST', `/api/messages/${keo.id}/rsvp`, { status: 'no' });
  // Không phải kèo
  const text = Number(run("INSERT INTO messages (conversation_id, sender_id, kind, text, created_at) VALUES (?, 1, 'text', 'hi', 0)", groupId).lastInsertRowid);
  assert.equal((await call(1, 'POST', `/api/messages/${text}/rsvp`, { status: 'yes' })).status, 404);
});

test('nhắc trước giờ hẹn: chỉ người chọn Đi / Có thể, một lần; thêm dòng nhắc trong nhóm', () => {
  const e = get('SELECT * FROM events WHERE message_id = ?', keo.id);
  pushes.length = 0;
  assert.equal(events.sweep(e.remind_at - 1000), 0); // chưa tới giờ
  assert.equal(events.nextDue(), e.remind_at);
  assert.equal(events.sweep(e.remind_at + 1000), 2);
  assert.deepEqual(pushes.map((p) => p.uid).sort(), [1, 2]);
  assert.equal(pushes[0].payload.type, 'event');
  assert.equal(pushes[0].payload.conversationId, groupId);
  assert.match(pushes[0].payload.title, /^⏰ Còn 1 tiếng nữa: Đi ăn lẩu$/);
  assert.match(pushes[0].payload.body, / · Quán cũ$/);
  const sys = get("SELECT * FROM messages WHERE conversation_id = ? AND kind = 'system' ORDER BY id DESC LIMIT 1", groupId);
  assert.deepEqual(JSON.parse(sys.text), { event: 'keo-remind', title: 'Đi ăn lẩu', startsAt: e.starts_at, messageId: keo.id });
  assert.equal(events.sweep(e.remind_at + 60_000), 0); // không nhắc lại
  assert.equal(events.nextDue(), null);
});

test('máy chủ thức dậy khi kèo đã bắt đầu thì không nhắc', async () => {
  const at = Date.now() + 2 * 3600_000;
  const r = await call(2, 'POST', `/api/conversations/${groupId}/events`, { title: 'Đá bóng', startsAt: at });
  pushes.length = 0;
  assert.equal(events.sweep(at + 60_000), 0);
  assert.equal(get('SELECT reminded FROM events WHERE message_id = ?', r.data.message.id).reminded, 1);
});

test('hủy kèo: chỉ người tạo hoặc quản trị viên; báo người đã chọn Đi / Có thể', async () => {
  assert.equal((await call(2, 'POST', `/api/messages/${keo.id}/event/cancel`, {})).status, 403);
  pushes.length = 0;
  const r = await call(1, 'POST', `/api/messages/${keo.id}/event/cancel`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.message.event.canceled, true);
  assert.deepEqual(pushes.map((p) => p.uid), [2]); // Bình chọn Có thể; Chi chọn Không đi; An là người hủy
  assert.equal(pushes[0].payload.title, 'Kèo “Đi ăn lẩu” đã bị hủy');
  const sys = get("SELECT * FROM messages WHERE conversation_id = ? AND kind = 'system' ORDER BY id DESC LIMIT 1", groupId);
  assert.equal(JSON.parse(sys.text).event, 'keo-cancel');
  assert.equal((await call(2, 'POST', `/api/messages/${keo.id}/rsvp`, { status: 'yes' })).status, 400); // đã hủy
  assert.match(eventText(keo.id, keo.text), /\(đã hủy\)$/);
  // Quản trị viên hủy được kèo của người khác (dù không trong nhóm thì vẫn phải là thành viên mới thấy)
  const k2 = (await call(2, 'POST', `/api/conversations/${groupId}/events`, { title: 'Cà phê', startsAt: Date.now() + 86400_000 })).data.message;
  run('INSERT INTO members (conversation_id, user_id) VALUES (?, 5)', groupId);
  assert.equal((await call(5, 'POST', `/api/messages/${k2.id}/event/cancel`, {})).status, 200);
  run('DELETE FROM members WHERE conversation_id = ? AND user_id = 5', groupId);
});

/* ---------------- Hẹn giờ gửi tin ---------------- */

test('hẹn giờ gửi: kiểm tra dữ liệu, danh sách riêng từng người', async () => {
  const at = Date.now() + 3600_000;
  assert.equal((await call(4, 'POST', `/api/conversations/${groupId}/scheduled`, { text: 'hi', sendAt: at })).status, 404);
  assert.equal((await call(1, 'POST', `/api/conversations/${groupId}/scheduled`, { text: '   ', sendAt: at })).status, 400);
  assert.equal((await call(1, 'POST', `/api/conversations/${groupId}/scheduled`, { text: 'hi', sendAt: Date.now() + 10_000 })).status, 400);
  assert.equal((await call(1, 'POST', `/api/conversations/${groupId}/scheduled`, { text: 'x'.repeat(4001), sendAt: at })).status, 400);
  const r = await call(1, 'POST', `/api/conversations/${groupId}/scheduled`, { text: 'Chúc mừng sinh nhật @Bình 🎂', sendAt: at, mentions: [2, 4] });
  assert.equal(r.status, 200);
  assert.equal(r.data.scheduled.length, 1);
  assert.deepEqual(r.data.item.mentions, [2]); // Dũng không trong nhóm
  assert.equal(lastTo('user:1', 'scheduled:changed').data.scheduled.length, 1);
  assert.equal((await call(2, 'GET', '/api/scheduled')).data.scheduled.length, 0); // người khác không thấy
  assert.equal((await call(2, 'DELETE', `/api/scheduled/${r.data.item.id}`)).status, 404);
  assert.equal(scheduled.nextDue(), at);
});

test('đến giờ thì gửi như tin thường (có gọi Think AI), xóa khỏi danh sách', async () => {
  const before = (await call(1, 'GET', '/api/scheduled')).data.scheduled;
  posted.length = 0;
  assert.equal(scheduled.sweep(before[0].sendAt - 1000), 0);
  assert.equal(scheduled.sweep(before[0].sendAt + 1000), 1);
  assert.deepEqual(posted, [{ conversationId: groupId, senderId: 1, text: 'Chúc mừng sinh nhật @Bình 🎂', mentions: [2], ai: true }]);
  assert.equal((await call(1, 'GET', '/api/scheduled')).data.scheduled.length, 0);
  assert.equal(lastTo('user:1', 'scheduled:changed').data.scheduled.length, 0);
  assert.equal(scheduled.nextDue(), null);
});

test('gửi ngay, hủy; đã rời nhóm thì bỏ tin', async () => {
  const at = Date.now() + 86400_000;
  const a = (await call(2, 'POST', `/api/conversations/${groupId}/scheduled`, { text: 'Tin A', sendAt: at })).data.item;
  const b = (await call(2, 'POST', `/api/conversations/${groupId}/scheduled`, { text: 'Tin B', sendAt: at + 1000 })).data.item;
  const c = (await call(3, 'POST', `/api/conversations/${groupId}/scheduled`, { text: 'Tin C', sendAt: at })).data.item;
  posted.length = 0;
  let r = await call(2, 'POST', `/api/scheduled/${a.id}/send`, {});
  assert.equal(r.status, 200);
  assert.equal(posted[0].text, 'Tin A');
  assert.deepEqual(r.data.scheduled.map((s) => s.id), [b.id]);
  r = await call(2, 'DELETE', `/api/scheduled/${b.id}`);
  assert.deepEqual(r.data.scheduled, []);
  assert.equal((await call(2, 'POST', `/api/scheduled/${b.id}/send`, {})).status, 404);
  run('DELETE FROM members WHERE conversation_id = ? AND user_id = 3', groupId);
  posted.length = 0;
  assert.equal(scheduled.sweep(at + 5000), 0);
  assert.equal(posted.length, 0);
  assert.equal(get('SELECT 1 AS x FROM scheduled_messages WHERE id = ?', c.id), undefined);
  run('INSERT INTO members (conversation_id, user_id) VALUES (?, 3)', groupId);
});

test('mỗi người tối đa 50 tin hẹn giờ', async () => {
  const at = Date.now() + 86400_000;
  for (let i = 0; i < 50; i++) run('INSERT INTO scheduled_messages (conversation_id, user_id, text, send_at, created_at) VALUES (?, 3, ?, ?, 0)', groupId, `t${i}`, at);
  const r = await call(3, 'POST', `/api/conversations/${groupId}/scheduled`, { text: 'nữa', sendAt: at });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /50 tin hẹn giờ/);
  run('DELETE FROM scheduled_messages WHERE user_id = 3');
});

/* ---------------- Giữ máy chủ thức ---------------- */

test('giữ máy chủ thức: chỉ khi có địa chỉ công khai và còn việc trong 3 ngày tới', async () => {
  const pings = [];
  let due = null;
  const ka = setupKeepAwake({ nextDue: () => due, url: 'https://think.example.com/', every: 3600_000, ping: async (u) => pings.push(u) });
  const now = Date.now();
  assert.equal(await ka.tick(now), false);
  due = now + 4 * 86400_000;
  assert.equal(await ka.tick(now), false);
  due = now + 3600_000;
  assert.equal(await ka.tick(now), true);
  assert.deepEqual(pings, ['https://think.example.com/api/config']);
  const off = setupKeepAwake({ nextDue: () => now, url: '' });
  assert.equal(off.enabled, false);
  assert.equal(await off.tick(now), false);
});

/* ---------------- Công thức toán, hóa ---------------- */

test('công thức: mũ, chỉ số dưới, ion; không đụng mặt cười, đường dẫn, tên file', () => {
  const u = F.toUnicode;
  assert.equal(u('x^2 + y^2 = r^2'), 'x² + y² = r²');
  assert.equal(u('x^2+1'), 'x²+1');
  assert.equal(u('10^-3'), '10⁻³');
  assert.equal(u('e^x'), 'eˣ');
  assert.equal(u('2^(n+1)'), '2ⁿ⁺¹');
  assert.equal(u('x^{n-1}'), 'xⁿ⁻¹');
  assert.equal(u('H_2O'), 'H₂O');
  assert.equal(u('2H_2 + O_2 → 2H_2O'), '2H₂ + O₂ → 2H₂O');
  assert.equal(u('Fe^3+ và SO_4^2-'), 'Fe³⁺ và SO₄²⁻');
  assert.equal(u('Na^+ + Cl^-'), 'Na⁺ + Cl⁻');
  assert.equal(u('C_{n}H_{2n+2}'), 'CₙH₂ₙ₊₂');
  assert.equal(u('Ca(OH)_2'), 'Ca(OH)₂');
  assert.equal(u('x^{1/2} và 10^{1.5}'), 'x¹⁄² và 10¹·⁵');
  assert.equal(u('e^{iπ}'), 'e^(iπ)'); // π không có dạng nhỏ: giữ dạng dễ đọc
  assert.equal(u('NaHCO_3, KMnO_4, K_2Cr_2O_7, C_6H_{12}O_6'), 'NaHCO₃, KMnO₄, K₂Cr₂O₇, C₆H₁₂O₆');
  assert.equal(u('log_2 x và m^2, cm^3'), 'log₂ x và m², cm³');
  const keeps = ['^_^', 'T_T', 'O_o', '-_-', 'u_u', 'n^^', 'IMG_2024.jpg', 'snake_case', 'x^', 'x^T', 'x_n', 'https://a.vn/x_1^2',
    'minh_12@gmail.com', 'wifi: Nha_88', 'file_12.png', 'www.site.vn/a_1', 'pass: abc_12'];
  for (const keep of keeps) assert.equal(u(keep), keep);
  assert.equal(F.has('H_2O'), true);
  assert.equal(F.has('chào ^_^'), false);
  assert.deepEqual(F.parse('a^{b}c'), [{ t: 'text', s: 'a' }, { t: 'sup', s: 'b' }, { t: 'text', s: 'c' }]);
  assert.equal(F.sup('n+1'), 'ⁿ⁺¹');
  assert.equal(F.sub('q'), null);
});

test('bàn phím ký hiệu: chèn tại con trỏ, bọc chữ đang bôi đen', () => {
  assert.deepEqual(F.insert('x', 1, 1, '²'), { value: 'x²', caret: 2 });
  assert.deepEqual(F.insert('x + 1', 1, 1, '^{‸}'), { value: 'x^{} + 1', caret: 3 });
  assert.deepEqual(F.insert('2 n+1', 2, 5, '^{‸}'), { value: '2 ^{n+1}', caret: 8 });
  assert.deepEqual(F.insert('', null, null, '√(‸)'), { value: '√()', caret: 2 });
  for (const g of F.PAD) {
    assert.ok(g.keys.length >= 20, g.id);
    for (const k of g.keys) assert.ok(typeof k[0] === 'string' && k[0].length > 0);
  }
});
