'use strict';
// Kèo (2.16.0): rủ cả nhóm đi đâu đó — tên kèo, giờ hẹn, địa điểm; mọi người bấm Đi / Có thể / Không đi.
// - Là tin nhắn loại 'event' (tên kèo nằm ở messages.text, người tạo là messages.sender_id),
//   chi tiết ở bảng events, lựa chọn của từng người ở event_rsvps. Ai bấm gì thì phát lại tin bằng message:updated.
// - Trước giờ hẹn 1 tiếng (kèo tạo gấp: 15 phút) máy chủ nhắc những người chọn Đi / Có thể bằng thông báo đẩy,
//   kèm một dòng nhắc trong cuộc trò chuyện. Máy chủ ngủ lỡ giờ nhắc thì nhắc ngay khi thức (nếu kèo chưa bắt đầu).
// - Người tạo kèo (hoặc quản trị viên) hủy được kèo chưa diễn ra; ai đã chọn Đi / Có thể nhận thông báo kèo bị hủy.
const { db, get, all, run, transaction, searchKey } = require('./db');

const MAX_TITLE = 100;
const MAX_PLACE = 120;
const MAX_AHEAD = 366 * 86400_000;
const MIN_AHEAD = 60_000;
const REMIND_BEFORE = 3600_000;
const REMIND_SHORT = 15 * 60_000;
const SWEEP_MS = 60_000;
const STATUSES = ['yes', 'maybe', 'no'];
const VN = 7 * 3600_000; // giờ Việt Nam (máy chủ chạy giờ UTC)
const WEEKDAYS = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    place TEXT,
    starts_at INTEGER NOT NULL,
    remind_at INTEGER,
    reminded INTEGER NOT NULL DEFAULT 0,
    canceled INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_events_remind ON events(reminded, remind_at);
  CREATE TABLE IF NOT EXISTS event_rsvps (
    message_id INTEGER NOT NULL REFERENCES events(message_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );
`);

/** Một dòng chữ: bỏ xuống dòng, ký tự điều khiển, khoảng trắng thừa */
const oneLine = (v) =>
  String(v ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Giờ nhắc: trước 1 tiếng; kèo tạo gấp thì trước 15 phút; gấp hơn nữa thì không nhắc */
function remindAtFor(startsAt, now = Date.now()) {
  const left = startsAt - now;
  if (left >= REMIND_BEFORE + 5 * 60_000) return startsAt - REMIND_BEFORE;
  if (left >= REMIND_SHORT + 5 * 60_000) return startsAt - REMIND_SHORT;
  return null;
}

const pad = (n) => String(n).padStart(2, '0');
/** "20:00" theo giờ Việt Nam */
function vnClock(ts) {
  const d = new Date(ts + VN);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** "20:00 hôm nay", "08:00 ngày mai", "19:30 thứ Bảy 11/10" theo giờ Việt Nam */
function vnWhen(ts, now = Date.now()) {
  const day = (t) => Math.floor((t + VN) / 86400_000);
  const diff = day(ts) - day(now);
  const d = new Date(ts + VN);
  const label = diff === 0 ? 'hôm nay' : diff === 1 ? 'ngày mai' : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  return `${vnClock(ts)} ${label}`;
}
/** "1 tiếng", "15 phút", "1 tiếng 20 phút" */
function leftText(ms) {
  const mins = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} phút`;
  return m ? `${h} tiếng ${m} phút` : `${h} tiếng`;
}

/** Dữ liệu kèo của tin nhắn loại 'event' (cho serializeMessage) */
function eventData(messageId) {
  const e = get('SELECT place, starts_at, canceled FROM events WHERE message_id = ?', messageId);
  if (!e) return null;
  const rows = all('SELECT user_id, status FROM event_rsvps WHERE message_id = ? ORDER BY updated_at, user_id', messageId);
  const of = (st) => rows.filter((r) => r.status === st).map((r) => r.user_id);
  return { place: e.place || '', startsAt: e.starts_at, canceled: Boolean(e.canceled), yes: of('yes'), maybe: of('maybe'), no: of('no') };
}

/** Dòng thông báo khi có kèo mới: "📅 Kèo: Đi ăn lẩu · 20:00 hôm nay" */
function eventSummary(message, now = Date.now()) {
  const e = message.event;
  return e ? `📅 Kèo: ${message.text} · ${vnWhen(e.startsAt, now)}${e.place ? ` · ${e.place}` : ''}` : `📅 Kèo: ${message.text}`;
}

/** Kèo ở dạng chữ cho Think AI đọc (tóm tắt, ngữ cảnh trả lời): "[kèo] Đi ăn lẩu · 20:00 thứ Bảy 11/10 · Quán cũ" */
function eventText(messageId, title, now = Date.now()) {
  const e = get('SELECT place, starts_at, canceled FROM events WHERE message_id = ?', messageId);
  if (!e) return `[kèo] ${title || ''}`;
  return `[kèo] ${title || ''} · ${vnWhen(e.starts_at, now)}${e.place ? ` · ${e.place}` : ''}${e.canceled ? ' (đã hủy)' : ''}`;
}

function setupEvents(ctx) {
  const { app, io, requireAuth, requireReady, membership, memberIds, loadMessage, systemMessage, emitMessage, notifyMembers, notify } = ctx;
  const auth = [requireAuth, requireReady];
  const toMembers = (convId, event, payload) => {
    for (const uid of memberIds(convId)) io.to(`user:${uid}`).emit(event, payload);
  };
  const emitUpdated = (messageId) => {
    const message = loadMessage(messageId);
    if (message) toMembers(message.conversationId, 'message:updated', { message });
    return message;
  };
  const findEvent = (req, res) => {
    const msg = get('SELECT * FROM messages WHERE id = ?', Number(req.params.id));
    const ev = msg && msg.kind === 'event' && !msg.deleted && membership(msg.conversation_id, req.user.id)
      ? get('SELECT * FROM events WHERE message_id = ?', msg.id)
      : null;
    if (!ev) {
      res.status(404).json({ error: 'Không tìm thấy kèo.' });
      return null;
    }
    return { msg, ev };
  };
  const rsvpUsers = (messageId, convId) => {
    const members = new Set(memberIds(convId));
    return all("SELECT user_id FROM event_rsvps WHERE message_id = ? AND status IN ('yes', 'maybe')", messageId)
      .map((r) => r.user_id)
      .filter((uid) => members.has(uid));
  };

  /* ---------- Tạo kèo ---------- */
  app.post('/api/conversations/:id/events', ...auth, (req, res) => {
    const convId = Number(req.params.id);
    const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
    if (!conv || !membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    const title = oneLine(req.body?.title);
    const place = oneLine(req.body?.place);
    const startsAt = Number(req.body?.startsAt);
    const now = Date.now();
    if (!title) return res.status(400).json({ error: 'Hãy đặt tên cho kèo.' });
    if (title.length > MAX_TITLE) return res.status(400).json({ error: `Tên kèo dài quá ${MAX_TITLE} ký tự.` });
    if (place.length > MAX_PLACE) return res.status(400).json({ error: `Địa điểm dài quá ${MAX_PLACE} ký tự.` });
    if (!Number.isSafeInteger(startsAt) || startsAt < now + MIN_AHEAD) return res.status(400).json({ error: 'Giờ hẹn phải sau bây giờ.' });
    if (startsAt > now + MAX_AHEAD) return res.status(400).json({ error: 'Chỉ hẹn được trong vòng một năm tới.' });
    const remindAt = remindAtFor(startsAt, now);
    const id = transaction(() => {
      const newId = Number(
        run("INSERT INTO messages (conversation_id, sender_id, kind, text, search_text, created_at) VALUES (?, ?, 'event', ?, ?, ?)",
          convId, req.user.id, title, searchKey(`${title} ${place}`), now).lastInsertRowid
      );
      run('INSERT INTO events (message_id, conversation_id, place, starts_at, remind_at, reminded) VALUES (?, ?, ?, ?, ?, ?)',
        newId, convId, place || null, startsAt, remindAt, remindAt ? 0 : 1);
      run("INSERT INTO event_rsvps (message_id, user_id, status, updated_at) VALUES (?, ?, 'yes', ?)", newId, req.user.id, now);
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

  /* ---------- Đi / Có thể / Không đi (status null = bỏ chọn) ---------- */
  app.post('/api/messages/:id/rsvp', ...auth, (req, res) => {
    const found = findEvent(req, res);
    if (!found) return;
    const { msg, ev } = found;
    if (ev.canceled) return res.status(400).json({ error: 'Kèo này đã bị hủy.' });
    if (ev.starts_at <= Date.now()) return res.status(400).json({ error: 'Kèo đã diễn ra rồi.' });
    const status = req.body?.status ?? null;
    if (status !== null && !STATUSES.includes(status)) return res.status(400).json({ error: 'Lựa chọn không hợp lệ.' });
    const now = Date.now();
    transaction(() => {
      if (status === null) run('DELETE FROM event_rsvps WHERE message_id = ? AND user_id = ?', msg.id, req.user.id);
      else {
        run(`INSERT INTO event_rsvps (message_id, user_id, status, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(message_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
          msg.id, req.user.id, status, now);
      }
      run('UPDATE messages SET updated_at = ? WHERE id = ?', now, msg.id);
    });
    res.json({ message: emitUpdated(msg.id) });
  });

  /* ---------- Hủy kèo ---------- */
  app.post('/api/messages/:id/event/cancel', ...auth, (req, res) => {
    const found = findEvent(req, res);
    if (!found) return;
    const { msg, ev } = found;
    if (msg.sender_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ người tạo kèo mới hủy được.' });
    if (ev.canceled) return res.json({ message: loadMessage(msg.id) });
    if (ev.starts_at <= Date.now()) return res.status(400).json({ error: 'Kèo đã diễn ra rồi.' });
    const notifyIds = rsvpUsers(msg.id, msg.conversation_id).filter((uid) => uid !== req.user.id);
    const sysId = transaction(() => {
      run('UPDATE events SET canceled = 1 WHERE message_id = ?', msg.id);
      run('UPDATE messages SET updated_at = ? WHERE id = ?', Date.now(), msg.id);
      return systemMessage(msg.conversation_id, req.user.id, { event: 'keo-cancel', title: msg.text, messageId: msg.id });
    });
    const message = emitUpdated(msg.id);
    emitMessage(sysId, memberIds(msg.conversation_id));
    const actor = get('SELECT display_name, avatar FROM users WHERE id = ?', req.user.id);
    for (const uid of notifyIds) {
      notify(uid, {
        type: 'event',
        title: `Kèo “${msg.text}” đã bị hủy`,
        body: `${actor?.display_name || 'Người tạo kèo'} đã hủy kèo lúc ${vnWhen(ev.starts_at)}.`,
        conversationId: msg.conversation_id,
        messageId: msg.id,
        tag: `event-${msg.id}`,
        url: `/#/c/${msg.conversation_id}`,
        icon: actor?.avatar || '/icons/icon-192.png',
      }).catch(() => undefined);
    }
    res.json({ message });
  });

  /* ---------- Nhắc trước giờ hẹn ---------- */
  function sweep(now = Date.now()) {
    const due = all(
      `SELECT e.*, m.text AS title, m.sender_id, m.deleted FROM events e JOIN messages m ON m.id = e.message_id
        WHERE e.reminded = 0 AND e.canceled = 0 AND e.remind_at IS NOT NULL AND e.remind_at <= ? ORDER BY e.remind_at LIMIT 50`,
      now
    );
    let sent = 0;
    for (const e of due) {
      run('UPDATE events SET reminded = 1 WHERE message_id = ?', e.message_id);
      if (e.deleted || e.starts_at <= now) continue; // máy chủ thức dậy khi kèo đã bắt đầu: thôi không nhắc
      const targets = rsvpUsers(e.message_id, e.conversation_id);
      const left = leftText(e.starts_at - now);
      const sysId = systemMessage(e.conversation_id, e.sender_id, { event: 'keo-remind', title: e.title, startsAt: e.starts_at, messageId: e.message_id });
      emitMessage(sysId, memberIds(e.conversation_id));
      for (const uid of targets) {
        notify(uid, {
          type: 'event',
          title: `⏰ Còn ${left} nữa: ${e.title}`,
          body: `${vnWhen(e.starts_at, now)}${e.place ? ` · ${e.place}` : ''}`,
          conversationId: e.conversation_id,
          messageId: e.message_id,
          tag: `event-${e.message_id}`,
          url: `/#/c/${e.conversation_id}`,
          icon: '/icons/icon-192.png',
        }).catch(() => undefined);
        sent++;
      }
    }
    return sent;
  }
  sweep();
  setInterval(sweep, SWEEP_MS).unref();

  /** Lời nhắc sớm nhất còn chờ (để máy chủ không ngủ quên, xem src/keep-awake.js) */
  const nextDue = () => get('SELECT MIN(remind_at) AS t FROM events WHERE reminded = 0 AND canceled = 0 AND remind_at IS NOT NULL')?.t || null;

  return { sweep, nextDue };
}

module.exports = { setupEvents, eventData, eventSummary, eventText, remindAtFor, vnWhen, leftText };
