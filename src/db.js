'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Ẩn dòng cảnh báo "SQLite is an experimental feature" của Node (không ảnh hưởng gì)
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const text = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (text.includes('SQLite is an experimental feature')) return;
  return originalEmitWarning.call(process, warning, ...args);
};

function loadDriver() {
  try {
    return require('node:sqlite').DatabaseSync; // có sẵn từ Node 22.13
  } catch {
    try {
      return require('better-sqlite3'); // dự phòng nếu bạn tự cài: npm i better-sqlite3
    } catch {
      console.error('\n❌ Không tìm thấy SQLite. App cần Node.js 22.13 trở lên.');
      console.error('   Kiểm tra phiên bản: node -v\n');
      process.exit(1);
    }
  }
}
const Driver = loadDriver();

const { DATA_DIR, UPLOAD_DIR, AVATAR_DIR, IMAGE_DIR } = require('./paths');
for (const dir of [DATA_DIR, AVATAR_DIR, IMAGE_DIR]) fs.mkdirSync(dir, { recursive: true });

const db = new Driver(path.join(DATA_DIR, 'chat.db'));
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch {
  db.exec('PRAGMA journal_mode = DELETE;'); // một số ổ đĩa (vd /sdcard trên Android) không hỗ trợ WAL
}
db.exec(`
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    disabled INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    last_seen INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_used INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT,
    dm_key TEXT UNIQUE,
    last_message_id INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT,
    image TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT REFERENCES sessions(token_hash) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

  -- Mã nhận thông báo (FCM) của app Think cài từ APK. Gắn với phiên đăng nhập: đăng xuất là tự xóa.
  CREATE TABLE IF NOT EXISTS app_push_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT REFERENCES sessions(token_hash) ON DELETE CASCADE,
    platform TEXT NOT NULL DEFAULT 'android',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_app_push_user ON app_push_tokens(user_id);

  -- Cờ vua: điểm ELO của từng người (chỉ tính ván xếp hạng giữa người với người)
  CREATE TABLE IF NOT EXISTS chess_ratings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL DEFAULT 1200,
    peak INTEGER NOT NULL DEFAULT 1200,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER
  );

  -- Cờ vua: lời thách đấu và ván cờ (status: challenge, active, finished, aborted, declined, cancelled, expired)
  CREATE TABLE IF NOT EXISTS chess_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    white_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    black_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    bot TEXT,
    challenger_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    opponent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    color_pref TEXT NOT NULL DEFAULT 'random',
    rated INTEGER NOT NULL DEFAULT 0,
    base_ms INTEGER NOT NULL DEFAULT 0,
    inc_ms INTEGER NOT NULL DEFAULT 0,
    moves TEXT NOT NULL DEFAULT '',
    fen TEXT NOT NULL,
    white_ms INTEGER,
    black_ms INTEGER,
    turn_started_at INTEGER,
    draw_offer TEXT,
    result TEXT,
    reason TEXT,
    white_rating INTEGER,
    black_rating INTEGER,
    white_delta INTEGER,
    black_delta INTEGER,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chess_status ON chess_games(status);
  CREATE INDEX IF NOT EXISTS idx_chess_white ON chess_games(white_id, status);
  CREATE INDEX IF NOT EXISTS idx_chess_black ON chess_games(black_id, status);
  CREATE INDEX IF NOT EXISTS idx_chess_challenge ON chess_games(opponent_id, status);
  CREATE INDEX IF NOT EXISTS idx_chess_ended ON chess_games(ended_at);

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT,
    image TEXT,
    game_id INTEGER REFERENCES chess_games(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, id);

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS post_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_post_comments ON post_comments(post_id, id);

  CREATE TABLE IF NOT EXISTS chess_analysis (
    game_id INTEGER PRIMARY KEY REFERENCES chess_games(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    data TEXT,
    error TEXT,
    requested_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Nâng cấp database cũ: thêm cột mới mà không mất dữ liệu
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('messages', 'kind', "kind TEXT NOT NULL DEFAULT 'text'"); // 'text' hoặc 'system' (thông báo trong nhóm)
ensureColumn('messages', 'reply_to', 'reply_to INTEGER');                 // trả lời tin nhắn nào
ensureColumn('conversations', 'created_by', 'created_by INTEGER');       // trưởng nhóm
ensureColumn('messages', 'image_purged', 'image_purged INTEGER NOT NULL DEFAULT 0'); // ảnh đã bị dọn khỏi máy chủ
ensureColumn('users', 'cover', 'cover TEXT');                               // ảnh bìa trang cá nhân
ensureColumn('users', 'bio', 'bio TEXT');                                   // giới thiệu ngắn
if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'updated_at')) {
  // Thời điểm tin nhắn thay đổi lần cuối (thu hồi, cảm xúc, dọn ảnh) để máy người dùng đồng bộ
  db.exec('ALTER TABLE messages ADD COLUMN updated_at INTEGER');
  db.exec('UPDATE messages SET updated_at = created_at');
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages(conversation_id, updated_at);
  CREATE TRIGGER IF NOT EXISTS trg_messages_updated AFTER INSERT ON messages
  WHEN NEW.updated_at IS NULL
  BEGIN
    UPDATE messages SET updated_at = NEW.created_at WHERE id = NEW.id;
  END;

  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );

  -- Mọi file đã tải lên (ảnh tin nhắn, ảnh đại diện) và dung lượng, để đo bộ nhớ máy chủ
  CREATE TABLE IF NOT EXISTS uploads (
    path TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Cache câu lệnh đã chuẩn bị để chạy nhanh hơn
const statements = new Map();
function statement(sql) {
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}
const get = (sql, ...params) => statement(sql).get(...params);
const all = (sql, ...params) => statement(sql).all(...params);
const run = (sql, ...params) => statement(sql).run(...params);

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* bỏ qua */ }
    throw err;
  }
}

// Phòng chat chung: ai có tài khoản cũng ở trong phòng này
function ensureGeneralRoom() {
  const row = get("SELECT id FROM conversations WHERE type = 'general' ORDER BY id LIMIT 1");
  if (row) return row.id;
  const name = process.env.GENERAL_ROOM_NAME || 'Cả nhóm';
  return Number(run("INSERT INTO conversations (type, name, created_at) VALUES ('general', ?, ?)", name, Date.now()).lastInsertRowid);
}
const GENERAL_ID = ensureGeneralRoom();
run(
  `INSERT OR IGNORE INTO members (conversation_id, user_id, last_read_id)
   SELECT ?, id, COALESCE((SELECT last_message_id FROM conversations WHERE id = ?), 0) FROM users`,
  GENERAL_ID,
  GENERAL_ID
);

// Cài đặt dạng JSON lưu trong database (được sao lưu cùng dữ liệu)
function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}
function setSetting(key, value) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value)
  );
}

module.exports = { db, get, all, run, transaction, getSetting, setSetting, DATA_DIR, UPLOAD_DIR, AVATAR_DIR, IMAGE_DIR, GENERAL_ID };
