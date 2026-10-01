'use strict';
// Lưu tin nhắn trên máy người dùng (IndexedDB), mỗi tài khoản một kho riêng.
// Máy chủ có thể dọn tin và ảnh cũ khi sắp đầy; bản lưu ở đây vẫn giữ để xem lại,
// kể cả khi mất mạng hoặc máy chủ đang thức dậy. Ảnh được service worker giữ trong bộ nhớ đệm.
(() => {
  const VERSION = 1;
  const KEY_ENABLED = 'think:local';
  const KEY_IMAGES = 'think:local-images';
  let db = null;
  let dbName = null;

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* chế độ ẩn danh */ } },
  };

  const supported = () => typeof indexedDB !== 'undefined';
  const enabled = () => supported() && store.get(KEY_ENABLED) !== 'off';
  const autoImages = () => enabled() && store.get(KEY_IMAGES) !== 'off';

  const wrap = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const finish = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Giao dịch bị hủy'));
  });

  async function open(userId) {
    if (!enabled() || !userId) return null;
    const name = `think-u${userId}`;
    if (db && dbName === name) return db;
    close();
    try {
      db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, VERSION);
        request.onupgradeneeded = () => {
          const d = request.result;
          const messages = d.createObjectStore('messages', { keyPath: 'id' });
          messages.createIndex('byConv', ['conversationId', 'id']);
          d.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Kho dữ liệu đang bị khóa bởi tab khác'));
      });
      db.onversionchange = () => close();
      dbName = name;
    } catch (err) {
      console.warn('Không mở được bộ nhớ trên máy:', err);
      db = null;
      dbName = null;
    }
    return db;
  }

  function close() {
    if (db) db.close();
    db = null;
    dbName = null;
  }

  const ready = () => Boolean(db);

  // Chỉ lưu phần dữ liệu thật của tin nhắn, bỏ các trạng thái tạm trên màn hình
  function clean(m) {
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      kind: m.kind || 'text',
      text: m.text ?? null,
      image: m.image ?? null,
      imagePurged: Boolean(m.imagePurged),
      deleted: Boolean(m.deleted),
      createdAt: m.createdAt,
      replyTo: m.replyTo || null,
      reactions: m.reactions || [],
      // 2.1.0: đã sửa, chuyển tiếp, @nhắc tên, bình chọn
      editedAt: m.editedAt || null,
      forwarded: Boolean(m.forwarded),
      mentions: Array.isArray(m.mentions) && m.mentions.length ? m.mentions : undefined,
      poll: m.poll || undefined,
    };
  }

  // Gộp bản mới từ máy chủ vào bản đang có: ảnh và tin gốc đã bị dọn trên máy chủ thì giữ bản của máy
  function mergeMessage(prev, next) {
    if (!prev) return next;
    const out = { ...prev, ...next };
    if (!next.deleted) {
      if (!next.image && next.imagePurged && prev.image) out.image = prev.image;
      if (next.replyTo && next.replyTo.missing && prev.replyTo && !prev.replyTo.missing) out.replyTo = prev.replyTo;
    }
    return out;
  }

  async function putMessages(list) {
    const items = (list || []).filter((m) => m && m.id);
    if (!db || !items.length) return;
    const tx = db.transaction('messages', 'readwrite');
    const os = tx.objectStore('messages');
    for (const m of items) {
      const next = clean(m);
      const request = os.get(next.id);
      request.onsuccess = () => os.put(mergeMessage(request.result, next));
    }
    await finish(tx);
  }

  async function patchMessage(id, patch) {
    if (!db || !id) return;
    const tx = db.transaction('messages', 'readwrite');
    const os = tx.objectStore('messages');
    const request = os.get(id);
    request.onsuccess = () => {
      if (request.result) os.put({ ...request.result, ...patch });
    };
    await finish(tx);
  }

  async function getMessage(id) {
    if (!db || !id) return null;
    return (await wrap(db.transaction('messages').objectStore('messages').get(id))) || null;
  }

  // Lấy tối đa `limit` tin cũ hơn `beforeId` (không có thì lấy mới nhất), trả về theo thứ tự cũ → mới
  function range(convId, beforeId, limit) {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const upper = beforeId ? [convId, beforeId] : [convId, Number.MAX_SAFE_INTEGER];
      const keyRange = IDBKeyRange.bound([convId, 0], upper, false, Boolean(beforeId));
      const out = [];
      const request = db.transaction('messages').objectStore('messages').index('byConv').openCursor(keyRange, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || out.length >= limit) {
          resolve(out.reverse());
          return;
        }
        out.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
  const latest = (convId, limit = 50) => range(convId, 0, limit);
  const before = (convId, beforeId, limit = 40) => range(convId, beforeId, limit);

  async function deleteConversation(convId) {
    if (!db) return;
    const tx = db.transaction(['messages', 'meta'], 'readwrite');
    const index = tx.objectStore('messages').index('byConv');
    const request = index.openCursor(IDBKeyRange.bound([convId, 0], [convId, Number.MAX_SAFE_INTEGER]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.objectStore('meta').delete(`conv:${convId}`);
    await finish(tx);
  }

  async function getMeta(key) {
    if (!db) return null;
    const row = await wrap(db.transaction('meta').objectStore('meta').get(key));
    return row ? row.value : null;
  }
  async function setMeta(key, value) {
    if (!db) return;
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    await finish(tx);
  }

  async function count() {
    if (!db) return 0;
    return wrap(db.transaction('messages').objectStore('messages').count());
  }
  async function allMessages() {
    if (!db) return [];
    return wrap(db.transaction('messages').objectStore('messages').getAll());
  }

  // Xóa sạch kho của tài khoản này trên máy (tin nhắn + ảnh đã lưu)
  async function clear(userId) {
    close();
    if (supported() && userId) {
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(`think-u${userId}`);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      });
    }
    try {
      if ('caches' in window) await caches.delete('think-media');
    } catch { /* bỏ qua */ }
  }

  // Báo cho service worker có giữ ảnh trên máy hay không
  async function syncMediaFlag() {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open('think-media');
      if (enabled()) await cache.delete('/__think/media-off');
      else await cache.put('/__think/media-off', new Response('1'));
    } catch { /* bỏ qua */ }
  }

  async function setEnabled(on, userId) {
    store.set(KEY_ENABLED, on ? 'on' : 'off');
    if (!on) await clear(userId);
    await syncMediaFlag();
    if (on && userId) await open(userId);
  }
  const setAutoImages = (on) => store.set(KEY_IMAGES, on ? 'on' : 'off');

  async function estimate() {
    const out = { usage: null, persisted: null };
    try {
      if (navigator.storage && navigator.storage.estimate) out.usage = (await navigator.storage.estimate()).usage ?? null;
      if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    } catch { /* trình duyệt không hỗ trợ */ }
    return out;
  }

  // Xin trình duyệt đừng tự xóa dữ liệu này khi máy thiếu bộ nhớ
  async function persist() {
    try {
      if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
        return await navigator.storage.persist();
      }
    } catch { /* bỏ qua */ }
    return false;
  }

  window.LocalDB = {
    supported, enabled, autoImages, open, close, ready, mergeMessage,
    putMessages, patchMessage, getMessage, latest, before, deleteConversation,
    getMeta, setMeta, count, allMessages, clear, setEnabled, setAutoImages, syncMediaFlag, estimate, persist,
  };
})();
