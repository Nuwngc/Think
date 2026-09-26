/* Service worker: lưu giao diện để mở nhanh + hiện thông báo đẩy kể cả khi đã đóng app */
const CACHE = 'think-v3';
const SHELL = [
  '/',
  '/app.css',
  '/app.js',
  '/manifest.webmanifest',
  '/socket.io/socket.io.min.js',
  '/icons/icon-192.png',
  '/icons/badge-72.png',
  '/icons/favicon-48.png',
  '/fonts/be-vietnam-pro-latin-400-normal.woff2',
  '/fonts/be-vietnam-pro-vietnamese-400-normal.woff2',
  '/fonts/be-vietnam-pro-latin-600-normal.woff2',
  '/fonts/be-vietnam-pro-vietnamese-600-normal.woff2',
  '/fonts/be-vietnam-pro-latin-800-normal.woff2',
  '/fonts/be-vietnam-pro-vietnamese-800-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Luôn lấy bản mới từ mạng trước, mất mạng mới dùng bản đã lưu
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  if (url.pathname.startsWith('/socket.io/') && url.search) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = (await caches.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? await caches.match('/') : undefined);
    return cached || Response.error();
  }
}

/* ---------------- Thông báo đẩy ---------------- */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Tin nhắn mới', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(handlePush(data));
});

async function handlePush(data) {
  // Số trên biểu tượng app (Android/iPhone/máy tính có hỗ trợ)
  if (typeof data.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    try {
      if (data.badge > 0) await self.navigator.setAppBadge(data.badge);
      else await self.navigator.clearAppBadge();
    } catch { /* bỏ qua */ }
  }
  if (data.type === 'message') return showMessage(data);
  // Thông báo khác: có người thả cảm xúc, được thêm vào nhóm, gửi thử...
  return self.registration.showNotification(data.title || 'Think', {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || data.type || 'general',
    data: { url: data.url || '/' },
  });
}

// Gom tin của cùng một cuộc trò chuyện vào một thông báo: "Minh (3 tin nhắn)"
async function showMessage(d) {
  const tag = `conv-${d.conversationId}`;
  let lines = [];
  let count = 0;
  try {
    const existing = await self.registration.getNotifications({ tag });
    const prev = existing[existing.length - 1];
    if (prev && prev.data && Array.isArray(prev.data.lines)) {
      lines = prev.data.lines;
      count = prev.data.count || lines.length;
    }
  } catch { /* trình duyệt không hỗ trợ đọc thông báo cũ */ }
  const line = d.isGroup ? `${d.senderName}: ${d.text}` : d.text;
  lines = lines.concat(line).slice(-5);
  count += 1;
  const title = d.isGroup ? d.convTitle : d.senderName;
  return self.registration.showNotification(count > 1 ? `${title} (${count} tin nhắn)` : title, {
    body: lines.join('\n'),
    tag,
    renotify: true,
    icon: d.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    timestamp: d.createdAt || Date.now(),
    vibrate: [80, 40, 80],
    data: { url: d.url || '/', conversationId: d.conversationId, lines, count },
  });
}

// Trang đang mở nhưng không được chú ý (cửa sổ khác đang ở trên): trang nhờ worker hiện thông báo
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'notify' && d.payload) event.waitUntil(showMessage(d.payload));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try { await client.focus(); } catch { /* bỏ qua */ }
      client.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// Trình duyệt tự làm mới đăng ký thông báo: báo lại cho máy chủ
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('/api/push/key');
    const { publicKey } = await res.json();
    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToBytes(publicKey),
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        oldEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : null,
      }),
    });
  })().catch(() => {}));
});

function base64ToBytes(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}
