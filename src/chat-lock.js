'use strict';
// Khóa cuộc trò chuyện (2.9.0): mỗi người tự đặt mật khẩu riêng cho một cuộc trò chuyện (riêng hay nhóm) trên tài khoản của mình.
// Người khác trong cuộc trò chuyện không bị ảnh hưởng. Mật khẩu lưu dạng mã băm (scrypt, giống mật khẩu đăng nhập) ở members.lock_hash,
// nên đổi máy / dùng cả web lẫn app vẫn cùng một khóa. Web và app không hiện tin nhắn khi chưa mở khóa; thông báo đẩy của
// cuộc trò chuyện đã khóa không có nội dung (server.js: notifyMembers). Quên mật khẩu: bỏ khóa bằng mật khẩu đăng nhập.
const { get, all, run } = require('./db');
const auth = require('./auth');

const MIN_LEN = 4;
const MAX_LEN = 32;
const MAX_TRIES = 5; // sai 5 lần thì đợi 15 phút

class LockError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const validLock = (p) => typeof p === 'string' && [...p].length >= MIN_LEN && [...p].length <= MAX_LEN;

/** Những người đang khóa cuộc trò chuyện này (Set id) */
function lockedMembers(convId) {
  return new Set(all('SELECT user_id FROM members WHERE conversation_id = ? AND lock_hash IS NOT NULL', convId).map((r) => r.user_id));
}

function setupChatLock({ app, requireAuth, requireReady, emitConvChanged, getConv, limiter = new auth.Limiter(15 * 60 * 1000) }) {
  const authed = [requireAuth, requireReady];
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof LockError) return res.status(err.status).json({ error: err.message });
      console.error('[chat-lock]', err);
      res.status(500).json({ error: 'Có lỗi xảy ra, thử lại sau.' });
    }
  };

  function memberOf(req) {
    const convId = Number(req.params.id);
    const mem = Number.isInteger(convId) ? get('SELECT lock_hash FROM members WHERE conversation_id = ? AND user_id = ?', convId, req.user.id) : null;
    if (!mem) throw new LockError(404, 'Không tìm thấy cuộc trò chuyện.');
    return { convId, hash: mem.lock_hash };
  }

  /** Kiểm tra mật khẩu khóa; sai quá nhiều lần thì chặn một lúc */
  async function checkLock(req, convId, hash, password) {
    const key = `lock:${req.user.id}:${convId}`;
    if (limiter.count(key) >= MAX_TRIES) throw new LockError(429, 'Bạn nhập sai quá nhiều lần. Đợi 15 phút rồi thử lại, hoặc bỏ khóa bằng mật khẩu đăng nhập.');
    if (!(await auth.verifyPassword(String(password || ''), hash))) {
      limiter.hit(key);
      const left = MAX_TRIES - limiter.count(key);
      throw new LockError(400, left > 0 ? `Mật khẩu chưa đúng. Còn ${left} lần thử.` : 'Mật khẩu chưa đúng. Đợi 15 phút rồi thử lại.');
    }
    limiter.clear(key);
  }

  const changed = (req, convId) => {
    emitConvChanged(convId, [req.user.id]); // báo các máy khác của chính mình
    return getConv(convId, req.user.id);
  };

  // Đặt khóa / đổi mật khẩu: { password, current } (đang khóa thì phải nhập mật khẩu cũ)
  app.put('/api/conversations/:id/lock', ...authed, handle(async (req, res) => {
    const { convId, hash } = memberOf(req);
    const password = req.body?.password;
    if (!validLock(password)) throw new LockError(400, `Mật khẩu khóa cần từ ${MIN_LEN} đến ${MAX_LEN} ký tự.`);
    if (hash) await checkLock(req, convId, hash, req.body?.current);
    run('UPDATE members SET lock_hash = ? WHERE conversation_id = ? AND user_id = ?', await auth.hashPassword(password), convId, req.user.id);
    res.json({ conversation: changed(req, convId) });
  }));

  // Mở khóa để xem: { password }
  app.post('/api/conversations/:id/unlock', ...authed, handle(async (req, res) => {
    const { convId, hash } = memberOf(req);
    if (!hash) return res.json({ ok: true });
    await checkLock(req, convId, hash, req.body?.password);
    res.json({ ok: true });
  }));

  // Bỏ khóa: { password } (mật khẩu khóa) hoặc { accountPassword } (quên mật khẩu khóa: dùng mật khẩu đăng nhập)
  app.delete('/api/conversations/:id/lock', ...authed, handle(async (req, res) => {
    const { convId, hash } = memberOf(req);
    if (hash) {
      if (req.body?.accountPassword != null) {
        const key = `pw:${req.user.id}`;
        if (limiter.count(key) >= 10) throw new LockError(429, 'Bạn nhập sai quá nhiều lần. Đợi 15 phút rồi thử lại.');
        const user = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
        if (!(await auth.verifyPassword(String(req.body.accountPassword), user?.password_hash))) {
          limiter.hit(key);
          throw new LockError(400, 'Mật khẩu đăng nhập chưa đúng.');
        }
        limiter.clear(`lock:${req.user.id}:${convId}`);
      } else {
        await checkLock(req, convId, hash, req.body?.password);
      }
      run('UPDATE members SET lock_hash = NULL WHERE conversation_id = ? AND user_id = ?', convId, req.user.id);
    }
    res.json({ conversation: changed(req, convId) });
  }));
}

module.exports = { setupChatLock, lockedMembers, validLock, MIN_LEN, MAX_LEN, MAX_TRIES };
