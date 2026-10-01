'use strict';
// Báo lỗi app: app Think Beta (Android) và trang web tự gửi lỗi (crash, lỗi JavaScript) lên đây,
// kèm tên máy, bản Android, bản app. Admin xem trong tab Quản trị → Báo lỗi app để biết app lỗi ở máy nào.
//
// Nhận cả khi chưa đăng nhập (app có thể crash ngay lúc mở), nên giới hạn chặt: kích thước từng trường,
// số lần gửi theo địa chỉ IP, và chỉ giữ tối đa MAX_ROWS lỗi (lỗi giống nhau gộp lại, tăng số lần).
const crypto = require('node:crypto');
const { db, get, all, run, transaction } = require('./db');

const MAX_ROWS = 400;
const MAX_BATCH = 20;
const KINDS = new Set(['crash', 'native', 'js', 'promise', 'anr', 'web', 'other']);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    fatal INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL,
    stack TEXT,
    platform TEXT NOT NULL,
    app_version TEXT,
    os_version TEXT,
    device TEXT,
    where_at TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    users TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 1,
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_app_errors_last ON app_errors(last_at);
`);

const clip = (v, n) => {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  // Bỏ ký tự điều khiển (trừ xuống dòng / tab)
  const t = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Làm sạch một báo lỗi gửi lên; trả về null nếu không dùng được */
function cleanReport(r) {
  if (!r || typeof r !== 'object') return null;
  const message = clip(r.message, 600);
  if (!message) return null;
  const kind = KINDS.has(r.kind) ? r.kind : 'other';
  const platform = /^(android|ios|web)$/.test(r.platform) ? r.platform : 'other';
  return {
    kind,
    fatal: r.fatal ? 1 : 0,
    message,
    stack: clip(r.stack, 12000) || null,
    platform,
    appVersion: clip(r.appVersion, 40) || null,
    osVersion: clip(r.osVersion, 60) || null,
    device: clip(r.device, 120) || null,
    where: clip(r.where, 120) || null,
    at: Number.isFinite(Number(r.at)) ? Number(r.at) : null,
  };
}

/** Lỗi giống nhau (cùng loại, cùng nội dung, cùng vài dòng đầu của stack, cùng bản app) được gộp làm một */
function fingerprintOf(r) {
  const frames = String(r.stack || '')
    .split('\n')
    .map((l) => l.trim().replace(/:\d+(:\d+)?\)?$/, '').replace(/\?[^\s)]*/g, ''))
    .filter(Boolean)
    .slice(0, 4)
    .join('|');
  const msg = r.message.replace(/\d{3,}/g, '#');
  return crypto.createHash('sha1').update([r.kind, r.platform, r.appVersion || '', msg, frames].join('\n')).digest('hex');
}

function rateLimit(n, ms) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < ms);
    if (list.length >= n) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

function save(reports, userId) {
  const now = Date.now();
  let saved = 0;
  transaction(() => {
    for (const r of reports) {
      const fp = fingerprintOf(r);
      const old = get('SELECT id, users FROM app_errors WHERE fingerprint = ?', fp);
      if (old) {
        const users = new Set(String(old.users || '').split(',').filter(Boolean));
        if (userId) users.add(String(userId));
        run(
          `UPDATE app_errors SET count = count + 1, last_at = ?, users = ?, device = COALESCE(?, device),
             os_version = COALESCE(?, os_version), user_id = COALESCE(?, user_id) WHERE id = ?`,
          now, [...users].slice(-30).join(','), r.device, r.osVersion, userId || null, old.id
        );
      } else {
        run(
          `INSERT INTO app_errors (fingerprint, kind, fatal, message, stack, platform, app_version, os_version, device, where_at, user_id, users, first_at, last_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          fp, r.kind, r.fatal, r.message, r.stack, r.platform, r.appVersion, r.osVersion, r.device, r.where,
          userId || null, userId ? String(userId) : '', now, now
        );
      }
      saved++;
    }
    // Chỉ giữ các lỗi mới nhất
    run(`DELETE FROM app_errors WHERE id NOT IN (SELECT id FROM app_errors ORDER BY last_at DESC LIMIT ${MAX_ROWS})`);
  });
  return saved;
}

function serialize(r) {
  return {
    id: r.id,
    kind: r.kind,
    fatal: Boolean(r.fatal),
    message: r.message,
    stack: r.stack,
    platform: r.platform,
    appVersion: r.app_version,
    osVersion: r.os_version,
    device: r.device,
    where: r.where_at,
    userIds: String(r.users || '').split(',').filter(Boolean).map(Number),
    count: r.count,
    firstAt: r.first_at,
    lastAt: r.last_at,
  };
}

function setupReports({ app, io, loadSession, requireAdminChain }) {
  const perIp = rateLimit(40, 60 * 60 * 1000);

  // Nhận báo lỗi (không bắt buộc đăng nhập)
  app.post('/api/app/errors', (req, res) => {
    const list = Array.isArray(req.body?.errors) ? req.body.errors : req.body ? [req.body] : [];
    const clean = list.slice(0, MAX_BATCH).map(cleanReport).filter(Boolean);
    if (!clean.length) return res.status(400).json({ error: 'Báo lỗi không có nội dung.' });
    const ip = req.ip || req.socket?.remoteAddress || '?';
    if (!perIp(ip)) return res.status(429).json({ error: 'Gửi báo lỗi nhiều quá, thử lại sau.' });
    const session = loadSession(req);
    const saved = save(clean, session ? session.id : null);
    if (io && clean.some((r) => r.fatal)) io.to('admins').emit('admin:errors', { count: saved });
    res.json({ ok: true, saved });
  });

  app.get('/api/admin/errors', ...requireAdminChain, (req, res) => {
    const rows = all('SELECT * FROM app_errors ORDER BY last_at DESC LIMIT 200');
    const total = get('SELECT COUNT(*) AS n, COALESCE(SUM(count), 0) AS times FROM app_errors');
    res.json({ errors: rows.map(serialize), total: total.n, times: total.times });
  });

  app.delete('/api/admin/errors/:id', ...requireAdminChain, (req, res) => {
    run('DELETE FROM app_errors WHERE id = ?', Number(req.params.id));
    res.json({ ok: true });
  });

  app.delete('/api/admin/errors', ...requireAdminChain, (req, res) => {
    run('DELETE FROM app_errors');
    res.json({ ok: true });
  });
}

module.exports = { setupReports, cleanReport, fingerprintOf };
