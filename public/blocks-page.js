'use strict';
// Trang riêng /blocks.html: chơi Xếp Khối kể cả khi máy chủ đang ngủ hoặc mất mạng.
// Đang đăng nhập Think trên trình duyệt này thì điểm tự gửi lên bảng xếp hạng.
(() => {
  let me = null;
  const users = new Map();
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Không kết nối được máy chủ.');
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const game = window.ThinkBlocks.create({
    api,
    me: () => me,
    nameOf: (id) => (users.get(id) || {}).displayName || 'Người dùng',
    userOf: () => null,
    back: () => { location.href = '/'; },
    toast: () => {},
    standalone: true,
  });
  game.mount(document.getElementById('blocks-root'));

  let connecting = false;
  let retry = null;
  async function connect() {
    if (connecting || me) return;
    connecting = true;
    clearTimeout(retry);
    try {
      const r = await api('/api/me');
      me = r.user && !r.user.mustChangePassword ? r.user : null;
      if (!me) return;
      const list = await api('/api/users');
      for (const u of list.users || []) users.set(u.id, u);
      game.sync();
    } catch {
      retry = setTimeout(connect, 15000); // máy chủ đang ngủ / mất mạng: thử lại sau
    } finally {
      connecting = false;
    }
  }
  connect();
  window.addEventListener('online', connect); // có mạng lại: đăng nhập được thì gửi điểm ngay
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
