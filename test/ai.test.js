'use strict';
// Kiểm thử Think AI (src/ai.js) với một dịch vụ AI giả chạy trên máy — chạy: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-ai-'));
delete process.env.GEMINI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.AI_BASE_URL;
delete process.env.AI_PROVIDER;
delete process.env.AI_MODEL;
const express = require('express');
const { run, get, all, GENERAL_ID, IMAGE_DIR } = require('../src/db');
const auth = require('../src/auth');
const ai = require('../src/ai');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];
const pushes = [];
const requests = [];
let reply = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '**Chào** bạn!\n* một\n* hai' }] } }] } });
let mock;
let mockUrl;
let base;
let srv;
let hooks;

const io = { to: (room) => ({ emit: (ev, data) => events.push({ room, ev, data }) }) };
const loadMessage = (id) => {
  const m = get('SELECT * FROM messages WHERE id = ?', id);
  const r = m.reply_to ? get('SELECT sender_id FROM messages WHERE id = ?', m.reply_to) : null;
  return { id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, kind: m.kind, text: m.text, image: m.image, deleted: false, replyTo: r ? { id: m.reply_to, senderId: r.sender_id } : null };
};
const memberIds = (convId) => all('SELECT user_id FROM members WHERE conversation_id = ?', convId).map((r) => r.user_id);

/** Người gửi tin như server.js làm, rồi báo cho Think AI */
function send(convId, uid, text, extra = {}) {
  const id = Number(run("INSERT INTO messages (conversation_id, sender_id, kind, text, image, reply_to, created_at) VALUES (?, ?, 'text', ?, ?, ?, ?)", convId, uid, text, extra.image || null, extra.replyTo || null, Date.now()).lastInsertRowid);
  run('UPDATE conversations SET last_message_id = ? WHERE id = ?', id, convId);
  const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
  return { id, started: hooks.onMessage(conv, loadMessage(id)) };
}
const botMessages = (convId) => all('SELECT * FROM messages WHERE conversation_id = ? AND sender_id = ? ORDER BY id', convId, ai.getBotId());
async function waitBot(convId, count) {
  for (let i = 0; i < 100; i++) {
    const rows = botMessages(convId);
    if (rows.length >= count) return rows;
    await sleep(20);
  }
  throw new Error(`Think AI chưa trả lời (cuộc trò chuyện ${convId})`);
}
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

let dmId;
test.before(async () => {
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (1, 'an', 'An', 'x', 0)");
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (2, 'binh', 'Bình', 'x', 0)");
  run("INSERT INTO conversations (id, type, name, created_at) VALUES (102, 'group', 'Hội bạn', 0)");
  for (const u of [1, 2]) run('INSERT INTO members (conversation_id, user_id, last_read_id) VALUES (102, ?, 0)', u);
  for (const u of [1, 2]) run('INSERT OR IGNORE INTO members (conversation_id, user_id, last_read_id) VALUES (?, ?, 0)', GENERAL_ID, u);

  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const r = { url: req.url, headers: req.headers, body: JSON.parse(body || '{}') };
      requests.push(r);
      const out = reply(r);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise((resolve) => mock.listen(0, resolve));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;

  const app = express();
  app.use(express.json());
  const pass = (req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
  };
  hooks = ai.setupAI({
    app,
    io,
    requireAuth: pass,
    requireReady: pass,
    requireAdmin: pass,
    memberIds,
    loadMessage,
    notifyMembers: async (conv, message, members) => pushes.push({ conv: conv.id, message: message.id, members }),
    publicUser: (u) => ({ id: u.id, displayName: u.display_name, bot: u.role === 'bot' }),
    readImage: async (url) => ai.readLocalImage(url),
  });
  await new Promise((resolve) => {
    srv = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
  // Cuộc trò chuyện riêng An ↔ Think AI (giống POST /api/conversations/dm)
  const botId = ai.getBotId();
  dmId = Number(run("INSERT INTO conversations (type, dm_key, created_at) VALUES ('dm', ?, 0)", `1:${botId}`).lastInsertRowid);
  run('INSERT INTO members (conversation_id, user_id) VALUES (?, 1)', dmId);
  run('INSERT INTO members (conversation_id, user_id) VALUES (?, ?)', dmId, botId);
});
test.after(() => {
  srv?.close();
  mock?.close();
});

test('tài khoản Think AI: không đăng nhập được, không ở phòng chung, tạo lại không bị trùng', async () => {
  const bot = get('SELECT * FROM users WHERE id = ?', ai.getBotId());
  assert.equal(bot.role, 'bot');
  assert.equal(bot.display_name, 'Think AI');
  assert.equal(bot.avatar, '/icons/think-ai.png');
  assert.equal(await auth.verifyPassword('', bot.password_hash), false);
  assert.equal(await auth.verifyPassword('!', bot.password_hash), false);
  assert.equal(get('SELECT COUNT(*) AS n FROM members WHERE conversation_id = ? AND user_id = ?', GENERAL_ID, bot.id).n, 0);
  assert.equal(ai.ensureBot(), bot.id);
  assert.equal(get("SELECT COUNT(*) AS n FROM users WHERE role = 'bot'").n, 1);
  const r = await call('GET', '/api/ai');
  assert.equal(r.data.bot.id, bot.id);
  assert.equal(r.data.ready, false);
});

test('gọi tên @Think AI: nhận đúng cách viết', () => {
  for (const t of ['@Think AI ơi', 'hỏi @AI cái này', '@thinkai giúp với', 'Ê @Think AI, mấy giờ rồi?', '(@ai)']) assert.equal(ai.mentionsBot(t), true, t);
  for (const t of ['email@ai.com', '@AIden chào', 'think ai', '@Thinker']) assert.equal(ai.mentionsBot(t), false, t);
});

test('chưa có khóa API: Think AI chỉ cách cài, không gọi dịch vụ AI', async () => {
  send(dmId, 1, 'xin chào');
  const [m] = await waitBot(dmId, 1);
  assert.match(m.text, /chưa được cài đặt/);
  assert.equal(requests.length, 0);
});

test('nhắn riêng: hỏi Gemini kèm lịch sử, bỏ Markdown, báo đang nhập và đã xem', async () => {
  const saved = ai.saveSettings({ provider: 'gemini', apiKey: 'test-key-1234', baseUrl: mockUrl, model: 'gemini-test' });
  assert.equal(saved.ready, true);
  assert.equal(saved.keyHint, '…1234');
  assert.equal(JSON.stringify(saved).includes('test-key-1234'), false); // không trả khóa API
  events.length = 0;
  const { id } = send(dmId, 1, 'Thủ đô Việt Nam là gì?');
  const rows = await waitBot(dmId, 2);
  assert.equal(rows[1].text, 'Chào bạn!\n• một\n• hai');
  assert.equal(rows[1].reply_to, null); // chat riêng không cần trả lời từng tin
  const req = requests.at(-1);
  assert.equal(req.url, '/models/gemini-test:generateContent');
  assert.equal(req.headers['x-goog-api-key'], 'test-key-1234');
  assert.match(req.body.system_instruction.parts[0].text, /Think AI/);
  assert.equal(req.body.contents.at(-1).role, 'user');
  assert.match(JSON.stringify(req.body.contents.at(-1)), /Thủ đô Việt Nam/);
  assert.equal(req.body.contents[0].role, 'user'); // bắt đầu bằng lượt người hỏi
  assert.equal(req.body.tools, undefined);
  assert.ok(events.some((e) => e.ev === 'typing' && e.data.userId === ai.getBotId()));
  assert.ok(events.some((e) => e.ev === 'read' && e.data.lastReadId === id));
  assert.ok(pushes.some((p) => p.message === rows[1].id)); // thông báo cho người hỏi nếu đã rời app
});

test('nhóm: chỉ trả lời khi gọi @Think AI hoặc trả lời tin của Think AI; ngữ cảnh có tên người gửi', async () => {
  const before = requests.length;
  assert.equal(send(102, 2, 'đi ăn không mọi người').started, false);
  const { id } = send(102, 1, '@Think AI gợi ý món ăn tối đi');
  const rows = await waitBot(102, 1);
  assert.equal(rows[0].reply_to, id);
  assert.equal(requests.length, before + 1);
  const ctx = JSON.stringify(requests.at(-1).body.contents);
  assert.match(ctx, /Bình: đi ăn không mọi người/);
  assert.match(ctx, /An: @Think AI gợi ý món ăn tối đi/);
  assert.match(requests.at(-1).body.system_instruction.parts[0].text, /nhóm chat "Hội bạn"/);
  // Trả lời tin của Think AI (không cần gọi tên)
  assert.equal(send(102, 2, 'còn món chay?', { replyTo: rows[0].id }).started, true);
  await waitBot(102, 2);
  assert.equal(requests.at(-1).body.contents.at(-2).role, 'model');
});

test('ảnh trong tin nhắn được gửi cho AI; Gemini báo lỗi 400 thì hỏi lại không kèm ảnh', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1d1d8a70000000049454e44ae426082', 'hex');
  fs.writeFileSync(path.join(IMAGE_DIR, 'a1.png'), png);
  send(dmId, 1, 'ảnh này là gì?', { image: '/uploads/img/a1.png' });
  await waitBot(dmId, 3);
  const part = requests.at(-1).body.contents.at(-1).parts.find((p) => p.inline_data);
  assert.equal(part.inline_data.mime_type, 'image/png');
  assert.equal(part.inline_data.data, png.toString('base64'));
  let n = 0;
  reply = (r) => (r.body.contents.some((c) => c.parts.some((p) => p.inline_data)) ? { status: 400, body: { error: { message: 'bad image' } } } : { status: 200, body: { candidates: [{ content: { parts: [{ text: `lần ${++n}` }] } }] } });
  send(dmId, 1, 'xem lại ảnh', { image: '/uploads/img/a1.png' });
  const rows = await waitBot(dmId, 4);
  assert.equal(rows.at(-1).text, 'lần 1');
});

test('lỗi của dịch vụ AI thành câu dễ hiểu', async () => {
  reply = () => ({ status: 429, body: { error: { message: 'Resource exhausted' } } });
  send(dmId, 1, 'câu 1');
  let rows = await waitBot(dmId, 5);
  assert.match(rows.at(-1).text, /hết lượt miễn phí/);
  reply = () => ({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } });
  send(dmId, 1, 'câu 2');
  rows = await waitBot(dmId, 6);
  assert.match(rows.at(-1).text, /Khóa API/);
  const t = await call('POST', '/api/admin/ai/test');
  assert.equal(t.status, 400);
  assert.match(t.data.error, /Khóa API không đúng/);
});

test('hỏi quá nhanh thì nhắc đợi một phút', async () => {
  // An đã hỏi hơn 6 câu trong một phút ở các phần trên
  send(dmId, 1, 'câu 3');
  const rows = await waitBot(dmId, 7);
  assert.match(rows.at(-1).text, /hỏi nhanh quá/);
  ai.resetRateLimit();
});

test('dịch vụ kiểu OpenAI (Groq, OpenRouter...)', async () => {
  reply = (r) => ({ status: 200, body: { choices: [{ message: { content: `Model ${r.body.model} đây` } }] } });
  const r = await call('PUT', '/api/admin/ai', { provider: 'openai', baseUrl: `${mockUrl}/v1/`, model: 'llama-test', apiKey: 'sk-abcd' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ai.provider, 'openai');
  assert.equal(r.data.ai.baseUrl, `${mockUrl}/v1`);
  send(dmId, 1, 'chào');
  const rows = await waitBot(dmId, 8);
  assert.equal(rows.at(-1).text, 'Model llama-test đây');
  const req = requests.at(-1);
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer sk-abcd');
  assert.equal(req.body.messages[0].role, 'system');
  assert.ok(req.body.messages.some((m) => m.role === 'assistant'));
  const ok = await call('POST', '/api/admin/ai/test');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.ok, true);
  // Sai dữ liệu
  assert.equal((await call('PUT', '/api/admin/ai', { provider: 'abc' })).status, 400);
  assert.equal((await call('PUT', '/api/admin/ai', { baseUrl: 'ftp://x' })).status, 400);
  assert.equal((await call('PUT', '/api/admin/ai', { model: 'a b' })).status, 400);
  const view = (await call('GET', '/api/admin/ai')).data.ai;
  assert.equal(view.hasKey, true);
  assert.equal('apiKey' in view, false);
});

test('giới hạn mỗi người mỗi ngày, tắt Think AI', async () => {
  await call('PUT', '/api/admin/ai', { perUserDaily: 1 });
  const before = requests.length;
  send(dmId, 1, 'thêm một câu');
  const rows = await waitBot(dmId, 9);
  assert.match(rows.at(-1).text, /Hôm nay bạn đã hỏi đủ 1 câu/);
  assert.equal(requests.length, before);
  await call('PUT', '/api/admin/ai', { enabled: false, perUserDaily: 40 });
  send(dmId, 1, 'còn đó không');
  assert.match((await waitBot(dmId, 10)).at(-1).text, /tạm nghỉ/);
  assert.equal(ai.adminView().ready, false);
});

test('bỏ Markdown, cắt câu trả lời quá dài', () => {
  assert.equal(ai.plain('## Tiêu đề\n**Đậm** và `mã`\n- ý một\n\n\n\nhết'), 'Tiêu đề\nĐậm và mã\n• ý một\n\nhết');
  assert.equal(ai.plain('```js\nconst a = 1;\n```'), 'const a = 1;');
  const long = ai.plain('a'.repeat(5000));
  assert.equal(long.length, 3900);
  assert.ok(long.endsWith('…'));
});

test('Cerebras: model mặc định, nghĩ ít cho nhanh, phần suy nghĩ không lẫn vào câu trả lời', async () => {
  ai.resetRateLimit();
  // Đổi dịch vụ mà không ghi model / khóa / địa chỉ: về mặc định của Cerebras, khóa cũ bị bỏ
  const r = await call('PUT', '/api/admin/ai', { enabled: true, provider: 'cerebras' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ai.provider, 'cerebras');
  assert.equal(r.data.ai.model, 'qwen-3.8-27b');
  assert.equal(r.data.ai.hasKey, false);
  assert.equal(r.data.ai.baseUrl, '');
  assert.equal(ai.config().baseUrl, 'https://api.cerebras.ai/v1');
  // Thử với máy giả (địa chỉ API chỉ đặt được qua cài đặt, giao diện không hiện cho Cerebras)
  ai.saveSettings({ apiKey: 'csk-test-9876', baseUrl: `${mockUrl}/v1` });
  reply = () => ({ status: 200, body: { choices: [{ message: { content: '<think>nháp</think>**Xin chào** từ Cerebras', reasoning: 'nghĩ…' } }] } });
  send(dmId, 1, 'chào Cerebras');
  assert.equal((await waitBot(dmId, 11)).at(-1).text, 'Xin chào từ Cerebras');
  let req = requests.at(-1);
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer csk-test-9876');
  assert.equal(req.body.model, 'qwen-3.8-27b');
  assert.equal(req.body.reasoning_effort, 'low');
  assert.equal(req.body.reasoning_format, 'parsed');
  // Dịch vụ không nhận tham số suy nghĩ (400) thì hỏi lại không kèm
  reply = (q) => (q.body.reasoning_effort ? { status: 400, body: { message: 'unsupported parameter' } } : { status: 200, body: { choices: [{ message: { content: 'lần hai' } }] } });
  send(dmId, 1, 'hỏi lại');
  assert.equal((await waitBot(dmId, 12)).at(-1).text, 'lần hai');
  // Model khác (không phải gpt-oss / qwen): không gửi tham số suy nghĩ
  await call('PUT', '/api/admin/ai', { model: 'llama-test' });
  reply = () => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } });
  send(dmId, 1, 'câu ba');
  await waitBot(dmId, 13);
  req = requests.at(-1);
  assert.equal(req.body.model, 'llama-test');
  assert.equal('reasoning_effort' in req.body, false);
  // Khóa từ biến môi trường CEREBRAS_API_KEY
  ai.saveSettings({ apiKey: '' });
  process.env.CEREBRAS_API_KEY = 'csk-env-5555';
  try {
    const view = (await call('GET', '/api/admin/ai')).data.ai;
    assert.equal(view.keySource, 'env');
    assert.equal(view.keyHint, '…5555');
    assert.equal('apiKey' in view, false);
  } finally {
    delete process.env.CEREBRAS_API_KEY;
  }
});
