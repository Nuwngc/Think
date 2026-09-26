'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');

// Đọc file .env nếu có (Node 22 đọc được sẵn, không cần thư viện dotenv)
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* không có .env thì dùng mặc định */
}

const express = require('express');
const { Server } = require('socket.io');
const cloud = require('./src/cloud');
if ((process.env.FIREBASE_SERVICE_ACCOUNT || process.env.THINK_FAKE_FIRESTORE) && !cloud.enabled()) {
  // Chạy thẳng server.js sẽ bỏ qua bước tải dữ liệu từ Firebase và có thể ghi đè mất dữ liệu thật
  console.error('❌ Đã cấu hình Firebase nhưng server không được chạy qua start.js. Hãy dùng lệnh: npm start');
  process.exit(1);
}
const { db, get, all, run, transaction, DATA_DIR, UPLOAD_DIR, AVATAR_DIR, IMAGE_DIR, GENERAL_ID } = require('./src/db');
const auth = require('./src/auth');
const push = require('./src/push');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const APP_NAME = process.env.APP_NAME || 'Think';
const COOKIE = 'sid';

push.init();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 20000, maxHttpBufferSize: 1e5 });

app.disable('x-powered-by');

// Tin header X-Forwarded-* của reverse proxy (Caddy/Nginx cùng máy, hoặc Render/Railway)
function trustProxySetting() {
  const v = process.env.TRUST_PROXY;
  if (v === undefined || v === '') {
    return process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME ? 1 : 'loopback';
  }
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
app.set('trust proxy', trustProxySetting());

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self' ws: wss:",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use(express.json({ limit: '64kb' }));

/* ---------------- Tiện ích ---------------- */

function normUsername(value) {
  const s = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_.]{3,32}$/.test(s) ? s : null;
}
function normDisplayName(value) {
  const s = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= 1 && s.length <= 40 ? s : null;
}
const validPassword = (v) => typeof v === 'string' && v.length >= 6 && v.length <= 128;
function clampInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

// Nhận diện ảnh bằng "chữ ký" đầu file, không tin phần đuôi/Content-Type do máy khách gửi
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head = buf.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function removeUpload(url) {
  const m = /^\/uploads\/(avatars|img)\/([\w.-]+)$/.exec(url || '');
  if (!m) return;
  fs.unlink(path.join(UPLOAD_DIR, m[1], m[2]), () => {});
  cloud.removeFile(`uploads/${m[1]}/${m[2]}`);
}

/* ---------------- Trạng thái online ---------------- */

const online = new Map(); // userId -> Set<socket>
const isOnline = (uid) => (online.get(uid)?.size || 0) > 0;

// "Đang xem app" = có tab đang hiện trên màn hình và vừa báo hoạt động gần đây
function isActive(uid) {
  const set = online.get(uid);
  if (!set) return false;
  const now = Date.now();
  for (const s of set) if (s.data.visible && now - s.data.lastActive < 70_000) return true;
  return false;
}

function disconnectSockets(userId, predicate, reason) {
  const set = online.get(userId);
  if (!set) return;
  for (const s of [...set]) {
    if (!predicate(s)) continue;
    s.emit('session:ended', { reason });
    s.disconnect(true);
  }
}

/* ---------------- Chuyển dữ liệu ra JSON ---------------- */

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar || null,
    role: u.role,
    disabled: Boolean(u.disabled),
    online: isOnline(u.id),
    lastSeen: u.last_seen || null,
  };
}
const meUser = (u) => ({ ...publicUser(u), mustChangePassword: Boolean(u.must_change_password) });

const snippet = (s, n = 140) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function serializeMessage(m, reactions) {
  const out = {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    kind: m.kind || 'text',
    text: m.deleted ? null : m.text,
    image: m.deleted ? null : m.image,
    deleted: Boolean(m.deleted),
    createdAt: m.created_at,
    replyTo: null,
    reactions: reactions || [],
  };
  if (m.reply_to && !m.deleted) {
    const gone = m.r_sender_id == null || Boolean(m.r_deleted);
    out.replyTo = {
      id: m.reply_to,
      senderId: m.r_sender_id ?? null,
      deleted: gone,
      text: gone ? null : snippet(m.r_text),
      image: !gone && Boolean(m.r_image),
    };
  }
  return out;
}

// Tin nhắn kèm thông tin tin được trả lời
const MSG_SELECT = `
  SELECT m.*, r.sender_id AS r_sender_id, r.text AS r_text, r.image AS r_image, r.deleted AS r_deleted
    FROM messages m LEFT JOIN messages r ON r.id = m.reply_to`;

const reactionsOf = (messageId) =>
  all('SELECT user_id, emoji FROM reactions WHERE message_id = ? ORDER BY created_at', messageId)
    .map((r) => ({ userId: r.user_id, emoji: r.emoji }));

function reactionsBetween(convId, minId, maxId) {
  const map = new Map();
  const rows = all(
    `SELECT r.message_id, r.user_id, r.emoji FROM reactions r JOIN messages m ON m.id = r.message_id
      WHERE m.conversation_id = ? AND r.message_id BETWEEN ? AND ? ORDER BY r.created_at`,
    convId, minId, maxId
  );
  for (const row of rows) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    map.get(row.message_id).push({ userId: row.user_id, emoji: row.emoji });
  }
  return map;
}

function loadMessage(id) {
  const row = get(`${MSG_SELECT} WHERE m.id = ?`, id);
  return row ? serializeMessage(row, reactionsOf(id)) : null;
}

const CONV_SELECT = `
  SELECT c.id, c.type, c.name, c.created_at, c.created_by, mem.last_read_id,
         lm.id AS lm_id, lm.sender_id AS lm_sender_id, lm.text AS lm_text, lm.image AS lm_image,
         lm.deleted AS lm_deleted, lm.created_at AS lm_created_at, lm.kind AS lm_kind,
         (SELECT COUNT(*) FROM messages m
           WHERE m.conversation_id = c.id AND m.id > mem.last_read_id AND m.sender_id <> :uid
             AND m.kind <> 'system') AS unread,
         (SELECT group_concat(o.user_id) FROM members o WHERE o.conversation_id = c.id) AS member_ids,
         (SELECT o.user_id FROM members o WHERE o.conversation_id = c.id AND o.user_id <> :uid LIMIT 1) AS peer_id,
         (SELECT o.last_read_id FROM members o WHERE o.conversation_id = c.id AND o.user_id <> :uid LIMIT 1) AS peer_last_read_id,
         (SELECT COUNT(*) FROM members o WHERE o.conversation_id = c.id) AS member_count
    FROM members mem
    JOIN conversations c ON c.id = mem.conversation_id
    LEFT JOIN messages lm ON lm.id = c.last_message_id
   WHERE mem.user_id = :uid`;

function serializeConv(r) {
  const isDm = r.type === 'dm';
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    memberCount: r.member_count,
    memberIds: r.type === 'group' ? String(r.member_ids || '').split(',').filter(Boolean).map(Number) : null,
    createdBy: r.created_by || null,
    peerId: isDm ? r.peer_id : null,
    peerLastReadId: isDm ? r.peer_last_read_id || 0 : null,
    lastReadId: r.last_read_id,
    unread: r.unread,
    createdAt: r.created_at,
    lastMessage: r.lm_id
      ? serializeMessage({
          id: r.lm_id,
          conversation_id: r.id,
          sender_id: r.lm_sender_id,
          text: r.lm_text,
          image: r.lm_image,
          deleted: r.lm_deleted,
          created_at: r.lm_created_at,
          kind: r.lm_kind,
        })
      : null,
  };
}
const listConvs = (uid) => all(CONV_SELECT + ' ORDER BY COALESCE(lm.created_at, c.created_at) DESC', { uid }).map(serializeConv);
function getConv(convId, uid) {
  const row = get(CONV_SELECT + ' AND c.id = :cid', { uid, cid: convId });
  return row ? serializeConv(row) : null;
}

const membership = (convId, uid) => get('SELECT last_read_id FROM members WHERE conversation_id = ? AND user_id = ?', convId, uid);
const memberIds = (convId) => all('SELECT user_id FROM members WHERE conversation_id = ?', convId).map((r) => r.user_id);

function unreadTotal(uid) {
  return get(
    `SELECT COALESCE(SUM((SELECT COUNT(*) FROM messages m
                           WHERE m.conversation_id = mem.conversation_id
                             AND m.id > mem.last_read_id AND m.sender_id <> :uid
                             AND m.kind <> 'system')), 0) AS n
       FROM members mem WHERE mem.user_id = :uid`,
    { uid }
  ).n;
}

/* ---------------- Tài khoản ---------------- */

async function createUser({ username, displayName, password, role = 'member', mustChange = true }) {
  const hash = await auth.hashPassword(password);
  return transaction(() => {
    const id = Number(
      run(
        'INSERT INTO users (username, display_name, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        username,
        displayName,
        hash,
        role,
        mustChange ? 1 : 0,
        Date.now()
      ).lastInsertRowid
    );
    // Vào phòng chung, coi như đã đọc tin cũ để không bị hàng trăm tin chưa đọc
    const room = get('SELECT last_message_id FROM conversations WHERE id = ?', GENERAL_ID);
    run('INSERT OR IGNORE INTO members (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)', GENERAL_ID, id, room?.last_message_id || 0);
    return get('SELECT * FROM users WHERE id = ?', id);
  });
}

async function bootstrapAdmin() {
  if (get('SELECT COUNT(*) AS n FROM users').n > 0) return;
  const username = normUsername(process.env.ADMIN_USERNAME) || 'admin';
  const fromEnv = validPassword(process.env.ADMIN_PASSWORD);
  const password = fromEnv ? process.env.ADMIN_PASSWORD : auth.generatePassword(10);
  await createUser({ username, displayName: 'Admin', password, role: 'admin', mustChange: !fromEnv });
  const line = '─'.repeat(46);
  console.log(`\n${line}\n  Đã tạo tài khoản admin đầu tiên`);
  console.log(`  Tên đăng nhập: ${username}`);
  console.log(`  Mật khẩu:      ${fromEnv ? '(lấy từ ADMIN_PASSWORD trong .env)' : password}`);
  if (!fromEnv) console.log('  Đăng nhập xong app sẽ yêu cầu đổi mật khẩu.');
  console.log(`${line}\n`);
}

// Quên mật khẩu admin mà máy chủ không có dòng lệnh (vd Render Free): đặt biến RESET_ADMIN_PASSWORD rồi deploy lại
async function resetAdminFromEnv() {
  const password = process.env.RESET_ADMIN_PASSWORD;
  if (!password) return;
  if (!validPassword(password)) {
    console.warn('⚠️  RESET_ADMIN_PASSWORD cần từ 6 đến 128 ký tự, đã bỏ qua.');
    return;
  }
  const username = normUsername(process.env.ADMIN_USERNAME) || 'admin';
  const user = get('SELECT id FROM users WHERE username = ?', username);
  if (!user) {
    console.warn(`⚠️  Không có tài khoản "${username}" để đặt lại mật khẩu.`);
    return;
  }
  run("UPDATE users SET password_hash = ?, must_change_password = 0, disabled = 0, role = 'admin' WHERE id = ?", await auth.hashPassword(password), user.id);
  auth.deleteUserSessions(user.id);
  console.log(`🔑 Đã đặt lại mật khẩu cho ${username} theo RESET_ADMIN_PASSWORD. Đăng nhập xong nhớ xóa biến này.`);
}

/* ---------------- Phiên đăng nhập ---------------- */

function loadSession(req) {
  if (req._session === undefined) {
    req._session = auth.findSession(auth.parseCookies(req.headers.cookie)[COOKIE]);
  }
  return req._session;
}
function requireAuth(req, res, next) {
  const session = loadSession(req);
  if (!session) return res.status(401).json({ error: 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.' });
  req.user = session;
  req.sessionHash = session.token_hash;
  next();
}
function requireReady(req, res, next) {
  if (req.user.must_change_password) {
    return res.status(403).json({ error: 'Bạn cần đặt mật khẩu mới trước khi tiếp tục.', code: 'must_change_password' });
  }
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới làm được việc này.' });
  next();
}

const cookieOptions = (req) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
const setSessionCookie = (req, res, token) => res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: auth.SESSION_TTL });
const clearSessionCookie = (req, res) => res.clearCookie(COOKIE, cookieOptions(req));

const limiter = new auth.Limiter(15 * 60 * 1000);

/* ---------------- Trang tĩnh ---------------- */

app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').set('Cache-Control', 'no-cache');
  res.send(
    JSON.stringify({
      id: '/',
      name: APP_NAME,
      short_name: APP_NAME,
      description: 'Chat riêng cho hội bạn',
      lang: 'vi',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#EEF2EF',
      theme_color: '#0E7C66',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    })
  );
});

// App Android (APK từ PWABuilder) kiểm tra file này để mở toàn màn hình, không hiện thanh địa chỉ.
// Cách 1: chép assetlinks.json vào thư mục data/.  Cách 2: đặt ANDROID_PACKAGE + ANDROID_SHA256 trong .env
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  const file = path.join(DATA_DIR, 'assetlinks.json');
  if (fs.existsSync(file)) {
    try {
      return res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      console.warn('[apk] data/assetlinks.json không phải JSON hợp lệ. Hãy chép lại nguyên file từ PWABuilder.');
      return res.status(500).json({ error: 'assetlinks.json không hợp lệ' });
    }
  }
  const pkg = (process.env.ANDROID_PACKAGE || '').trim();
  const fingerprints = (process.env.ANDROID_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (pkg && fingerprints.length) {
    return res.json([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
    }]);
  }
  res.status(404).json([]);
});

// Máy chủ không giữ ổ đĩa (Render Free): ảnh chưa có trên máy thì tải từ Firebase về trước khi gửi
const fromCloud = (dir) => async (req, res, next) => {
  if (!cloud.enabled() || !/^\/[\w.-]+$/.test(req.path)) return next();
  try {
    await cloud.fetchFile(`uploads/${dir}${req.path}`);
  } catch (err) {
    console.warn('☁️  Không tải được ảnh từ Firebase:', cloud.explain(err));
  }
  next();
};

app.use('/uploads/avatars', fromCloud('avatars'), express.static(AVATAR_DIR, { index: false, maxAge: '365d', immutable: true }));
app.use(
  '/uploads/img',
  (req, res, next) => (loadSession(req) ? next() : res.status(401).send('Cần đăng nhập để xem ảnh.')),
  fromCloud('img'),
  express.static(IMAGE_DIR, {
    index: false,
    setHeaders: (res) => res.set('Cache-Control', 'private, max-age=31536000, immutable'),
  })
);

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      const immutable = filePath.includes(`${path.sep}fonts${path.sep}`);
      res.set('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  })
);

/* ---------------- API: đăng nhập ---------------- */

app.get('/api/config', (req, res) => {
  res.json({ appName: APP_NAME, vapidPublicKey: push.publicKey() });
});

app.post('/api/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const username = String(req.body?.username || '').trim().toLowerCase().slice(0, 64);
  const password = String(req.body?.password || '');
  const keys = [`ip:${ip}`, `pair:${ip}|${username}`, `user:${username}`];
  if (limiter.count(keys[0]) >= 40 || limiter.count(keys[1]) >= 8 || limiter.count(keys[2]) >= 30) {
    return res.status(429).json({ error: 'Bạn nhập sai quá nhiều lần. Đợi 15 phút rồi thử lại.' });
  }
  if (!username || !password) return res.status(400).json({ error: 'Nhập tên đăng nhập và mật khẩu.' });

  const user = get('SELECT * FROM users WHERE username = ?', username);
  const ok = await auth.verifyPassword(password, user?.password_hash);
  if (!user || !ok) {
    keys.forEach((k) => limiter.hit(k));
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu.' });
  }
  if (user.disabled) return res.status(403).json({ error: 'Tài khoản này đã bị khóa. Liên hệ admin để mở lại.' });

  limiter.clear(keys[1]);
  setSessionCookie(req, res, auth.createSession(user.id, req.get('user-agent')));
  res.json({ user: meUser(user) });
});

app.post('/api/logout', requireAuth, (req, res) => {
  auth.deleteSession(req.sessionHash); // xóa luôn đăng ký thông báo của thiết bị này
  disconnectSockets(req.user.id, (s) => s.data.sessionHash === req.sessionHash, 'Bạn đã đăng xuất.');
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

/* ---------------- API: tài khoản của tôi ---------------- */

app.get('/api/me', (req, res) => {
  const session = loadSession(req);
  res.json({ user: session ? meUser(session) : null }); // chưa đăng nhập thì trả null, không báo lỗi
});

app.post('/api/me/password', requireAuth, async (req, res) => {
  const key = `pw:${req.user.id}`;
  if (limiter.count(key) >= 10) return res.status(429).json({ error: 'Bạn nhập sai quá nhiều lần. Đợi 15 phút rồi thử lại.' });
  const { currentPassword, newPassword } = req.body || {};
  if (!validPassword(newPassword)) return res.status(400).json({ error: 'Mật khẩu mới cần từ 6 đến 128 ký tự.' });

  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  // Lần đầu đăng nhập (mật khẩu tạm) thì không hỏi lại mật khẩu cũ
  if (!user.must_change_password && !(await auth.verifyPassword(String(currentPassword || ''), user.password_hash))) {
    limiter.hit(key);
    return res.status(400).json({ error: 'Mật khẩu hiện tại chưa đúng.' });
  }
  if (await auth.verifyPassword(newPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu đang dùng.' });
  }
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await auth.hashPassword(newPassword), user.id);
  // Đăng xuất mọi thiết bị khác
  auth.deleteUserSessions(user.id, req.sessionHash);
  disconnectSockets(user.id, (s) => s.data.sessionHash !== req.sessionHash, 'Mật khẩu vừa được đổi trên thiết bị khác.');
  res.json({ user: meUser(get('SELECT * FROM users WHERE id = ?', user.id)) });
});

app.patch('/api/me', requireAuth, requireReady, (req, res) => {
  const name = normDisplayName(req.body?.displayName);
  if (!name) return res.status(400).json({ error: 'Tên hiển thị cần từ 1 đến 40 ký tự.' });
  run('UPDATE users SET display_name = ? WHERE id = ?', name, req.user.id);
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  io.emit('user:updated', publicUser(user));
  res.json({ user: meUser(user) });
});

const rawImage = express.raw({ type: () => true, limit: '10mb' });

app.post('/api/me/avatar', requireAuth, requireReady, rawImage, (req, res) => {
  const kind = sniffImage(req.body);
  if (!kind) return res.status(400).json({ error: 'File này không phải ảnh JPG, PNG, WEBP hoặc GIF.' });
  if (req.body.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'Ảnh đại diện tối đa 2 MB.' });
  const name = `${req.user.id}-${crypto.randomBytes(6).toString('hex')}.${kind}`;
  fs.writeFileSync(path.join(AVATAR_DIR, name), req.body);
  cloud.saveFile(`uploads/avatars/${name}`);
  run('UPDATE users SET avatar = ? WHERE id = ?', `/uploads/avatars/${name}`, req.user.id);
  removeUpload(req.user.avatar);
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  io.emit('user:updated', publicUser(user));
  res.json({ user: meUser(user) });
});

app.delete('/api/me/avatar', requireAuth, requireReady, (req, res) => {
  run('UPDATE users SET avatar = NULL WHERE id = ?', req.user.id);
  removeUpload(req.user.avatar);
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  io.emit('user:updated', publicUser(user));
  res.json({ user: meUser(user) });
});

/* ---------------- API: chat ---------------- */

app.get('/api/users', requireAuth, requireReady, (req, res) => {
  const users = all('SELECT id, username, display_name, avatar, role, disabled, last_seen FROM users ORDER BY id');
  res.json({ users: users.map(publicUser) });
});

app.get('/api/conversations', requireAuth, requireReady, (req, res) => {
  res.json({ conversations: listConvs(req.user.id) });
});

app.get('/api/conversations/:id', requireAuth, requireReady, (req, res) => {
  const conv = getConv(Number(req.params.id), req.user.id);
  if (!conv) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
  res.json({ conversation: conv });
});

app.post('/api/conversations/dm', requireAuth, requireReady, (req, res) => {
  const otherId = Number(req.body?.userId);
  if (!Number.isInteger(otherId) || otherId === req.user.id) return res.status(400).json({ error: 'Chọn một người để nhắn tin.' });
  const other = get('SELECT id, disabled FROM users WHERE id = ?', otherId);
  if (!other || other.disabled) return res.status(404).json({ error: 'Không tìm thấy người này.' });

  const key = [req.user.id, otherId].sort((a, b) => a - b).join(':');
  let row = get('SELECT id FROM conversations WHERE dm_key = ?', key);
  if (!row) {
    row = transaction(() => {
      const id = Number(run("INSERT INTO conversations (type, dm_key, created_at) VALUES ('dm', ?, ?)", key, Date.now()).lastInsertRowid);
      run('INSERT INTO members (conversation_id, user_id) VALUES (?, ?)', id, req.user.id);
      run('INSERT INTO members (conversation_id, user_id) VALUES (?, ?)', id, otherId);
      return { id };
    });
  }
  res.json({ conversation: getConv(row.id, req.user.id) });
});

app.get('/api/conversations/:id/messages', requireAuth, requireReady, (req, res) => {
  const convId = Number(req.params.id);
  if (!membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
  const limit = clampInt(req.query.limit, 1, 100) || 40;
  const before = clampInt(req.query.before, 1, Number.MAX_SAFE_INTEGER) || Number.MAX_SAFE_INTEGER;
  const rows = all(`${MSG_SELECT} WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`, convId, before, limit).reverse();
  const reacts = rows.length ? reactionsBetween(convId, rows[0].id, rows[rows.length - 1].id) : new Map();
  const reads = all('SELECT user_id, last_read_id FROM members WHERE conversation_id = ?', convId);
  res.json({
    messages: rows.map((m) => serializeMessage(m, reacts.get(m.id))),
    hasMore: rows.length === limit,
    reads: reads.map((r) => ({ userId: r.user_id, lastReadId: r.last_read_id })),
  });
});

// Ảnh vừa tải lên, chờ được gắn vào tin nhắn (quá 1 giờ không gửi thì xóa)
const pendingUploads = new Map();

app.post('/api/upload', requireAuth, requireReady, rawImage, (req, res) => {
  const kind = sniffImage(req.body);
  if (!kind) return res.status(400).json({ error: 'File này không phải ảnh JPG, PNG, WEBP hoặc GIF.' });
  const w = clampInt(req.query.w, 1, 20000);
  const h = clampInt(req.query.h, 1, 20000);
  const name = `${crypto.randomUUID()}${w && h ? `_${w}x${h}` : ''}.${kind}`;
  fs.writeFileSync(path.join(IMAGE_DIR, name), req.body);
  cloud.saveFile(`uploads/img/${name}`);
  const url = `/uploads/img/${name}`;
  pendingUploads.set(url, { userId: req.user.id, at: Date.now() });
  res.json({ url });
});

app.post('/api/conversations/:id/messages', requireAuth, requireReady, (req, res) => {
  const convId = Number(req.params.id);
  const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
  if (!conv || !membership(convId, req.user.id)) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });

  const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\r\n?/g, '\n').trim() : '';
  if (text.length > 4000) return res.status(400).json({ error: 'Tin nhắn dài quá 4000 ký tự. Hãy chia nhỏ ra.' });
  let image = null;
  if (req.body?.image) {
    const upload = pendingUploads.get(req.body.image);
    if (!upload || upload.userId !== req.user.id) return res.status(400).json({ error: 'Ảnh đã hết hạn. Hãy chọn và gửi lại.' });
    pendingUploads.delete(req.body.image);
    image = req.body.image;
  }
  if (!text && !image) return res.status(400).json({ error: 'Tin nhắn đang trống.' });
  let replyTo = null;
  if (req.body?.replyTo != null) {
    const target = get("SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND kind <> 'system'", Number(req.body.replyTo), convId);
    if (!target) return res.status(400).json({ error: 'Không tìm thấy tin nhắn bạn muốn trả lời.' });
    replyTo = target.id;
  }

  const newId = transaction(() => {
    const id = Number(
      run(
        'INSERT INTO messages (conversation_id, sender_id, text, image, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        convId,
        req.user.id,
        text || null,
        image,
        replyTo,
        Date.now()
      ).lastInsertRowid
    );
    run('UPDATE conversations SET last_message_id = ? WHERE id = ?', id, convId);
    run('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?', id, convId, req.user.id);
    return id;
  });

  const message = loadMessage(newId);
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.slice(0, 64) : undefined;
  const members = memberIds(convId);
  for (const uid of members) {
    io.to(`user:${uid}`).emit('message:new', uid === req.user.id ? { ...message, clientId } : message);
  }
  res.json({ message: { ...message, clientId } });

  notifyMembers(conv, message, members).catch((err) => console.warn('[push]', err.message));
});

async function notifyMembers(conv, message, members) {
  const targets = members.filter((uid) => uid !== message.senderId && !isActive(uid));
  if (!targets.length) return;
  const sender = get('SELECT display_name, avatar FROM users WHERE id = ?', message.senderId);
  const text = message.text ? (message.image ? `📷 ${message.text}` : message.text) : '📷 Đã gửi một ảnh';
  const base = {
    type: 'message',
    conversationId: conv.id,
    messageId: message.id,
    isGroup: conv.type !== 'dm',
    convTitle: conv.type === 'dm' ? sender.display_name : conv.name,
    senderName: sender.display_name,
    text: text.length > 180 ? `${text.slice(0, 177)}…` : text,
    icon: sender.avatar || '/icons/icon-192.png',
    url: `/#/c/${conv.id}`,
    createdAt: message.createdAt,
  };
  await Promise.all(targets.map((uid) => push.sendToUser(uid, { ...base, badge: unreadTotal(uid) })));
}

app.post('/api/conversations/:id/read', requireAuth, requireReady, (req, res) => {
  const convId = Number(req.params.id);
  const mem = membership(convId, req.user.id);
  if (!mem) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
  const lastId = get('SELECT last_message_id FROM conversations WHERE id = ?', convId).last_message_id || 0;
  const wanted = clampInt(req.body?.messageId, 0, Number.MAX_SAFE_INTEGER);
  const target = Math.min(wanted ?? lastId, lastId);
  if (target > mem.last_read_id) {
    run('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?', target, convId, req.user.id);
    for (const uid of memberIds(convId)) {
      io.to(`user:${uid}`).emit('read', { conversationId: convId, userId: req.user.id, lastReadId: target });
    }
  }
  res.json({ ok: true, unreadTotal: unreadTotal(req.user.id) });
});

// Thu hồi tin nhắn của chính mình
app.delete('/api/messages/:id', requireAuth, requireReady, (req, res) => {
  const msg = get('SELECT * FROM messages WHERE id = ?', Number(req.params.id));
  if (!msg || msg.sender_id !== req.user.id || msg.kind === 'system') return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
  if (!msg.deleted) {
    run('UPDATE messages SET deleted = 1, text = NULL, image = NULL WHERE id = ?', msg.id);
    run('DELETE FROM reactions WHERE message_id = ?', msg.id);
    removeUpload(msg.image);
    for (const uid of memberIds(msg.conversation_id)) {
      io.to(`user:${uid}`).emit('message:deleted', { conversationId: msg.conversation_id, messageId: msg.id });
    }
  }
  res.json({ ok: true });
});

/* ---------------- API: thả cảm xúc ---------------- */

const REACTIONS = ['\u2764\uFE0F', '\u{1F606}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F44D}']; // ❤️ 😆 😮 😢 😡 👍

app.post('/api/messages/:id/reactions', requireAuth, requireReady, (req, res) => {
  const msg = get('SELECT * FROM messages WHERE id = ?', Number(req.params.id));
  if (!msg || msg.deleted || msg.kind === 'system' || !membership(msg.conversation_id, req.user.id)) {
    return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
  }
  const emoji = String(req.body?.emoji || '');
  if (!REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Cảm xúc này chưa được hỗ trợ.' });

  // Bấm lại đúng cảm xúc cũ thì gỡ, chọn cảm xúc khác thì đổi
  const current = get('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?', msg.id, req.user.id);
  const removing = Boolean(current && current.emoji === emoji);
  if (removing) {
    run('DELETE FROM reactions WHERE message_id = ? AND user_id = ?', msg.id, req.user.id);
  } else {
    run(
      `INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
      msg.id, req.user.id, emoji, Date.now()
    );
  }
  const payload = { conversationId: msg.conversation_id, messageId: msg.id, reactions: reactionsOf(msg.id) };
  for (const uid of memberIds(msg.conversation_id)) io.to(`user:${uid}`).emit('message:reactions', payload);
  res.json(payload);

  if (!removing && msg.sender_id !== req.user.id && !isActive(msg.sender_id)) {
    notifyReaction(msg, req.user.id, emoji).catch((err) => console.warn('[push]', err.message));
  }
});

async function notifyReaction(msg, actorId, emoji) {
  const conv = get('SELECT id, type, name FROM conversations WHERE id = ?', msg.conversation_id);
  const actor = get('SELECT display_name, avatar FROM users WHERE id = ?', actorId);
  const what = msg.text ? `tin nhắn của bạn: “${snippet(msg.text, 60)}”` : 'ảnh của bạn';
  await push.sendToUser(msg.sender_id, {
    type: 'reaction',
    conversationId: conv.id,
    title: conv.type === 'dm' ? actor.display_name : conv.name,
    body: `${actor.display_name} đã bày tỏ cảm xúc ${emoji} về ${what}`,
    icon: actor.avatar || '/icons/icon-192.png',
    tag: `react-${conv.id}`,
    url: `/#/c/${conv.id}`,
  });
}

/* ---------------- API: nhóm chat riêng ---------------- */

function normGroupName(value) {
  const s = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= 1 && s.length <= 60 ? s : null;
}

// Lọc danh sách người dùng hợp lệ (đang hoạt động, không trùng, bỏ chính mình)
function activeUserIds(list, excludeId) {
  if (!Array.isArray(list)) return [];
  const active = new Set(all('SELECT id FROM users WHERE disabled = 0').map((r) => r.id));
  return [...new Set(list.map(Number))].filter((id) => id !== excludeId && active.has(id)).slice(0, 200);
}

// Tin hệ thống trong nhóm: "Minh đã thêm Lan vào nhóm"... (không tính là tin chưa đọc)
function systemMessage(convId, actorId, data) {
  const id = Number(
    run("INSERT INTO messages (conversation_id, sender_id, kind, text, created_at) VALUES (?, ?, 'system', ?, ?)",
      convId, actorId, JSON.stringify(data), Date.now()).lastInsertRowid
  );
  run('UPDATE conversations SET last_message_id = ? WHERE id = ?', id, convId);
  return id;
}

function emitMessage(messageId, userIds) {
  const message = loadMessage(messageId);
  for (const uid of userIds) io.to(`user:${uid}`).emit('message:new', message);
}

function emitConvChanged(convId, userIds, extra = {}) {
  for (const uid of new Set(userIds)) io.to(`user:${uid}`).emit('conversation:changed', { conversationId: convId, ...extra });
}

function notifyAdded(convId, actorId, userIds) {
  const conv = get('SELECT name FROM conversations WHERE id = ?', convId);
  const actor = get('SELECT display_name, avatar FROM users WHERE id = ?', actorId);
  for (const uid of userIds) {
    if (isActive(uid)) continue;
    push.sendToUser(uid, {
      type: 'group',
      conversationId: convId,
      title: conv.name,
      body: `${actor.display_name} đã thêm bạn vào nhóm`,
      icon: actor.avatar || '/icons/icon-192.png',
      tag: `group-${convId}`,
      url: `/#/c/${convId}`,
    }).catch((err) => console.warn('[push]', err.message));
  }
}

function groupFor(req, res) {
  const conv = get('SELECT * FROM conversations WHERE id = ?', Number(req.params.id));
  if (!conv || conv.type !== 'group' || !membership(conv.id, req.user.id)) {
    res.status(404).json({ error: 'Không tìm thấy nhóm này.' });
    return null;
  }
  return conv;
}

app.post('/api/groups', requireAuth, requireReady, (req, res) => {
  const others = activeUserIds(req.body?.memberIds, req.user.id);
  if (others.length < 2) return res.status(400).json({ error: 'Chọn ít nhất 2 người để tạo nhóm.' });
  let name = normGroupName(req.body?.name);
  if (!name) {
    const names = [req.user.id, ...others].slice(0, 4).map((id) => get('SELECT display_name FROM users WHERE id = ?', id).display_name);
    name = normGroupName(names.join(', ')) || 'Nhóm mới';
  }
  const convId = transaction(() => {
    const id = Number(
      run("INSERT INTO conversations (type, name, created_by, created_at) VALUES ('group', ?, ?, ?)", name, req.user.id, Date.now()).lastInsertRowid
    );
    for (const uid of [req.user.id, ...others]) run('INSERT INTO members (conversation_id, user_id, last_read_id) VALUES (?, ?, 0)', id, uid);
    systemMessage(id, req.user.id, { event: 'create' });
    return id;
  });
  emitConvChanged(convId, [req.user.id, ...others], { addedBy: req.user.id, added: others });
  res.json({ conversation: getConv(convId, req.user.id) });
  notifyAdded(convId, req.user.id, others);
});

app.patch('/api/groups/:id', requireAuth, requireReady, (req, res) => {
  const conv = groupFor(req, res);
  if (!conv) return;
  const name = normGroupName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Tên nhóm cần từ 1 đến 60 ký tự.' });
  if (name !== conv.name) {
    const msgId = transaction(() => {
      run('UPDATE conversations SET name = ? WHERE id = ?', name, conv.id);
      return systemMessage(conv.id, req.user.id, { event: 'rename', name });
    });
    const members = memberIds(conv.id);
    emitMessage(msgId, members);
    emitConvChanged(conv.id, members);
  }
  res.json({ conversation: getConv(conv.id, req.user.id) });
});

app.post('/api/groups/:id/members', requireAuth, requireReady, (req, res) => {
  const conv = groupFor(req, res);
  if (!conv) return;
  const current = new Set(memberIds(conv.id));
  const toAdd = activeUserIds(req.body?.userIds, req.user.id).filter((id) => !current.has(id));
  if (!toAdd.length) return res.status(400).json({ error: 'Chọn ít nhất 1 người chưa có trong nhóm.' });
  const msgId = transaction(() => {
    const last = get('SELECT last_message_id FROM conversations WHERE id = ?', conv.id).last_message_id || 0;
    for (const uid of toAdd) run('INSERT OR IGNORE INTO members (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)', conv.id, uid, last);
    return systemMessage(conv.id, req.user.id, { event: 'add', targets: toAdd });
  });
  const members = memberIds(conv.id);
  emitMessage(msgId, members);
  emitConvChanged(conv.id, members, { addedBy: req.user.id, added: toAdd });
  res.json({ conversation: getConv(conv.id, req.user.id) });
  notifyAdded(conv.id, req.user.id, toAdd);
});

// Rời nhóm (xóa chính mình) hoặc trưởng nhóm xóa thành viên
app.delete('/api/groups/:id/members/:userId', requireAuth, requireReady, (req, res) => {
  const conv = groupFor(req, res);
  if (!conv) return;
  const target = Number(req.params.userId);
  const leaving = target === req.user.id;
  if (!leaving && conv.created_by !== req.user.id) return res.status(403).json({ error: 'Chỉ trưởng nhóm mới xóa được thành viên.' });
  if (!membership(conv.id, target)) return res.status(404).json({ error: 'Người này không có trong nhóm.' });

  const before = memberIds(conv.id);
  const images = all('SELECT image FROM messages WHERE conversation_id = ? AND image IS NOT NULL', conv.id).map((r) => r.image);
  const result = transaction(() => {
    run('DELETE FROM members WHERE conversation_id = ? AND user_id = ?', conv.id, target);
    if (get('SELECT COUNT(*) AS n FROM members WHERE conversation_id = ?', conv.id).n === 0) {
      run('DELETE FROM conversations WHERE id = ?', conv.id); // người cuối cùng rời: xóa nhóm
      return { deleted: true };
    }
    if (conv.created_by === target) {
      // Trưởng nhóm rời: chuyển cho người vào nhóm sớm nhất còn lại
      const heir = get('SELECT user_id FROM members WHERE conversation_id = ? ORDER BY rowid LIMIT 1', conv.id);
      run('UPDATE conversations SET created_by = ? WHERE id = ?', heir.user_id, conv.id);
    }
    return { msgId: systemMessage(conv.id, req.user.id, leaving ? { event: 'leave' } : { event: 'remove', targets: [target] }) };
  });
  if (result.deleted) images.forEach(removeUpload);
  else emitMessage(result.msgId, memberIds(conv.id));
  emitConvChanged(conv.id, before, { removed: [target] });
  res.json({ ok: true });
});

/* ---------------- API: thông báo đẩy ---------------- */

app.get('/api/push/key', (req, res) => res.json({ publicKey: push.publicKey() }));

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription;
  if (!push.isValidSubscription(sub)) return res.status(400).json({ error: 'Trình duyệt gửi đăng ký thông báo không hợp lệ.' });
  const oldEndpoint = typeof req.body?.oldEndpoint === 'string' ? req.body.oldEndpoint : null;
  push.save(req.user.id, req.sessionHash, sub, oldEndpoint);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  if (typeof req.body?.endpoint === 'string') push.remove(req.body.endpoint, req.user.id);
  res.json({ ok: true });
});

app.post('/api/push/test', requireAuth, async (req, res) => {
  const sent = await push.sendToUser(req.user.id, {
    type: 'test',
    title: APP_NAME,
    body: 'Thông báo đang hoạt động. Bạn sẽ nhận tin nhắn mới kể cả khi đóng app.',
  });
  if (!sent) return res.status(400).json({ error: 'Chưa có thiết bị nào bật thông báo cho tài khoản này.' });
  res.json({ ok: true, sent });
});

/* ---------------- API: admin ---------------- */

const admin = express.Router();
admin.use(requireAuth, requireReady, requireAdmin);

const adminUser = (u) => ({ ...publicUser(u), mustChangePassword: Boolean(u.must_change_password), createdAt: u.created_at });
const findUser = (id) => get('SELECT * FROM users WHERE id = ?', Number(id));

admin.get('/users', (req, res) => {
  res.json({ users: all('SELECT * FROM users ORDER BY id').map(adminUser) });
});

admin.post('/users', async (req, res) => {
  const username = normUsername(req.body?.username);
  if (!username) {
    return res.status(400).json({ error: 'Tên đăng nhập cần 3–32 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới.' });
  }
  if (get('SELECT 1 AS x FROM users WHERE username = ?', username)) {
    return res.status(409).json({ error: 'Tên đăng nhập này đã có người dùng. Chọn tên khác.' });
  }
  const displayName = normDisplayName(req.body?.displayName) || username;
  const password = req.body?.password ? String(req.body.password) : auth.generatePassword(10);
  if (!validPassword(password)) return res.status(400).json({ error: 'Mật khẩu tạm cần từ 6 đến 128 ký tự.' });
  const role = req.body?.role === 'admin' ? 'admin' : 'member';

  const user = await createUser({ username, displayName, password, role, mustChange: true });
  io.emit('user:updated', publicUser(user));
  res.json({ user: adminUser(user), password });
});

admin.post('/users/:id/reset-password', async (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Đổi mật khẩu của chính bạn trong phần Tài khoản.' });
  const password = req.body?.password ? String(req.body.password) : auth.generatePassword(10);
  if (!validPassword(password)) return res.status(400).json({ error: 'Mật khẩu tạm cần từ 6 đến 128 ký tự.' });
  run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', await auth.hashPassword(password), user.id);
  auth.deleteUserSessions(user.id);
  disconnectSockets(user.id, () => true, 'Admin vừa đặt lại mật khẩu của bạn.');
  res.json({ user: adminUser(findUser(user.id)), password });
});

admin.post('/users/:id/disabled', (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Bạn không thể tự khóa tài khoản của mình.' });
  const disabled = Boolean(req.body?.disabled);
  run('UPDATE users SET disabled = ? WHERE id = ?', disabled ? 1 : 0, user.id);
  if (disabled) {
    auth.deleteUserSessions(user.id);
    disconnectSockets(user.id, () => true, 'Tài khoản của bạn đã bị khóa.');
  }
  const fresh = findUser(user.id);
  io.emit('user:updated', publicUser(fresh));
  res.json({ user: adminUser(fresh) });
});

admin.post('/users/:id/role', (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  const role = req.body?.role === 'admin' ? 'admin' : 'member';
  if (user.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Bạn không thể tự gỡ quyền admin của mình.' });
  run('UPDATE users SET role = ? WHERE id = ?', role, user.id);
  const fresh = findUser(user.id);
  io.emit('user:updated', publicUser(fresh));
  res.json({ user: adminUser(fresh) });
});

app.use('/api/admin', admin);

app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy đường dẫn API này.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File quá lớn (tối đa 10 MB).' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu gửi lên không đúng định dạng.' });
  console.error(err);
  res.status(500).json({ error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.' });
});

/* ---------------- Realtime (Socket.IO) ---------------- */

io.use((socket, next) => {
  const session = auth.findSession(auth.parseCookies(socket.handshake.headers.cookie)[COOKIE]);
  if (!session) return next(new Error('unauthorized'));
  if (session.must_change_password) return next(new Error('must_change_password'));
  socket.data.userId = session.id;
  socket.data.sessionHash = session.token_hash;
  socket.data.visible = false;
  socket.data.lastActive = 0;
  socket.data.typingAt = 0;
  next();
});

io.on('connection', (socket) => {
  const uid = socket.data.userId;
  socket.join(`user:${uid}`);
  let set = online.get(uid);
  if (!set) online.set(uid, (set = new Set()));
  set.add(socket);
  if (set.size === 1) io.emit('presence', { userId: uid, online: true });

  socket.on('visibility', (data) => {
    socket.data.visible = Boolean(data && data.visible);
    socket.data.lastActive = Date.now();
  });

  socket.on('typing', (data) => {
    const now = Date.now();
    if (now - socket.data.typingAt < 1500) return;
    socket.data.typingAt = now;
    const convId = Number(data && data.conversationId);
    if (!Number.isInteger(convId) || !membership(convId, uid)) return;
    for (const m of memberIds(convId)) {
      if (m !== uid) io.to(`user:${m}`).emit('typing', { conversationId: convId, userId: uid });
    }
  });

  socket.on('disconnect', () => {
    const current = online.get(uid);
    if (!current) return;
    current.delete(socket);
    if (current.size === 0) {
      online.delete(uid);
      const ts = Date.now();
      run('UPDATE users SET last_seen = ? WHERE id = ?', ts, uid);
      io.emit('presence', { userId: uid, online: false, lastSeen: ts });
    }
  });
});

/* ---------------- Dọn dẹp định kỳ ---------------- */

setInterval(() => {
  run('DELETE FROM sessions WHERE last_used < ?', Date.now() - auth.SESSION_TTL);
  for (const [url, info] of pendingUploads) {
    if (Date.now() - info.at > 60 * 60 * 1000) {
      pendingUploads.delete(url);
      removeUpload(url);
    }
  }
  limiter.prune();
}, 30 * 60 * 1000).unref();

/* ---------------- Khởi động ---------------- */

(async () => {
  cloud.attach(db); // bắt đầu tự sao lưu lên Firebase (nếu có cấu hình)
  await bootstrapAdmin();
  await resetAdminFromEnv();
  server.listen(PORT, HOST, () => {
    console.log(`✅ ${APP_NAME} đang chạy tại http://localhost:${PORT}`);
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('\nĐang tắt server...');
  setTimeout(() => process.exit(0), 25000).unref(); // Render cho khoảng 30 giây để tắt hẳn
  io.close();
  await cloud.flush(); // lưu dữ liệu lần cuối lên Firebase
  try { db.close(); } catch { /* bỏ qua */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
