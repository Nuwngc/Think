'use strict';
const crypto = require('node:crypto');
const { get, run } = require('./db');

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL = 180 * 24 * 60 * 60 * 1000; // 180 ngày không mở app thì phải đăng nhập lại

function scrypt(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFC'), salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

// Dùng khi không có user để thời gian phản hồi giống nhau (khó dò tên đăng nhập)
const DUMMY_HASH = ['scrypt', 16384, 8, 1, Buffer.alloc(16).toString('base64'), Buffer.alloc(64).toString('base64')].join('$');

async function verifyPassword(password, stored) {
  const parts = String(stored || DUMMY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(password).normalize('NFC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return Boolean(stored) && key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Bỏ các ký tự dễ nhầm (0/O, 1/l/I) để đọc mật khẩu qua tin nhắn không bị sai
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generatePassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function createSession(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  run(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_used, user_agent) VALUES (?, ?, ?, ?, ?)',
    sha256(token),
    userId,
    now,
    now,
    String(userAgent || '').slice(0, 200)
  );
  return token;
}

function findSession(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;
  const hash = sha256(token);
  const row = get(
    `SELECT s.token_hash, s.last_used AS session_last_used,
            u.id, u.username, u.display_name, u.avatar, u.cover, u.bio, u.created_at, u.role, u.disabled, u.must_change_password, u.last_seen
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    hash
  );
  if (!row) return null;
  const now = Date.now();
  if (row.disabled || now - row.session_last_used > SESSION_TTL) {
    run('DELETE FROM sessions WHERE token_hash = ?', hash);
    return null;
  }
  if (now - row.session_last_used > 60 * 60 * 1000) {
    run('UPDATE sessions SET last_used = ? WHERE token_hash = ?', now, hash);
  }
  return row;
}

const deleteSession = (hash) => run('DELETE FROM sessions WHERE token_hash = ?', hash);
const deleteUserSessions = (userId, exceptHash = '') =>
  run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', userId, exceptHash);

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

// Chặn dò mật khẩu: đếm số lần sai trong 15 phút
class Limiter {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  count(key) {
    const entry = this.hits.get(key);
    if (!entry || Date.now() > entry.reset) return 0;
    return entry.count;
  }
  hit(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
  }
  clear(key) {
    this.hits.delete(key);
  }
  prune() {
    const now = Date.now();
    for (const [key, entry] of this.hits) if (now > entry.reset) this.hits.delete(key);
  }
}

module.exports = {
  SESSION_TTL,
  hashPassword,
  verifyPassword,
  generatePassword,
  createSession,
  findSession,
  deleteSession,
  deleteUserSessions,
  parseCookies,
  Limiter,
};
