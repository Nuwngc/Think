'use strict';
// Thông báo đẩy cho app Think (bản cài từ APK, thư mục native/) qua Firebase Cloud Messaging.
//
// Dùng lại khóa FIREBASE_SERVICE_ACCOUNT mà máy chủ đã có để sao lưu lên Firestore.
// App gửi mã FCM của máy lên /api/app/push; mã gắn với phiên đăng nhập nên đăng xuất,
// đổi mật khẩu hay bị khóa tài khoản là mã tự bị xóa theo.
const path = require('node:path');
const { all, run } = require('./db');

let messaging = null;

function init() {
  if (messaging) return true;
  try {
    if (process.env.THINK_FAKE_FCM) {
      // Chỉ dùng khi chạy thử nghiệm tự động
      messaging = require(path.resolve(process.env.THINK_FAKE_FCM))();
    } else {
      const credentials = require('./cloud').readCredentials();
      if (!credentials) return false;
      const { getApps, initializeApp, cert } = require('firebase-admin/app');
      const { getMessaging } = require('firebase-admin/messaging');
      const app = getApps()[0] || initializeApp({ credential: cert(credentials) });
      messaging = getMessaging(app);
    }
  } catch (err) {
    console.warn('[fcm] Không bật được thông báo cho app Think:', err.message);
    messaging = null;
  }
  return Boolean(messaging);
}

const enabled = () => Boolean(messaging);

const validToken = (t) => typeof t === 'string' && t.length >= 20 && t.length <= 4096 && /^[\w:.-]+$/.test(t);

function save(userId, sessionHash, token, platform) {
  run(
    `INSERT INTO app_push_tokens (token, user_id, session_hash, platform, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, session_hash = excluded.session_hash,
       platform = excluded.platform`,
    token,
    userId,
    sessionHash,
    platform === 'ios' ? 'ios' : 'android',
    Date.now()
  );
}

function remove(token, userId) {
  run('DELETE FROM app_push_tokens WHERE token = ? AND user_id = ?', token, userId);
}

const clip = (s, n) => {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Đổi nội dung thông báo của web (xem public/sw.js) sang dạng app hiểu (expo-notifications trên Android).
// Gửi dạng "chỉ có data" để app tự hiện, nhờ vậy có nút Trả lời / Đã đọc ngay trong thông báo.
function toData(p) {
  const data = { type: p.type || 'message' };
  if (p.conversationId != null) data.conversationId = p.conversationId;
  if (p.messageId != null) data.messageId = p.messageId;
  if (p.gameId != null) data.gameId = p.gameId;
  const out = { color: '#0E7C66', channelId: 'messages' };
  if (p.type === 'message') {
    out.title = clip(p.convTitle || p.senderName || 'Think', 80);
    out.message = clip(p.isGroup ? `${p.senderName}: ${p.text}` : p.text, 400);
    out.tag = `conv-${p.conversationId}`;
    out.categoryId = 'message';
    if (p.convUnread > 1) out.subtitle = `${p.convUnread} tin nhắn mới`;
  } else {
    out.title = clip(p.title || 'Think', 80);
    out.message = clip(p.body || '', 400);
    if (p.tag) out.tag = p.tag;
    if (p.type === 'reaction' || p.type === 'test') out.channelId = 'other';
    if (p.type === 'chess') out.channelId = 'chess';
  }
  if (p.badge != null) out.badge = String(p.badge);
  out.body = JSON.stringify(data);
  return out;
}

const GONE = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

async function sendToUser(userId, payload) {
  if (!messaging) return 0;
  const rows = all('SELECT token FROM app_push_tokens WHERE user_id = ?', userId);
  if (!rows.length) return 0;
  const data = toData(payload);
  let sent = 0;
  await Promise.all(
    rows.map(async ({ token }) => {
      try {
        await messaging.send({ token, data, android: { priority: 'high', ttl: 24 * 60 * 60 * 1000 } });
        sent++;
      } catch (err) {
        const code = err && (err.code || (err.errorInfo && err.errorInfo.code));
        if (GONE.has(code)) run('DELETE FROM app_push_tokens WHERE token = ?', token); // app đã gỡ hoặc mã hết hạn
        else console.warn('[fcm] Gửi thông báo lỗi:', code || '', String((err && err.message) || err).slice(0, 200));
      }
    })
  );
  return sent;
}

module.exports = { init, enabled, validToken, save, remove, sendToUser, toData };
