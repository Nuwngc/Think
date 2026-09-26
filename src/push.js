'use strict';
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const { all, run, DATA_DIR } = require('./db');

let vapidPublicKey = null;

// Khóa VAPID dùng để ký thông báo đẩy. Tự tạo lần đầu và lưu vào data/vapid.json.
// Đừng xóa file này: nếu khóa đổi, mọi người phải bật lại thông báo.
function init() {
  let keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY.trim(), privateKey: process.env.VAPID_PRIVATE_KEY.trim() };
  } else {
    const file = path.join(DATA_DIR, 'vapid.json');
    if (fs.existsSync(file)) {
      keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      keys = webpush.generateVAPIDKeys();
      fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
      require('./cloud').saveFile('vapid.json'); // giữ khóa qua các lần máy chủ khởi động lại
    }
  }
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  vapidPublicKey = keys.publicKey;
  return vapidPublicKey;
}

function isValidSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return false;
  if (!sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return false;
  if (sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) return false;
  try {
    const url = new URL(sub.endpoint);
    if (url.protocol !== 'https:') return false;
    // Chỉ gửi tới dịch vụ push thật, không gửi vào mạng nội bộ
    if (url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return false;
    return true;
  } catch {
    return false;
  }
}

function save(userId, sessionHash, sub, oldEndpoint) {
  if (oldEndpoint && oldEndpoint !== sub.endpoint) {
    run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', oldEndpoint, userId);
  }
  run(
    `INSERT INTO push_subscriptions (endpoint, user_id, session_hash, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id, session_hash = excluded.session_hash,
       p256dh = excluded.p256dh, auth = excluded.auth`,
    sub.endpoint,
    userId,
    sessionHash,
    sub.keys.p256dh,
    sub.keys.auth,
    Date.now()
  );
}

function remove(endpoint, userId) {
  run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, userId);
}

async function sendToUser(userId, payload) {
  const subs = all('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', userId);
  if (!subs.length) return 0;
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 24 * 60 * 60,
          urgency: 'high',
        });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Thiết bị đã gỡ app hoặc tắt thông báo: xóa đăng ký cũ
          run('DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint);
        } else {
          console.warn('[push] Gửi thông báo lỗi:', err.statusCode || '', String(err.body || err.message || '').slice(0, 200));
        }
      }
    })
  );
  return sent;
}

module.exports = { init, publicKey: () => vapidPublicKey, isValidSubscription, save, remove, sendToUser };
