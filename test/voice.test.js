'use strict';
// Kiểm thử tin nhắn thoại: dạng sóng, nhận dạng file ghi âm (public/voice-core.js), lưu và dọn file (chạy: npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-voice-'));
const V = require('../public/voice-core.js');

test('dạng sóng: 40 cột, mã hóa rồi giải mã giữ được độ to', () => {
  const levels = Array.from({ length: 123 }, (_, i) => (i % 10) / 9);
  const wave = V.encodeWave(levels);
  assert.equal(wave.length, V.BARS);
  assert.match(wave, /^[0-9a-v]+$/);
  assert.equal(V.encodeWave([]), '');
  assert.equal(V.encodeWave([1, 1]), 'v'.repeat(V.BARS)); // ít mẫu hơn số cột vẫn đủ cột
  assert.equal(V.encodeWave(Array(80).fill(0)), '0'.repeat(V.BARS));
  const bars = V.decodeWave('0'.repeat(20) + 'v'.repeat(20));
  assert.equal(bars.length, V.BARS);
  assert.equal(bars[0], 0.08); // im lặng vẫn có vạch nhỏ
  assert.equal(bars[39], 1);
  assert.equal(V.decodeWave('xyz!').length, V.BARS); // dữ liệu hỏng: sóng mặc định
  assert.equal(V.cleanWave('abc'), 'abc');
  assert.equal(V.cleanWave('ABC'), null);
  assert.equal(V.cleanWave('a'.repeat(65)), null);
  assert.deepEqual([V.levelFromDb(0), V.levelFromDb(-50), V.levelFromDb(-160), V.levelFromDb(-25)], [1, 0, 0, 0.5]);
  assert.deepEqual([V.clock(0), V.clock(7400), V.clock(65000)], ['0:00', '0:07', '1:05']);
});

test('nhận dạng file ghi âm theo nội dung, không theo tên', () => {
  const pad = (head) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
  assert.equal(V.sniffAudio(pad([0x1a, 0x45, 0xdf, 0xa3])), 'webm');
  assert.equal(V.sniffAudio(pad('OggS')), 'ogg');
  assert.equal(V.sniffAudio(pad('\0\0\0\x1cftypM4A ')), 'm4a');
  assert.equal(V.sniffAudio(pad('\0\0\0\x1cftyp3gp4')), '3gp');
  assert.equal(V.sniffAudio(pad('ID3')), 'mp3');
  assert.equal(V.sniffAudio(pad([0xff, 0xf1, 0x50])), 'aac');
  assert.equal(V.sniffAudio(pad([0xff, 0xfb, 0x90])), 'mp3');
  assert.equal(V.sniffAudio(pad([0x89, 0x50, 0x4e, 0x47])), null); // ảnh PNG
  assert.equal(V.sniffAudio(Buffer.from('short')), null);
  assert.equal(V.sniffAudio(new Uint8Array(pad('OggS'))), 'ogg'); // app/web dùng Uint8Array
});

test('dọn bộ nhớ: file tin nhắn thoại cũng được tính và dọn như ảnh', async () => {
  const { run, get } = require('../src/db');
  const storage = require('../src/storage');
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (950, 'vc', 'Voice', 'x', 0)");
  run("INSERT INTO conversations (id, type, name, created_at) VALUES (950, 'group', 'V', 0)");
  const dir = path.join(process.env.DATA_DIR, 'uploads', 'audio');
  fs.writeFileSync(path.join(dir, 'a1.webm'), Buffer.alloc(5000));
  storage.recordUpload('/uploads/audio/a1.webm', 'audio', 5000, 950);
  const id = Number(run("INSERT INTO messages (conversation_id, sender_id, kind, audio, audio_ms, audio_wave, created_at) VALUES (950, 950, 'voice', '/uploads/audio/a1.webm', 3000, 'abc', 1)").lastInsertRowid);
  run("INSERT INTO messages (conversation_id, sender_id, text, created_at) VALUES (950, 950, 'sau', 2)"); // tin cuối được giữ
  const u = storage.usage();
  assert.deepEqual(u.audio, { count: 1, bytes: 5000 });
  assert.equal(storage.cleanup('images', 0, { dryRun: true }).count, 1);
  storage.cleanup('images', 0);
  const row = get('SELECT audio, image_purged FROM messages WHERE id = ?', id);
  assert.deepEqual([row.audio, row.image_purged], [null, 1]);
  for (let i = 0; i < 50 && fs.existsSync(path.join(dir, 'a1.webm')); i++) await new Promise((r) => setTimeout(r, 20)); // xóa file chạy nền
  assert.equal(fs.existsSync(path.join(dir, 'a1.webm')), false);
  assert.equal(storage.usage().audio.count, 0);
});
