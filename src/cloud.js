'use strict';
// Sao lưu dữ liệu lên Firebase Firestore (gói Spark miễn phí, không cần thẻ).
//
// Dùng cho máy chủ không giữ ổ đĩa như Render Free: app vẫn chạy SQLite trên ổ đĩa tạm.
//  - Khởi động: tải bản sao lưu database từ Firestore về (nếu trên máy chưa có).
//  - Đang chạy: có thay đổi thì đẩy bản mới lên, tối đa 30 giây một lần.
//  - Khi tắt (Render ngủ, khởi động lại, deploy): đẩy lần cuối.
//  - Ảnh và khóa thông báo cũng lưu trên Firestore; ảnh chỉ được tải về khi có người xem.
// Firestore giới hạn 1 MiB mỗi document nên dữ liệu được cắt thành nhiều mảnh.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DATA_DIR } = require('./paths');

const CHUNK = 900 * 1024;
const MIN_GAP = 30 * 1000;
const MISS_TTL = 10 * 60 * 1000;

let firestore = null;
let prefix = 'think';
let db = null;
let lastKey = null;
let lastRun = 0;
let running = null;
let slot = null;
const pending = new Set();   // các lượt lưu/xóa file đang chạy
const fetching = new Map();  // file đang được tải về
const misses = new Map();    // file không có trên Firestore (nhớ 10 phút)

function readCredentials() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  for (const text of [raw, Buffer.from(raw, 'base64').toString('utf8')]) {
    try {
      const json = JSON.parse(text);
      if (json && json.private_key && json.client_email) return json;
    } catch { /* thử cách khác */ }
  }
  throw new Error('Biến FIREBASE_SERVICE_ACCOUNT không đúng. Dán nguyên nội dung file khóa .json tải từ Firebase (Project settings → Service accounts).');
}

function init() {
  if (firestore) return true;
  if (process.env.THINK_FAKE_FIRESTORE) {
    // Chỉ dùng khi chạy thử nghiệm tự động
    firestore = require(path.resolve(process.env.THINK_FAKE_FIRESTORE))();
  } else {
    const credentials = readCredentials();
    if (!credentials) return false;
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    firestore = getFirestore(initializeApp({ credential: cert(credentials) }));
  }
  prefix = String(process.env.FIREBASE_PREFIX || 'think').replace(/[^\w-]/g, '') || 'think';
  return true;
}

const enabled = () => Boolean(firestore);
const col = (name) => firestore.collection(`${prefix}_${name}`);
const fileId = (rel) => rel.split(path.sep).join('/').replace(/\//g, '|');

// Dịch các lỗi thường gặp sang hướng dẫn cách sửa
function explain(err) {
  const msg = String((err && (err.details || err.message)) || err);
  if (/database \(default\) does not exist|has not been used|is disabled|NOT_FOUND/i.test(msg)) {
    return 'Chưa tạo Firestore Database. Vào Firebase → Build → Firestore Database → Create database.';
  }
  if (/UNAUTHENTICATED|invalid_grant|private key|DECODER|invalid_client/i.test(msg)) {
    return 'Khóa Firebase không hợp lệ. Tạo khóa mới ở Project settings → Service accounts → Generate new private key.';
  }
  if (/PERMISSION_DENIED/i.test(msg)) return 'Khóa Firebase không có quyền truy cập Firestore của project này.';
  if (/RESOURCE_EXHAUSTED|quota/i.test(msg)) return 'Đã hết hạn mức miễn phí trong ngày của Firestore, mai sẽ tự chạy lại.';
  return msg;
}

async function writeChunks(collection, baseId, buf) {
  const count = Math.max(1, Math.ceil(buf.length / CHUNK));
  for (let i = 0; i < count; i++) {
    await collection.doc(`${baseId}#${i}`).set({ data: buf.subarray(i * CHUNK, (i + 1) * CHUNK) });
  }
  return count;
}

async function readChunks(collection, baseId, count) {
  const parts = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const snap = await collection.doc(`${baseId}#${i}`).get();
      if (!snap.exists) throw new Error(`Thiếu mảnh dữ liệu ${baseId}#${i} trên Firestore.`);
      return Buffer.from(snap.get('data'));
    })
  );
  return Buffer.concat(parts);
}

/* ---------------- Khởi động: tải dữ liệu về ---------------- */

async function restoreAll() {
  if (!firestore) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const dbFile = path.join(DATA_DIR, 'chat.db');
  try {
    const meta = await col('meta').doc('db').get();
    if (meta.exists) slot = meta.get('slot');
    if (fs.existsSync(dbFile)) {
      // Trên máy đã có database (vd chạy trên Termux có bật Firebase): giữ bản trên máy
      console.log('☁️  Đã có dữ liệu trên máy, giữ nguyên và tự sao lưu lên Firebase khi có thay đổi.');
    } else if (meta.exists) {
      const info = meta.data();
      const gz = await readChunks(col('dbchunks'), info.slot, info.chunks);
      fs.writeFileSync(dbFile, zlib.gunzipSync(gz));
      console.log(`☁️  Đã khôi phục dữ liệu từ Firebase (bản lưu lúc ${new Date(info.updatedAt).toISOString()}).`);
    } else {
      console.log('☁️  Firebase chưa có bản sao lưu nào, bắt đầu với dữ liệu mới.');
    }
    await fetchFile('vapid.json');
  } catch (err) {
    // Không được chạy với database trống, vì lần sao lưu sau sẽ ghi đè mất dữ liệu thật
    throw new Error(`Không tải được dữ liệu từ Firebase: ${explain(err)}`);
  }
}

/* ---------------- Đang chạy: tự sao lưu database ---------------- */

function changeKey() {
  const total = db.prepare('SELECT total_changes() AS n').get().n;
  const version = db.prepare('PRAGMA data_version').get().data_version; // thay đổi từ tiến trình khác (vd lệnh admin)
  return `${total}:${version}`;
}

function attach(database) {
  if (!firestore) return;
  db = database;
  lastKey = changeKey();
  setInterval(() => {
    if (running || Date.now() - lastRun < MIN_GAP || changeKey() === lastKey) return;
    backupNow().catch(() => {});
  }, 5000).unref();
}

async function doBackup() {
  const key = changeKey();
  lastRun = Date.now();
  const tmp = path.join(os.tmpdir(), `think-${process.pid}-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); // bản chụp nhất quán của database
    const gz = zlib.gzipSync(fs.readFileSync(tmp), { level: 9 });
    const next = slot === 'A' ? 'B' : 'A'; // ghi vào ô còn lại rồi mới chuyển, lỗi giữa chừng không hỏng bản cũ
    const chunks = await writeChunks(col('dbchunks'), next, gz);
    await col('meta').doc('db').set({ slot: next, chunks, size: gz.length, updatedAt: Date.now() });
    slot = next;
    lastKey = key;
  } catch (err) {
    console.warn('☁️  Sao lưu lên Firebase lỗi, sẽ thử lại:', explain(err));
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function backupNow() {
  if (!firestore || !db) return Promise.resolve();
  if (!running) running = doBackup().finally(() => { running = null; });
  return running;
}

// Gọi khi tắt server: chờ các file đang lưu và đẩy database lần cuối
async function flush() {
  if (!firestore || !db) return;
  await Promise.allSettled([...pending]);
  if (running) await running.catch(() => {});
  if (changeKey() !== lastKey) {
    console.log('☁️  Đang lưu dữ liệu lên Firebase trước khi tắt…');
    await backupNow().then(() => console.log('☁️  Đã lưu xong.'), () => {});
  }
}

/* ---------------- File: ảnh, ảnh đại diện, khóa thông báo ---------------- */

function track(promise) {
  pending.add(promise);
  promise.finally(() => pending.delete(promise)).catch(() => {});
  return promise;
}

function saveFile(rel) {
  if (!firestore) return;
  track((async () => {
    const buf = fs.readFileSync(path.join(DATA_DIR, rel));
    const id = fileId(rel);
    const chunks = await writeChunks(col('files'), id, buf);
    await col('files').doc(id).set({ chunks, size: buf.length, updatedAt: Date.now() });
    misses.delete(rel);
  })().catch((err) => console.warn(`☁️  Không lưu được ${rel} lên Firebase:`, explain(err))));
}

function removeFile(rel) {
  if (!firestore) return;
  track((async () => {
    const id = fileId(rel);
    const meta = await col('files').doc(id).get();
    if (!meta.exists) return;
    const batch = firestore.batch();
    batch.delete(col('files').doc(id));
    for (let i = 0; i < (meta.get('chunks') || 1); i++) batch.delete(col('files').doc(`${id}#${i}`));
    await batch.commit();
  })().catch((err) => console.warn(`☁️  Không xóa được ${rel} trên Firebase:`, explain(err))));
}

// Tải file về ổ đĩa tạm nếu chưa có. Trả về true nếu file có sẵn để phục vụ.
function fetchFile(rel) {
  if (!firestore) return Promise.resolve(false);
  const full = path.join(DATA_DIR, rel);
  if (fs.existsSync(full)) return Promise.resolve(true);
  const missAt = misses.get(rel);
  if (missAt && Date.now() - missAt < MISS_TTL) return Promise.resolve(false);
  if (fetching.has(rel)) return fetching.get(rel);
  const job = (async () => {
    const id = fileId(rel);
    const meta = await col('files').doc(id).get();
    if (!meta.exists) {
      misses.set(rel, Date.now());
      return false;
    }
    const buf = await readChunks(col('files'), id, meta.get('chunks') || 1);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
    return true;
  })().finally(() => fetching.delete(rel));
  fetching.set(rel, job);
  return job;
}

module.exports = { init, enabled, restoreAll, attach, backupNow, flush, saveFile, removeFile, fetchFile, explain };
