'use strict';
// Bộ nhớ máy chủ: đo dung lượng, tự dọn ảnh và tin nhắn cũ khi sắp đầy, dọn thủ công cho admin.
//
// Dung lượng tính theo nơi thật sự bị giới hạn:
//  - Có Firebase (Render Free): Firestore miễn phí 1 GiB, gồm 2 bản sao lưu database + ảnh.
//  - Không có Firebase (VPS, Termux): ổ đĩa của máy chủ.
// Khi dọn: ảnh cũ bị xóa trước (chiếm nhiều chỗ nhất), tin nhắn vẫn giữ và hiện "ảnh đã được dọn";
// chưa đủ thì mới xóa tin nhắn cũ. Tin mới nhất của mỗi cuộc trò chuyện luôn được giữ lại.
// Người dùng bật "Lưu trên máy" vẫn xem lại được tin và ảnh đã lưu trên điện thoại của họ.
const fs = require('node:fs');
const path = require('node:path');
const { db, get, all, run, transaction, getSetting, setSetting, DATA_DIR, UPLOAD_DIR } = require('./db');
const cloud = require('./cloud');

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const FIREBASE_LIMIT_MB = 900; // Firestore miễn phí 1 GiB, chừa lại một ít cho an toàn
const DEFAULTS = { autoClean: true, cleanAt: 90, cleanTo: 75, limitMb: null };
const UPLOAD_RE = /^\/uploads\/(avatars|img|audio)\/([\w.-]+)$/;
const KEEP_LAST = 'id NOT IN (SELECT last_message_id FROM conversations WHERE last_message_id IS NOT NULL)';

let onChange = () => {};
let timer = null;
let cleaning = false;

const userError = (message) => Object.assign(new Error(message), { status: 400 });
const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

/* ---------------- Cài đặt ---------------- */

function settings() {
  return { ...DEFAULTS, ...(getSetting('storage', {}) || {}) };
}

function saveSettings(input) {
  const next = settings();
  if (input.autoClean !== undefined) next.autoClean = Boolean(input.autoClean);
  if (input.cleanAt !== undefined) {
    const v = Number(input.cleanAt);
    if (!(v >= 50 && v <= 99)) throw userError('Ngưỡng bắt đầu dọn cần từ 50% đến 99%.');
    next.cleanAt = Math.round(v);
  }
  if (input.cleanTo !== undefined) {
    const v = Number(input.cleanTo);
    if (!(v >= 10 && v <= 95)) throw userError('Mức dọn xuống cần từ 10% đến 95%.');
    next.cleanTo = Math.round(v);
  }
  if (next.cleanTo >= next.cleanAt) throw userError('Mức dọn xuống phải thấp hơn ngưỡng bắt đầu dọn.');
  if (input.limitMb !== undefined) {
    if (input.limitMb === null || input.limitMb === '' || Number(input.limitMb) === 0) {
      next.limitMb = null;
    } else {
      const v = Number(input.limitMb);
      if (!(v >= 50 && v <= 1024 * 1024)) throw userError('Giới hạn dung lượng cần từ 50 MB trở lên.');
      next.limitMb = Math.round(v);
    }
  }
  setSetting('storage', next);
  scheduleCheck(500);
  return next;
}

/* ---------------- File đã tải lên ---------------- */

function recordUpload(url, kind, size, userId) {
  run(
    'INSERT OR REPLACE INTO uploads (path, kind, size, user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    url, kind, size || 0, userId ?? null, Date.now()
  );
  scheduleCheck();
}

function removeUpload(url) {
  const m = UPLOAD_RE.exec(url || '');
  if (!m) return;
  fs.unlink(path.join(UPLOAD_DIR, m[1], m[2]), () => {});
  cloud.removeFile(`uploads/${m[1]}/${m[2]}`);
  run('DELETE FROM uploads WHERE path = ?', url);
}

// Ghi nhận dung lượng các file có từ trước khi có bảng uploads (chạy một lần)
async function backfill() {
  const rows = all(`
    SELECT image AS path, 'img' AS kind, sender_id AS user_id, created_at FROM messages
     WHERE image IS NOT NULL AND image NOT IN (SELECT path FROM uploads)
    UNION ALL
    SELECT avatar, 'avatar', id, created_at FROM users
     WHERE avatar IS NOT NULL AND avatar NOT IN (SELECT path FROM uploads)`);
  for (const r of rows) {
    const m = UPLOAD_RE.exec(r.path);
    if (!m) continue;
    let size = sizeOf(path.join(UPLOAD_DIR, m[1], m[2]));
    if (!size && cloud.enabled()) {
      try {
        size = await cloud.fileSize(`uploads/${m[1]}/${m[2]}`);
      } catch { /* thử lại lần khởi động sau */ }
    }
    run('INSERT OR IGNORE INTO uploads (path, kind, size, user_id, created_at) VALUES (?, ?, ?, ?, ?)',
      r.path, r.kind, size, r.user_id, r.created_at);
  }
  if (rows.length) console.log(`📦 Đã ghi nhận dung lượng ${rows.length} file có từ trước.`);
}

/* ---------------- Đo dung lượng ---------------- */

function limitFor(total, useCustom = true) {
  const custom = settings().limitMb;
  if (useCustom && custom) return { bytes: custom * MB, source: 'custom' };
  const env = Number(process.env.STORAGE_LIMIT_MB);
  if (env > 0) return { bytes: env * MB, source: 'env' };
  if (cloud.enabled()) return { bytes: FIREBASE_LIMIT_MB * MB, source: 'firebase' };
  try {
    const st = fs.statfsSync(DATA_DIR); // dung lượng app đang dùng + phần ổ đĩa còn trống
    return { bytes: Math.max(total + st.bavail * st.bsize, 64 * MB), source: 'disk' };
  } catch {
    return { bytes: 2048 * MB, source: 'default' };
  }
}

function usage() {
  const dbFile = path.join(DATA_DIR, 'chat.db');
  const local = sizeOf(dbFile) + sizeOf(`${dbFile}-wal`);
  // Có Firebase: database nằm trên Firestore dưới dạng 2 bản sao lưu đã nén
  const dbBytes = cloud.enabled() ? cloud.backupBytes() || Math.round(local * 0.5) : local;
  const rows = all('SELECT kind, COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM uploads GROUP BY kind');
  const pick = (kind) => {
    const r = rows.find((x) => x.kind === kind);
    return { count: r ? r.n : 0, bytes: r ? r.bytes : 0 };
  };
  const images = pick('img');
  const avatars = pick('avatar');
  const audio = pick('audio'); // tin nhắn thoại
  const messages = get('SELECT COUNT(*) AS n FROM messages').n;
  const total = dbBytes + images.bytes + avatars.bytes + audio.bytes;
  const limit = limitFor(total);
  return {
    total,
    limit: limit.bytes,
    limitSource: limit.source,
    defaultLimit: limitFor(total, false).bytes,
    percent: limit.bytes ? (total / limit.bytes) * 100 : 0,
    db: { bytes: dbBytes, messages },
    images,
    avatars,
    audio,
    cloud: cloud.enabled(),
  };
}

/* ---------------- Xóa dữ liệu ---------------- */

// Ảnh (và file tin nhắn thoại): tin nhắn vẫn còn, chỉ file bị xóa khỏi máy chủ
function purgeImages(rows) {
  if (!rows.length) return 0;
  const now = Date.now();
  transaction(() => {
    for (const r of rows) run('UPDATE messages SET image = NULL, audio = NULL, image_purged = 1, updated_at = ? WHERE id = ?', now, r.id);
  });
  let bytes = 0;
  for (const r of rows) {
    bytes += r.size || 0;
    removeUpload(r.image);
  }
  return bytes;
}

// Tin nhắn: xóa hẳn (kèm ảnh và cảm xúc của tin đó)
function purgeMessages(ids) {
  if (!ids.length) return;
  const images = [];
  transaction(() => {
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const marks = part.map(() => '?').join(',');
      images.push(...db.prepare(`SELECT COALESCE(image, audio) AS image FROM messages WHERE COALESCE(image, audio) IS NOT NULL AND id IN (${marks})`).all(...part));
      db.prepare(`DELETE FROM messages WHERE id IN (${marks})`).run(...part);
    }
  });
  for (const r of images) removeUpload(r.image);
}

// Thu nhỏ file database sau khi xóa nhiều (bản sao lưu Firebase đã tự nén nên không cần)
function compact() {
  if (cloud.enabled()) return;
  try {
    db.exec('VACUUM');
  } catch { /* đang bận thì bỏ qua, lần sau thu nhỏ */ }
}

const imageBatch = (cutoff, limit) => all(
  `SELECT m.id, COALESCE(m.image, m.audio) AS image, COALESCE(u.size, 0) AS size FROM messages m LEFT JOIN uploads u ON u.path = COALESCE(m.image, m.audio)
    WHERE COALESCE(m.image, m.audio) IS NOT NULL AND m.created_at < ? ORDER BY m.id LIMIT ?`, cutoff, limit);
const messageBatch = (cutoff, limit) => all(
  `SELECT id FROM messages WHERE created_at < ? AND ${KEEP_LAST} ORDER BY id LIMIT ?`, cutoff, limit
).map((r) => r.id);

function avgMessageBytes(u) {
  return u.db.messages ? u.db.bytes / u.db.messages : 0;
}

// Xem trước: sẽ xóa bao nhiêu, giải phóng khoảng bao nhiêu
function preview(kind, cutoff) {
  if (kind === 'images') {
    const r = get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(u.size), 0) AS bytes FROM messages m LEFT JOIN uploads u ON u.path = COALESCE(m.image, m.audio)
        WHERE COALESCE(m.image, m.audio) IS NOT NULL AND m.created_at < ?`, cutoff);
    return { count: r.n, bytes: r.bytes };
  }
  const r = get(`SELECT COUNT(*) AS n FROM messages WHERE created_at < ? AND ${KEEP_LAST}`, cutoff);
  const img = get(
    `SELECT COALESCE(SUM(u.size), 0) AS bytes FROM messages m JOIN uploads u ON u.path = COALESCE(m.image, m.audio)
      WHERE m.created_at < ? AND m.${KEEP_LAST}`, cutoff);
  return { count: r.n, bytes: Math.round(r.n * avgMessageBytes(usage())) + img.bytes };
}

// Dọn thủ công (admin chọn). olderThanDays = 0 nghĩa là tất cả.
function cleanup(kind, olderThanDays, { dryRun = false } = {}) {
  const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * DAY : Date.now() + 1;
  const plan = preview(kind, cutoff);
  if (dryRun || !plan.count) return { kind, olderThanDays, ...plan, dryRun };
  if (kind === 'images') {
    for (let rows = imageBatch(cutoff, 200); rows.length; rows = imageBatch(cutoff, 200)) purgeImages(rows);
  } else {
    for (let ids = messageBatch(cutoff, 1000); ids.length; ids = messageBatch(cutoff, 1000)) purgeMessages(ids);
    compact();
  }
  const result = {
    auto: false, at: Date.now(), kind, olderThanDays,
    images: kind === 'images' ? plan.count : 0,
    messages: kind === 'messages' ? plan.count : 0,
    count: plan.count, bytes: plan.bytes,
  };
  setSetting('storage_last_clean', result);
  onChange(result);
  return { ...result, dryRun: false };
}

// Tự dọn khi vượt ngưỡng: ảnh cũ nhất trước, chưa đủ mới đến tin nhắn cũ nhất
function autoClean() {
  if (cleaning) return null;
  cleaning = true;
  try {
    const s = settings();
    if (!s.autoClean) return null;
    const u = usage();
    if (u.total < (u.limit * s.cleanAt) / 100) return null;
    let need = u.total - (u.limit * s.cleanTo) / 100;
    const result = { auto: true, at: Date.now(), images: 0, messages: 0, bytes: 0, percentBefore: u.percent };
    while (need > 0) {
      const rows = imageBatch(Date.now() + 1, 100);
      if (!rows.length) break;
      const chosen = [];
      for (const r of rows) {
        chosen.push(r);
        need -= r.size || 0;
        if (need <= 0) break;
      }
      result.bytes += purgeImages(chosen);
      result.images += chosen.length;
    }
    const avg = avgMessageBytes(u);
    if (need > 0 && avg > 0) {
      let left = Math.min(u.db.messages, Math.ceil(need / avg));
      while (left > 0) {
        const ids = messageBatch(Date.now() + 1, Math.min(left, 1000));
        if (!ids.length) break;
        purgeMessages(ids);
        left -= ids.length;
        result.messages += ids.length;
      }
      result.bytes += Math.round(result.messages * avg);
      if (result.messages) compact();
    }
    if (!result.images && !result.messages) return null;
    result.count = result.images + result.messages;
    setSetting('storage_last_clean', result);
    console.log(`🧹 Bộ nhớ máy chủ đạt ${u.percent.toFixed(0)}%: đã tự dọn ${result.images} ảnh và ${result.messages} tin nhắn cũ.`);
    onChange(result);
    return result;
  } finally {
    cleaning = false;
  }
}

function scheduleCheck(delay = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      autoClean();
    } catch (err) {
      console.warn('🧹 Tự dọn bộ nhớ lỗi:', err.message);
    }
  }, delay);
  if (timer.unref) timer.unref();
}

function init(options = {}) {
  if (options.onChange) onChange = options.onChange;
  backfill()
    .catch((err) => console.warn('📦 Không ghi nhận được dung lượng file cũ:', cloud.explain(err)))
    .finally(() => scheduleCheck(5000));
  setInterval(() => scheduleCheck(0), 10 * 60 * 1000).unref();
}

module.exports = { init, settings, saveSettings, usage, recordUpload, removeUpload, cleanup, autoClean, scheduleCheck };
