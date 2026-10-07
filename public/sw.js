/* Service worker: lưu giao diện để mở nhanh + hiện thông báo đẩy kể cả khi đã đóng app */
const CACHE = 'think-v23';
// Ảnh trong tin nhắn và ảnh đại diện đã xem được giữ lại trên máy (tên file không bao giờ đổi),
// nên vẫn hiện được khi mất mạng hoặc khi máy chủ đã dọn ảnh cũ. Tắt "Lưu trên máy" thì không giữ nữa.
const MEDIA = 'think-media';
const MEDIA_OFF = '/__think/media-off';
const SHELL = [
  '/',
  '/app.css',
  '/app.js',
  '/localdb.js',
  '/chess-ui.js',
  '/chess-anim.js',
  '/social-ui.js',
  '/voice-core.js',
  '/voice-ui.js',
  '/calls-ui.js',
  '/stories-ui.js',
  '/games-ui.js',
  // Chuỗi hằng ngày của mọi game
  '/streaks.js',
  '/streaks.css',
  // Cờ caro: chơi với máy được cả khi mất mạng
  '/caro.css',
  '/caro-core.js',
  '/caro-ui.js',
  ...['place-x', 'place-o', 'turn', 'invalid', 'threat', 'start', 'win', 'lose', 'draw'].map((n) => `/caro/sounds/${n}.wav`),
  // Câu đố (Quiz hôm nay, Thử thách nhanh): luật + dữ liệu, giải được Xếp Khối / cờ caro khi mất mạng
  '/puzzles.css',
  '/puzzles-core.js',
  '/puzzles-ui.js',
  '/puzzles/chess.json',
  '/puzzles/blocks.json',
  '/puzzles/caro.json',
  // Nông trại: giao diện (hình và âm thanh được lưu dần khi dùng, xem OFFLINE_FIRST)
  '/farm.css',
  '/farm-ui.js',
  '/theme.js',
  '/vendor/chess.js',
  ...['K', 'Q', 'R', 'B', 'N', 'P'].flatMap((p) => [`/chess/pieces/w${p}.svg`, `/chess/pieces/b${p}.svg`]),
  ...['move', 'move-opp', 'capture', 'castle', 'check', 'promote', 'start', 'end', 'illegal', 'lowtime'].map((n) => `/chess/sounds/${n}.wav`),
  // Game Xếp Khối chơi được khi mất mạng: lưu sẵn cả trang riêng lẫn âm thanh
  '/blocks.html',
  '/blocks.css',
  '/blocks-core.js',
  '/blocks.js',
  '/blocks-page.js',
  ...['pick', 'place', 'invalid', 'clear1', 'clear2', 'clear3', 'combo1', 'combo2', 'combo3', 'combo4', 'combo5', 'combo6', 'combo7', 'combo8', 'allclear', 'best', 'gameover', 'start'].map((n) => `/blocks/sounds/${n}.wav`),
  '/manifest.webmanifest',
  '/socket.io/socket.io.min.js',
  '/icons/icon-192.png',
  '/icons/think-ai.png',
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
    await Promise.all(keys.filter((key) => key !== CACHE && key !== MEDIA).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Luôn lấy bản mới từ mạng trước, mất mạng mới dùng bản đã lưu
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  // Tin nhắn thoại: để trình duyệt tự tải từng đoạn (tua được), không cất vào bộ nhớ đệm
  if (url.pathname.startsWith('/uploads/audio/')) return;
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(mediaFirst(req));
    return;
  }
  if (url.pathname.startsWith('/socket.io/') && url.search) return;
  // Game Xếp Khối (và phông chữ): dùng bản trên máy ngay, cập nhật ngầm. Máy chủ đang ngủ
  // (giữ yêu cầu tới cả phút) hay mất mạng thì vẫn mở game tức thì.
  if (OFFLINE_FIRST.test(url.pathname)) {
    event.respondWith(cacheFirst(req, event));
    return;
  }
  event.respondWith(networkFirst(req));
});

const OFFLINE_FIRST = /^\/(blocks(\.html|\.css|\.js|-core\.js|-page\.js|\/sounds\/[\w-]+\.wav)|streaks\.js|fonts\/|farm\/(emoji|sounds)\/)/;

async function cacheFirst(req, event) {
  const cached = await caches.match(req, { ignoreSearch: true }).catch(() => null);
  const update = fetch(req)
    .then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(update); // lần sau có bản mới
    return cached;
  }
  return (await update) || Response.error();
}

// Ảnh: có sẵn trên máy thì dùng luôn, chưa có thì tải về rồi cất lại
async function mediaFirst(req) {
  let cache = null;
  try {
    cache = await caches.open(MEDIA);
    const hit = await cache.match(req.url);
    if (hit) return hit;
  } catch { /* bộ nhớ đệm lỗi thì tải thẳng */ }
  let res;
  try {
    res = await fetch(req);
  } catch {
    return Response.error();
  }
  if (cache && res.ok && res.type === 'basic') {
    const off = await cache.match(MEDIA_OFF).catch(() => null);
    if (!off) cache.put(req.url, res.clone()).catch(() => {});
  }
  return res;
}

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
  // Cuộc gọi đến: rung lâu, giữ thông báo đến khi bấm (cuộc gọi nhỡ dùng cùng tag nên thay thế thông báo này)
  if (data.type === 'call') {
    return self.registration.showNotification(data.title || 'Think', {
      body: data.body || 'Đang gọi cho bạn…',
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag || 'call',
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 200, 400, 200, 400],
      data: { url: data.url || '/' },
    });
  }
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
