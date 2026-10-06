'use strict';
// Think AI (2.10.0): trợ lý AI trong chat, giống Meta AI.
// - Nhắn riêng với "Think AI" (một tài khoản đặc biệt role = 'bot', không đăng nhập được), hoặc gọi "@Think AI" / "@AI"
//   trong nhóm và phòng chung, hoặc trả lời (reply) một tin của Think AI.
// - Máy chủ gọi Google Gemini (mặc định, có gói miễn phí) hoặc một dịch vụ kiểu OpenAI (OpenAI, Groq, OpenRouter...).
// - Khóa API do admin nhập trong Quản trị → mục "AI, gọi" (lưu trong database, không bao giờ gửi lại cho máy người dùng)
//   hoặc đặt biến môi trường GEMINI_API_KEY / AI_API_KEY trên Render. Không gửi khóa qua tin nhắn.
// - Giới hạn số câu hỏi mỗi người mỗi ngày và cả máy chủ mỗi ngày (gói miễn phí có hạn mức).
const fs = require('node:fs');
const path = require('node:path');
const { get, all, run, transaction, getSetting, setSetting, searchKey, IMAGE_DIR } = require('./db');

const BOT_USERNAME = 'think.ai';
const BOT_NAME = 'Think AI';
const BOT_AVATAR = '/icons/think-ai.png';
const BOT_BIO = 'Trợ lý AI của Think. Nhắn riêng cho mình, hoặc gọi @Think AI trong nhóm.';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_URL = 'https://api.openai.com/v1';
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'; // tên gọi tắt luôn trỏ tới bản Gemini Flash mới nhất
const MAX_REPLY = 3900; // tin nhắn tối đa 4000 ký tự
const CONTEXT_MESSAGES = 16;
const MAX_IMAGES = 2;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const PER_MINUTE = 6; // mỗi người tối đa 6 câu / phút
const TIMEOUT_MS = 60_000;

const DEFAULTS = Object.freeze({
  enabled: true,
  provider: '', // 'gemini' | 'openai' ('' = tự chọn theo biến môi trường)
  model: '',
  baseUrl: '',
  apiKey: '',
  perUserDaily: 40,
  totalDaily: 300,
  search: false, // Gemini: tra Google cho câu hỏi về tin tức, thời tiết...
});

// "@Think AI", "@ThinkAI", "@AI" ở đầu tin hoặc sau khoảng trắng
const TRIGGER = /(^|[\s(“"'])@(think\s?ai|ai)(?=$|[\s,.:;!?)”"'])/i;
const mentionsBot = (text) => TRIGGER.test(String(text || ''));

class AiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code; // not_configured | quota | key | model | blocked | timeout | network | provider
    this.status = status;
  }
}

/* ---------------- Tài khoản Think AI ---------------- */

let botId = null;

function ensureBot() {
  let row = get("SELECT id FROM users WHERE role = 'bot' ORDER BY id LIMIT 1");
  if (!row) {
    // Tên đăng nhập trùng người thật (rất hiếm) thì thêm số phía sau. password_hash '!' không bao giờ khớp mật khẩu nào.
    let username = BOT_USERNAME;
    for (let i = 2; get('SELECT 1 AS x FROM users WHERE username = ?', username); i++) username = `${BOT_USERNAME}${i}`;
    const id = Number(
      run(
        "INSERT INTO users (username, display_name, password_hash, avatar, bio, role, must_change_password, created_at) VALUES (?, ?, '!', ?, ?, 'bot', 0, ?)",
        username,
        BOT_NAME,
        BOT_AVATAR,
        BOT_BIO,
        Date.now()
      ).lastInsertRowid
    );
    row = { id };
  }
  botId = row.id;
  run("UPDATE users SET display_name = ?, avatar = ?, bio = ?, disabled = 0, must_change_password = 0, password_hash = '!' WHERE id = ?", BOT_NAME, BOT_AVATAR, BOT_BIO, botId);
  run('DELETE FROM sessions WHERE user_id = ?', botId);
  // Think AI không là thành viên phòng chung / nhóm (chỉ ở trong cuộc trò chuyện riêng với từng người)
  run("DELETE FROM members WHERE user_id = ? AND conversation_id IN (SELECT id FROM conversations WHERE type <> 'dm')", botId);
  return botId;
}

const getBotId = () => botId;
const isBot = (uid) => botId != null && Number(uid) === botId;

/* ---------------- Cài đặt ---------------- */

function stored() {
  const s = getSetting('ai', null);
  return { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
}

/** Cấu hình đang dùng: cài đặt của admin, thiếu thì lấy biến môi trường */
function config() {
  const s = stored();
  const env = process.env;
  const provider = s.provider || env.AI_PROVIDER || (env.AI_BASE_URL && !env.GEMINI_API_KEY ? 'openai' : 'gemini');
  const gemini = provider !== 'openai';
  const envKey = gemini ? env.GEMINI_API_KEY || env.AI_API_KEY || '' : env.AI_API_KEY || '';
  const key = s.apiKey || envKey;
  return {
    enabled: s.enabled !== false,
    provider: gemini ? 'gemini' : 'openai',
    model: s.model || env.AI_MODEL || (gemini ? DEFAULT_GEMINI_MODEL : ''),
    baseUrl: String(s.baseUrl || env.AI_BASE_URL || (gemini ? GEMINI_URL : OPENAI_URL)).replace(/\/+$/, ''),
    apiKey: key,
    keySource: s.apiKey ? 'settings' : envKey ? 'env' : null,
    perUserDaily: s.perUserDaily,
    totalDaily: s.totalDaily,
    search: Boolean(s.search) && gemini,
  };
}

const ready = (c = config()) => c.enabled && Boolean(c.apiKey) && Boolean(c.model);

/** Thông tin cho trang Quản trị: không bao giờ trả khóa API, chỉ 4 ký tự cuối */
function adminView() {
  const c = config();
  const u = usage();
  return {
    enabled: c.enabled,
    provider: c.provider,
    model: c.model,
    baseUrl: stored().baseUrl || '',
    hasKey: Boolean(c.apiKey),
    keyHint: c.apiKey ? `…${c.apiKey.slice(-4)}` : null,
    keySource: c.keySource,
    perUserDaily: c.perUserDaily,
    totalDaily: c.totalDaily,
    search: c.search,
    ready: ready(c),
    usedToday: u.total,
    botId,
  };
}

function cleanInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Admin lưu cài đặt. apiKey: chuỗi mới / '' để xóa / bỏ trống trường (undefined) để giữ nguyên */
function saveSettings(body = {}) {
  const s = stored();
  const next = { ...s };
  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  if (body.provider !== undefined) {
    if (!['gemini', 'openai'].includes(body.provider)) throw new AiError('input', 'Chọn dịch vụ AI: Gemini hoặc kiểu OpenAI.');
    next.provider = body.provider;
  }
  if (body.model !== undefined) {
    const m = String(body.model || '').trim();
    if (m && !/^[\w.:/@-]{1,100}$/.test(m)) throw new AiError('input', 'Tên model chỉ gồm chữ, số và các dấu - _ . : /');
    next.model = m;
  }
  if (body.baseUrl !== undefined) {
    const u = String(body.baseUrl || '').trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw new AiError('input', 'Địa chỉ API phải bắt đầu bằng https://');
    next.baseUrl = u;
  }
  if (body.apiKey !== undefined && body.apiKey !== null) {
    const k = String(body.apiKey).trim();
    if (k.length > 300 || /\s/.test(k)) throw new AiError('input', 'Khóa API không hợp lệ.');
    next.apiKey = k;
  }
  if (body.perUserDaily !== undefined) next.perUserDaily = cleanInt(body.perUserDaily, 1, 1000, DEFAULTS.perUserDaily);
  if (body.totalDaily !== undefined) next.totalDaily = cleanInt(body.totalDaily, 1, 100000, DEFAULTS.totalDaily);
  if (body.search !== undefined) next.search = Boolean(body.search);
  // Đổi dịch vụ mà không nhập khóa mới: bỏ khóa cũ (khóa Gemini không dùng được cho dịch vụ khác)
  if (body.provider !== undefined && body.provider !== s.provider && s.provider && body.apiKey === undefined) next.apiKey = '';
  setSetting('ai', next);
  return adminView();
}

/* ---------------- Hạn mức ---------------- */

const dayKey = (t = Date.now()) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10); // ngày theo giờ Việt Nam

function usage() {
  const u = getSetting('ai_usage', null);
  return u && u.day === dayKey() ? u : { day: dayKey(), total: 0, users: {} };
}

const recent = new Map(); // userId -> [thời điểm hỏi trong 1 phút qua]

/** null = được hỏi; còn lại là câu trả lời giải thích vì sao chưa hỏi được */
function checkQuota(userId, c) {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter((t) => now - t < 60_000);
  recent.set(userId, list);
  if (list.length >= PER_MINUTE) return 'Bạn hỏi nhanh quá, đợi một phút rồi hỏi tiếp nhé.';
  const u = usage();
  if ((u.users[userId] || 0) >= c.perUserDaily) return `Hôm nay bạn đã hỏi đủ ${c.perUserDaily} câu rồi. Mai mình trả lời tiếp nhé! 🌙`;
  if (u.total >= c.totalDaily) return 'Think AI đã dùng hết lượt của cả nhóm hôm nay. Mai quay lại nhé! 🌙';
  return null;
}

function countUse(userId) {
  const list = recent.get(userId) || [];
  list.push(Date.now());
  recent.set(userId, list);
  const u = usage();
  u.total += 1;
  u.users[userId] = (u.users[userId] || 0) + 1;
  setSetting('ai_usage', u);
}

/* ---------------- Gọi dịch vụ AI ---------------- */

function systemPrompt({ conv, askerName }) {
  const now = new Date(Date.now() + 7 * 3600_000);
  const date = `${now.getUTCDate()}/${now.getUTCMonth() + 1}/${now.getUTCFullYear()} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  const lines = [
    `Bạn là ${BOT_NAME}, trợ lý AI trong Think — ứng dụng chat riêng của một nhóm bạn người Việt.`,
    'Trả lời bằng tiếng Việt (nếu người hỏi viết bằng ngôn ngữ khác thì trả lời bằng ngôn ngữ đó), thân thiện, tự nhiên như nhắn tin, ngắn gọn, đi thẳng vào ý chính.',
    'Viết chữ thường, không dùng định dạng Markdown (không **, không #, không bảng). Liệt kê thì dùng dấu • đầu dòng. Có thể dùng emoji vừa phải.',
    'Nếu không chắc chắn thì nói rõ là không chắc. Không bịa đặt thông tin về người trong nhóm.',
    `Bây giờ là ${date} (giờ Việt Nam).`,
  ];
  if (conv.type === 'dm') lines.push(`Bạn đang nhắn riêng với ${askerName}.`);
  else {
    lines.push(
      `Bạn đang ở trong ${conv.type === 'general' ? 'phòng chat chung' : `nhóm chat "${conv.name || 'Nhóm'}"`}. Tin nhắn của mọi người có dạng "Tên: nội dung".`,
      `${askerName} vừa gọi bạn. Chỉ trả lời ${askerName}, không cần nhắc lại tên mình, không viết "${BOT_NAME}:" ở đầu.`
    );
  }
  return lines.join('\n');
}

const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/** Lịch sử gần đây → các lượt hỏi đáp. Lượt cùng vai liền nhau được gộp lại. */
async function buildTurns({ conv, triggerId, readImage }) {
  const rows = all(
    `SELECT m.id, m.sender_id, m.kind, m.text, m.image, m.deleted, u.display_name AS name
       FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? AND m.id <= ? AND m.kind IN ('text', 'voice', 'poll') AND m.deleted = 0
      ORDER BY m.id DESC LIMIT ?`,
    conv.id,
    triggerId,
    CONTEXT_MESSAGES
  ).reverse();
  const group = conv.type !== 'dm';
  let imagesLeft = MAX_IMAGES;
  const turns = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    // đi từ tin mới nhất để ưu tiên ảnh gần đây
    const m = rows[i];
    const role = isBot(m.sender_id) ? 'model' : 'user';
    let text = m.kind === 'voice' ? '[gửi một tin nhắn thoại — bạn chưa nghe được]' : m.kind === 'poll' ? `[bình chọn] ${m.text || ''}` : m.text || '';
    const parts = [];
    if (m.image && role === 'user') {
      const img = imagesLeft > 0 && readImage ? await readImage(m.image).catch(() => null) : null;
      if (img && img.length <= MAX_IMAGE_BYTES) {
        imagesLeft--;
        parts.push({ image: { mime: IMG_TYPES[path.extname(m.image).slice(1).toLowerCase()] || 'image/jpeg', data: img.toString('base64') } });
      } else if (!text) text = '[gửi một ảnh]';
    }
    if (role === 'user' && group) text = `${m.name}: ${text || '(ảnh)'}`;
    if (text) parts.unshift({ text });
    if (parts.length) turns.unshift({ role, parts });
  }
  // Gộp lượt cùng vai, bỏ lượt "model" ở đầu (dịch vụ AI cần bắt đầu bằng lượt người hỏi)
  const merged = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.parts.push(...t.parts);
    else merged.push({ role: t.role, parts: [...t.parts] });
  }
  while (merged.length && merged[0].role === 'model') merged.shift();
  return merged;
}

function explainHttp(status, body) {
  const msg = String(body?.error?.message || body?.error || body?.message || '').slice(0, 300);
  if (status === 429) return new AiError('quota', `Hết hạn mức của dịch vụ AI (429). ${msg}`.trim(), status);
  if (status === 401 || status === 403 || /api key|apikey|unauthori[sz]ed|permission/i.test(msg)) return new AiError('key', `Khóa API không đúng hoặc chưa được cấp quyền (${status}). ${msg}`.trim(), status);
  if (status === 404 || /not found|does not exist|unknown model|model_not_found/i.test(msg)) return new AiError('model', `Không tìm thấy model (${status}). ${msg}`.trim(), status);
  return new AiError('provider', `Dịch vụ AI báo lỗi ${status}. ${msg}`.trim(), status);
}

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new AiError('timeout', 'Dịch vụ AI trả lời quá lâu.');
    throw new AiError('network', `Không kết nối được dịch vụ AI: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw explainHttp(res.status, data);
  return data;
}

async function callGemini(c, system, turns, { search, images = true }) {
  const contents = turns.map((t) => ({
    role: t.role,
    parts: t.parts
      .filter((p) => images || !p.image)
      .map((p) => (p.image ? { inline_data: { mime_type: p.image.mime, data: p.image.data } } : { text: p.text })),
  })).filter((t) => t.parts.length);
  const body = { system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.8 } };
  if (search) body.tools = [{ google_search: {} }];
  const data = await postJson(`${c.baseUrl}/models/${encodeURIComponent(c.model)}:generateContent`, { 'x-goog-api-key': c.apiKey }, body);
  if (data?.promptFeedback?.blockReason) throw new AiError('blocked', 'Câu hỏi bị bộ lọc an toàn chặn.');
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
  if (!text) {
    if (cand?.finishReason && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(cand.finishReason)) throw new AiError('blocked', 'Câu trả lời bị bộ lọc an toàn chặn.');
    throw new AiError('provider', 'Dịch vụ AI không trả lời gì.');
  }
  return text;
}

async function callOpenAI(c, system, turns, { images = true }) {
  const messages = [{ role: 'system', content: system }];
  for (const t of turns) {
    const role = t.role === 'model' ? 'assistant' : 'user';
    const imgs = images && role === 'user' ? t.parts.filter((p) => p.image) : [];
    const text = t.parts.filter((p) => p.text).map((p) => p.text).join('\n');
    if (imgs.length) {
      messages.push({ role, content: [...(text ? [{ type: 'text', text }] : []), ...imgs.map((p) => ({ type: 'image_url', image_url: { url: `data:${p.image.mime};base64,${p.image.data}` } }))] });
    } else if (text) messages.push({ role, content: text });
  }
  const data = await postJson(`${c.baseUrl}/chat/completions`, { authorization: `Bearer ${c.apiKey}` }, { model: c.model, messages, temperature: 0.8 });
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new AiError('provider', 'Dịch vụ AI không trả lời gì.');
  return text;
}

/** Hỏi dịch vụ AI. Lỗi 400 (model không nhận ảnh, không có công cụ tra Google...) thì hỏi lại bản đơn giản. */
async function ask(c, system, turns) {
  const call = (opts) => (c.provider === 'openai' ? callOpenAI(c, system, turns, opts) : callGemini(c, system, turns, opts));
  try {
    return await call({ search: c.search, images: true });
  } catch (err) {
    const simpler = err instanceof AiError && err.code === 'provider' && err.status === 400;
    const hasExtras = c.search || turns.some((t) => t.parts.some((p) => p.image));
    if (!simpler || !hasExtras) throw err;
    return call({ search: false, images: false });
  }
}

/** Bỏ định dạng Markdown để tin nhắn đọc tự nhiên */
function plain(text) {
  let t = String(text || '').replace(/\r\n?/g, '\n');
  t = t.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_, code) => code.trimEnd());
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^(\s*)[*-]\s+/gm, '$1• ');
  t = t.replace(/`([^`\n]+)`/g, '$1');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > MAX_REPLY) t = `${t.slice(0, MAX_REPLY - 1).trimEnd()}…`;
  return t;
}

function friendlyError(err, c) {
  const admin = ' (Admin xem lại trong Quản trị → mục "AI, gọi".)';
  if (!(err instanceof AiError)) return 'Think AI đang gặp trục trặc, bạn thử lại sau nhé.';
  if (err.code === 'quota') return 'Think AI đã dùng hết lượt miễn phí của dịch vụ AI lúc này. Đợi một lát (hoặc mai) rồi hỏi lại nhé.';
  if (err.code === 'key') return `Khóa API của Think AI chưa đúng nên mình chưa trả lời được.${admin}`;
  if (err.code === 'model') return `Không tìm thấy model "${c.model}".${admin}`;
  if (err.code === 'blocked') return 'Mình không trả lời được câu này. Bạn hỏi cách khác nhé.';
  if (err.code === 'timeout') return 'Mình nghĩ lâu quá mà chưa xong. Bạn hỏi lại giúp mình nhé.';
  return 'Think AI đang gặp trục trặc, bạn thử lại sau nhé.';
}

/* ---------------- Gắn vào chat ---------------- */

function setupAI(ctx) {
  const { app, io, requireAuth, requireReady, requireAdmin, memberIds, loadMessage, notifyMembers, readImage, publicUser, onBotChanged } = ctx;
  ensureBot();
  onBotChanged?.();
  const pending = new Map(); // convId -> { busy, again }

  function insertReply(conv, text, replyTo) {
    return transaction(() => {
      const id = Number(
        run(
          `INSERT INTO messages (conversation_id, sender_id, kind, text, reply_to, search_text, created_at) VALUES (?, ?, 'text', ?, ?, ?, ?)`,
          conv.id,
          botId,
          text,
          replyTo || null,
          searchKey(text),
          Date.now()
        ).lastInsertRowid
      );
      run('UPDATE conversations SET last_message_id = ? WHERE id = ?', id, conv.id);
      run('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?', id, conv.id, botId);
      return id;
    });
  }

  function post(conv, text, replyTo) {
    const id = insertReply(conv, text, replyTo);
    const message = loadMessage(id);
    const members = memberIds(conv.id);
    for (const uid of members) io.to(`user:${uid}`).emit('message:new', message);
    notifyMembers(conv, message, members).catch((err) => console.warn('[push]', err.message));
    return message;
  }

  // Think AI "đã xem" tin trong cuộc trò chuyện riêng
  function markRead(conv, messageId) {
    if (conv.type !== 'dm') return;
    const r = run('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ? AND last_read_id < ?', messageId, conv.id, botId, messageId);
    if (r.changes) for (const uid of memberIds(conv.id)) io.to(`user:${uid}`).emit('read', { conversationId: conv.id, userId: botId, lastReadId: messageId });
  }

  function typing(conv) {
    const send = () => {
      for (const uid of memberIds(conv.id)) io.to(`user:${uid}`).emit('typing', { conversationId: conv.id, userId: botId });
    };
    send();
    const t = setInterval(send, 2500);
    return () => clearInterval(t);
  }

  async function answer(conv, message) {
    const c = config();
    const replyTo = conv.type === 'dm' ? null : message.id;
    if (!c.enabled) return post(conv, 'Think AI đang tạm nghỉ. Admin có thể bật lại trong Quản trị → mục "AI, gọi".', replyTo);
    if (!ready(c)) {
      return post(conv, 'Think AI chưa được cài đặt. Admin vào Quản trị → mục "AI, gọi" và dán khóa API (Gemini có gói miễn phí) là mình trả lời được ngay! ✨', replyTo);
    }
    const limited = checkQuota(message.senderId, c);
    if (limited) return post(conv, limited, replyTo);
    countUse(message.senderId);
    const stop = typing(conv);
    let text;
    try {
      const asker = get('SELECT display_name FROM users WHERE id = ?', message.senderId)?.display_name || 'bạn';
      const turns = await buildTurns({ conv, triggerId: message.id, readImage });
      if (!turns.length) return null;
      text = plain(await ask(c, systemPrompt({ conv, askerName: asker }), turns));
    } catch (err) {
      console.warn('[ai]', err.code || '', err.message);
      text = friendlyError(err, c);
    } finally {
      stop();
    }
    return post(conv, text || 'Mình chưa nghĩ ra câu trả lời. Bạn hỏi lại nhé.', replyTo);
  }

  /** Có cần Think AI trả lời tin này không */
  function shouldAnswer(conv, message) {
    if (isBot(message.senderId) || message.deleted) return false;
    if (!['text', 'voice'].includes(message.kind)) return false;
    if (conv.type === 'dm') return memberIds(conv.id).includes(botId);
    if (mentionsBot(message.text)) return true;
    // Trả lời (reply) một tin của Think AI trong nhóm
    return Boolean(message.replyTo && isBot(message.replyTo.senderId));
  }

  /** Gọi sau khi một người gửi tin (server.js). Chạy nền, không làm chậm việc gửi. */
  function onMessage(conv, message) {
    if (!shouldAnswer(conv, message)) return false;
    markRead(conv, message.id);
    const st = pending.get(conv.id);
    if (st) {
      // Đang trả lời tin trước: trả lời tiếp một lần nữa cho tin mới nhất (gộp các tin gửi dồn dập)
      st.again = message;
      return true;
    }
    const run1 = async (msg) => {
      const state = { again: null };
      pending.set(conv.id, state);
      try {
        await answer(conv, msg);
      } catch (err) {
        console.warn('[ai]', err.message);
      } finally {
        pending.delete(conv.id);
      }
      if (state.again) await run1(state.again);
    };
    run1(message);
    return true;
  }

  // Cho máy người dùng: tài khoản Think AI có sẵn chưa
  app.get('/api/ai', requireAuth, requireReady, (req, res) => {
    const bot = get('SELECT * FROM users WHERE id = ?', botId);
    res.json({ bot: bot ? publicUser(bot) : null, ready: ready() });
  });

  const adminChain = [requireAuth, requireReady, requireAdmin];
  app.get('/api/admin/ai', ...adminChain, (req, res) => res.json({ ai: adminView() }));
  app.put('/api/admin/ai', ...adminChain, (req, res) => {
    try {
      res.json({ ai: saveSettings(req.body || {}) });
    } catch (err) {
      if (err instanceof AiError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });
  // Thử khóa API: hỏi một câu ngắn
  app.post('/api/admin/ai/test', ...adminChain, async (req, res) => {
    const c = config();
    if (!c.apiKey) return res.status(400).json({ error: 'Chưa có khóa API.' });
    try {
      const reply = await ask(c, 'Trả lời thật ngắn bằng tiếng Việt.', [{ role: 'user', parts: [{ text: 'Chào bạn! Bạn là ai?' }] }]);
      res.json({ ok: true, reply: plain(reply).slice(0, 300), model: c.model });
    } catch (err) {
      res.status(400).json({ error: err instanceof AiError ? err.message : `Lỗi: ${err.message}` });
    }
  });

  return { onMessage, shouldAnswer, getBotId, isBot, mentionsBot };
}

/** Đọc ảnh tin nhắn trên máy chủ (dùng cho server.js) */
function readLocalImage(url) {
  const m = /^\/uploads\/img\/([\w.-]+)$/.exec(String(url || ''));
  if (!m) return null;
  const file = path.join(IMAGE_DIR, m[1]);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

module.exports = {
  setupAI,
  ensureBot,
  getBotId,
  isBot,
  mentionsBot,
  config,
  saveSettings,
  adminView,
  plain,
  buildTurns,
  readLocalImage,
  dayKey,
  resetRateLimit: () => recent.clear(), // cho kiểm thử
  BOT_NAME,
  BOT_USERNAME,
  BOT_AVATAR,
  DEFAULTS,
  AiError,
};
