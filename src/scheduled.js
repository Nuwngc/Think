'use strict';
// Hẹn giờ gửi tin nhắn (2.16.0): viết trước, máy chủ tự gửi đúng giờ như tin nhắn thường của bạn.
// - Chỉ người hẹn thấy danh sách tin đang chờ của mình (GET /api/scheduled, sự kiện scheduled:changed gửi riêng).
// - Đến giờ: máy chủ gửi tin (realtime, thông báo đẩy, Think AI trả lời nếu được gọi tên) rồi xóa khỏi danh sách.
//   Lúc đó người hẹn đã rời nhóm / bị khóa tài khoản thì bỏ tin. Máy chủ ngủ lỡ giờ thì gửi ngay khi thức.
// - Hủy, hoặc "Gửi ngay" không cần chờ.
const { db, get, all, run } = require('./db');

const MAX_TEXT = 4000;
const MAX_PENDING = 50; // mỗi người tối đa 50 tin đang chờ
const MIN_AHEAD = 60_000;
const MAX_AHEAD = 366 * 86400_000;
const SWEEP_MS = 15_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    mentions TEXT,
    send_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_messages(send_at);
  CREATE INDEX IF NOT EXISTS idx_scheduled_user ON scheduled_messages(user_id, send_at);
`);

const serialize = (r) => ({
  id: r.id,
  conversationId: r.conversation_id,
  text: r.text,
  sendAt: r.send_at,
  createdAt: r.created_at,
  mentions: r.mentions ? String(r.mentions).split(',').filter(Boolean).map(Number) : [],
});

function setupScheduled(ctx) {
  const { app, io, requireAuth, requireReady, membership, cleanMentions, postMessage } = ctx;
  const auth = [requireAuth, requireReady];

  const listFor = (uid) => all('SELECT * FROM scheduled_messages WHERE user_id = ? ORDER BY send_at, id', uid).map(serialize);
  const emitList = (uid) => {
    const scheduled = listFor(uid);
    io.to(`user:${uid}`).emit('scheduled:changed', { scheduled });
    return scheduled;
  };
  const mine = (req, res) => {
    const row = get('SELECT * FROM scheduled_messages WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!row) res.status(404).json({ error: 'Tin hẹn giờ này đã được gửi hoặc đã bị hủy.' });
    return row;
  };

  /** Gửi một tin hẹn giờ (đến giờ, hoặc bấm Gửi ngay). Trả về tin nhắn đã gửi, hoặc null nếu phải bỏ */
  function deliver(row) {
    run('DELETE FROM scheduled_messages WHERE id = ?', row.id);
    const user = get('SELECT disabled FROM users WHERE id = ?', row.user_id);
    if (!user || user.disabled || !membership(row.conversation_id, row.user_id)) return null;
    const mentions = cleanMentions(row.mentions ? String(row.mentions).split(',') : [], row.conversation_id, row.user_id);
    return postMessage(row.conversation_id, row.user_id, { text: row.text, mentions, ai: true });
  }

  app.get('/api/scheduled', ...auth, (req, res) => {
    res.json({ scheduled: listFor(req.user.id) });
  });

  app.post('/api/conversations/:id/scheduled', ...auth, (req, res) => {
    const convId = Number(req.params.id);
    if (!get('SELECT id FROM conversations WHERE id = ?', convId) || !membership(convId, req.user.id)) {
      return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    }
    const text = typeof req.body?.text === 'string' ? req.body.text.normalize('NFC').replace(/\r\n?/g, '\n').trim() : '';
    const sendAt = Number(req.body?.sendAt);
    const now = Date.now();
    if (!text) return res.status(400).json({ error: 'Hãy nhập tin nhắn muốn hẹn giờ gửi.' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Tin nhắn dài quá ${MAX_TEXT} ký tự. Hãy chia nhỏ ra.` });
    if (!Number.isSafeInteger(sendAt) || sendAt < now + MIN_AHEAD) return res.status(400).json({ error: 'Hãy chọn giờ gửi sau bây giờ ít nhất 1 phút.' });
    if (sendAt > now + MAX_AHEAD) return res.status(400).json({ error: 'Chỉ hẹn giờ được trong vòng một năm tới.' });
    const n = get('SELECT COUNT(*) AS n FROM scheduled_messages WHERE user_id = ?', req.user.id).n;
    if (n >= MAX_PENDING) return res.status(400).json({ error: `Bạn đang có ${MAX_PENDING} tin hẹn giờ. Hủy bớt tin cũ trước nhé.` });
    const mentions = cleanMentions(req.body?.mentions, convId, req.user.id);
    const id = Number(
      run('INSERT INTO scheduled_messages (conversation_id, user_id, text, mentions, send_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        convId, req.user.id, text, mentions.length ? mentions.join(',') : null, sendAt, now).lastInsertRowid
    );
    const scheduled = emitList(req.user.id);
    res.json({ scheduled, item: scheduled.find((s) => s.id === id) || null });
  });

  app.delete('/api/scheduled/:id', ...auth, (req, res) => {
    const row = mine(req, res);
    if (!row) return;
    run('DELETE FROM scheduled_messages WHERE id = ?', row.id);
    res.json({ scheduled: emitList(req.user.id) });
  });

  app.post('/api/scheduled/:id/send', ...auth, (req, res) => {
    const row = mine(req, res);
    if (!row) return;
    const message = deliver(row);
    const scheduled = emitList(req.user.id);
    if (!message) return res.status(400).json({ error: 'Bạn không còn ở trong cuộc trò chuyện này nên tin không gửi được.', scheduled });
    res.json({ scheduled, message });
  });

  function sweep(now = Date.now()) {
    const due = all('SELECT * FROM scheduled_messages WHERE send_at <= ? ORDER BY send_at, id LIMIT 200', now);
    const users = new Set();
    let sent = 0;
    for (const row of due) {
      users.add(row.user_id);
      try {
        if (deliver(row)) sent++;
      } catch (err) {
        console.warn('[scheduled] Không gửi được tin hẹn giờ:', err.message);
      }
    }
    for (const uid of users) emitList(uid);
    return sent;
  }
  sweep();
  setInterval(sweep, SWEEP_MS).unref();

  /** Tin hẹn giờ sớm nhất còn chờ (để máy chủ không ngủ quên, xem src/keep-awake.js) */
  const nextDue = () => get('SELECT MIN(send_at) AS t FROM scheduled_messages')?.t || null;

  return { sweep, nextDue, listFor };
}

module.exports = { setupScheduled };
