'use strict';
// Chức năng chat thêm ở bản 2.1.0:
//  - Sửa tin nhắn đã gửi ("đã chỉnh sửa")
//  - Ghim tin nhắn (thanh ghim trên đầu cuộc trò chuyện)
//  - Tìm tin nhắn trong cuộc trò chuyện (không cần gõ dấu)
//  - Chuyển tiếp tin nhắn sang cuộc trò chuyện khác
//  - Mỗi người tự tắt thông báo / ghim cuộc trò chuyện lên đầu danh sách
//  - Chủ đề (màu bong bóng chat) và biểu tượng gửi nhanh của từng cuộc trò chuyện
//  - Bình chọn trong cuộc trò chuyện
//  - Kho ảnh đã gửi trong cuộc trò chuyện
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { get, all, run, transaction, searchKey, IMAGE_DIR } = require('./db');

// Chủ đề cuộc trò chuyện: màu bong bóng tin của mình (web và app vẽ theo mã này)
const THEMES = ['default', 'ocean', 'sunset', 'grape', 'forest', 'candy', 'night', 'fire', 'gold', 'mono', 'love', 'mint'];
const THEME_NAMES = {
  default: 'Think',
  ocean: 'Đại dương',
  sunset: 'Hoàng hôn',
  grape: 'Nho tím',
  forest: 'Rừng thông',
  candy: 'Kẹo ngọt',
  night: 'Đêm sao',
  fire: 'Lửa hồng',
  gold: 'Nắng vàng',
  mono: 'Đen trắng',
  love: 'Tình yêu',
  mint: 'Bạc hà',
};
const DEFAULT_EMOJI = '\u{1F44D}'; // 👍
const MAX_PINS = 30;
const MAX_FORWARD = 10;

// Một biểu tượng cảm xúc (có thể ghép nhiều ký tự như ❤️ hay 👍🏻), không phải chữ thường
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}‍️⃣#*0-9])+$/u;
const validEmoji = (s) => typeof s === 'string' && s.length > 0 && s.length <= 16 && EMOJI_RE.test(s) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);

/** Dữ liệu bình chọn của tin nhắn loại 'poll' */
function pollData(messageId) {
  const p = get('SELECT options, multi, closed FROM polls WHERE message_id = ?', messageId);
  if (!p) return null;
  let options = [];
  try {
    options = JSON.parse(p.options);
  } catch {
    options = [];
  }
  const votes = all('SELECT user_id, option FROM poll_votes WHERE message_id = ? ORDER BY created_at', messageId);
  return {
    multi: Boolean(p.multi),
    closed: Boolean(p.closed),
    options: options.map((text, i) => ({ text, votes: votes.filter((v) => v.option === i).map((v) => v.user_id) })),
  };
}

const mutedNow = (mutedUntil, now = Date.now()) => mutedUntil === -1 || mutedUntil > now;

/** Người trong cuộc trò chuyện đang tắt thông báo (trả về Set id) */
function mutedMembers(convId, now = Date.now()) {
  return new Set(
    all('SELECT user_id, muted_until FROM members WHERE conversation_id = ? AND muted_until <> 0', convId)
      .filter((r) => mutedNow(r.muted_until, now))
      .map((r) => r.user_id)
  );
}

/** Lọc danh sách @nhắc tên: chỉ giữ người trong cuộc trò chuyện, bỏ chính mình */
function cleanMentions(list, convId, selfId) {
  if (!Array.isArray(list) || !list.length) return [];
  const members = new Set(all('SELECT user_id FROM members WHERE conversation_id = ?', convId).map((r) => r.user_id));
  return [...new Set(list.map(Number))].filter((id) => Number.isInteger(id) && id !== selfId && members.has(id)).slice(0, 50);
}

function setupChatPlus(ctx) {
  const {
    app,
    io,
    requireAuth,
    requireReady,
    membership,
    memberIds,
    loadMessage,
    getConv,
    systemMessage,
    emitMessage,
    notifyMembers,
    cleanText,
    snippet,
    storage,
    cloud,
  } = ctx;
  const auth = [requireAuth, requireReady];

  const toMembers = (convId, event, payload) => {
    for (const uid of memberIds(convId)) io.to(`user:${uid}`).emit(event, payload);
  };
  const emitUpdated = (messageId) => {
    const message = loadMessage(messageId);
    if (message) toMembers(message.conversationId, 'message:updated', { message });
    return message;
  };
  const myMessage = (req, res) => {
    const msg = get('SELECT * FROM messages WHERE id = ?', Number(req.params.id));
    if (!msg || !membership(msg.conversation_id, req.user.id)) {
      res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
      return null;
    }
    return msg;
  };

  /* ---------- Sửa tin nhắn ---------- */
  app.patch('/api/messages/:id', ...auth, (req, res) => {
    const msg = myMessage(req, res);
    if (!msg) return;
    if (msg.sender_id !== req.user.id || msg.deleted || msg.kind !== 'text') {
      return res.status(403).json({ error: 'Bạn chỉ sửa được tin nhắn chữ của chính mình.' });
    }
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\r\n?/g, '\n').trim() : '';
    if (text.length > 4000) return res.status(400).json({ error: 'Tin nhắn dài quá 4000 ký tự.' });
    if (!text && !msg.image) return res.status(400).json({ error: 'Tin nhắn không được để trống. Muốn xóa thì chọn Thu hồi.' });
    if (text === (msg.text || '')) return res.json({ message: loadMessage(msg.id) });
    const mentions = cleanMentions(req.body?.mentions, msg.conversation_id, req.user.id);
    const now = Date.now();
    run(
      'UPDATE messages SET text = ?, search_text = ?, mentions = ?, edited_at = ?, updated_at = ? WHERE id = ?',
      text || null, text ? searchKey(text) : null, mentions.length ? mentions.join(',') : null, now, now, msg.id
    );
    res.json({ message: emitUpdated(msg.id) });
  });

  /* ---------- Ghim tin nhắn ---------- */
  function pinsOf(convId) {
    return all('SELECT message_id, pinned_by, pinned_at FROM message_pins WHERE conversation_id = ? ORDER BY pinned_at DESC', convId)
      .map((p) => ({ message: loadMessage(p.message_id), pinnedBy: p.pinned_by, pinnedAt: p.pinned_at }))
      .filter((p) => p.message && !p.message.deleted);
  }

  app.get('/api/conversations/:id/pins', ...auth, (req, res) => {
    const convId = Number(req.params.id);
    if (!membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    res.json({ pins: pinsOf(convId) });
  });

  app.post('/api/messages/:id/pin', ...auth, (req, res) => {
    const msg = myMessage(req, res);
    if (!msg) return;
    if (msg.deleted || msg.kind === 'system') return res.status(400).json({ error: 'Không ghim được tin nhắn này.' });
    const pinned = req.body?.pinned !== false;
    const convId = msg.conversation_id;
    const exists = get('SELECT 1 AS x FROM message_pins WHERE message_id = ?', msg.id);
    let sysId = null;
    if (pinned && !exists) {
      const n = get('SELECT COUNT(*) AS n FROM message_pins WHERE conversation_id = ?', convId).n;
      if (n >= MAX_PINS) return res.status(400).json({ error: `Chỉ ghim được tối đa ${MAX_PINS} tin. Bỏ ghim bớt tin cũ trước nhé.` });
      sysId = transaction(() => {
        run('INSERT INTO message_pins (message_id, conversation_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)', msg.id, convId, req.user.id, Date.now());
        return systemMessage(convId, req.user.id, { event: 'pin', messageId: msg.id, text: msg.text ? snippet(msg.text, 60) : null, image: Boolean(msg.image) });
      });
    } else if (!pinned && exists) {
      run('DELETE FROM message_pins WHERE message_id = ?', msg.id);
    }
    const pins = pinsOf(convId);
    toMembers(convId, 'conversation:pins', { conversationId: convId, pins });
    if (sysId) emitMessage(sysId, memberIds(convId));
    res.json({ pins });
  });

  /* ---------- Tìm tin nhắn ---------- */
  app.get('/api/conversations/:id/search', ...auth, (req, res) => {
    const convId = Number(req.params.id);
    if (!membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    const q = searchKey(String(req.query.q || '')).slice(0, 100);
    if (q.length < 2) return res.json({ results: [], hasMore: false });
    const before = Number.parseInt(req.query.before, 10) || Number.MAX_SAFE_INTEGER;
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = all(
      `SELECT id FROM messages WHERE conversation_id = ? AND id < ? AND deleted = 0 AND kind IN ('text', 'poll')
         AND search_text LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 31`,
      convId, before, like
    );
    res.json({ results: rows.slice(0, 30).map((r) => loadMessage(r.id)).filter(Boolean), hasMore: rows.length > 30 });
  });

  /* ---------- Chuyển tiếp ---------- */
  function copyImage(url, userId) {
    // Mỗi tin giữ một file ảnh riêng (thu hồi / dọn ảnh tin này không làm mất ảnh tin kia)
    const m = /^\/uploads\/img\/([\w.-]+)$/.exec(url || '');
    if (!m) return null;
    const src = path.join(IMAGE_DIR, m[1]);
    if (!fs.existsSync(src)) return null;
    const dims = /_(\d+x\d+)\.\w+$/.exec(m[1]);
    const ext = path.extname(m[1]);
    const name = `${crypto.randomUUID()}${dims ? `_${dims[1]}` : ''}${ext}`;
    fs.copyFileSync(src, path.join(IMAGE_DIR, name));
    cloud.saveFile(`uploads/img/${name}`);
    const out = `/uploads/img/${name}`;
    storage.recordUpload(out, 'img', fs.statSync(src).size, userId);
    return out;
  }

  app.post('/api/messages/:id/forward', ...auth, (req, res) => {
    const msg = myMessage(req, res);
    if (!msg) return;
    if (msg.deleted || msg.kind !== 'text' || (!msg.text && !msg.image)) return res.status(400).json({ error: 'Không chuyển tiếp được tin nhắn này.' });
    const targets = [...new Set((Array.isArray(req.body?.conversationIds) ? req.body.conversationIds : []).map(Number))]
      .filter((id) => Number.isInteger(id) && membership(id, req.user.id))
      .slice(0, MAX_FORWARD);
    if (!targets.length) return res.status(400).json({ error: 'Chọn ít nhất một cuộc trò chuyện để gửi.' });
    const out = [];
    for (const convId of targets) {
      const image = msg.image ? copyImage(msg.image, req.user.id) : null;
      if (msg.image && !image && !msg.text) continue; // ảnh đã bị dọn khỏi máy chủ
      const id = transaction(() => {
        const newId = Number(
          run(
            'INSERT INTO messages (conversation_id, sender_id, text, image, forwarded, search_text, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
            convId, req.user.id, msg.text || null, image, msg.text ? searchKey(msg.text) : null, Date.now()
          ).lastInsertRowid
        );
        run('UPDATE conversations SET last_message_id = ? WHERE id = ?', newId, convId);
        run('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?', newId, convId, req.user.id);
        return newId;
      });
      const message = loadMessage(id);
      const members = memberIds(convId);
      for (const uid of members) io.to(`user:${uid}`).emit('message:new', message);
      const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
      notifyMembers(conv, message, members).catch((err) => console.warn('[push]', err.message));
      out.push(message);
    }
    if (!out.length) return res.status(400).json({ error: 'Ảnh của tin này đã bị dọn khỏi máy chủ nên không chuyển tiếp được.' });
    res.json({ messages: out });
  });

  /* ---------- Tắt thông báo, ghim cuộc trò chuyện (riêng từng người) ---------- */
  app.patch('/api/conversations/:id/prefs', ...auth, (req, res) => {
    const convId = Number(req.params.id);
    if (!membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    const b = req.body || {};
    if (b.mutedUntil !== undefined) {
      const v = Number(b.mutedUntil);
      if (!(v === -1 || v === 0 || (Number.isSafeInteger(v) && v > Date.now() && v < Date.now() + 400 * 86400000))) {
        return res.status(400).json({ error: 'Thời gian tắt thông báo không hợp lệ.' });
      }
      run('UPDATE members SET muted_until = ? WHERE conversation_id = ? AND user_id = ?', v, convId, req.user.id);
    }
    if (b.pinned !== undefined) {
      if (b.pinned) {
        const n = get('SELECT COUNT(*) AS n FROM members WHERE user_id = ? AND pinned_at IS NOT NULL AND conversation_id <> ?', req.user.id, convId).n;
        if (n >= 5) return res.status(400).json({ error: 'Chỉ ghim được tối đa 5 cuộc trò chuyện.' });
      }
      run('UPDATE members SET pinned_at = ? WHERE conversation_id = ? AND user_id = ?', b.pinned ? Date.now() : null, convId, req.user.id);
    }
    const conversation = getConv(convId, req.user.id);
    io.to(`user:${req.user.id}`).emit('conversation:prefs', {
      conversationId: convId,
      mutedUntil: conversation.mutedUntil,
      pinnedAt: conversation.pinnedAt,
    });
    res.json({ conversation });
  });

  /* ---------- Chủ đề và biểu tượng gửi nhanh ---------- */
  app.patch('/api/conversations/:id/appearance', ...auth, (req, res) => {
    const convId = Number(req.params.id);
    const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
    if (!conv || !membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    const b = req.body || {};
    const events = [];
    if (b.theme !== undefined) {
      if (!THEMES.includes(b.theme)) return res.status(400).json({ error: 'Chủ đề này chưa có.' });
      if ((conv.theme || 'default') !== b.theme) {
        run('UPDATE conversations SET theme = ? WHERE id = ?', b.theme === 'default' ? null : b.theme, convId);
        events.push({ event: 'theme', theme: b.theme, name: THEME_NAMES[b.theme] });
      }
    }
    if (b.emoji !== undefined) {
      if (!validEmoji(b.emoji)) return res.status(400).json({ error: 'Hãy chọn một biểu tượng cảm xúc.' });
      if ((conv.emoji || DEFAULT_EMOJI) !== b.emoji) {
        run('UPDATE conversations SET emoji = ? WHERE id = ?', b.emoji === DEFAULT_EMOJI ? null : b.emoji, convId);
        events.push({ event: 'emoji', emoji: b.emoji });
      }
    }
    const members = memberIds(convId);
    for (const data of events) emitMessage(systemMessage(convId, req.user.id, data), members);
    if (events.length) {
      const fresh = get('SELECT theme, emoji FROM conversations WHERE id = ?', convId);
      toMembers(convId, 'conversation:appearance', { conversationId: convId, theme: fresh.theme || 'default', emoji: fresh.emoji || DEFAULT_EMOJI });
    }
    res.json({ conversation: getConv(convId, req.user.id) });
  });

  /* ---------- Bình chọn ---------- */
  app.post('/api/conversations/:id/polls', ...auth, (req, res) => {
    const convId = Number(req.params.id);
    const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
    if (!conv || !membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    const question = cleanText(req.body?.question, 200);
    const options = (Array.isArray(req.body?.options) ? req.body.options : []).map((o) => cleanText(o, 100)).filter(Boolean);
    const unique = [...new Set(options)];
    if (!question) return res.status(400).json({ error: 'Hãy nhập câu hỏi.' });
    if (unique.length < 2) return res.status(400).json({ error: 'Cần ít nhất 2 lựa chọn khác nhau.' });
    if (unique.length > 10) return res.status(400).json({ error: 'Tối đa 10 lựa chọn.' });
    const id = transaction(() => {
      const newId = Number(
        run("INSERT INTO messages (conversation_id, sender_id, kind, text, search_text, created_at) VALUES (?, ?, 'poll', ?, ?, ?)",
          convId, req.user.id, question, searchKey(`${question} ${unique.join(' ')}`), Date.now()).lastInsertRowid
      );
      run('INSERT INTO polls (message_id, options, multi) VALUES (?, ?, ?)', newId, JSON.stringify(unique), req.body?.multi ? 1 : 0);
      run('UPDATE conversations SET last_message_id = ? WHERE id = ?', newId, convId);
      run('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?', newId, convId, req.user.id);
      return newId;
    });
    const message = loadMessage(id);
    const members = memberIds(convId);
    for (const uid of members) io.to(`user:${uid}`).emit('message:new', message);
    notifyMembers(conv, message, members).catch((err) => console.warn('[push]', err.message));
    res.json({ message });
  });

  app.post('/api/messages/:id/vote', ...auth, (req, res) => {
    const msg = myMessage(req, res);
    if (!msg) return;
    const poll = msg.kind === 'poll' && !msg.deleted ? get('SELECT * FROM polls WHERE message_id = ?', msg.id) : null;
    if (!poll) return res.status(404).json({ error: 'Không tìm thấy bình chọn.' });
    if (poll.closed) return res.status(400).json({ error: 'Bình chọn đã kết thúc.' });
    const count = JSON.parse(poll.options).length;
    let choices = [...new Set((Array.isArray(req.body?.options) ? req.body.options : []).map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < count);
    if (!poll.multi) choices = choices.slice(0, 1);
    const now = Date.now();
    transaction(() => {
      run('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?', msg.id, req.user.id);
      for (const i of choices) run('INSERT INTO poll_votes (message_id, user_id, option, created_at) VALUES (?, ?, ?, ?)', msg.id, req.user.id, i, now);
      run('UPDATE messages SET updated_at = ? WHERE id = ?', now, msg.id);
    });
    res.json({ message: emitUpdated(msg.id) });
  });

  app.post('/api/messages/:id/poll/close', ...auth, (req, res) => {
    const msg = myMessage(req, res);
    if (!msg) return;
    if (msg.kind !== 'poll' || msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Chỉ người tạo mới kết thúc được bình chọn.' });
    run('UPDATE polls SET closed = 1 WHERE message_id = ?', msg.id);
    run('UPDATE messages SET updated_at = ? WHERE id = ?', Date.now(), msg.id);
    res.json({ message: emitUpdated(msg.id) });
  });

  /* ---------- Ảnh đã gửi ---------- */
  app.get('/api/conversations/:id/media', ...auth, (req, res) => {
    const convId = Number(req.params.id);
    if (!membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    const before = Number.parseInt(req.query.before, 10) || Number.MAX_SAFE_INTEGER;
    const rows = all(
      `SELECT id, sender_id, image, created_at FROM messages
        WHERE conversation_id = ? AND id < ? AND deleted = 0 AND image IS NOT NULL ORDER BY id DESC LIMIT 61`,
      convId, before
    );
    res.json({
      images: rows.slice(0, 60).map((r) => ({ id: r.id, senderId: r.sender_id, image: r.image, createdAt: r.created_at })),
      hasMore: rows.length > 60,
    });
  });
}

module.exports = { setupChatPlus, pollData, mutedMembers, mutedNow, cleanMentions, THEMES, THEME_NAMES, DEFAULT_EMOJI, validEmoji };
