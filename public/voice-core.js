/* Tin nhắn thoại: phần dùng chung cho máy chủ, web và app (bản app: native/src/voice/core.ts, có kiểm thử so khớp).
   - Dạng sóng: 40 cột, mỗi cột một ký tự 0–9 a–v (0 = im lặng, v = to nhất), gửi kèm tin để vẽ ngay không cần tải file.
   - Ghi âm tối đa MAX_MS; ngắn hơn MIN_MS thì bỏ (bấm nhầm). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceCore = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const BARS = 40;
  const LEVELS = 32;
  const MAX_MS = 2 * 60 * 1000;
  const MIN_MS = 700;
  const DIGITS = '0123456789abcdefghijklmnopqrstuv';

  /** Gom các mức âm lượng (0–1, lấy mẫu đều trong lúc ghi) thành BARS cột, mã hóa thành chuỗi */
  function encodeWave(levels) {
    const list = Array.isArray(levels) ? levels.filter((v) => Number.isFinite(v)) : [];
    if (!list.length) return '';
    const out = [];
    for (let i = 0; i < BARS; i++) {
      const a = Math.floor((i * list.length) / BARS);
      const b = Math.max(a + 1, Math.floor(((i + 1) * list.length) / BARS));
      let peak = 0;
      for (let k = a; k < b && k < list.length; k++) peak = Math.max(peak, list[k]);
      out.push(DIGITS[Math.round(Math.min(1, Math.max(0, peak)) * (LEVELS - 1))]);
    }
    return out.join('');
  }

  /** Chuỗi dạng sóng → các cột 0–1 (luôn BARS cột; thiếu thì vẽ sóng nhẹ đều) */
  function decodeWave(wave) {
    const s = typeof wave === 'string' && /^[0-9a-v]{1,64}$/.test(wave) ? wave : '';
    if (!s) return Array.from({ length: BARS }, (_, i) => 0.25 + 0.15 * Math.abs(Math.sin(i * 0.9)));
    return Array.from({ length: BARS }, (_, i) => {
      const ch = s[Math.min(s.length - 1, Math.floor((i * s.length) / BARS))];
      return Math.max(0.08, DIGITS.indexOf(ch) / (LEVELS - 1));
    });
  }

  /** Mức âm lượng từ decibel (máy ghi của app: -160…0 dB) */
  const levelFromDb = (db) => (Number.isFinite(db) ? Math.min(1, Math.max(0, (db + 50) / 50)) : 0);

  /** 0:07, 1:05 */
  function clock(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Nhận dạng file ghi âm (máy chủ): WEBM / OGG (trình duyệt), M4A / MP4 / 3GP (điện thoại), AAC, MP3 */
  function sniffAudio(buf) {
    if (!buf || buf.length < 12) return null;
    const ascii = (a, b) => String.fromCharCode(...Array.from(buf.slice(a, b)));
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
    if (ascii(0, 4) === 'OggS') return 'ogg';
    if (ascii(4, 8) === 'ftyp') return ascii(8, 11) === '3gp' ? '3gp' : 'm4a';
    if (ascii(0, 3) === 'ID3') return 'mp3';
    if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'aac'; // ADTS (lớp 0)
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return 'mp3';
    return null;
  }

  /** Kiểm tra dạng sóng gửi lên (máy chủ) */
  const cleanWave = (wave) => (typeof wave === 'string' && /^[0-9a-v]{1,64}$/.test(wave) ? wave : null);

  return { BARS, MAX_MS, MIN_MS, encodeWave, decodeWave, levelFromDb, clock, cleanWave, sniffAudio };
});
