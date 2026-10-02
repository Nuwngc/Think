'use strict';
(() => {
  /* =========================================================
     Tiện ích DOM
     ========================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Tạo phần tử an toàn (không dùng innerHTML để tránh chèn mã độc qua tin nhắn)
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value === true ? '' : String(value));
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* chế độ ẩn danh */ } },
  };

  // Báo lỗi JavaScript của trang cho admin (Quản trị → Báo lỗi app). Mỗi lần mở trang gửi tối đa 5 lỗi khác nhau.
  (() => {
    const seen = new Set();
    const IGNORE = /ResizeObserver loop|extension:\/\/|Script error\.?$|AbortError|NetworkError|Failed to fetch|Load failed/i;
    function report(kind, message, stack) {
      const msg = String(message || '').slice(0, 600);
      if (!msg || IGNORE.test(msg) || IGNORE.test(String(stack || '')) || seen.size >= 5 || seen.has(msg)) return;
      seen.add(msg);
      const ua = navigator.userAgent;
      const body = {
        errors: [{
          kind,
          fatal: false,
          message: msg,
          stack: String(stack || '').slice(0, 8000),
          platform: 'web',
          appVersion: document.documentElement.dataset.version || 'web',
          osVersion: (/Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+/.exec(ua) || [''])[0].replace(/_/g, '.'),
          device: ua.slice(0, 120),
          where: location.hash.slice(0, 60) || '/',
          at: Date.now(),
        }],
      };
      fetch('/api/app/errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', keepalive: true }).catch(() => {});
    }
    window.addEventListener('error', (e) => report('web', e.message || (e.error && e.error.message), e.error && e.error.stack));
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      report('promise', (r && r.message) || String(r), r && r.stack);
    });
  })();

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
  const isAndroid = () => /android/i.test(navigator.userAgent);

  // App Think cho Android mở web kèm ?app=android&v=<bản app>; bong bóng chat mở web kèm ?bubble=1
  const NATIVE = window.ThinkApp || null; // cầu nối tới app, chỉ có trong bong bóng chat
  const IN_BUBBLE = new URLSearchParams(location.search).get('bubble') === '1';
  // Bong bóng nổi của Android 8–10 (?overlay=1): vẫn cho quay lại danh sách để chuyển cuộc trò chuyện
  const IN_OVERLAY = IN_BUBBLE && new URLSearchParams(location.search).get('overlay') === '1';
  (() => {
    const q = new URLSearchParams(location.search);
    if (q.get('app') === 'android') store.set('android-app', q.get('v') || '1');
    if (q.has('app') || q.has('v')) {
      q.delete('app');
      q.delete('v');
      const rest = q.toString();
      history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
  })();
  if (IN_BUBBLE) document.documentElement.classList.add('bubble-mode');
  if (IN_OVERLAY) document.documentElement.classList.add('overlay-mode');
  const inAndroidApp = () => !IN_BUBBLE && Boolean(store.get('android-app')) && isStandalone();
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =========================================================
     Trạng thái
     ========================================================= */
  const state = {
    appName: 'Think',
    vapidKey: null,
    me: null,
    users: new Map(),
    convs: new Map(),
    msgs: new Map(), // convId -> { list, loaded, loading, hasMore, error }
    currentId: null,
    typing: new Map(), // convId -> Map(userId -> timer)
    drafts: new Map(),
    socket: null,
    everConnected: false,
    installEvent: null,
    justAdded: new Set(),
    stickBottom: true,
    pushOn: false,
    sound: store.get('sound') !== 'off',
    replying: new Map(), // convId -> tin nhắn đang được trả lời
    editing: new Map(), // convId -> tin nhắn của mình đang sửa
    pins: new Map(), // convId -> danh sách tin đã ghim [{ message, pinnedBy, pinnedAt }]
    mentionPicks: new Map(), // convId -> Map(tên hiển thị -> id người được @nhắc tên trong bản nháp)
    tab: 'chats', // tab đang mở ở thanh dưới: chats | me | admin
    adminSeg: 'accounts', // mục đang mở trong trang Quản trị
    offline: false, // đang xem dữ liệu lưu trên máy, chưa kết nối được máy chủ
  };

  /* =========================================================
     Gọi API
     ========================================================= */
  class ApiError extends Error {
    constructor(message, status, code, data) {
      super(message);
      this.status = status;
      this.code = code;
      this.data = data; // dữ liệu máy chủ gửi kèm lỗi (vd trạng thái ván cờ mới nhất)
    }
  }

  async function api(url, { method = 'GET', body, raw } = {}) {
    const init = { method, headers: {}, credentials: 'same-origin' };
    if (raw) {
      init.body = raw;
      init.headers['Content-Type'] = raw.type || 'application/octet-stream';
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch {
      throw new ApiError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.', 0);
    }
    let data = {};
    try { data = await res.json(); } catch { /* không phải JSON */ }
    if (!res.ok) {
      const err = new ApiError(data.error || `Có lỗi xảy ra (mã ${res.status}).`, res.status, data.code, data);
      if (res.status === 401 && state.me && url !== '/api/login') sessionEnded('Phiên đăng nhập đã hết. Hãy đăng nhập lại.');
      else if (err.code === 'must_change_password' && state.me) showForce();
      throw err;
    }
    return data;
  }

  /* =========================================================
     Thời gian & chữ
     ========================================================= */
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  function daysAgo(ts) {
    const a = new Date(ts); a.setHours(0, 0, 0, 0);
    const b = new Date(); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86400000);
  }
  const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  function shortTime(ts) {
    const days = daysAgo(ts);
    if (days <= 0) return hm(ts);
    if (days === 1) return 'Hôm qua';
    if (days < 7) return WEEKDAYS[new Date(ts).getDay()];
    const d = new Date(ts);
    const year = d.getFullYear() !== new Date().getFullYear() ? `/${String(d.getFullYear()).slice(2)}` : '';
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${year}`;
  }
  function dayLabel(ts) {
    const days = daysAgo(ts);
    if (days <= 0) return 'Hôm nay';
    if (days === 1) return 'Hôm qua';
    const s = new Date(ts).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function lastSeenText(u) {
    if (!u) return '';
    if (u.online) return 'Đang hoạt động';
    if (!u.lastSeen) return 'Chưa hoạt động';
    const mins = Math.floor((Date.now() - u.lastSeen) / 60000);
    if (mins < 1) return 'Vừa mới hoạt động';
    if (mins < 60) return `Hoạt động ${mins} phút trước`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hoạt động ${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `Hoạt động ${days} ngày trước`;
    return `Hoạt động ngày ${new Date(u.lastSeen).toLocaleDateString('vi-VN')}`;
  }
  // Bỏ dấu để tìm kiếm: gõ "minh" vẫn ra "Mính"
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();

  /* =========================================================
     Người dùng & ảnh đại diện
     ========================================================= */
  const userOf = (id) => state.users.get(id);
  const nameOf = (id) => userOf(id)?.displayName || 'Người dùng';
  const convTitle = (c) => (c.type === 'dm' ? nameOf(c.peerId) : c.name || 'Cả nhóm');
  // Bảng màu ảnh đại diện chữ cái, hợp với tông ngọc bích + nghệ
  const AVATAR_COLORS = ['#2F6F8F', '#8A4FA3', '#B4533C', '#3E7D4F', '#A0527A', '#5160C4', '#B86F1F', '#2B8585'];
  const colorOf = (id) => AVATAR_COLORS[Math.abs(Number(id) || 0) % AVATAR_COLORS.length];
  const initialOf = (name) => (Array.from(String(name || '?').trim())[0] || '?').toUpperCase();

  function fillAvatar(el, user, { group = false, team = null, dot = true } = {}) {
    el.replaceChildren();
    el.classList.toggle('is-group', group);
    el.classList.toggle('is-team', Boolean(team));
    el.classList.toggle('is-online', Boolean(!group && !team && dot && user && user.online && user.id !== state.me?.id));
    if (team) {
      el.style.setProperty('--av', colorOf(team.id + 3));
      el.append(initialOf(team.name));
    } else if (group) {
      el.style.removeProperty('--av');
      el.append(icon('group'));
    } else if (user?.avatar) {
      const img = h('img', { src: user.avatar, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
      img.addEventListener('error', () => {
        img.remove();
        el.style.setProperty('--av', colorOf(user.id));
        el.append(initialOf(user.displayName));
      }, { once: true });
      el.append(img);
    } else {
      el.style.setProperty('--av', colorOf(user?.id || 0));
      el.append(initialOf(user?.displayName));
    }
    return el;
  }
  const avatarEl = (user, cls = '', opts) => fillAvatar(h('span', { class: `avatar ${cls}`.trim() }), user, opts);
  // Ảnh đại diện cuộc trò chuyện: người (chat riêng), biểu tượng (phòng chung), chữ cái trong ô vuông bo góc (nhóm riêng)
  function fillConvAvatar(el, c, extra = {}) {
    if (c.type === 'dm') return fillAvatar(el, userOf(c.peerId), extra);
    if (c.type === 'group') return fillAvatar(el, null, { ...extra, team: c });
    return fillAvatar(el, null, { ...extra, group: true });
  }
  const convAvatarEl = (c, cls = '', extra) => fillConvAvatar(h('span', { class: `avatar ${cls}`.trim() }), c, extra);

  const REACTIONS = ['\u2764\uFE0F', '\u{1F606}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F44D}']; // ❤️ 😆 😮 😢 😡 👍
  const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  function listNames(ids) {
    const names = (ids || []).map((id) => (id === state.me?.id ? 'bạn' : nameOf(id)));
    return names.length <= 2 ? names.join(' và ') : `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;
  }
  // Tin hệ thống trong nhóm, lưu dạng JSON, hiển thị theo tên hiện tại của mọi người
  function systemText(m) {
    let d = {};
    try { d = JSON.parse(m.text || '{}'); } catch { /* bỏ qua */ }
    const actor = m.senderId === state.me?.id ? 'Bạn' : nameOf(m.senderId);
    switch (d.event) {
      case 'create': return `${actor} đã tạo nhóm`;
      case 'rename': return `${actor} đã đổi tên nhóm thành “${d.name}”`;
      case 'add': return `${actor} đã thêm ${listNames(d.targets)} vào nhóm`;
      case 'remove': return `${actor} đã xóa ${listNames(d.targets)} khỏi nhóm`;
      case 'leave': return `${actor} đã rời nhóm`;
      case 'pin': return `${actor} đã ghim một tin nhắn${d.text ? `: “${d.text}”` : d.image ? ' (ảnh)' : ''}`;
      case 'theme': return `${actor} đã đổi chủ đề thành ${d.name || 'mới'}`;
      case 'emoji': return `${actor} đã đổi biểu tượng cảm xúc nhanh thành ${d.emoji}`;
      default: return 'Cuộc trò chuyện vừa được cập nhật';
    }
  }

  /* =========================================================
     Màn hình, form, thông báo nhỏ
     ========================================================= */
  // Màn đăng nhập nền đen: đổi luôn màu thanh trạng thái / thanh địa chỉ cho liền mạch
  const themeMetas = $$('meta[name="theme-color"]');
  themeMetas.forEach((m) => { m.dataset.base = m.content; });
  function showScreen(id) {
    for (const el of $$('.screen')) el.hidden = el.id !== id;
    const auth = id === 'view-login' || id === 'view-force';
    document.documentElement.classList.toggle('auth-mode', auth);
    for (const m of themeMetas) m.content = auth ? '#000000' : m.dataset.base;
  }
  function setFormError(form, message) {
    const el = $('.form-error', form);
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }
  async function withBusy(button, task) {
    if (!button || button.disabled) return undefined;
    button.disabled = true;
    button.classList.add('busy');
    try {
      return await task();
    } finally {
      button.disabled = false;
      button.classList.remove('busy');
    }
  }
  function pushToast(el, ms) {
    const wrap = $('#toasts');
    wrap.append(el);
    while (wrap.children.length > 3) wrap.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 250);
    }, ms);
  }
  const toast = (text) => pushToast(h('div', { class: 'toast', role: 'status', text }), 3400);

  // Tab Trò chơi (public/games-ui.js): trang chọn game, Xếp Khối (public/blocks.js), Cờ vua (public/chess-ui.js)
  // và Cờ caro (public/caro-ui.js). Ván cờ / game mở ở cột phải (toàn màn hình trên điện thoại)
  let games = null;
  let caro = null;
  // Số trên tab Trò chơi: việc cần làm ở cờ vua + cờ caro (lời thách đấu gửi tới mình, ván tới lượt mình)
  function updateGamesBadge() {
    const badge = $('#chess-badge');
    if (!badge) return;
    const n = (chess ? chess.badge() : 0) + (caro ? caro.badge() : 0);
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : String(n);
    const tab = $('.tab[data-tab="games"]');
    if (tab) tab.setAttribute('aria-label', n ? `Trò chơi, ${n} việc cần làm` : 'Trò chơi');
  }
  const chess = window.ThinkChess
    ? window.ThinkChess.create({
        api, h, icon, avatarEl, userOf, nameOf, state, toast, pushToast, navigate, goBack, withBusy, shortTime, fold,
        share: (game) => social && social.shareGame(game),
        onChange: () => games && games.refresh(),
        updateBadge: updateGamesBadge,
      })
    : null;
  caro = window.ThinkCaro && window.CaroCore
    ? window.ThinkCaro.create({
        api, h, icon, avatarEl, userOf, nameOf, state, toast, pushToast, navigate, goBack, withBusy, shortTime, fold,
        onChange: () => games && games.refresh(),
        updateBadge: updateGamesBadge,
      })
    : null;
  // Chuỗi hằng ngày của mọi game (public/streaks.js, máy chủ src/streaks.js)
  const streaks = window.ThinkStreaks
    ? window.ThinkStreaks.create({ h, icon, api, state, toast, onChange: () => games && games.refresh() })
    : null;
  // Câu đố của Cờ vua, Xếp Khối, Cờ caro: Quiz hôm nay + Thử thách nhanh (public/puzzles-ui.js, máy chủ src/puzzles.js)
  const puzzles = window.ThinkPuzzles && window.PuzzlesCore
    ? window.ThinkPuzzles.create({ h, icon, api, state, toast, navigate, goBack, nameOf, userOf, avatarEl, chess, caro, onChange: () => games && games.refresh() })
    : null;
  games = window.ThinkGames
    ? window.ThinkGames.create({ h, icon, api, state, navigate, goBack, toast, chess, caro, puzzles, nameOf, userOf, avatarEl, withBusy })
    : null;

  // Trang cá nhân và bảng tin (public/social-ui.js)
  // Tin nhắn thoại: ghi âm và nghe (public/voice-ui.js, public/voice-core.js)
  const voice = window.ThinkVoice && window.VoiceCore ? window.ThinkVoice.create({ h, icon, toast }) : null;
  const voiceLabel = (m) => `🎤 Tin nhắn thoại${m.audio && m.audio.ms && window.VoiceCore ? ` (${window.VoiceCore.clock(m.audio.ms)})` : ''}`;

  const social = window.ThinkSocial
    ? window.ThinkSocial.create({
        api, h, icon, avatarEl, userOf, nameOf, state, toast, navigate, goBack, withBusy, shortTime, fold,
        prepareImage: (file, opts) => prepareImage(file, opts),
        openLightbox: (src) => openLightbox(src),
        conversations: () => [...state.convs.values()]
          .filter((c) => c.type !== 'dm' || c.lastMessage)
          .sort((a, b) => (b.lastMessage?.createdAt || b.createdAt || 0) - (a.lastMessage?.createdAt || a.createdAt || 0))
          .map((c) => ({ id: c.id, title: convTitle(c), avatar: convAvatarEl(c, 'avatar-sm') })),
        sendText: (convId, text) => sendTextTo(convId, text),
        openDm: (userId) => openDmWith(userId),
        challenge: (userId) => chess && chess.openChallenge(userId),
        miniBoard: (fen, orientation) => (window.ThinkChess ? window.ThinkChess.miniBoard(fen, orientation) : null),
        chessText: window.ThinkChess ? window.ThinkChess.text : null,
      })
    : null;

  function showLogin(message) {
    teardown();
    showScreen('view-login');
    const form = $('#login-form');
    setFormError(form, message || '');
    if (!isTouch()) setTimeout(() => form.username.focus(), 60);
  }
  function showForce() {
    showScreen('view-force');
    const form = $('#force-form');
    form.reset();
    form.username.value = state.me?.username || '';
    setFormError(form, '');
  }
  function sessionEnded(reason) {
    if (!state.me) return;
    forgetMe();
    showLogin(reason);
    history.replaceState(null, '', '#/');
  }
  function teardown() {
    if (state.socket) {
      state.socket.removeAllListeners();
      state.socket.disconnect();
      state.socket = null;
    }
    for (const map of state.typing.values()) for (const timer of map.values()) clearTimeout(timer);
    state.me = null;
    state.users.clear();
    state.convs.clear();
    state.msgs.clear();
    state.typing.clear();
    state.drafts.clear();
    state.replying.clear();
    state.editing.clear();
    state.pins.clear();
    state.mentionPicks.clear();
    state.currentId = null;
    state.everConnected = false;
    if (chess) chess.reset();
    if (caro) caro.reset();
    if (games) games.reset();
    if (streaks) streaks.reset();
    if (puzzles) puzzles.reset();
    if (social) social.reset();
    $('#conv-list').replaceChildren();
    $('#messages').replaceChildren();
    $('#banner').replaceChildren();
    $('#conn-status').hidden = true;
    document.body.classList.remove('in-chat');
    closeSheetNow();
    state.offline = false;
    showTab('chats');
    if (window.LocalDB) LocalDB.close();
    updateBadge();
  }

  /* =========================================================
     Điều hướng (#/c/12, #/settings, #/new, #/admin)
     ========================================================= */
  // depth = số bước đã đi trong app, để nút Quay lại không thoát app khi mở từ thông báo
  const navDepth = () => (history.state && history.state.depth) || 0;
  function navigate(hash, { replace = false } = {}) {
    if ((location.hash || '#/') !== hash) {
      if (replace) history.replaceState({ depth: navDepth() }, '', hash);
      else history.pushState({ depth: navDepth() + 1 }, '', hash);
    }
    route();
  }
  function goBack() {
    if (navDepth() > 0) history.back();
    else navigate('#/', { replace: true });
  }
  function route() {
    // Nút Back của Android khi đang xem ảnh: chỉ đóng ảnh
    if (!(history.state && history.state.overlay === 'lightbox')) hideLightbox();
    closeMenu();
    if (!state.me || $('#view-main').hidden) return;
    const hash = location.hash || '#/';
    const chessGame = /^#\/chess\/g\/(\d+)$/.exec(hash);
    // Cờ caro: #/caro (trang caro), #/caro/bot (ván với máy), #/caro/g/12 (ván / lời thách đấu)
    const caroPage = /^#\/caro(?:\/(bot)|\/g\/(\d+))?$/.exec(hash);
    // Trang cá nhân của một người (#/u/5) mở ở cột phải; bài đăng (#/p/9, từ thông báo) mở bình luận
    const userPage = /^#\/u\/(\d+)$/.exec(hash);
    const postPage = /^#\/p\/(\d+)$/.exec(hash);
    // Nông trại: #/farm (vườn của mình), #/farm/u/5 (ghé vườn một người)
    const farmPage = /^#\/farm(?:\/u\/(\d+))?$/.exec(hash);
    // Câu đố: #/quiz/chess (quiz hôm nay), #/levels/chess (bản đồ màn), #/levels/chess/12 (màn 12)
    const quizPage = /^#\/quiz\/(chess|blocks|caro)$/.exec(hash);
    const levelsPage = /^#\/levels\/(chess|blocks|caro)(?:\/(\d+))?$/.exec(hash);
    const puzzleTarget = quizPage ? { kind: 'quiz', game: quizPage[1] }
      : levelsPage ? (levelsPage[2] ? { kind: 'level', game: levelsPage[1], level: Number(levelsPage[2]) } : { kind: 'map', game: levelsPage[1] })
        : null;
    const gamesView = hash === '#/chess' || chessGame ? 'chess' : caroPage ? 'caro' : hash === '#/blocks' ? 'blocks' : farmPage ? 'farm' : puzzleTarget ? 'puzzle' : hash === '#/games' ? 'hub' : null;
    const tab = hash === '#/me' || hash === '#/settings' || postPage ? 'me'
      : hash === '#/admin' ? 'admin'
        : gamesView ? 'games'
          : userPage ? (state.tab || 'chats')
            : 'chats';
    if (tab === 'games' && (!games || (gamesView === 'chess' && !chess) || (gamesView === 'caro' && !caro) || (gamesView === 'puzzle' && !puzzles))) {
      navigate('#/', { replace: true });
      return;
    }
    if (tab === 'admin' && state.me.role !== 'admin') {
      navigate('#/', { replace: true });
      return;
    }
    // Trong bong bóng chỉ nhắn tin; trang Cá nhân / Quản trị mở bằng app đầy đủ
    if (IN_BUBBLE && tab !== 'chats') {
      if (NATIVE && NATIVE.openApp) NATIVE.openApp(hash);
      navigate('#/', { replace: true });
      return;
    }
    const sheet = { '#/new': 'new', '#/new-group': 'new-group', '#/group': 'group', '#/conv': 'conv', '#/forward': 'forward', '#/poll': 'poll', '#/pins': 'pins', '#/media': 'media' }[hash] || null;
    // Các bảng của một cuộc trò chuyện cần đang mở cuộc trò chuyện đó
    if (['conv', 'forward', 'poll', 'pins', 'media'].includes(sheet) && (state.currentId == null || (sheet === 'forward' && !chatPlus.forward))) {
      navigate(state.currentId != null ? `#/c/${state.currentId}` : '#/', { replace: true });
      return;
    }
    if (sheet === 'group' && state.convs.get(state.currentId)?.type !== 'group') {
      navigate(state.currentId != null ? `#/c/${state.currentId}` : '#/', { replace: true });
      return;
    }
    const match = /^#\/c\/(\d+)$/.exec(hash);
    if (match) openConversation(Number(match[1]));
    else if (!sheet) closeConversation();
    showTab(tab);
    showMeView(hash === '#/settings' ? 'settings' : 'profile');
    if (chess) chess.route(tab === 'games' && gamesView === 'chess', chessGame ? Number(chessGame[1]) : null);
    if (games) games.route(tab === 'games' ? gamesView : null, farmPage && farmPage[1] ? Number(farmPage[1]) : null);
    if (social) {
      social.route(userPage ? Number(userPage[1]) : null);
      if (postPage) {
        // Bài từ thông báo (#/p/9): đổi địa chỉ về #/me rồi mở bình luận, để lần route sau không tự mở lại
        history.replaceState(history.state, '', '#/me');
        social.openPost(Number(postPage[1]));
      }
    }
    // Cờ caro chạy sau cùng: mở / đóng cột phải của caro sau khi các phần khác đã ẩn hiện xong
    if (caro) caro.route(tab === 'games' && gamesView === 'caro', !caroPage ? null : caroPage[1] ? 'bot' : caroPage[2] ? Number(caroPage[2]) : null);
    // Câu đố mở sau cùng (cột phải): các phần khác đã đóng cột của mình xong
    if (puzzles) puzzles.route(tab === 'games' && gamesView === 'puzzle' ? puzzleTarget : null);
    showSheet(sheet);
    if (sheet === 'conv') renderConvSheet();
    if (sheet === 'forward') renderForward();
    if (sheet === 'poll') renderPollForm();
    if (sheet === 'pins') renderPinsSheet();
    if (sheet === 'media') renderMedia(true);
  }

  // Tab Cá nhân có hai phần: trang cá nhân (mặc định) và Cài đặt (#/settings)
  function showMeView(view) {
    const settings = view === 'settings';
    const was = !$('#me-settings').hidden;
    $('#me-profile').hidden = settings;
    $('#me-settings').hidden = !settings;
    if (settings && !was && state.me) renderSettings();
    if (!settings && state.tab === 'me' && social) social.renderMe();
  }
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);

  /* ----- Thanh điều hướng dưới: Tin nhắn / Trò chơi / Cá nhân / Quản trị ----- */
  // Phần cuộn đang hiện của một tab (tab Trò chơi có hai phần: trang chọn game và Cờ vua)
  function visibleBody(tab) {
    return [...$$(`#page-${tab} .page-body`)].find((el) => !el.closest('[hidden]')) || null;
  }
  function showTab(tab) {
    const changed = state.tab !== tab;
    state.tab = tab;
    for (const page of $$('.tab-page')) page.hidden = page.id !== `page-${tab}`;
    for (const btn of $$('.tab')) {
      if (btn.dataset.tab === tab) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
    $('#chat-empty').classList.toggle('is-quiet', tab !== 'chats');
    if (!changed || !state.me) return;
    if (tab === 'me' && !$('#me-settings').hidden) renderSettings();
    if (tab === 'admin') renderAdmin();
    const body = visibleBody(tab);
    if (body) body.scrollTop = 0;
  }

  // Từ Tin nhắn sang tab khác thì thêm một bước lịch sử, để nút Back quay về Tin nhắn thay vì thoát app
  function switchTab(tab) {
    if (tab === state.tab) {
      const scroller = tab === 'chats' ? $('#conv-list') : visibleBody(tab);
      if (scroller) scroller.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    if (tab === 'chats') {
      if (history.state && history.state.tabPush) history.back();
      else navigate('#/', { replace: true });
      return;
    }
    const hash = `#/${tab}`;
    if (state.tab === 'chats') history.pushState({ depth: navDepth() + 1, tabPush: true }, '', hash);
    else history.replaceState({ ...(history.state || {}) }, '', hash);
    route();
  }
  $('.tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });

  // Điện thoại: đang gõ trong trang Cá nhân / Quản trị thì ẩn thanh dưới cho đỡ chật
  const TYPING_FIELDS = '.sidebar input:not([type=checkbox]):not([type=file]), .sidebar textarea, .sidebar select';
  document.addEventListener('focusin', (e) => {
    if (isTouch() && e.target.matches && e.target.matches(TYPING_FIELDS)) document.body.classList.add('typing');
  });
  document.addEventListener('focusout', () => document.body.classList.remove('typing'));

  let currentSheet = null;
  let sheetTimer = null;
  let sheetReturnFocus = null;
  function showSheet(name) {
    if (name === currentSheet) return;
    const layer = $('#sheet-layer');
    currentSheet = name;
    clearTimeout(sheetTimer);
    if (!name) {
      layer.classList.remove('open');
      sheetTimer = setTimeout(() => {
        layer.hidden = true;
        $$('.sheet', layer).forEach((s) => { s.hidden = true; });
      }, 220);
      if (!isTouch() && sheetReturnFocus && document.contains(sheetReturnFocus)) sheetReturnFocus.focus({ preventScroll: true });
      return;
    }
    sheetReturnFocus = document.activeElement;
    for (const s of $$('.sheet', layer)) s.hidden = s.id !== `sheet-${name}`;
    layer.hidden = false;
    void layer.offsetWidth; // chạy lại hiệu ứng trượt
    layer.classList.add('open');
    if (name === 'new') renderPeople();
    if (name === 'new-group') renderNewGroup(true);
    if (name === 'group') {
      groupAdd.open = false;
      groupAdd.selected.clear();
      $('#group-add-search').value = '';
      renderGroupInfo();
    }
    const sheet = $(`#sheet-${name}`);
    $('.sheet-body', sheet).scrollTop = 0;
    sheet.focus({ preventScroll: true });
  }
  function closeSheetNow() {
    currentSheet = null;
    clearTimeout(sheetTimer);
    const layer = $('#sheet-layer');
    layer.classList.remove('open');
    layer.hidden = true;
    $$('.sheet', layer).forEach((s) => { s.hidden = true; });
  }

  /* =========================================================
     Danh sách cuộc trò chuyện
     ========================================================= */
  function messageSummary(m) {
    if (m.kind === 'system') return systemText(m);
    if (m.deleted) return 'Tin nhắn đã được thu hồi';
    if (m.kind === 'poll') return `📊 ${oneLine(m.text)}`;
    if (m.kind === 'voice') return voiceLabel(m);
    const hasImage = Boolean(m.image || m.localUrl);
    if (hasImage && !m.text) return 'Đã gửi một ảnh';
    const shared = !hasImage && m.text ? chessShareOf(m.text) : null;
    if (shared) return `♟ ${shared.title}`;
    return `${hasImage ? '📷 ' : ''}${String(m.text || '').replace(/\s+/g, ' ')}`;
  }
  function previewText(m, c) {
    if (m.kind === 'system') return systemText(m);
    const who = m.senderId === state.me.id ? 'Bạn' : c.type !== 'dm' ? nameOf(m.senderId) : '';
    return who ? `${who}: ${messageSummary(m)}` : messageSummary(m);
  }
  const lastActivity = (c) => c.lastMessage?.createdAt || c.createdAt || 0;

  function renderConvList() {
    if (!state.me) return;
    const ul = $('#conv-list');
    const q = fold($('#conv-search').value);
    const list = [...state.convs.values()]
      .filter((c) => c.type !== 'dm' || c.lastMessage || c.id === state.currentId)
      .filter((c) => !q || fold(convTitle(c)).includes(q))
      .sort((a, b) => (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0) || (b.pinnedAt || 0) - (a.pinnedAt || 0) || lastActivity(b) - lastActivity(a));
    ul.replaceChildren(...list.map(convItem));
    if (!list.length) {
      ul.append(h('li', { class: 'conv-empty', text: q ? 'Không có cuộc trò chuyện nào khớp.' : 'Chưa có cuộc trò chuyện nào.' }));
    }
    saveSnapshot();
  }

  function convItem(c) {
    const isDm = c.type === 'dm';
    const lm = c.lastMessage;
    const typers = [...(state.typing.get(c.id)?.keys() || [])];
    const unread = c.unread || 0;
    const preview = typers.length
      ? h('span', { class: 'conv-preview is-typing', text: isDm ? 'Đang nhập…' : `${nameOf(typers[0])} đang nhập…` })
      : h('span', { class: 'conv-preview', text: lm ? previewText(lm, c) : isDm ? 'Chưa có tin nhắn' : 'Nơi cả nhóm cùng nói chuyện' });
    const muted = isMuted(c);
    return h('li', { class: `conv${unread ? ' has-unread' : ''}${muted ? ' is-muted' : ''}${c.id === state.currentId ? ' is-active' : ''}`, dataset: { conv: c.id } },
      h('a', {
        class: 'conv-link',
        href: `#/c/${c.id}`,
        onclick: (e) => {
          e.preventDefault();
          navigate(`#/c/${c.id}`, { replace: state.currentId != null });
        },
      },
      convAvatarEl(c),
      h('span', { class: 'conv-main' },
        h('span', { class: 'conv-row' },
          h('span', { class: 'conv-name', text: convTitle(c) }),
          muted ? h('span', { class: 'conv-flag', title: 'Đã tắt thông báo', 'aria-label': 'Đã tắt thông báo' }, icon('bell-off')) : null,
          c.pinnedAt ? h('span', { class: 'conv-flag', title: 'Đã ghim', 'aria-label': 'Đã ghim' }, icon('pin')) : null,
          h('time', { class: 'conv-time', text: lm ? shortTime(lm.createdAt) : '' })),
        h('span', { class: 'conv-row' },
          preview,
          unread ? h('span', { class: 'badge', text: unread > 99 ? '99+' : String(unread), 'aria-label': `${unread} tin chưa đọc` }) : null))));
  }
  $('#conv-search').addEventListener('input', renderConvList);

  /* =========================================================
     Khung chat
     ========================================================= */
  const messagesEl = $('#messages');
  const input = $('#composer-input');

  function box(id) {
    let b = state.msgs.get(id);
    if (!b) state.msgs.set(id, (b = { list: [], loaded: false, loading: false, hasMore: false, error: null }));
    return b;
  }

  function renderChatHeader() {
    const c = state.convs.get(state.currentId);
    if (!c) return;
    const isDm = c.type === 'dm';
    const peer = isDm ? userOf(c.peerId) : null;
    fillConvAvatar($('#chat-avatar'), c);
    $('#chat-name').textContent = convTitle(c);
    $('#group-info-btn').hidden = IN_BUBBLE;
    applyTheme(c);
    // Chat riêng: nút thách đấu cờ vua
    const chessBtn = $('#chess-dm-btn');
    chessBtn.hidden = !chess || !isDm || !peer || peer.disabled || IN_BUBBLE;
    chessBtn.setAttribute('aria-label', `Thách ${peer?.displayName || 'người này'} một ván cờ`);
    $('.chat-title').classList.toggle('is-link', c.type === 'group');
    const status = $('#chat-status');
    if (state.offline) {
      // Mở app khi chưa kết nối được máy chủ: nói rõ đang xem bản lưu trên máy
      status.textContent = 'Chưa kết nối máy chủ, đang xem bản lưu trên máy';
      status.classList.remove('is-online');
      return;
    }
    if (isDm) {
      status.textContent = peer?.disabled ? 'Tài khoản này đã bị khóa' : lastSeenText(peer);
      status.classList.toggle('is-online', Boolean(peer?.online));
    } else {
      const ids = c.type === 'group' ? c.memberIds || [] : [...state.users.values()].filter((u) => !u.disabled).map((u) => u.id);
      const active = ids.filter((uid) => uid !== state.me.id && userOf(uid)?.online).length;
      status.textContent = `${ids.length} thành viên${active ? `, ${active} người đang hoạt động` : ''}`;
      status.classList.remove('is-online');
    }
  }

  // Giữ lại thông tin "ai đã xem" khi cập nhật cuộc trò chuyện từ máy chủ
  function keepConv(conversation) {
    const prev = state.convs.get(conversation.id);
    if (prev?.reads) conversation.reads = prev.reads;
    state.convs.set(conversation.id, conversation);
    return conversation;
  }
  async function fetchConv(id) {
    const { conversation } = await api(`/api/conversations/${id}`);
    return keepConv(conversation);
  }

  async function openConversation(id) {
    if (!state.convs.has(id)) {
      try {
        await fetchConv(id);
      } catch {
        toast('Không mở được cuộc trò chuyện này.');
        navigate('#/', { replace: true });
        return;
      }
      if ((location.hash || '#/') !== `#/c/${id}`) return; // người dùng đã chuyển đi chỗ khác
    }
    const changed = state.currentId !== id;
    if (changed && voice) {
      voice.cancel(); // đang ghi âm dở cho cuộc trò chuyện khác: bỏ
      voice.stop();
    }
    state.currentId = id;
    document.body.classList.add('in-chat');
    $('#chat-empty').hidden = true;
    $('#chat-pane').hidden = false;
    renderChatHeader();
    renderConvList();
    if (changed) {
      input.value = state.drafts.get(id) || '';
      syncComposer();
      renderTyping();
      renderReplyBar();
      closeChatSearch();
      hideMentions();
      renderPinBar();
      loadPins(id);
      $('#jump-btn').hidden = true;
      clearNotifications(id);
    }
    const b = box(id);
    if (!b.loaded && LocalDB.ready() && !b.localTried) {
      // Hiện ngay tin nhắn đã lưu trên máy (không phải chờ máy chủ)
      b.localTried = true;
      let cached = [];
      try {
        cached = await LocalDB.latest(id, 50);
      } catch { /* bỏ qua */ }
      if (state.currentId !== id) return;
      if (cached.length && !b.loaded) {
        merge(b, cached);
        b.loaded = true;
        b.hasMore = true;
        renderMessages({ toBottom: true });
      }
    }
    if (!b.loaded) {
      renderMessages({ toBottom: true });
      await loadMessages(id, { toBottom: true });
    } else if (changed) {
      renderMessages({ toBottom: true });
    }
    if (state.currentId !== id) return;
    if (isNearBottom()) markRead(id);
    reportVisibility();
    if (changed && !isTouch()) input.focus({ preventScroll: true });
    syncConv(id).catch(() => {}); // lấy tin mới và các thay đổi từ máy chủ
  }

  function closeConversation() {
    if (state.currentId == null) return;
    if (voice) {
      voice.cancel();
      voice.stop();
    }
    state.currentId = null;
    closeChatSearch();
    hideMentions();
    document.body.classList.remove('in-chat');
    $('#chat-pane').hidden = true;
    $('#chat-empty').hidden = false;
    renderTyping();
    renderConvList();
  }

  async function loadMessages(id, { older = false, toBottom = false } = {}) {
    const b = box(id);
    if (b.loading) return;
    b.loading = true;
    if (older && state.currentId === id) {
      const indicator = $('.msg-state', messagesEl);
      if (indicator) indicator.textContent = 'Đang tải tin cũ hơn…';
    }
    try {
      const firstId = b.list.find((m) => m.id)?.id;
      let from = older ? firstId : 0;
      let local = [];
      if (older && firstId && LocalDB.ready()) {
        try {
          local = await LocalDB.before(id, firstId, 40);
        } catch { /* bỏ qua */ }
        if (local.length) {
          merge(b, local);
          from = local[0].id;
        }
      }
      if (!older || local.length < 40) {
        if (older && b.olderFailedAt && Date.now() - b.olderFailedAt < 10000) throw new Error('offline');
        try {
          const data = await api(`/api/conversations/${id}/messages?limit=40${from ? `&before=${from}` : ''}`);
          merge(b, data.messages); // gộp, không bỏ tin chỉ còn trên máy (máy chủ có thể đã dọn)
          saveLocal(data.messages);
          if (!older) markSynced(id, data);
          b.hasMore = data.hasMore;
          applyReads(id, data.reads);
        } catch (err) {
          if (older) b.olderFailedAt = Date.now();
          if (!older || !local.length) throw err;
        }
      }
      b.loaded = true;
      b.error = null;
    } catch (err) {
      if (!older) b.error = err.message;
    } finally {
      b.loading = false;
    }
    if (state.currentId === id) renderMessages(older ? { preserve: true } : { toBottom });
  }

  function merge(b, incoming) {
    const byId = new Map();
    for (const m of b.list) if (m.id) byId.set(m.id, m);
    for (const m of incoming) byId.set(m.id, LocalDB.mergeMessage(byId.get(m.id), m));
    const pending = b.list.filter((m) => !m.id);
    b.list = [...byId.values()].sort((x, y) => x.id - y.id).concat(pending);
  }

  function applyReads(convId, reads) {
    const c = state.convs.get(convId);
    if (!c || !Array.isArray(reads)) return;
    c.reads = new Map(reads.map((r) => [r.userId, r.lastReadId]));
    for (const r of reads) {
      if (c.type === 'dm' && r.userId === c.peerId) c.peerLastReadId = Math.max(c.peerLastReadId || 0, r.lastReadId);
    }
  }

  const isNearBottom = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 90;
  const GROUP_GAP = 5 * 60 * 1000;

  function renderMessages({ toBottom = false, preserve = false } = {}) {
    const id = state.currentId;
    const c = state.convs.get(id);
    if (id == null || !c) return;
    const b = state.msgs.get(id);
    const wasNear = isNearBottom();
    const prevHeight = messagesEl.scrollHeight;
    const prevTop = messagesEl.scrollTop;
    const frag = document.createDocumentFragment();

    if (!b || !b.loaded) {
      frag.append(b?.error
        ? h('p', { class: 'msg-state' },
            h('button', {
              class: 'btn btn-sm', type: 'button', text: 'Không tải được tin nhắn. Thử lại',
              onclick: () => { b.error = null; renderMessages(); loadMessages(id, { toBottom: true }); },
            }))
        : h('p', { class: 'msg-state', text: 'Đang tải tin nhắn…' }));
    } else {
      frag.append(b.hasMore ? h('p', { class: 'msg-state', text: b.loading ? 'Đang tải tin cũ hơn…' : '' }) : introEl(c));
      let lastDay = '';
      b.list.forEach((m, i) => {
        const prev = b.list[i - 1];
        const next = b.list[i + 1];
        const day = dayKey(m.createdAt);
        if (day !== lastDay) {
          frag.append(h('div', { class: 'day-sep' }, h('span', { text: dayLabel(m.createdAt) })));
          lastDay = day;
        }
        if (m.kind === 'system') {
          frag.append(h('div', { class: 'sys-msg' }, h('span', { text: systemText(m) })));
          return;
        }
        const joinPrev = Boolean(prev && prev.kind !== 'system' && prev.senderId === m.senderId && dayKey(prev.createdAt) === day && m.createdAt - prev.createdAt < GROUP_GAP);
        const joinNext = Boolean(next && next.kind !== 'system' && next.senderId === m.senderId && dayKey(next.createdAt) === day && next.createdAt - m.createdAt < GROUP_GAP);
        frag.append(messageRow(m, c, !joinPrev, !joinNext));
      });
      // "Đã xem" dưới tin cuối của mình (chat riêng)
      const last = b.list[b.list.length - 1];
      if (c.type === 'dm' && last && last.id && last.senderId === state.me.id && !last.deleted) {
        const seen = (c.peerLastReadId || 0) >= last.id;
        frag.append(h('div', { class: 'seen' }, seen
          ? [avatarEl(userOf(c.peerId), 'avatar-xs', { dot: false }), h('span', { text: 'Đã xem' })]
          : h('span', { text: 'Đã gửi' })));
      } else if (c.type !== 'dm' && c.reads && last && last.id && last.kind !== 'system' && !last.deleted) {
        // Nhóm: ảnh nhỏ của những người đã xem tin cuối
        const readers = [...c.reads]
          .filter(([uid, rid]) => uid !== state.me.id && uid !== last.senderId && rid >= last.id)
          .map(([uid]) => uid);
        if (readers.length) {
          const shown = readers.slice(0, 5);
          frag.append(h('div', { class: 'seen readers', title: `Đã xem: ${readers.map(nameOf).join(', ')}` },
            shown.map((uid) => avatarEl(userOf(uid), 'avatar-xs', { dot: false })),
            readers.length > shown.length ? h('span', { text: `+${readers.length - shown.length}` }) : null));
        }
      }
    }
    messagesEl.replaceChildren(frag);
    state.justAdded.clear();
    if (preserve) messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight + prevTop;
    else if (toBottom || wasNear) messagesEl.scrollTop = messagesEl.scrollHeight;
    else messagesEl.scrollTop = prevTop;
    state.stickBottom = isNearBottom();
  }

  function introEl(c) {
    const peer = c.type === 'dm' ? userOf(c.peerId) : null;
    let text = 'Phòng chung của cả nhóm. Tin nhắn ở đây mọi thành viên đều đọc được.';
    if (c.type === 'dm') text = `Đây là đầu cuộc trò chuyện riêng giữa bạn và ${peer?.displayName || 'người này'}.`;
    if (c.type === 'group') {
      const owner = c.createdBy === state.me.id ? 'bạn' : nameOf(c.createdBy);
      text = `Nhóm riêng do ${owner} làm trưởng nhóm. Chỉ thành viên trong nhóm mới đọc được tin nhắn ở đây.`;
    }
    return h('div', { class: 'intro' },
      convAvatarEl(c, 'avatar-xl', { dot: false }),
      h('p', { class: 'intro-name', text: convTitle(c) }),
      h('p', { class: 'intro-text', text }));
  }

  function messageRow(m, c, first, last) {
    const mine = m.senderId === state.me.id;
    const cls = ['msg', mine ? 'mine' : 'theirs'];
    if (first) cls.push('first');
    if (last) cls.push('last');
    if (m.pending) cls.push('pending');
    if (m.failed) cls.push('failed');
    if (state.justAdded.has(m.id ? `id:${m.id}` : `c:${m.clientId}`)) cls.push('enter');
    const row = h('div', { class: cls.join(' '), dataset: { id: m.id || '', cid: m.clientId || '' } });
    if (!mine) row.append(h('span', { class: 'msg-avatar' }, last ? avatarEl(userOf(m.senderId), 'avatar-sm', { dot: false }) : null));
    const col = h('div', { class: 'msg-col' });
    if (!mine && c.type !== 'dm' && first) col.append(h('span', { class: 'msg-sender', text: nameOf(m.senderId) }));
    const tags = [];
    if (m.forwarded && !m.deleted) tags.push(h('span', null, icon('forward'), 'Đã chuyển tiếp'));
    if (m.editedAt && !m.deleted) tags.push(h('span', { title: `Sửa lúc ${hm(m.editedAt)}` }, icon('edit'), 'Đã chỉnh sửa'));
    if (isPinned(m)) tags.push(h('span', null, icon('pin'), 'Đã ghim'));
    if (tags.length) col.append(h('span', { class: 'msg-tags' }, tags));
    col.append(m.kind === 'poll' && !m.deleted ? pollEl(m) : bubbleEl(m));
    const reacts = reactionsEl(m);
    if (reacts) col.append(reacts);
    if (m.failed) col.append(h('span', { class: 'msg-meta', text: 'Chưa gửi được. Chạm để gửi lại.' }));
    else if (last) col.append(h('span', { class: 'msg-meta', text: m.pending ? 'Đang gửi…' : hm(m.createdAt) }));
    row.append(col);
    return row;
  }

  function bubbleEl(m) {
    if (m.deleted) return h('div', { class: 'bubble is-deleted', text: 'Tin nhắn đã được thu hồi' });
    if (m.kind === 'voice') {
      const vb = h('div', { class: 'bubble is-voice' });
      if (m.replyTo) vb.append(quoteEl(m.replyTo));
      vb.append(voice ? voice.player(m) : h('span', { class: 'bubble-text', text: voiceLabel(m) }));
      return vb;
    }
    const hasImage = Boolean(m.image || m.localUrl);
    const purged = !hasImage && Boolean(m.imagePurged); // ảnh đã bị dọn khỏi máy chủ, máy này cũng không có
    const showsImage = hasImage || purged;
    const hasQuote = Boolean(m.replyTo);
    const emoji = !showsImage && !hasQuote && isEmojiOnly(m.text);
    const cls = ['bubble'];
    if (showsImage && !m.text && !hasQuote) cls.push('is-image');
    else if (showsImage) cls.push('has-image');
    if (emoji) cls.push('is-emoji');
    if ((m.mentions || []).includes(state.me.id)) cls.push('mentions-me');
    const b = h('div', { class: cls.join(' ') });
    if (hasQuote) b.append(quoteEl(m.replyTo));
    if (hasImage) b.append(imageEl(m));
    else if (purged) b.append(goneImageEl(true));
    const shared = m.text ? chessShareOf(m.text) : null;
    if (shared) b.append(chessShareCard(shared));
    else if (m.text) b.append(h('span', { class: 'bubble-text' }, withMentions(linkify(m.text), m.mentions)));
    return b;
  }

  // Khung trích dẫn tin được trả lời, bấm vào để nhảy tới tin gốc
  function quoteEl(r) {
    if (r.missing) {
      // Tin gốc đã bị dọn khỏi máy chủ: dùng bản lưu trên máy nếu có
      const orig = state.msgs.get(state.currentId)?.list.find((x) => x.id === r.id);
      r = orig && !orig.deleted
        ? { ...quoteOf(orig), missing: false }
        : { ...r, text: 'Tin nhắn cũ đã được dọn khỏi máy chủ', gone: true };
    }
    const who = r.senderId == null ? 'Tin nhắn cũ' : r.senderId === state.me.id ? 'Bạn' : nameOf(r.senderId);
    const text = r.deleted ? 'Tin nhắn đã được thu hồi' : r.text || (r.audio ? '🎤 Tin nhắn thoại' : r.image ? '📷 Ảnh' : '');
    return h('button', { class: `quote${r.deleted || r.gone ? ' is-gone' : ''}`, type: 'button', dataset: { reply: r.id }, 'aria-label': `Xem tin nhắn gốc của ${who}` },
      h('span', { class: 'quote-name', text: who }),
      h('span', { class: 'quote-text', text }));
  }

  // Cảm xúc dưới bong bóng: tối đa 3 biểu tượng + tổng số
  function reactionsEl(m) {
    const list = m.reactions || [];
    if (!list.length || m.deleted) return null;
    const counts = new Map();
    for (const r of list) counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e);
    const mine = list.some((r) => r.userId === state.me.id);
    return h('button', {
      class: `reacts${mine ? ' is-mine' : ''}`, type: 'button', dataset: { reacts: m.id },
      'aria-label': `${list.length} người đã bày tỏ cảm xúc. Bấm để xem`,
    }, h('span', { class: 'reacts-emoji', text: top.join('') }), list.length > 1 ? h('span', { class: 'reacts-count', text: String(list.length) }) : null);
  }

  function imageEl(m) {
    // Kích thước ảnh nằm trong tên file (…_800x600.jpg) để giữ chỗ trước, không bị giật khi tải
    const match = /_(\d+)x(\d+)\.\w+$/.exec(m.image || '');
    const dims = m.w && m.h ? { w: m.w, h: m.h } : match ? { w: Number(match[1]), h: Number(match[2]) } : { w: 240, h: 180 };
    const scale = Math.min(1, 260 / dims.w, 320 / dims.h);
    const src = m.localUrl || m.image;
    const img = h('img', {
      class: 'msg-img', src, alt: 'Ảnh', loading: 'lazy', decoding: 'async',
      width: Math.max(1, Math.round(dims.w * scale)), height: Math.max(1, Math.round(dims.h * scale)),
      dataset: { full: src },
    });
    img.addEventListener('error', () => {
      const placeholder = goneImageEl(Boolean(m.imagePurged), () => placeholder.replaceWith(imageEl(m)));
      img.replaceWith(placeholder);
    }, { once: true });
    return img;
  }

  // Chỗ ảnh không hiện được: đã bị dọn khỏi máy chủ, hoặc lỗi mạng (bấm để thử lại)
  function goneImageEl(purged, retryLoad) {
    if (purged || !retryLoad) {
      return h('div', { class: 'img-gone', role: 'img', 'aria-label': 'Ảnh đã được dọn khỏi máy chủ' },
        icon('image'), h('span', { text: 'Ảnh đã được dọn khỏi máy chủ' }));
    }
    return h('button', { class: 'img-gone', type: 'button', onclick: (e) => { e.stopPropagation(); retryLoad(); } },
      icon('image'), h('span', { text: 'Không tải được ảnh. Chạm để thử lại' }));
  }

  // Tin nhắn chia sẻ ván cờ: "♟ …" + dòng mô tả + đường dẫn …/#/chess/g/12 → hiện thành thẻ bấm để xem ván
  function chessShareOf(text) {
    const m = /^♟ ([^\n]+)\n(?:([^\n]*)\n)?\S*#\/chess\/g\/(\d+)\s*$/.exec(text);
    return m ? { title: m[1], sub: m[2] || '', id: Number(m[3]) } : null;
  }
  function chessShareCard(c) {
    return h('button', {
      class: 'chess-share-card',
      type: 'button',
      onclick: (e) => {
        e.stopPropagation();
        navigate(`#/chess/g/${c.id}`);
      },
    },
    h('span', { class: 'chess-share-ic' }, icon('knight')),
    h('span', { class: 'chess-share-main' },
      h('strong', { text: c.title }),
      c.sub ? h('span', { text: c.sub }) : null,
      h('em', { text: 'Bấm để xem lại ván' })));
  }
  // Gửi một tin chữ vào cuộc trò chuyện bất kỳ (dùng khi chia sẻ ván cờ)
  function sendTextTo(convId, text) {
    const m = {
      id: null, clientId: newClientId(), conversationId: convId, senderId: state.me.id, text, image: null,
      replyTo: null, reactions: [], createdAt: Date.now(), pending: true,
    };
    addLocal(m);
    // true = đã gửi; false = lỗi (deliver đã báo lỗi, tin nằm trong khung chat để gửi lại)
    return deliver(m).then(() => !m.failed);
  }

  function linkify(text) {
    const parts = [];
    const re = /\bhttps?:\/\/[^\s<>"']+/gi;
    let last = 0;
    let match;
    while ((match = re.exec(text))) {
      let url = match[0];
      const trail = /[),.!?;:]+$/.exec(url);
      if (trail) url = url.slice(0, -trail[0].length);
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
      last = match.index + url.length;
      re.lastIndex = last;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3|\s)+$/u;
  const HAS_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
  function isEmojiOnly(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 30 || !EMOJI_ONLY.test(t) || !HAS_EMOJI.test(t)) return false;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return [...new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(t.replace(/\s+/g, ''))].length <= 3;
    }
    return true;
  }

  /* ----- Chạm giữ / chuột phải vào tin nhắn ----- */
  messagesEl.addEventListener('click', (e) => {
    const quote = e.target.closest('.quote');
    if (quote) {
      jumpTo(Number(quote.dataset.reply));
      return;
    }
    const reacts = e.target.closest('.reacts');
    if (reacts) {
      openReactors(Number(reacts.dataset.reacts), e.clientX, e.clientY);
      return;
    }
    const img = e.target.closest('.msg-img');
    if (img) {
      openLightbox(img.dataset.full || img.src);
      return;
    }
    const failed = e.target.closest('.msg.failed');
    if (failed) retry(failed.dataset.cid);
  });
  messagesEl.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.msg');
    if (!row || !row.dataset.id || e.target.closest('a')) return;
    e.preventDefault();
    openMenu(row, e.clientX, e.clientY);
  });
  // Chạm giữ: mở menu. Vuốt ngang tin nhắn: trả lời (tin người khác vuốt sang phải, tin của mình vuốt sang trái)
  let press = null;
  messagesEl.addEventListener('touchstart', (e) => {
    const row = e.target.closest('.msg');
    if (!row || !row.dataset.id || e.touches.length !== 1 || e.target.closest('a')) return;
    const t = e.touches[0];
    press = {
      row,
      x: t.clientX,
      y: t.clientY,
      dx: 0,
      swipe: null,
      ready: false,
      timer: setTimeout(() => {
        const target = press && press.row;
        press = null;
        if (!target) return;
        openMenu(target, t.clientX, t.clientY);
        if (navigator.vibrate) navigator.vibrate(10);
      }, 480),
    };
  }, { passive: true });
  messagesEl.addEventListener('touchmove', (e) => {
    if (!press) return;
    const t = e.touches[0];
    const dx = t.clientX - press.x;
    const dy = t.clientY - press.y;
    if (press.swipe === null) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) press.swipe = true;
      else if (Math.abs(dx) > 10 || Math.abs(dy) > 10) press.swipe = false;
      if (press.swipe !== null) clearTimeout(press.timer);
    }
    if (press.swipe === false) {
      press = null;
      return;
    }
    if (press.swipe) {
      const mine = press.row.classList.contains('mine');
      const d = mine ? Math.min(0, dx) : Math.max(0, dx);
      press.dx = d;
      press.row.style.transform = `translateX(${Math.sign(d) * Math.min(72, Math.abs(d) * 0.6)}px)`;
      const ready = Math.abs(d) > 70;
      if (ready && !press.ready && navigator.vibrate) navigator.vibrate(8);
      press.ready = ready;
      press.row.classList.toggle('swipe-ready', ready);
    }
  }, { passive: true });
  function endPress(e) {
    if (!press) return;
    clearTimeout(press.timer);
    const { row, swipe, ready } = press;
    press = null;
    if (!swipe) return;
    row.classList.remove('swipe-ready');
    row.style.transition = 'transform .18s ease';
    row.style.transform = '';
    setTimeout(() => { row.style.transition = ''; }, 200);
    if (ready && e.type === 'touchend') startReply(findMsg(Number(row.dataset.id)));
  }
  messagesEl.addEventListener('touchend', endPress, { passive: true });
  messagesEl.addEventListener('touchcancel', endPress, { passive: true });

  const findMsg = (id) => state.msgs.get(state.currentId)?.list.find((item) => item.id === id);

  function placeMenu(nodes, x, y, row) {
    const layer = $('#menu-layer');
    const menu = $('#msg-menu');
    menu.replaceChildren(...nodes);
    layer.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.round(Math.min(Math.max(8, x - rect.width / 2), window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.round(Math.min(Math.max(8, y - rect.height - 12), window.innerHeight - rect.height - 8))}px`;
    if (row) row.classList.add('is-selected');
    if (!isTouch()) menu.querySelector('button')?.focus();
  }

  function openMenu(row, x, y) {
    if (!$('#menu-layer').hidden) return;
    const m = findMsg(Number(row.dataset.id));
    if (!m || m.deleted || m.kind === 'system') return;
    const myEmoji = (m.reactions || []).find((r) => r.userId === state.me.id)?.emoji;
    const bar = h('div', { class: 'react-bar', role: 'group', 'aria-label': 'Bày tỏ cảm xúc' },
      REACTIONS.map((emoji) => h('button', {
        class: `react-btn${emoji === myEmoji ? ' is-on' : ''}`, type: 'button', text: emoji, 'aria-label': `Thả ${emoji}`,
        onclick: () => { closeMenu(); react(m, emoji); },
      })));
    const items = [{ label: 'Trả lời', run: () => startReply(m) }];
    const mineMsg = m.senderId === state.me.id;
    if (mineMsg && m.kind !== 'poll' && m.text != null && !chessShareOf(m.text || '')) items.push({ label: 'Sửa', run: () => startEdit(m) });
    if (m.text && m.kind !== 'poll') items.push({ label: 'Sao chép', run: () => copyText(m.text).then(() => toast('Đã sao chép tin nhắn.'), () => toast('Không sao chép được.')) });
    if (m.kind !== 'poll') items.push({ label: 'Chuyển tiếp', run: () => openForward(m) });
    items.push(isPinned(m) ? { label: 'Bỏ ghim', run: () => pinMessage(m, false) } : { label: 'Ghim', run: () => pinMessage(m, true) });
    if (m.kind === 'poll' && mineMsg && m.poll && !m.poll.closed) items.push({ label: 'Kết thúc bình chọn', run: () => closePoll(m) });
    if (m.image || m.localUrl) {
      items.push({ label: 'Xem ảnh', run: () => openLightbox(m.localUrl || m.image) });
      items.push({ label: 'Tải ảnh về máy', run: () => downloadImage(m.localUrl || m.image) });
    }
    if (m.senderId === state.me.id) items.push({ label: 'Thu hồi', danger: true, run: () => recall(m) });
    placeMenu([bar, ...items.map((item) => h('button', {
      class: `menu-item${item.danger ? ' is-danger' : ''}`, type: 'button', role: 'menuitem', text: item.label,
      onclick: () => { closeMenu(); item.run(); },
    }))], x, y, row);
  }

  // Danh sách ai đã thả cảm xúc
  function openReactors(messageId, x, y) {
    const m = findMsg(messageId);
    if (!m || !(m.reactions || []).length) return;
    const nodes = [h('p', { class: 'menu-title', text: 'Cảm xúc' })];
    for (const r of m.reactions) {
      nodes.push(h('div', { class: 'reactor' },
        avatarEl(userOf(r.userId), 'avatar-sm', { dot: false }),
        h('span', { class: 'reactor-name', text: r.userId === state.me.id ? 'Bạn' : nameOf(r.userId) }),
        h('span', { class: 'reactor-emoji', text: r.emoji })));
    }
    const mine = m.reactions.find((r) => r.userId === state.me.id);
    if (mine) {
      nodes.push(h('button', {
        class: 'menu-item is-danger', type: 'button', role: 'menuitem', text: 'Gỡ cảm xúc của bạn',
        onclick: () => { closeMenu(); react(m, mine.emoji); },
      }));
    }
    placeMenu(nodes, x, y, null);
  }

  async function react(m, emoji) {
    const before = m.reactions || [];
    const mine = before.find((r) => r.userId === state.me.id);
    const others = before.filter((r) => r.userId !== state.me.id);
    // Hiện ngay trên màn hình, máy chủ trả kết quả chuẩn sau
    m.reactions = mine && mine.emoji === emoji ? others : [...others, { userId: state.me.id, emoji }];
    renderMessages();
    try {
      onReactions(await api(`/api/messages/${m.id}/reactions`, { method: 'POST', body: { emoji } }));
    } catch (err) {
      m.reactions = before;
      renderMessages();
      toast(err.message);
    }
  }

  function onReactions({ conversationId, messageId, reactions }) {
    LocalDB.patchMessage(messageId, { reactions }).catch(() => {});
    const m = state.msgs.get(conversationId)?.list.find((item) => item.id === messageId);
    if (!m) return;
    m.reactions = reactions;
    if (state.currentId === conversationId) renderMessages();
  }

  // Trả lời tin nhắn
  const quoteOf = (m) => ({
    id: m.id, senderId: m.senderId, deleted: false, text: m.text ? oneLine(m.text).slice(0, 140) : null,
    image: m.kind !== 'voice' && Boolean(m.image || m.localUrl), audio: m.kind === 'voice',
  });
  function startReply(m) {
    if (!m || !m.id || m.deleted || m.kind === 'system') return;
    state.replying.set(m.conversationId, m);
    renderReplyBar();
    input.focus({ preventScroll: true });
  }
  function cancelReply() {
    state.replying.delete(state.currentId);
    renderReplyBar();
  }
  function renderReplyBar() {
    const bar = $('#reply-bar');
    const editing = state.currentId != null ? state.editing.get(state.currentId) : null;
    if (editing) {
      bar.replaceChildren(
        h('div', { class: 'reply-bar-main' },
          h('span', { class: 'reply-bar-title' }, icon('edit'), ' Đang sửa tin nhắn'),
          h('span', { class: 'reply-bar-text', text: oneLine(editing.text || '') || '📷 Ảnh' })),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Hủy sửa', onclick: cancelEdit }, icon('close')));
      bar.hidden = false;
      return;
    }
    const m = state.currentId != null ? state.replying.get(state.currentId) : null;
    if (!m) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }
    const who = m.senderId === state.me.id ? 'chính mình' : nameOf(m.senderId);
    bar.replaceChildren(
      h('div', { class: 'reply-bar-main' },
        h('span', { class: 'reply-bar-title' }, 'Đang trả lời ', h('strong', { text: who })),
        h('span', { class: 'reply-bar-text', text: m.kind === 'voice' ? voiceLabel(m) : m.text ? oneLine(m.text) : m.image || m.localUrl ? '📷 Ảnh' : '' })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Hủy trả lời', onclick: cancelReply }, icon('close')));
    bar.hidden = false;
  }

  // Nhảy tới tin gốc (tự tải thêm tin cũ nếu cần)
  async function jumpTo(messageId, { deep = false } = {}) {
    const convId = state.currentId;
    const b = state.msgs.get(convId);
    if (!b || !messageId) return;
    const maxTries = deep ? 60 : 12; // từ tìm kiếm / tin ghim: có thể là tin rất cũ
    if (deep && !b.list.some((x) => x.id === messageId) && b.hasMore) toast('Đang tìm tin nhắn cũ…');
    for (let tries = 0; !b.list.some((x) => x.id === messageId) && b.hasMore && tries < maxTries; tries++) {
      if (b.loading) await new Promise((r) => setTimeout(r, 200));
      else await loadMessages(convId, { older: true });
      if (state.currentId !== convId) return;
    }
    const row = messagesEl.querySelector(`.msg[data-id="${messageId}"]`);
    if (!row) {
      toast('Không tìm thấy tin nhắn gốc.');
      return;
    }
    row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    row.classList.add('is-flash');
    setTimeout(() => row.classList.remove('is-flash'), 1600);
  }
  function closeMenu() {
    $('#menu-layer').hidden = true;
    $$('.msg.is-selected').forEach((r) => r.classList.remove('is-selected'));
  }
  $('#menu-layer').addEventListener('click', (e) => { if (e.target.id === 'menu-layer') closeMenu(); });

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = h('textarea', { class: 'visually-hidden', readonly: true });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('copy');
  }

  async function recall(m) {
    if (!window.confirm('Thu hồi tin nhắn này? Mọi người sẽ không xem được nữa.')) return;
    try {
      await api(`/api/messages/${m.id}`, { method: 'DELETE' });
      onMessageDeleted({ conversationId: m.conversationId, messageId: m.id });
    } catch (err) {
      toast(err.message);
    }
  }

  function openLightbox(src) {
    const lb = $('#lightbox');
    $('img', lb).src = src;
    lb.hidden = false;
    history.pushState({ depth: navDepth() + 1, overlay: 'lightbox' }, '', location.hash || '#/');
  }
  function hideLightbox() {
    const lb = $('#lightbox');
    if (lb.hidden) return;
    lb.hidden = true;
    $('img', lb).removeAttribute('src');
  }
  function closeLightbox() {
    if (history.state && history.state.overlay === 'lightbox') history.back();
    else hideLightbox();
  }
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.closest('.lightbox-actions')) return;
    closeLightbox();
  });

  /* =========================================================
     Chat 2.1.0: chủ đề + biểu tượng gửi nhanh, sửa tin, ghim tin, tìm tin,
     chuyển tiếp, tắt thông báo / ghim cuộc trò chuyện, @nhắc tên, bình chọn, ảnh đã gửi
     ========================================================= */
  // Chủ đề (màu bong bóng tin của mình). Máy chủ chỉ lưu mã; màu giống hệt trong app (native/src/chatThemes.ts)
  const THEMES = {
    default: { name: 'Think', a: '#0E7C66', b: '#139C80' },
    ocean: { name: 'Đại dương', a: '#1565C0', b: '#00A5C8' },
    sunset: { name: 'Hoàng hôn', a: '#E8542F', b: '#E84A8A' },
    grape: { name: 'Nho tím', a: '#6A3FC4', b: '#B046C9' },
    forest: { name: 'Rừng thông', a: '#2E7D32', b: '#6FA83A' },
    candy: { name: 'Kẹo ngọt', a: '#E0467E', b: '#F37A5A' },
    night: { name: 'Đêm sao', a: '#283593', b: '#5E35B1' },
    fire: { name: 'Lửa hồng', a: '#D32F2F', b: '#EF6C00' },
    gold: { name: 'Nắng vàng', a: '#B86E00', b: '#D89400' },
    mono: { name: 'Đen trắng', a: '#263238', b: '#546E7A' },
    love: { name: 'Tình yêu', a: '#C2185B', b: '#E53972' },
    mint: { name: 'Bạc hà', a: '#00897B', b: '#1FB5C9' },
  };
  const QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '😍', '🥰', '😎', '🎉', '👏', '🙏', '💯', '⭐', '🌸', '🐱', '🍕', '☕', '⚽', '🎮', '😆', '🤝', '💪', '🌈', '✨', '😘'];
  const MUTE_OPTIONS = [
    { label: 'Trong 1 giờ', ms: 3600e3 },
    { label: 'Trong 8 giờ', ms: 8 * 3600e3 },
    { label: 'Trong 24 giờ', ms: 24 * 3600e3 },
    { label: 'Cho đến khi bật lại', ms: -1 },
  ];
  const chatPlus = { forward: null, forwardPick: new Set(), searchTimer: null, searchSeq: 0, mention: null, media: { list: [], hasMore: false, loading: false, conv: null } };

  const isMuted = (c) => Boolean(c) && (c.mutedUntil === -1 || c.mutedUntil > Date.now());
  function muteText(c) {
    if (!isMuted(c)) return 'Đang bật thông báo';
    if (c.mutedUntil === -1) return 'Đã tắt thông báo cho đến khi bật lại';
    return `Đã tắt thông báo đến ${hm(c.mutedUntil)}${dayKey(c.mutedUntil) !== dayKey(Date.now()) ? ` ${dayLabel(c.mutedUntil).toLowerCase()}` : ''}`;
  }

  function applyTheme(c) {
    const t = THEMES[c?.theme] || THEMES.default;
    const pane = $('#chat-pane');
    pane.style.setProperty('--mine-a', t.a);
    pane.style.setProperty('--mine-b', t.b);
    pane.dataset.theme = c?.theme || 'default';
    syncComposer();
  }

  /* ----- Ghim tin nhắn ----- */
  const isPinned = (m) => Boolean(m && m.id && (state.pins.get(m.conversationId) || []).some((p) => p.message.id === m.id));
  async function loadPins(convId) {
    if (state.offline) return;
    try {
      const { pins } = await api(`/api/conversations/${convId}/pins`);
      state.pins.set(convId, pins);
      if (state.currentId === convId) {
        renderPinBar();
        renderMessages();
      }
    } catch { /* bỏ qua: không có thanh ghim */ }
  }
  function renderPinBar() {
    const bar = $('#pin-bar');
    const pins = state.currentId != null ? state.pins.get(state.currentId) || [] : [];
    if (!pins.length) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }
    const p = pins[0];
    const m = p.message;
    const who = m.senderId === state.me.id ? 'Bạn' : nameOf(m.senderId);
    bar.replaceChildren(
      h('button', { class: 'pin-bar-main', type: 'button', 'aria-label': `Tin đã ghim của ${who}. Bấm để xem`, onclick: () => jumpTo(m.id, { deep: true }) },
        icon('pin'),
        h('span', { class: 'pin-bar-text' },
          h('strong', { text: pins.length > 1 ? `Tin đã ghim (${pins.length})` : 'Tin đã ghim' }),
          h('span', { text: `${who}: ${messageSummary(m)}` }))),
      ...(pins.length > 1 ? [h('button', { class: 'btn btn-sm', type: 'button', text: 'Xem tất cả', onclick: () => navigate('#/pins') })] : []));
    bar.hidden = false;
  }
  function onPins({ conversationId, pins, removed }) {
    if (Array.isArray(pins)) state.pins.set(conversationId, pins);
    else if (removed) state.pins.set(conversationId, (state.pins.get(conversationId) || []).filter((p) => p.message.id !== removed));
    if (state.currentId === conversationId) {
      renderPinBar();
      renderMessages();
      if (currentSheet === 'pins') renderPinsSheet();
      if (currentSheet === 'conv') renderConvSheet();
    }
  }
  async function pinMessage(m, pinned) {
    try {
      const { pins } = await api(`/api/messages/${m.id}/pin`, { method: 'POST', body: { pinned } });
      onPins({ conversationId: m.conversationId, pins });
      toast(pinned ? 'Đã ghim tin nhắn.' : 'Đã bỏ ghim.');
    } catch (err) {
      toast(err.message);
    }
  }
  function renderPinsSheet() {
    const ul = $('#pins-list');
    const pins = state.pins.get(state.currentId) || [];
    if (!pins.length) {
      ul.replaceChildren(h('li', { class: 'people-empty', text: 'Chưa có tin nhắn nào được ghim. Chạm giữ một tin nhắn rồi chọn Ghim.' }));
      return;
    }
    ul.replaceChildren(...pins.map((p) => {
      const m = p.message;
      return h('li', { class: 'pin-row' },
        h('button', {
          class: 'pin-row-main', type: 'button',
          onclick: () => { goBack(); setTimeout(() => jumpTo(m.id, { deep: true }), 260); },
        },
        avatarEl(userOf(m.senderId), 'avatar-sm', { dot: false }),
        h('span', { class: 'person-main' },
          h('span', { class: 'person-name', text: m.senderId === state.me.id ? 'Bạn' : nameOf(m.senderId) }),
          h('span', { class: 'pin-row-text', text: messageSummary(m) }),
          h('span', { class: 'person-sub', text: `Ghim bởi ${p.pinnedBy === state.me.id ? 'bạn' : nameOf(p.pinnedBy)} · ${shortTime(p.pinnedAt)}` }))),
        h('button', { class: 'btn btn-sm btn-danger-quiet', type: 'button', text: 'Bỏ ghim', onclick: () => pinMessage(m, false) }));
    }));
  }

  /* ----- Sửa tin nhắn ----- */
  function startEdit(m) {
    if (!m || !m.id || m.deleted) return;
    state.replying.delete(m.conversationId);
    state.editing.set(m.conversationId, m);
    input.value = m.text || '';
    // Giữ lại danh sách @nhắc tên của tin cũ để sửa xong vẫn còn
    const picks = new Map();
    for (const uid of m.mentions || []) picks.set(nameOf(uid), uid);
    state.mentionPicks.set(m.conversationId, picks);
    renderReplyBar();
    syncComposer();
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }
  function cancelEdit() {
    const convId = state.currentId;
    if (!state.editing.has(convId)) return;
    state.editing.delete(convId);
    state.mentionPicks.delete(convId);
    input.value = state.drafts.get(convId) || '';
    renderReplyBar();
    syncComposer();
  }
  async function saveEdit() {
    const convId = state.currentId;
    const m = state.editing.get(convId);
    if (!m) return;
    const text = input.value.trim();
    if (!text && !m.image) {
      toast('Tin nhắn không được để trống. Muốn xóa thì chọn Thu hồi.');
      return;
    }
    if (text === (m.text || '').trim()) {
      cancelEdit();
      return;
    }
    const mentions = mentionsIn(convId, text);
    const before = { text: m.text, editedAt: m.editedAt, mentions: m.mentions };
    Object.assign(m, { text, editedAt: Date.now(), mentions });
    state.editing.delete(convId);
    state.mentionPicks.delete(convId);
    input.value = state.drafts.get(convId) || '';
    renderReplyBar();
    syncComposer();
    renderMessages();
    try {
      const { message } = await api(`/api/messages/${m.id}`, { method: 'PATCH', body: { text, mentions } });
      onMessageUpdated({ message });
    } catch (err) {
      Object.assign(m, before);
      renderMessages();
      toast(err.message);
    }
  }

  // Tin nhắn thay đổi (sửa, bình chọn): thay bản trên máy
  function onMessageUpdated({ message }) {
    if (!message) return;
    const b = state.msgs.get(message.conversationId);
    const old = b?.list.find((x) => x.id === message.id);
    if (old) Object.assign(old, message);
    saveLocal([message]);
    const c = state.convs.get(message.conversationId);
    if (c && c.lastMessage && c.lastMessage.id === message.id) c.lastMessage = { ...c.lastMessage, ...message };
    const pins = state.pins.get(message.conversationId);
    if (pins) for (const p of pins) if (p.message.id === message.id) p.message = { ...p.message, ...message };
    if (state.currentId === message.conversationId) {
      renderMessages();
      renderPinBar();
    }
    renderConvList();
  }

  /* ----- Chủ đề, biểu tượng nhanh, tắt thông báo, ghim cuộc trò chuyện ----- */
  function onAppearance({ conversationId, theme, emoji }) {
    const c = state.convs.get(conversationId);
    if (!c) return;
    c.theme = theme;
    c.emoji = emoji;
    if (state.currentId === conversationId) applyTheme(c);
    if (currentSheet === 'conv' && state.currentId === conversationId) renderConvSheet();
  }
  function onConvPrefs({ conversationId, mutedUntil, pinnedAt }) {
    const c = state.convs.get(conversationId);
    if (!c) return;
    c.mutedUntil = mutedUntil;
    c.pinnedAt = pinnedAt;
    renderConvList();
    updateBadge();
    if (currentSheet === 'conv' && state.currentId === conversationId) renderConvSheet();
  }
  async function setAppearance(c, body) {
    try {
      const { conversation } = await api(`/api/conversations/${c.id}/appearance`, { method: 'PATCH', body });
      onAppearance({ conversationId: c.id, theme: conversation.theme, emoji: conversation.emoji });
    } catch (err) {
      toast(err.message);
    }
  }
  async function setPrefs(c, body) {
    try {
      const { conversation } = await api(`/api/conversations/${c.id}/prefs`, { method: 'PATCH', body });
      onConvPrefs({ conversationId: c.id, mutedUntil: conversation.mutedUntil, pinnedAt: conversation.pinnedAt });
      if (body.mutedUntil !== undefined) toast(body.mutedUntil ? 'Đã tắt thông báo của cuộc trò chuyện này.' : 'Đã bật lại thông báo.');
      if (body.pinned !== undefined) toast(body.pinned ? 'Đã ghim lên đầu danh sách.' : 'Đã bỏ ghim.');
    } catch (err) {
      toast(err.message);
    }
  }
  function muteMenuItems(c) {
    if (isMuted(c)) return [{ label: 'Bật lại thông báo', run: () => setPrefs(c, { mutedUntil: 0 }) }];
    return MUTE_OPTIONS.map((o) => ({ label: `Tắt thông báo ${o.label.toLowerCase()}`, run: () => setPrefs(c, { mutedUntil: o.ms === -1 ? -1 : Date.now() + o.ms }) }));
  }
  function menuButtons(items) {
    return items.map((item) => h('button', {
      class: `menu-item${item.danger ? ' is-danger' : ''}`, type: 'button', role: 'menuitem', text: item.label,
      onclick: () => { closeMenu(); item.run(); },
    }));
  }
  // Chuột phải / chạm giữ vào một cuộc trò chuyện trong danh sách
  function openConvMenu(c, x, y) {
    if (!c || !$('#menu-layer').hidden) return;
    placeMenu([
      h('p', { class: 'menu-title', text: convTitle(c) }),
      ...menuButtons([
        c.pinnedAt ? { label: 'Bỏ ghim khỏi đầu danh sách', run: () => setPrefs(c, { pinned: false }) } : { label: 'Ghim lên đầu danh sách', run: () => setPrefs(c, { pinned: true }) },
        ...muteMenuItems(c),
      ]),
    ], x, y, null);
  }
  const convListEl = $('#conv-list');
  convListEl.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('.conv');
    if (!li || state.offline) return;
    e.preventDefault();
    openConvMenu(state.convs.get(Number(li.dataset.conv)), e.clientX, e.clientY);
  });
  let convPress = null;
  convListEl.addEventListener('touchstart', (e) => {
    const li = e.target.closest('.conv');
    if (!li || e.touches.length !== 1 || state.offline) return;
    const t = e.touches[0];
    convPress = {
      x: t.clientX,
      y: t.clientY,
      timer: setTimeout(() => {
        convPress = null;
        openConvMenu(state.convs.get(Number(li.dataset.conv)), t.clientX, t.clientY);
        if (navigator.vibrate) navigator.vibrate(10);
      }, 520),
    };
  }, { passive: true });
  convListEl.addEventListener('touchmove', (e) => {
    if (!convPress) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - convPress.x) > 10 || Math.abs(t.clientY - convPress.y) > 10) {
      clearTimeout(convPress.timer);
      convPress = null;
    }
  }, { passive: true });
  const endConvPress = () => {
    if (convPress) clearTimeout(convPress.timer);
    convPress = null;
  };
  convListEl.addEventListener('touchend', endConvPress, { passive: true });
  convListEl.addEventListener('touchcancel', endConvPress, { passive: true });
  // Chạm giữ xong thì trình duyệt vẫn bắn "click": chặn để không mở cuộc trò chuyện
  convListEl.addEventListener('click', (e) => {
    if (!$('#menu-layer').hidden && e.target.closest('.conv')) e.preventDefault();
  }, true);

  /* ----- Bảng "Tùy chỉnh đoạn chat" ----- */
  function renderConvSheet() {
    const c = state.convs.get(state.currentId);
    const body = $('#conv-body');
    if (!c) return;
    const t = THEMES[c.theme] || THEMES.default;
    const pins = state.pins.get(c.id) || [];
    const quick = (label, ic, run, on) => h('button', { class: `conv-quick${on ? ' is-on' : ''}`, type: 'button', onclick: run },
      h('span', { class: 'conv-quick-ic' }, icon(ic)), h('span', { text: label }));
    const media = chatPlus.media.conv === c.id ? chatPlus.media.list.slice(0, 9) : [];
    body.replaceChildren(
      h('div', { class: 'profile' },
        convAvatarEl(c, 'avatar-xl', { dot: false }),
        h('p', { class: 'profile-title', text: convTitle(c) }),
        h('p', { class: 'hint', text: muteText(c) })),
      h('div', { class: 'conv-quick-row' },
        quick('Tìm tin nhắn', 'search', () => { goBack(); setTimeout(openChatSearch, 260); }),
        quick(isMuted(c) ? 'Bật thông báo' : 'Tắt thông báo', isMuted(c) ? 'bell' : 'bell-off', (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          placeMenu(menuButtons(muteMenuItems(c)), r.left + r.width / 2, r.top, null);
        }, isMuted(c)),
        quick(c.pinnedAt ? 'Bỏ ghim' : 'Ghim lên đầu', 'pin', () => setPrefs(c, { pinned: !c.pinnedAt }), Boolean(c.pinnedAt)),
        c.type === 'group' ? quick('Thành viên', 'group', () => navigate('#/group', { replace: true })) : null),
      h('div', { class: 'panel' },
        h('h3', { text: `Chủ đề: ${t.name}` }),
        h('div', { class: 'ctheme-grid', role: 'radiogroup', 'aria-label': 'Chủ đề' },
          Object.entries(THEMES).map(([id, th]) => h('button', {
            class: `ctheme${(c.theme || 'default') === id ? ' is-on' : ''}`, type: 'button', role: 'radio',
            'aria-checked': (c.theme || 'default') === id ? 'true' : 'false', 'aria-label': th.name, title: th.name,
            style: `--sw-a:${th.a};--sw-b:${th.b}`,
            onclick: () => { if ((c.theme || 'default') !== id) setAppearance(c, { theme: id }); },
          }, h('span', { class: 'ctheme-dot' }), h('span', { class: 'ctheme-name', text: th.name }))))),
      h('div', { class: 'panel' },
        h('h3', { text: `Biểu tượng gửi nhanh: ${c.emoji || '👍'}` }),
        h('p', { class: 'hint', text: 'Khi ô nhập trống, nút gửi thành biểu tượng này, bấm là gửi ngay.' }),
        h('div', { class: 'emoji-grid' },
          QUICK_EMOJIS.map((e) => h('button', {
            class: `emoji-pick${(c.emoji || '👍') === e ? ' is-on' : ''}`, type: 'button', text: e, 'aria-label': `Chọn ${e}`,
            onclick: () => { if ((c.emoji || '👍') !== e) setAppearance(c, { emoji: e }); },
          })))),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-row' },
          h('h3', { text: `Tin nhắn đã ghim (${pins.length})` }),
          pins.length ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Xem', onclick: () => navigate('#/pins', { replace: true }) }) : null),
        pins.length ? null : h('p', { class: 'hint', text: 'Chạm giữ một tin nhắn rồi chọn Ghim để giữ nó ở đầu cuộc trò chuyện.' })),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-row' },
          h('h3', { text: 'Ảnh đã gửi' }),
          h('button', { class: 'btn btn-sm', type: 'button', text: 'Xem tất cả', onclick: () => navigate('#/media', { replace: true }) })),
        media.length
          ? h('div', { class: 'media-grid is-mini' }, media.map((x) => mediaThumb(x)))
          : h('p', { class: 'hint', text: chatPlus.media.loading ? 'Đang tải…' : 'Chưa có ảnh nào.' })));
    if (chatPlus.media.conv !== c.id && !chatPlus.media.loading) renderMedia(true, { quiet: true });
  }

  /* ----- Ảnh đã gửi ----- */
  function mediaThumb(x) {
    return h('button', { class: 'media-thumb', type: 'button', 'aria-label': `Ảnh của ${nameOf(x.senderId)}, ${shortTime(x.createdAt)}`, onclick: () => openLightbox(x.image) },
      h('img', { src: x.image, alt: '', loading: 'lazy', decoding: 'async' }));
  }
  async function renderMedia(reset, { quiet = false } = {}) {
    const convId = state.currentId;
    const md = chatPlus.media;
    if (convId == null) return;
    if (reset && md.conv !== convId) {
      md.conv = convId;
      md.list = [];
      md.hasMore = true;
    }
    const grid = $('#media-grid');
    const draw = () => {
      if (quiet) {
        if (currentSheet === 'conv') renderConvSheet();
        return;
      }
      grid.replaceChildren(...md.list.map(mediaThumb));
      if (!md.list.length && !md.loading) grid.append(h('p', { class: 'hint', text: 'Chưa có ảnh nào trong cuộc trò chuyện này.' }));
      if (md.hasMore && md.list.length) {
        grid.append(h('button', { class: 'btn btn-sm media-more', type: 'button', text: md.loading ? 'Đang tải…' : 'Tải thêm', onclick: () => renderMedia(false) }));
      }
    };
    if (!reset || !md.list.length) {
      if (md.loading || !md.hasMore) return draw();
      md.loading = true;
      draw();
      try {
        const before = md.list.length ? md.list[md.list.length - 1].id : '';
        const data = await api(`/api/conversations/${convId}/media${before ? `?before=${before}` : ''}`);
        if (md.conv !== convId) return;
        md.list = md.list.concat(data.images);
        md.hasMore = data.hasMore;
      } catch (err) {
        if (!quiet) toast(err.message);
        md.hasMore = false;
      } finally {
        md.loading = false;
      }
    }
    draw();
  }

  /* ----- Tìm tin nhắn trong cuộc trò chuyện ----- */
  function openChatSearch() {
    if (state.currentId == null) return;
    const panel = $('#chat-search');
    $('#chat-pane').style.setProperty('--chat-head-h', `${$('.chat-head').offsetHeight}px`);
    panel.hidden = false;
    const inp = $('#chat-search-input');
    inp.value = '';
    $('#chat-search-results').replaceChildren();
    $('#chat-search-state').textContent = 'Gõ ít nhất 2 chữ, không cần dấu.';
    inp.focus();
  }
  function closeChatSearch() {
    const panel = $('#chat-search');
    if (panel.hidden) return;
    panel.hidden = true;
    clearTimeout(chatPlus.searchTimer);
    chatPlus.searchSeq++;
  }
  function highlight(text, q) {
    // Tô đậm chỗ khớp (so khớp không dấu, giữ nguyên chữ gốc)
    const src = oneLine(text);
    const f = fold(src);
    const k = fold(q);
    const i = k ? f.indexOf(k) : -1;
    if (i < 0) return [src];
    // fold giữ nguyên độ dài từng chữ cái nên vị trí khớp dùng được cho chữ gốc
    const start = Math.max(0, i - 40);
    return [start ? `…${src.slice(start, i)}` : src.slice(0, i), h('mark', { text: src.slice(i, i + k.length) }), src.slice(i + k.length)];
  }
  async function runChatSearch() {
    const q = $('#chat-search-input').value.trim();
    const convId = state.currentId;
    const seq = ++chatPlus.searchSeq;
    const ul = $('#chat-search-results');
    const note = $('#chat-search-state');
    if (fold(q).length < 2) {
      ul.replaceChildren();
      note.textContent = 'Gõ ít nhất 2 chữ, không cần dấu.';
      return;
    }
    note.textContent = 'Đang tìm…';
    let results = [];
    try {
      results = (await api(`/api/conversations/${convId}/search?q=${encodeURIComponent(q)}`)).results;
    } catch {
      // Mất mạng: tìm trong các tin đang có trên máy
      const k = fold(q);
      results = (state.msgs.get(convId)?.list || []).filter((m) => m.id && !m.deleted && m.kind !== 'system' && fold(m.text || '').includes(k)).reverse();
    }
    if (seq !== chatPlus.searchSeq) return;
    note.textContent = results.length ? `${results.length}${results.length >= 30 ? '+' : ''} tin nhắn` : 'Không tìm thấy tin nhắn nào.';
    ul.replaceChildren(...results.map((m) => h('li', null,
      h('button', { class: 'search-hit', type: 'button', onclick: () => { closeChatSearch(); jumpTo(m.id, { deep: true }); } },
        avatarEl(userOf(m.senderId), 'avatar-sm', { dot: false }),
        h('span', { class: 'person-main' },
          h('span', { class: 'search-hit-head' },
            h('strong', { text: m.senderId === state.me.id ? 'Bạn' : nameOf(m.senderId) }),
            h('time', { text: `${dayLabel(m.createdAt)} ${hm(m.createdAt)}` })),
          h('span', { class: 'search-hit-text' }, highlight(m.kind === 'poll' ? `📊 ${m.text}` : m.text || '', q)))))));
  }
  $('#chat-search-input').addEventListener('input', () => {
    clearTimeout(chatPlus.searchTimer);
    chatPlus.searchTimer = setTimeout(runChatSearch, 280);
  });
  $('#chat-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(chatPlus.searchTimer);
      runChatSearch();
    }
  });

  /* ----- Chuyển tiếp ----- */
  function openForward(m) {
    chatPlus.forward = m;
    chatPlus.forwardPick.clear();
    $('#forward-search').value = '';
    navigate('#/forward');
  }
  function renderForward() {
    const m = chatPlus.forward;
    if (!m) return;
    $('#forward-preview').replaceChildren(
      ...(m.image || m.localUrl ? [h('img', { src: m.localUrl || m.image, alt: '' })] : []),
      h('span', { text: messageSummary(m) }));
    const q = fold($('#forward-search').value);
    const list = [...state.convs.values()]
      .filter((c) => (c.type !== 'dm' || c.lastMessage || c.id === m.conversationId) && (!q || fold(convTitle(c)).includes(q)))
      .sort((a, b) => lastActivity(b) - lastActivity(a));
    const ul = $('#forward-list');
    ul.replaceChildren(...list.map((c) => h('li', null,
      h('button', {
        class: 'person pick', type: 'button', 'aria-pressed': chatPlus.forwardPick.has(c.id) ? 'true' : 'false',
        onclick: () => {
          if (chatPlus.forwardPick.has(c.id)) chatPlus.forwardPick.delete(c.id);
          else if (chatPlus.forwardPick.size >= 10) toast('Chọn tối đa 10 nơi một lần.');
          else chatPlus.forwardPick.add(c.id);
          renderForward();
        },
      },
      convAvatarEl(c),
      h('span', { class: 'person-main' },
        h('span', { class: 'person-name', text: convTitle(c) }),
        h('span', { class: 'person-sub', text: c.type === 'dm' ? 'Tin nhắn riêng' : `${c.memberCount || ''} thành viên`.trim() })),
      h('span', { class: 'check', 'aria-hidden': 'true' }, icon('check'))))));
    if (!list.length) ul.append(h('li', { class: 'people-empty', text: 'Không có cuộc trò chuyện nào khớp.' }));
    const n = chatPlus.forwardPick.size;
    const btn = $('#forward-send');
    btn.disabled = !n;
    btn.textContent = n ? `Gửi tới ${n} nơi` : 'Chọn nơi gửi';
  }
  $('#forward-search').addEventListener('input', renderForward);
  $('#forward-send').addEventListener('click', (e) => {
    const m = chatPlus.forward;
    if (!m || !chatPlus.forwardPick.size) return;
    withBusy(e.currentTarget, async () => {
      try {
        const { messages } = await api(`/api/messages/${m.id}/forward`, { method: 'POST', body: { conversationIds: [...chatPlus.forwardPick] } });
        for (const msg of messages) receive(msg);
        chatPlus.forward = null;
        chatPlus.forwardPick.clear();
        toast(messages.length > 1 ? `Đã chuyển tiếp tới ${messages.length} nơi.` : 'Đã chuyển tiếp.');
        goBack();
        renderConvList();
        if (state.currentId != null) renderMessages();
      } catch (err) {
        toast(err.message);
      }
    });
  });

  /* ----- Bình chọn ----- */
  function openComposerMenu(btn) {
    const c = state.convs.get(state.currentId);
    if (!c) return;
    const r = btn.getBoundingClientRect();
    placeMenu(menuButtons([
      { label: '📊 Tạo bình chọn', run: () => navigate('#/poll') },
      { label: '🖼️ Gửi ảnh', run: () => $('#image-input').click() },
      { label: `${c.emoji || '👍'} Gửi biểu tượng nhanh`, run: () => sendText({ quick: true }) },
    ]), r.left + 90, r.top, null);
  }
  const pollDraft = { options: ['', ''] };
  function renderPollForm(reset = true) {
    const form = $('#poll-form');
    if (reset) {
      form.reset();
      pollDraft.options = ['', ''];
      setFormError(form, '');
    }
    const box = $('#poll-options');
    box.replaceChildren(...pollDraft.options.map((v, i) => {
      const inp = h('input', { class: 'search-input', maxlength: 100, placeholder: `Lựa chọn ${i + 1}`, 'aria-label': `Lựa chọn ${i + 1}`, autocomplete: 'off' });
      inp.value = v;
      inp.addEventListener('input', () => { pollDraft.options[i] = inp.value; });
      return h('div', { class: 'poll-option-row' }, inp,
        pollDraft.options.length > 2
          ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Xóa lựa chọn ${i + 1}`, onclick: () => { pollDraft.options.splice(i, 1); renderPollForm(false); } }, icon('close'))
          : null);
    }));
    $('#poll-add').hidden = pollDraft.options.length >= 10;
    if (reset) setTimeout(() => form.elements.question.focus(), 250);
  }
  $('#poll-add').addEventListener('click', () => {
    if (pollDraft.options.length >= 10) return;
    pollDraft.options.push('');
    renderPollForm(false);
    const inputs = $$('#poll-options input');
    inputs[inputs.length - 1].focus();
  });
  $('#poll-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const question = form.elements.question.value.trim();
    const options = pollDraft.options.map((o) => o.trim()).filter(Boolean);
    if (!question) return setFormError(form, 'Hãy nhập câu hỏi.');
    if (new Set(options).size < 2) return setFormError(form, 'Cần ít nhất 2 lựa chọn khác nhau.');
    const convId = state.currentId;
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const { message } = await api(`/api/conversations/${convId}/polls`, { method: 'POST', body: { question, options, multi: form.elements.multi.checked } });
        receive(message);
        goBack();
        if (state.currentId === convId) renderMessages({ toBottom: true });
        renderConvList();
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  });
  function pollEl(m) {
    const p = m.poll || { options: [], multi: false, closed: false };
    const voters = new Set(p.options.flatMap((o) => o.votes));
    const total = voters.size;
    const mine = new Set(p.options.map((o, i) => (o.votes.includes(state.me.id) ? i : -1)).filter((i) => i >= 0));
    const max = Math.max(1, ...p.options.map((o) => o.votes.length));
    return h('div', { class: `bubble poll${p.closed ? ' is-closed' : ''}` },
      h('p', { class: 'poll-q' }, icon('poll'), h('span', { text: m.text })),
      h('p', { class: 'poll-sub', text: p.closed ? 'Bình chọn đã kết thúc' : p.multi ? 'Chọn một hoặc nhiều đáp án' : 'Chọn một đáp án' }),
      h('div', { class: 'poll-opts' }, p.options.map((o, i) => {
        const n = o.votes.length;
        const pct = total ? Math.round((n / total) * 100) : 0;
        const on = mine.has(i);
        return h('button', {
          class: `poll-opt${on ? ' is-on' : ''}${n === max && n > 0 ? ' is-top' : ''}`, type: 'button', disabled: p.closed || !m.id,
          'aria-pressed': on ? 'true' : 'false', 'aria-label': `${o.text}: ${n} phiếu${on ? ', bạn đã chọn' : ''}`,
          style: `--pct:${total ? (n / total) * 100 : 0}%`,
          onclick: (e) => { e.stopPropagation(); vote(m, i); },
        },
        h('span', { class: `poll-mark${p.multi ? ' is-multi' : ''}`, 'aria-hidden': 'true' }, on ? icon('check') : null),
        h('span', { class: 'poll-text', text: o.text }),
        h('span', { class: 'poll-voters' }, o.votes.slice(0, 3).map((uid) => avatarEl(userOf(uid), 'avatar-xs', { dot: false }))),
        h('span', { class: 'poll-count', text: total ? `${pct}%` : '0' }));
      })),
      h('p', { class: 'poll-foot', text: total ? `${total} người đã bình chọn` : 'Chưa có ai bình chọn' }));
  }
  async function vote(m, i) {
    const p = m.poll;
    if (!p || p.closed) return;
    const mine = p.options.map((o, k) => (o.votes.includes(state.me.id) ? k : -1)).filter((k) => k >= 0);
    let next;
    if (p.multi) next = mine.includes(i) ? mine.filter((k) => k !== i) : [...mine, i];
    else next = mine.length === 1 && mine[0] === i ? [] : [i];
    const before = JSON.parse(JSON.stringify(p));
    p.options.forEach((o, k) => {
      o.votes = o.votes.filter((uid) => uid !== state.me.id);
      if (next.includes(k)) o.votes.push(state.me.id);
    });
    renderMessages();
    try {
      onMessageUpdated(await api(`/api/messages/${m.id}/vote`, { method: 'POST', body: { options: next } }));
    } catch (err) {
      m.poll = before;
      renderMessages();
      toast(err.message);
    }
  }
  async function closePoll(m) {
    if (!window.confirm('Kết thúc bình chọn này? Mọi người sẽ không chọn được nữa.')) return;
    try {
      onMessageUpdated(await api(`/api/messages/${m.id}/poll/close`, { method: 'POST', body: {} }));
    } catch (err) {
      toast(err.message);
    }
  }

  /* ----- @nhắc tên (trong nhóm và phòng chung) ----- */
  function memberIdsOf(c) {
    if (!c) return [];
    if (c.type === 'group') return c.memberIds || [];
    if (c.type === 'dm') return [c.peerId];
    return [...state.users.values()].filter((u) => !u.disabled).map((u) => u.id);
  }
  function updateMentions() {
    const c = state.convs.get(state.currentId);
    const box = $('#mention-box');
    if (!c || c.type === 'dm') return hideMentions();
    const before = input.value.slice(0, input.selectionStart);
    const m = /(?:^|\s)@([^\s@]{0,24})$/.exec(before);
    if (!m) return hideMentions();
    const q = fold(m[1]);
    const people = memberIdsOf(c)
      .filter((uid) => uid !== state.me.id)
      .map((uid) => userOf(uid))
      .filter((u) => u && !u.disabled && (!q || fold(u.displayName).includes(q) || u.username.includes(q)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'))
      .slice(0, 6);
    if (!people.length) return hideMentions();
    chatPlus.mention = { start: before.length - m[1].length - 1, people, index: 0 };
    box.replaceChildren(...people.map((u, i) => h('button', {
      class: `mention-item${i === 0 ? ' is-active' : ''}`, type: 'button', role: 'option', 'aria-selected': i === 0 ? 'true' : 'false',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => pickMention(u),
    }, avatarEl(u, 'avatar-sm', { dot: false }), h('span', { class: 'person-name', text: u.displayName }), h('span', { class: 'person-sub', text: `@${u.username}` }))));
    box.hidden = false;
  }
  function hideMentions() {
    chatPlus.mention = null;
    const box = $('#mention-box');
    if (!box.hidden) {
      box.hidden = true;
      box.replaceChildren();
    }
  }
  function pickMention(u) {
    const mt = chatPlus.mention;
    if (!mt) return;
    const caret = input.selectionStart;
    const insert = `@${u.displayName} `;
    input.value = input.value.slice(0, mt.start) + insert + input.value.slice(caret);
    const pos = mt.start + insert.length;
    input.setSelectionRange(pos, pos);
    const convId = state.currentId;
    if (!state.mentionPicks.has(convId)) state.mentionPicks.set(convId, new Map());
    state.mentionPicks.get(convId).set(u.displayName, u.id);
    hideMentions();
    input.dispatchEvent(new Event('input'));
    input.focus();
  }
  function mentionKey(e) {
    const mt = chatPlus.mention;
    if (!mt || $('#mention-box').hidden) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      mt.index = (mt.index + (e.key === 'ArrowDown' ? 1 : mt.people.length - 1)) % mt.people.length;
      $$('.mention-item').forEach((el, i) => {
        el.classList.toggle('is-active', i === mt.index);
        el.setAttribute('aria-selected', i === mt.index ? 'true' : 'false');
      });
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(mt.people[mt.index]);
      return true;
    }
    return false;
  }
  // Ai được nhắc tên trong tin sắp gửi: những người đã chọn từ gợi ý mà "@Tên" vẫn còn trong chữ
  function mentionsIn(convId, text) {
    const picks = state.mentionPicks.get(convId);
    if (!picks) return [];
    return [...new Set([...picks].filter(([name]) => text.includes(`@${name}`)).map(([, id]) => id))];
  }
  // Tô màu "@Tên" của những người được nhắc trong tin
  function withMentions(parts, ids) {
    if (!ids || !ids.length) return parts;
    const names = [...new Set(ids.map((id) => nameOf(id)))].sort((a, b) => b.length - a.length);
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`@(${names.map(esc).join('|')})`, 'g');
    const out = [];
    for (const part of parts) {
      if (typeof part !== 'string') {
        out.push(part);
        continue;
      }
      let last = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(part))) {
        if (m.index > last) out.push(part.slice(last, m.index));
        const uid = ids.find((id) => nameOf(id) === m[1]);
        out.push(h('span', { class: `mention${uid === state.me.id ? ' is-me' : ''}`, text: m[0] }));
        last = m.index + m[0].length;
      }
      if (last < part.length) out.push(part.slice(last));
    }
    return out;
  }

  /* =========================================================
     Gửi tin nhắn
     ========================================================= */
  const newClientId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function syncComposer() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 140)}px`;
    const ready = Boolean(input.value.trim());
    const btn = $('.send-btn');
    btn.classList.toggle('is-ready', ready);
    // Ô nhập trống: nút gửi thành biểu tượng cảm xúc nhanh của cuộc trò chuyện (như 👍 của Messenger)
    const c = state.convs.get(state.currentId);
    const quick = !ready && c && !state.editing.has(c.id) ? c.emoji || '👍' : '';
    btn.classList.toggle('is-emoji', Boolean(quick));
    $('.send-emoji', btn).textContent = quick;
    btn.setAttribute('aria-label', quick ? `Gửi ${quick}` : state.editing.has(state.currentId) ? 'Lưu tin nhắn đã sửa' : 'Gửi');
  }

  function bumpConv(convId, m) {
    const c = state.convs.get(convId);
    if (!c) return;
    if (!c.lastMessage || !c.lastMessage.id || !m.id || m.id >= c.lastMessage.id) c.lastMessage = m;
    if (m.id && m.senderId === state.me.id) c.lastReadId = Math.max(c.lastReadId || 0, m.id);
  }

  function addLocal(m) {
    box(m.conversationId).list.push(m);
    state.justAdded.add(`c:${m.clientId}`);
    bumpConv(m.conversationId, m);
    if (state.currentId === m.conversationId) renderMessages({ toBottom: true });
    renderConvList();
  }

  // Nhận tin từ máy chủ (qua API hoặc realtime), thay thế bản tạm nếu có
  function receive(msg) {
    const b = state.msgs.get(msg.conversationId);
    let isNew = false;
    if (b && !b.list.some((m) => m.id === msg.id)) {
      const idx = msg.clientId ? b.list.findIndex((m) => !m.id && m.clientId === msg.clientId) : -1;
      if (idx >= 0) {
        const temp = b.list.splice(idx, 1)[0];
        msg = { ...msg, localUrl: temp.localUrl };
      } else {
        isNew = true;
        state.justAdded.add(`id:${msg.id}`);
      }
      merge(b, [msg]);
    }
    bumpConv(msg.conversationId, msg);
    saveLocal([msg]);
    return isNew;
  }

  function sendText({ quick = false } = {}) {
    const convId = state.currentId;
    if (convId == null) return;
    if (state.editing.has(convId)) {
      saveEdit();
      return;
    }
    const typed = input.value.trim();
    // Ô nhập trống mà bấm nút gửi: gửi biểu tượng cảm xúc nhanh
    const text = typed || (quick ? state.convs.get(convId)?.emoji || '👍' : '');
    if (!text) return;
    if (text.length > 4000) {
      toast('Tin nhắn dài quá 4000 ký tự. Hãy chia nhỏ ra.');
      return;
    }
    const mentions = typed ? mentionsIn(convId, text) : [];
    input.value = '';
    state.drafts.delete(convId);
    state.mentionPicks.delete(convId);
    hideMentions();
    syncComposer();
    const target = state.replying.get(convId);
    state.replying.delete(convId);
    renderReplyBar();
    const m = {
      id: null, clientId: newClientId(), conversationId: convId, senderId: state.me.id, text, image: null,
      replyTo: target ? quoteOf(target) : null, reactions: [], createdAt: Date.now(), pending: true,
      mentions: mentions.length ? mentions : undefined,
    };
    addLocal(m);
    deliver(m);
  }

  async function deliver(m) {
    m.pending = true;
    m.failed = false;
    try {
      if (m.audioBlob && !m.uploadedAudio) {
        const up = await api('/api/upload/audio', { method: 'POST', raw: m.audioBlob });
        m.uploadedAudio = up.url;
      }
      if (m.audioBlob) {
        const { message } = await api(`/api/conversations/${m.conversationId}/messages`, {
          method: 'POST',
          body: { audio: m.uploadedAudio, audioMs: m.audio.ms, audioWave: m.audio.wave, replyTo: m.replyTo ? m.replyTo.id : undefined, clientId: m.clientId },
        });
        receive(message);
        if (state.currentId === m.conversationId) renderMessages();
        renderConvList();
        return;
      }
      if (m.blob && !m.uploadedUrl) {
        const up = await api(`/api/upload?w=${m.w}&h=${m.h}`, { method: 'POST', raw: m.blob });
        m.uploadedUrl = up.url;
        cacheOwnImage(up.url, m.blob); // giữ luôn ảnh mình gửi trên máy
      }
      const { message } = await api(`/api/conversations/${m.conversationId}/messages`, {
        method: 'POST',
        body: { text: m.text || '', image: m.uploadedUrl || undefined, replyTo: m.replyTo ? m.replyTo.id : undefined, clientId: m.clientId, mentions: m.mentions },
      });
      receive(message);
      if (state.currentId === m.conversationId) renderMessages();
      renderConvList();
    } catch (err) {
      m.pending = false;
      m.failed = true;
      if (state.currentId === m.conversationId) renderMessages();
      if (err.status !== 401) toast(err.message);
    }
  }

  function retry(clientId) {
    const m = state.msgs.get(state.currentId)?.list.find((item) => !item.id && item.clientId === clientId);
    if (!m || m.pending) return;
    m.uploadedUrl = null;
    m.uploadedAudio = null;
    deliver(m);
    renderMessages();
  }

  /* ----- Ảnh: thu nhỏ ngay trên máy trước khi gửi để nhanh và nhẹ ----- */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không đọc được ảnh này. Hãy thử ảnh khác.'));
      };
      img.src = url;
    });
  }

  async function prepareImage(file, { max, square = false, quality = 0.85 }) {
    const { img, url } = await loadImage(file);
    try {
      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      let sx = 0;
      let sy = 0;
      if (!sw || !sh) throw new Error('Không đọc được kích thước ảnh.');
      // Giữ nguyên ảnh động GIF
      if (!square && file.type === 'image/gif' && file.size <= 8 * 1024 * 1024) return { blob: file, w: sw, h: sh };
      if (square) {
        const side = Math.min(sw, sh);
        sx = (sw - side) / 2;
        sy = (sh - side) / 2;
        sw = side;
        sh = side;
      }
      const scale = Math.min(1, max / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * scale));
      const ht = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = ht;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, ht);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, ht);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) throw new Error('Không nén được ảnh này.');
      return { blob, w, h: ht };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function sendImages(files) {
    const convId = state.currentId;
    if (convId == null) return;
    const list = files.filter((f) => f && (!f.type || /^image\//.test(f.type)));
    if (!list.length) {
      toast('Chỉ gửi được file ảnh.');
      return;
    }
    if (list.length > 10) toast('Mỗi lần gửi tối đa 10 ảnh.');
    let target = state.replying.get(convId); // trả lời gắn vào ảnh đầu tiên
    if (target) {
      state.replying.delete(convId);
      renderReplyBar();
    }
    for (const file of list.slice(0, 10)) {
      let prepared;
      try {
        prepared = await prepareImage(file, { max: 1600 });
      } catch (err) {
        toast(err.message);
        continue;
      }
      if (prepared.blob.size > 10 * 1024 * 1024) {
        toast('Ảnh quá lớn (tối đa 10 MB).');
        continue;
      }
      const m = {
        id: null, clientId: newClientId(), conversationId: convId, senderId: state.me.id,
        text: null, image: null, blob: prepared.blob, w: prepared.w, h: prepared.h,
        replyTo: target ? quoteOf(target) : null, reactions: [],
        localUrl: URL.createObjectURL(prepared.blob), createdAt: Date.now(), pending: true,
      };
      target = null;
      addLocal(m);
      await deliver(m);
    }
  }

  // Tin nhắn thoại: giữ nút micro để nói, thả tay để gửi (public/voice-ui.js)
  function sendVoice({ blob, ms, wave }) {
    const convId = state.currentId;
    if (convId == null) return;
    const target = state.replying.get(convId);
    state.replying.delete(convId);
    renderReplyBar();
    const m = {
      id: null, clientId: newClientId(), conversationId: convId, senderId: state.me.id, kind: 'voice', text: null, image: null,
      audio: { url: URL.createObjectURL(blob), ms, wave }, audioBlob: blob,
      replyTo: target ? quoteOf(target) : null, reactions: [], createdAt: Date.now(), pending: true,
    };
    addLocal(m);
    deliver(m);
  }
  if (voice) {
    voice.attach({
      button: $('#mic-btn'),
      bar: $('#voice-bar'),
      onSend: sendVoice,
      canRecord: () => {
        if (state.currentId == null) return false;
        if (state.editing.has(state.currentId)) {
          toast('Đang sửa tin nhắn: lưu hoặc hủy trước khi ghi âm.');
          return false;
        }
        return true;
      },
    });
  } else {
    $('#mic-btn').hidden = true;
  }

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    sendText({ quick: true }); // bấm nút gửi khi ô nhập trống: gửi biểu tượng cảm xúc nhanh
  });
  input.addEventListener('keydown', (e) => {
    if (mentionKey(e)) return;
    // Máy tính: Enter để gửi, Shift+Enter xuống dòng. Điện thoại: dùng nút gửi.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !isTouch()) {
      e.preventDefault();
      sendText();
    }
  });
  let lastTypingSent = 0;
  input.addEventListener('input', () => {
    syncComposer();
    if (state.currentId == null) return;
    updateMentions();
    if (input.value) state.drafts.set(state.currentId, input.value);
    else state.drafts.delete(state.currentId);
    const now = Date.now();
    if (input.value.trim() && state.socket?.connected && now - lastTypingSent > 2000) {
      lastTypingSent = now;
      state.socket.emit('typing', { conversationId: state.currentId });
    }
  });
  input.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    sendImages(files);
  });
  $('.send-btn').addEventListener('mousedown', (e) => e.preventDefault()); // giữ bàn phím không bị đóng
  $('#image-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) sendImages(files);
  });

  messagesEl.addEventListener('scroll', () => {
    state.stickBottom = isNearBottom();
    if (state.stickBottom) {
      $('#jump-btn').hidden = true;
      if (state.currentId != null && document.hasFocus()) markRead(state.currentId);
    }
    const b = state.msgs.get(state.currentId);
    if (b && b.loaded && b.hasMore && !b.loading && messagesEl.scrollTop < 200) loadMessages(state.currentId, { older: true });
  }, { passive: true });
  if ('ResizeObserver' in window) {
    // Bàn phím bật lên làm khung chat thấp đi: giữ tin mới nhất trong tầm mắt
    new ResizeObserver(() => { if (state.stickBottom) messagesEl.scrollTop = messagesEl.scrollHeight; }).observe(messagesEl);
  }
  $('#jump-btn').addEventListener('click', () => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });
    $('#jump-btn').hidden = true;
  });

  /* ----- Đang nhập… ----- */
  function onTyping({ conversationId, userId }) {
    if (userId === state.me?.id) return;
    let map = state.typing.get(conversationId);
    if (!map) state.typing.set(conversationId, (map = new Map()));
    clearTimeout(map.get(userId));
    map.set(userId, setTimeout(() => clearTyping(conversationId, userId), 3500));
    if (state.currentId === conversationId) renderTyping();
    renderConvList();
  }
  function clearTyping(convId, userId) {
    const map = state.typing.get(convId);
    if (!map || !map.has(userId)) return;
    clearTimeout(map.get(userId));
    map.delete(userId);
    if (state.currentId === convId) renderTyping();
    renderConvList();
  }
  function renderTyping() {
    const el = $('#typing');
    const map = state.typing.get(state.currentId);
    const names = map ? [...map.keys()].map(nameOf) : [];
    if (!names.length) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} và ${names[1]}` : `${names[0]} và ${names.length - 1} người khác`;
    el.replaceChildren(h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: `${who} đang nhập…` }));
    el.hidden = false;
  }

  /* =========================================================
     Lưu trên máy người dùng (IndexedDB + bộ nhớ đệm ảnh)
     ========================================================= */
  const MEDIA_CACHE = 'think-media';
  const ME_KEY = 'think:me';
  const numFmt = new Intl.NumberFormat('vi-VN');
  const decFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
  const fmtNum = (n) => numFmt.format(n || 0);
  function fmtBytes(bytes) {
    const b = Math.max(0, Number(bytes) || 0);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${decFmt.format(b / 1024)} KB`;
    if (b < 1024 ** 3) return `${decFmt.format(b / 1024 ** 2)} MB`;
    return `${decFmt.format(b / 1024 ** 3)} GB`;
  }

  function saveLocal(list) {
    if (LocalDB.ready() && list && list.length) LocalDB.putMessages(list).catch(() => {});
  }

  // Ghi mốc đồng bộ lần đầu (sau đó chỉ cần hỏi máy chủ phần mới hơn mốc)
  async function markSynced(convId, data) {
    if (!LocalDB.ready()) return;
    try {
      if (await LocalDB.getMeta(`conv:${convId}`)) return;
      const top = data.messages.length ? data.messages[data.messages.length - 1].id : 0;
      await LocalDB.setMeta(`conv:${convId}`, { syncedTo: top, syncedAt: data.serverTime || 0 });
    } catch { /* bỏ qua */ }
  }

  // Chỉ cập nhật tin đang hiện trên màn hình (không chèn tin cũ lẻ tẻ vào giữa)
  function mergeUpdates(b, list) {
    const known = new Set(b.list.filter((m) => m.id).map((m) => m.id));
    const hit = list.filter((m) => known.has(m.id));
    if (hit.length) merge(b, hit);
    return hit.length;
  }

  // Đồng bộ một cuộc trò chuyện: tin mới sau mốc + tin cũ có thay đổi (thu hồi, cảm xúc, ảnh bị dọn)
  const syncing = new Map();
  function syncConv(convId) {
    if (!LocalDB.ready() || state.offline || !state.me) return Promise.resolve([]);
    if (syncing.has(convId)) return syncing.get(convId);
    const job = (async () => {
      const key = `conv:${convId}`;
      const meta = await LocalDB.getMeta(key);
      const fresh = [];
      const changed = [];
      if (!meta) {
        const data = await api(`/api/conversations/${convId}/messages?limit=50`);
        await LocalDB.putMessages(data.messages);
        fresh.push(...data.messages);
        const top = data.messages.length ? data.messages[data.messages.length - 1].id : 0;
        await LocalDB.setMeta(key, { syncedTo: top, syncedAt: data.serverTime || 0 });
        applyReads(convId, data.reads);
      } else {
        let after = meta.syncedTo || 0;
        let since = meta.syncedAt || 0;
        for (let page = 0; page < 200; page++) {
          const data = await api(`/api/conversations/${convId}/sync?after=${after}&since=${since}`);
          await LocalDB.putMessages([...data.messages, ...data.changed]);
          fresh.push(...data.messages);
          changed.push(...data.changed);
          after = data.nextAfter;
          since = data.nextSince;
          await LocalDB.setMeta(key, { syncedTo: after, syncedAt: since });
          if (!data.more) break;
        }
      }
      const b = state.msgs.get(convId);
      if (b && b.loaded && (fresh.length || changed.length)) {
        if (fresh.length) merge(b, fresh);
        mergeUpdates(b, changed);
        if (state.currentId === convId) renderMessages();
      }
      prefetchImages(fresh);
      return fresh;
    })().finally(() => syncing.delete(convId));
    syncing.set(convId, job);
    return job;
  }

  // Đồng bộ tất cả cuộc trò chuyện (khi mở app, khi có mạng lại), cái mới hoạt động trước
  let syncAllRunning = false;
  async function syncAll() {
    if (syncAllRunning || !LocalDB.ready()) return;
    syncAllRunning = true;
    try {
      const list = [...state.convs.values()].sort((a, b) => lastActivity(b) - lastActivity(a));
      for (const c of list) {
        if (!state.me || state.offline || !LocalDB.ready()) return;
        try {
          await syncConv(c.id);
        } catch (err) {
          if (!err || err.status === 0) return; // mất mạng: để lần sau
        }
      }
    } finally {
      syncAllRunning = false;
    }
  }

  // Tự tải ảnh mới về máy (bỏ qua khi bật tiết kiệm dữ liệu)
  const imageQueue = [];
  let imageBusy = false;
  function prefetchImages(list) {
    if (!LocalDB.autoImages() || !('caches' in window)) return;
    if (navigator.connection && navigator.connection.saveData) return;
    for (const m of list || []) {
      if (m.image && !m.deleted && !imageQueue.includes(m.image)) imageQueue.push(m.image);
    }
    imageQueue.splice(0, Math.max(0, imageQueue.length - 300));
    if (!imageBusy) runImageQueue();
  }
  async function runImageQueue() {
    imageBusy = true;
    try {
      const cache = await caches.open(MEDIA_CACHE);
      while (imageQueue.length && state.me && !state.offline && LocalDB.autoImages()) {
        const url = imageQueue.shift();
        if (await cache.match(url)) continue;
        try {
          const res = await fetch(url, { credentials: 'same-origin' });
          // Trang chưa được service worker quản lý thì tự cất vào bộ nhớ đệm
          if (res.ok && !navigator.serviceWorker?.controller) await cache.put(url, res);
        } catch {
          break;
        }
      }
    } catch { /* bỏ qua */ } finally {
      imageBusy = false;
    }
  }
  async function cacheOwnImage(url, blob) {
    if (!LocalDB.enabled() || !('caches' in window) || !blob) return;
    try {
      const cache = await caches.open(MEDIA_CACHE);
      await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
    } catch { /* bỏ qua */ }
  }

  // Ảnh chụp danh sách chat + danh bạ, để lần sau mở app xem được ngay kể cả khi máy chủ đang ngủ
  let snapshotTimer = null;
  function saveSnapshot() {
    if (!LocalDB.ready() || state.offline || !state.me) return;
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      if (!LocalDB.ready() || state.offline) return;
      const convs = [...state.convs.values()].map(({ reads, ...c }) => c);
      LocalDB.setMeta('convs', convs).catch(() => {});
      LocalDB.setMeta('users', [...state.users.values()]).catch(() => {});
    }, 800);
  }

  function cacheMe(user) {
    if (!user || !LocalDB.enabled()) return;
    const { id, username, displayName, avatar, role } = user;
    store.set(ME_KEY, JSON.stringify({ id, username, displayName, avatar, role }));
  }
  function forgetMe() {
    try { localStorage.removeItem(ME_KEY); } catch { /* bỏ qua */ }
  }
  function cachedMe() {
    try {
      const me = JSON.parse(store.get(ME_KEY) || 'null');
      return me && me.id ? me : null;
    } catch {
      return null;
    }
  }

  function setOfflineStatus(on) {
    const el = $('#conn-status');
    el.textContent = on
      ? 'Đang kết nối máy chủ… Bạn vẫn xem được tin nhắn đã lưu trên máy này.'
      : 'Đang kết nối lại… Nếu app vừa ngủ, máy chủ cần khoảng 1 phút để thức dậy.';
    el.hidden = !on;
  }

  // Mở app bằng dữ liệu trên máy trong lúc chờ máy chủ (Render Free ngủ cần ~1 phút để dậy)
  async function openOffline(me) {
    if (!(await LocalDB.open(me.id))) return false;
    let convs = null;
    let users = null;
    try {
      [convs, users] = await Promise.all([LocalDB.getMeta('convs'), LocalDB.getMeta('users')]);
    } catch { /* bỏ qua */ }
    if (!convs || !convs.length) return false;
    state.me = { ...me, mustChangePassword: false };
    state.users = new Map((users || []).map((u) => [u.id, { ...u, online: false }]));
    state.users.set(me.id, { ...(state.users.get(me.id) || {}), ...state.me });
    state.convs = new Map(convs.map((c) => [c.id, c]));
    state.offline = true;
    showScreen('view-main');
    renderMe();
    setOfflineStatus(true);
    renderConvList();
    updateBadge();
    route();
    return true;
  }

  /* ----- Mục "Lưu trên máy này" trong trang Cá nhân ----- */
  async function renderLocal() {
    const supported = LocalDB.supported();
    const on = LocalDB.enabled();
    $('#local-toggle').checked = on;
    $('#local-toggle').disabled = !supported;
    $('#local-images-toggle').checked = LocalDB.autoImages();
    $('#local-images-toggle').disabled = !on;
    $('#local-export').disabled = !on;
    $('#local-clear').hidden = !on;
    const stats = $('#local-stats');
    if (!supported) {
      stats.textContent = 'Trình duyệt này không hỗ trợ lưu dữ liệu trên máy.';
      return;
    }
    if (!on) {
      stats.textContent = 'Đang tắt. Tin nhắn chỉ nằm trên máy chủ.';
      return;
    }
    const [count, est] = await Promise.all([LocalDB.count().catch(() => 0), LocalDB.estimate()]);
    let text = `Đã lưu ${fmtNum(count)} tin nhắn`;
    if (est.usage != null) text += `, đang dùng ${fmtBytes(est.usage)} bộ nhớ máy`;
    text += '.';
    if (est.persisted === true) text += ' Trình duyệt sẽ giữ dữ liệu này, không tự xóa.';
    else if (est.persisted === false) text += ' Khi máy thiếu bộ nhớ, trình duyệt có thể tự xóa bớt.';
    stats.textContent = text;
  }

  $('#local-toggle').addEventListener('change', async (e) => {
    const on = e.target.checked;
    if (!on && !window.confirm('Tắt lưu trên máy sẽ xóa các tin nhắn và ảnh đã lưu trên máy này. Tin nào đã bị dọn khỏi máy chủ sẽ không xem lại được nữa. Tiếp tục?')) {
      e.target.checked = true;
      return;
    }
    await LocalDB.setEnabled(on, state.me && state.me.id);
    if (on) {
      cacheMe(state.me);
      LocalDB.persist();
      saveSnapshot();
      syncAll();
      toast('Đã bật lưu trên máy. Đang tải tin nhắn về máy…');
    } else {
      forgetMe();
      toast('Đã tắt lưu trên máy và xóa dữ liệu đã lưu.');
    }
    renderLocal();
  });

  $('#local-images-toggle').addEventListener('change', (e) => {
    LocalDB.setAutoImages(e.target.checked);
    if (e.target.checked) {
      for (const b of state.msgs.values()) prefetchImages(b.list);
    }
  });

  $('#local-clear').addEventListener('click', async (e) => {
    if (!window.confirm('Xóa toàn bộ tin nhắn và ảnh đã lưu trên máy này? Tin nào đã bị dọn khỏi máy chủ sẽ không xem lại được nữa.')) return;
    const btn = e.currentTarget;
    await withBusy(btn, async () => {
      await LocalDB.clear(state.me.id);
      await LocalDB.open(state.me.id);
      await LocalDB.syncMediaFlag();
      for (const b of state.msgs.values()) b.localTried = true;
      saveSnapshot();
      toast('Đã xóa dữ liệu lưu trên máy.');
    });
    renderLocal();
  });

  // Tải toàn bộ lịch sử đã lưu thành một file .html đọc được bằng trình duyệt
  $('#local-export').addEventListener('click', (e) => {
    withBusy(e.currentTarget, async () => {
      try {
        const all = LocalDB.ready() ? await LocalDB.allMessages() : [];
        if (!all.length) {
          toast('Chưa có tin nhắn nào được lưu trên máy này.');
          return;
        }
        const name = `think-lich-su-${new Date().toISOString().slice(0, 10)}.html`;
        const blob = new Blob([buildExport(all)], { type: 'text/html;charset=utf-8' });
        const a = h('a', { href: URL.createObjectURL(blob), download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast(`Đã tải ${fmtNum(all.length)} tin nhắn về máy (file ${name}).`);
      } catch {
        toast('Không tạo được file lịch sử chat.');
      }
    });
  });

  function buildExport(all) {
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const groups = new Map();
    for (const m of all) {
      if (!groups.has(m.conversationId)) groups.set(m.conversationId, []);
      groups.get(m.conversationId).push(m);
    }
    const convName = (id) => {
      const c = state.convs.get(id);
      return c ? convTitle(c) : 'Cuộc trò chuyện đã rời';
    };
    const order = [...groups.keys()].sort((a, b) => {
      const la = groups.get(a).reduce((x, m) => Math.max(x, m.createdAt), 0);
      const lb = groups.get(b).reduce((x, m) => Math.max(x, m.createdAt), 0);
      return lb - la;
    });
    const sections = order.map((id) => {
      const msgs = groups.get(id).sort((a, b) => a.id - b.id);
      let day = '';
      const rows = msgs.map((m) => {
        let out = '';
        const d = dayKey(m.createdAt);
        if (d !== day) {
          day = d;
          out += `<p class="day">${esc(dayLabel(m.createdAt))}</p>`;
        }
        if (m.kind === 'system') return `${out}<p class="m s">${esc(hm(m.createdAt))} ${esc(systemText(m))}</p>`;
        let body;
        if (m.deleted) body = '<em>Tin nhắn đã được thu hồi</em>';
        else {
          const parts = [];
          if (m.replyTo) {
            const r = m.replyTo;
            const who = r.senderId == null ? 'tin cũ' : r.senderId === state.me.id ? 'Bạn' : nameOf(r.senderId);
            const t = r.deleted ? 'Tin nhắn đã được thu hồi' : r.missing ? 'tin nhắn cũ' : r.text || (r.image ? '[Ảnh]' : '');
            parts.push(`<span class="q">Trả lời ${esc(who)}: ${esc(t)}</span>`);
          }
          if (m.image || m.imagePurged) parts.push('<span class="img">[Ảnh]</span>');
          if (m.text) parts.push(esc(m.text).replace(/\n/g, '<br>'));
          body = parts.join(' ');
        }
        const who = m.senderId === state.me.id ? 'Bạn' : nameOf(m.senderId);
        return `${out}<p class="m"><span class="t">${esc(hm(m.createdAt))}</span><span class="n">${esc(who)}</span>${body}</p>`;
      }).join('\n');
      return `<section><h2>${esc(convName(id))}</h2>\n${rows}\n</section>`;
    }).join('\n');
    const when = new Date().toLocaleString('vi-VN');
    return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lịch sử chat ${esc(state.appName)}</title>
<style>
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:720px;margin:0 auto;padding:28px 16px 48px;color:#14201c;background:#fff}
h1{font-size:26px;margin:0 0 6px}.sub{color:#62716b;margin:0 0 28px}
section{margin:32px 0}h2{font-size:19px;margin:0 0 8px;padding-bottom:6px;border-bottom:2px solid #0e7c66}
.day{color:#62716b;font-size:13px;font-weight:600;margin:18px 0 6px}.m{margin:4px 0;overflow-wrap:anywhere}
.t{color:#62716b;font-size:12.5px;margin-right:8px}.n{font-weight:600;margin-right:8px}
.q{display:block;color:#62716b;font-size:13.5px;border-left:3px solid #c9d3cf;padding-left:8px;margin:2px 0}
.s{color:#62716b;font-style:italic}.img{color:#0e7c66}
</style></head><body>
<h1>Lịch sử chat ${esc(state.appName)}</h1>
<p class="sub">Tài khoản ${esc(state.me.displayName)} (@${esc(state.me.username)}). Xuất lúc ${esc(when)}, gồm ${fmtNum(all.length)} tin nhắn đã lưu trên máy. Ảnh không nằm trong file này: mở ảnh trong app rồi bấm nút tải để lưu ảnh.</p>
${sections}
</body></html>`;
  }

  // Tải một ảnh về máy (iPhone: mở bảng chia sẻ để lưu vào Ảnh)
  async function downloadImage(src) {
    if (NATIVE && NATIVE.download) {
      NATIVE.download(new URL(src, location.href).href);
      toast('Đang tải ảnh về máy…');
      return;
    }
    try {
      const res = await fetch(src, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('http');
      const blob = await res.blob();
      const ext = ((blob.type || 'image/jpeg').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const name = `think-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
      if (isIOS() && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => {});
        return;
      }
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('Đã tải ảnh về máy.');
    } catch {
      toast('Không tải được ảnh này.');
    }
  }

  /* =========================================================
     Realtime (Socket.IO)
     ========================================================= */
  function connectSocket() {
    if (typeof window.io !== 'function') {
      toast('Không tải được phần kết nối realtime. Hãy tải lại trang.');
      return;
    }
    const socket = window.io();
    state.socket = socket;
    const showOffline = () => setTimeout(() => {
      if (state.socket === socket && !socket.connected) $('#conn-status').hidden = false;
    }, 2500);
    socket.on('connect', () => {
      $('#conn-status').hidden = true;
      reportVisibility();
      if (state.everConnected) {
        resync();
        if (chess) chess.reload();
        if (caro) caro.reload();
        if (streaks) streaks.load();
        if (puzzles) puzzles.load(); // gửi kết quả câu đố giải lúc mất mạng
      }
      state.everConnected = true;
    });
    socket.on('disconnect', (reason) => { if (reason !== 'io client disconnect') showOffline(); });
    socket.on('connect_error', (err) => {
      if (err && err.message === 'unauthorized') sessionEnded('Phiên đăng nhập đã hết. Hãy đăng nhập lại.');
      else if (err && err.message === 'must_change_password') showForce();
      else showOffline();
    });
    socket.on('message:new', onMessageNew);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('message:reactions', onReactions);
    socket.on('message:updated', onMessageUpdated);
    socket.on('conversation:pins', onPins);
    socket.on('conversation:appearance', onAppearance);
    socket.on('conversation:prefs', onConvPrefs);
    socket.on('conversation:changed', onConvChanged);
    socket.on('read', onRead);
    socket.on('typing', onTyping);
    socket.on('presence', onPresence);
    socket.on('user:updated', onUserUpdated);
    if (social) {
      for (const ev of ['post:new', 'post:likes', 'post:comment', 'post:comment-deleted', 'post:deleted']) {
        socket.on(ev, (data) => social.onEvent(ev, data));
      }
    }
    socket.on('session:ended', (data) => sessionEnded((data && data.reason) || 'Bạn đã bị đăng xuất.'));
    if (chess) {
      socket.on('chess:game', (data) => chess.onEvent('chess:game', data));
      socket.on('chess:challenge', (data) => chess.onEvent('chess:challenge', data));
      socket.on('chess:analysis', (data) => chess.onAnalysis(data));
    }
    if (caro) {
      socket.on('caro:game', (data) => caro.onEvent('caro:game', data));
      socket.on('caro:challenge', (data) => caro.onEvent('caro:challenge', data));
    }
    if (games) socket.on('games:score', (data) => games.onScore(data));
    if (games) socket.on('farm:event', (data) => games.onFarmEvent(data));
    if (streaks) socket.on('streak:update', (data) => streaks.onUpdate(data));
    if (puzzles) socket.on('puzzle:daily', (data) => puzzles.onDaily(data));
    socket.on('admin:errors', () => {
      if (state.tab === 'admin' && state.adminSeg === 'errors') loadErrors();
      else $('#errors-badge').hidden = false;
    });
    socket.on('storage:changed', (result) => {
      if (state.tab === 'admin') loadStorage();
      if (result && result.auto) toast(`Máy chủ sắp đầy nên đã tự dọn ${fmtNum(result.images)} ảnh và ${fmtNum(result.messages)} tin nhắn cũ nhất.`);
    });
  }

  async function onMessageNew(msg) {
    let fresh = false;
    if (!state.convs.has(msg.conversationId)) {
      try {
        await fetchConv(msg.conversationId);
        fresh = true; // số tin chưa đọc lấy từ máy chủ đã tính tin này
      } catch {
        return;
      }
    }
    const c = state.convs.get(msg.conversationId);
    const mine = msg.senderId === state.me.id;
    const wasNear = isNearBottom();
    receive(msg);
    clearTyping(msg.conversationId, msg.senderId);
    if (!mine && msg.kind !== 'system') {
      const here = state.currentId === msg.conversationId && document.visibilityState === 'visible';
      if (here && document.hasFocus() && wasNear) {
        markRead(msg.conversationId);
      } else {
        if (!fresh) c.unread = (c.unread || 0) + 1;
        if (here && document.hasFocus()) $('#jump-btn').hidden = false;
        else alertIncoming(msg, c);
      }
    }
    if (state.currentId === msg.conversationId) renderMessages();
    renderConvList();
    updateBadge();
  }

  function alertIncoming(msg, c) {
    if (document.visibilityState !== 'visible') return; // app đang ẩn: máy chủ gửi thông báo đẩy
    if (isMuted(c) && !(msg.mentions || []).includes(state.me.id)) return; // đã tắt thông báo
    playSound();
    if (document.hasFocus()) showMessageToast(msg, c);
    else localNotify(msg, c); // cửa sổ đang mở nhưng bạn đang làm việc khác
  }

  function showMessageToast(msg, c) {
    const el = h('button', {
      class: 'toast toast-msg',
      type: 'button',
      onclick: () => {
        el.remove();
        navigate(`#/c/${c.id}`, { replace: state.currentId != null });
      },
    },
    avatarEl(userOf(msg.senderId), 'avatar-sm', { dot: false }),
    h('span', { class: 'toast-text' }, h('strong', { text: convTitle(c) }), h('span', { text: previewText(msg, c) })));
    pushToast(el, 4500);
  }

  function localNotify(msg, c) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!worker) return;
    worker.postMessage({
      type: 'notify',
      payload: {
        type: 'message',
        conversationId: c.id,
        isGroup: c.type !== 'dm',
        convTitle: convTitle(c),
        senderName: nameOf(msg.senderId),
        text: msg.image && !msg.text ? '📷 Đã gửi một ảnh' : messageSummary(msg),
        icon: userOf(msg.senderId)?.avatar || '/icons/icon-192.png',
        url: `/#/c/${c.id}`,
        createdAt: msg.createdAt,
      },
    });
  }

  function onMessageDeleted({ conversationId, messageId }) {
    const m = state.msgs.get(conversationId)?.list.find((item) => item.id === messageId);
    if (m) Object.assign(m, { deleted: true, text: null, image: null, localUrl: null });
    LocalDB.patchMessage(messageId, { deleted: true, text: null, image: null, reactions: [] }).catch(() => {}); // tôn trọng thu hồi
    const c = state.convs.get(conversationId);
    if (c && c.lastMessage && c.lastMessage.id === messageId) {
      c.lastMessage = { ...c.lastMessage, deleted: true, text: null, image: null, localUrl: null };
    }
    if (state.currentId === conversationId) renderMessages();
    renderConvList();
  }

  function onRead({ conversationId, userId, lastReadId }) {
    const c = state.convs.get(conversationId);
    if (!c) return;
    if (userId === state.me.id) {
      // Bạn vừa đọc trên thiết bị khác
      if (lastReadId > (c.lastReadId || 0)) {
        c.lastReadId = lastReadId;
        if (!c.lastMessage || !c.lastMessage.id || lastReadId >= c.lastMessage.id) {
          c.unread = 0;
          clearNotifications(conversationId);
        }
        renderConvList();
        updateBadge();
      }
    } else {
      if (c.reads) c.reads.set(userId, Math.max(c.reads.get(userId) || 0, lastReadId));
      if (c.type === 'dm' && userId === c.peerId) c.peerLastReadId = Math.max(c.peerLastReadId || 0, lastReadId);
      if (state.currentId === conversationId) renderMessages();
    }
  }

  // Nhóm vừa đổi (tạo, đổi tên, thêm/xóa người): tải lại; nếu mình không còn trong nhóm thì bỏ khỏi danh sách
  async function onConvChanged({ conversationId, addedBy, added, removed }) {
    try {
      if (Array.isArray(removed) && removed.includes(state.me.id)) {
        throw Object.assign(new Error('removed'), { status: 404 }); // mình vừa rời hoặc bị xóa khỏi nhóm
      }
      const c = await fetchConv(conversationId);
      if (Array.isArray(added) && added.includes(state.me.id) && addedBy !== state.me.id) {
        toast(`${nameOf(addedBy)} đã thêm bạn vào nhóm “${c.name}”.`);
      }
    } catch (err) {
      if (err.status !== 404) return;
      state.convs.delete(conversationId);
      state.msgs.delete(conversationId);
      state.replying.delete(conversationId);
      LocalDB.deleteConversation(conversationId).catch(() => {});
      if (state.currentId === conversationId) {
        toast('Bạn không còn ở trong nhóm này.');
        navigate('#/', { replace: true });
      }
    }
    renderConvList();
    updateBadge();
    if (state.currentId === conversationId) {
      renderChatHeader();
      renderMessages();
    }
    if (currentSheet === 'group') renderGroupInfo();
  }

  function onPresence({ userId, online, lastSeen }) {
    const u = state.users.get(userId);
    if (!u) return;
    u.online = online;
    if (lastSeen) u.lastSeen = lastSeen;
    renderConvList();
    renderChatHeader();
    if (currentSheet === 'new') renderPeople();
  }

  function onUserUpdated(u) {
    state.users.set(u.id, { ...(state.users.get(u.id) || {}), ...u });
    if (state.me && u.id === state.me.id) {
      Object.assign(state.me, u);
      cacheMe(state.me);
      renderMe();
      if (state.tab === 'me') renderSettingsProfile();
      if (state.me.role !== 'admin' && state.tab === 'admin') navigate('#/', { replace: true });
    }
    renderConvList();
    renderChatHeader();
    if (state.currentId != null) renderMessages();
    if (currentSheet === 'new') renderPeople();
    if (state.tab === 'admin') loadAdminUsers();
    if (currentSheet === 'group') renderGroupInfo();
    if (currentSheet === 'new-group') renderNewGroup();
    if (social) social.onUser(u);
  }

  async function loadUsers() {
    const { users } = await api('/api/users');
    state.users = new Map(users.map((u) => [u.id, u]));
  }
  async function loadConvs() {
    const { conversations } = await api('/api/conversations');
    const prev = state.convs;
    state.convs = new Map(conversations.map((c) => {
      if (prev.get(c.id)?.reads) c.reads = prev.get(c.id).reads;
      return [c.id, c];
    }));
    // Cuộc trò chuyện mình không còn tham gia: xóa bản lưu trên máy
    if (LocalDB.ready()) {
      LocalDB.getMeta('convs').then((saved) => {
        for (const c of saved || []) if (!state.convs.has(c.id)) LocalDB.deleteConversation(c.id).catch(() => {});
      }).catch(() => {});
    }
    renderConvList();
    updateBadge();
  }

  // Sau khi mất mạng rồi có lại: tải lại để không sót tin
  async function resync() {
    try {
      await Promise.all([loadUsers(), loadConvs()]);
      for (const id of [...state.msgs.keys()]) if (id !== state.currentId) state.msgs.delete(id);
      if (state.currentId != null) {
        if (!state.convs.has(state.currentId)) {
          navigate('#/', { replace: true });
          return;
        }
        renderChatHeader();
        await loadMessages(state.currentId);
        if (document.visibilityState === 'visible' && isNearBottom()) markRead(state.currentId);
      }
      renderBanner();
      syncAll();
    } catch {
      /* thử lại ở lần kết nối sau */
    }
  }

  /* =========================================================
     Đã đọc, số tin chưa đọc, âm báo
     ========================================================= */
  function reportVisibility() {
    if (state.socket && state.socket.connected) state.socket.emit('visibility', { visible: document.visibilityState === 'visible' });
  }

  const readTimers = new Map();
  function markRead(convId) {
    const c = state.convs.get(convId);
    if (!c || document.visibilityState !== 'visible') return;
    const lastId = c.lastMessage?.id || 0;
    if (!c.unread && (c.lastReadId || 0) >= lastId) return;
    c.unread = 0;
    c.lastReadId = Math.max(c.lastReadId || 0, lastId);
    renderConvList();
    updateBadge();
    clearNotifications(convId);
    clearTimeout(readTimers.get(convId));
    readTimers.set(convId, setTimeout(() => {
      api(`/api/conversations/${convId}/read`, { method: 'POST', body: { messageId: c.lastReadId } }).catch(() => {});
    }, 250));
  }

  document.addEventListener('visibilitychange', () => {
    reportVisibility();
    if (document.visibilityState !== 'visible' || !state.me) return;
    if (state.currentId != null && isNearBottom()) markRead(state.currentId);
    updateBadge();
    if (state.socket && !state.socket.connected) state.socket.connect();
  });
  window.addEventListener('focus', () => {
    reportVisibility();
    if (state.me && state.currentId != null && isNearBottom()) markRead(state.currentId);
  });
  window.addEventListener('pagehide', () => {
    if (state.socket && state.socket.connected) state.socket.emit('visibility', { visible: false });
  });
  setInterval(() => { if (document.visibilityState === 'visible') reportVisibility(); }, 25000);
  setInterval(() => {
    if (!state.me || document.visibilityState !== 'visible') return;
    renderConvList();
    renderChatHeader();
  }, 60000);

  function updateBadge() {
    const total = [...state.convs.values()].reduce((sum, c) => sum + (isMuted(c) ? 0 : c.unread || 0), 0);
    document.title = total ? `(${total}) ${state.appName}` : state.appName;
    const badge = $('#tab-badge');
    badge.hidden = !total;
    badge.textContent = total > 99 ? '99+' : String(total);
    $('.tab[data-tab="chats"]').setAttribute('aria-label', total ? `Tin nhắn, ${total} tin chưa đọc` : 'Tin nhắn');
    if ('setAppBadge' in navigator) {
      const p = total ? navigator.setAppBadge(total) : navigator.clearAppBadge();
      if (p && p.catch) p.catch(() => {});
    }
  }

  async function clearNotifications(convId) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg || !reg.getNotifications) return;
      const list = await reg.getNotifications({ tag: `conv-${convId}` });
      list.forEach((n) => n.close());
    } catch {
      /* trình duyệt không hỗ trợ */
    }
  }

  let audioCtx = null;
  let lastSoundAt = 0;
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch {
      /* máy không hỗ trợ âm thanh */
    }
  }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  document.addEventListener('keydown', unlockAudio);
  function playSound(force = false) {
    if ((!state.sound && !force) || !audioCtx || audioCtx.state !== 'running') return;
    const now = Date.now();
    if (!force && now - lastSoundAt < 900) return;
    lastSoundAt = now;
    const t = audioCtx.currentTime;
    for (const [freq, delay] of [[740, 0], [1110, 0.1]]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.16, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.25);
    }
  }

  /* =========================================================
     Thông báo đẩy (Web Push)
     ========================================================= */
  function b64ToBytes(b64) {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  }
  function sameKey(sub, key) {
    try {
      const a = new Uint8Array(sub.options.applicationServerKey);
      const b = b64ToBytes(key);
      return a.length === b.length && a.every((v, i) => v === b[i]);
    } catch {
      return true;
    }
  }
  function pushSupport() {
    if (!window.isSecureContext) return 'insecure';
    if (isIOS() && !isStandalone()) return 'ios-browser';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return 'ok';
  }
  const PUSH_TEXT = {
    insecure: 'Thông báo chỉ hoạt động khi mở app bằng địa chỉ https:// (hoặc localhost).',
    'ios-browser': 'Trên iPhone/iPad: mở trang này bằng Safari, bấm nút Chia sẻ, chọn "Thêm vào MH chính", rồi mở app từ màn hình chính để bật thông báo.',
    unsupported: 'Trình duyệt này chưa hỗ trợ thông báo đẩy. Hãy dùng Chrome, Edge, Firefox hoặc Safari bản mới.',
    denied: 'Bạn đã chặn thông báo của trang này. Mở cài đặt trang web trong trình duyệt, cho phép Thông báo, rồi tải lại app.',
  };
  function swReady() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 8000))]);
  }
  async function currentSubscription() {
    try {
      const reg = await swReady();
      return reg ? await reg.pushManager.getSubscription() : null;
    } catch {
      return null;
    }
  }

  async function enablePush({ silent = false } = {}) {
    const support = pushSupport();
    if (support !== 'ok') {
      if (!silent) toast(PUSH_TEXT[support]);
      return false;
    }
    try {
      let permission = Notification.permission;
      if (permission === 'default') {
        if (silent) return false;
        permission = await Notification.requestPermission(); // phải gọi ngay khi bấm nút
      }
      if (permission !== 'granted') {
        if (!silent) toast('Bạn chưa cho phép thông báo. Có thể bật lại trong cài đặt trình duyệt.');
        return false;
      }
      if (!state.vapidKey) throw new Error('Máy chủ chưa có khóa thông báo. Tải lại trang rồi thử lại.');
      const reg = await swReady();
      if (!reg) throw new Error('App chưa sẵn sàng nhận thông báo. Tải lại trang rồi thử lại.');
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, state.vapidKey)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(state.vapidKey) });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      store.set('push', 'on');
      if (!silent) toast('Đã bật thông báo trên thiết bị này.');
      return true;
    } catch (err) {
      if (!silent) {
        toast(err instanceof ApiError || err.name === 'Error'
          ? err.message
          : `Trình duyệt chưa đăng ký được thông báo (${err.message || err.name}). Thử lại sau.`);
      }
      return false;
    } finally {
      renderBanner();
      if (state.tab === 'me') renderNotify();
    }
  }

  async function disablePush() {
    try {
      const sub = await currentSubscription();
      if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } finally {
      store.set('push', 'off');
      renderBanner();
      renderNotify();
      toast('Đã tắt thông báo trên thiết bị này.');
    }
  }

  // Mỗi lần mở app: nếu đã cho phép thông báo thì báo lại cho máy chủ (phiên đăng nhập có thể đã đổi)
  function syncPush() {
    if (store.get('push') === 'off' || pushSupport() !== 'ok' || Notification.permission !== 'granted') return;
    enablePush({ silent: true });
  }

  async function renderNotify() {
    const status = $('#notify-status');
    const toggle = $('#notify-toggle');
    const test = $('#notify-test');
    const support = pushSupport();
    if (support !== 'ok') {
      state.pushOn = false;
      status.textContent = PUSH_TEXT[support];
      toggle.hidden = true;
      test.hidden = true;
      return;
    }
    const sub = Notification.permission === 'granted' ? await currentSubscription() : null;
    const on = Boolean(sub) && store.get('push') !== 'off';
    state.pushOn = on;
    status.textContent = on
      ? 'Đang bật trên thiết bị này. Có tin nhắn mới là bạn biết, kể cả khi đã đóng app.'
      : 'Đang tắt trên thiết bị này.';
    toggle.hidden = false;
    toggle.textContent = on ? 'Tắt thông báo' : 'Bật thông báo';
    toggle.classList.toggle('btn-primary', !on);
    test.hidden = !on;
  }
  $('#notify-toggle').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    withBusy(btn, () => (state.pushOn ? disablePush() : enablePush()));
  });
  $('#notify-test').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    withBusy(btn, async () => {
      try {
        const { sent } = await api('/api/push/test', { method: 'POST', body: {} });
        toast(`Đã gửi thử tới ${sent} thiết bị. Kiểm tra thanh thông báo.`);
      } catch (err) {
        toast(err.message);
      }
    });
  });

  /* ----- Dải nhắc ở đầu danh sách ----- */
  function renderBanner() {
    const host = $('#banner');
    host.replaceChildren();
    if (!state.me) return;
    const dismissed = (key) => Number(store.get(`dismiss:${key}`) || 0) > Date.now();
    const dismiss = (key) => {
      store.set(`dismiss:${key}`, String(Date.now() + 7 * 864e5));
      renderBanner();
    };
    const make = (key, text, actionLabel, action) => h('div', { class: 'banner', role: 'note' },
      h('p', { text }),
      h('div', { class: 'banner-actions' },
        actionLabel ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: actionLabel, onclick: action }) : null,
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', text: 'Để sau', onclick: () => dismiss(key) })));
    const support = pushSupport();
    let banner = null;
    if (support === 'insecure' && !dismissed('insecure')) {
      banner = make('insecure', 'Trang đang mở bằng http nên chưa cài app và nhận thông báo được. Hãy mở bằng địa chỉ https://.');
    } else if (support === 'ios-browser' && !dismissed('ios')) {
      banner = make('ios', 'Trên iPhone: bấm nút Chia sẻ của Safari, chọn "Thêm vào MH chính", rồi mở app từ màn hình chính để nhận thông báo.');
    } else if (support === 'ok' && Notification.permission === 'default' && store.get('push') !== 'off' && !dismissed('push')) {
      banner = make('push', 'Bật thông báo để biết ngay khi có tin nhắn mới, kể cả lúc đã đóng app.', 'Bật thông báo', () => enablePush());
    } else if (state.installEvent && !isStandalone() && !dismissed('install')) {
      banner = make('install', `Cài ${state.appName} lên máy để mở nhanh như một app.`, 'Cài app', promptInstall);
    }
    if (banner) host.append(banner);
  }

  /* ----- Cài app (PWA) ----- */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installEvent = e;
    renderBanner();
    if (state.tab === 'me') renderInstall();
  });
  window.addEventListener('appinstalled', () => {
    state.installEvent = null;
    renderBanner();
    if (state.tab === 'me') renderInstall();
    toast('Đã cài app lên máy.');
  });
  async function promptInstall() {
    const e = state.installEvent;
    if (!e) return;
    state.installEvent = null;
    e.prompt();
    try { await e.userChoice; } catch { /* bỏ qua */ }
    renderBanner();
    if (state.tab === 'me') renderInstall();
  }
  function renderInstall() {
    const hint = $('#install-hint');
    const apk = $('#apk-link');
    apk.hidden = true;
    $('#install-btn').hidden = !state.installEvent;
    if (inAndroidApp()) {
      $('#install-btn').hidden = true;
      hint.textContent = `Bạn đang dùng app Think cho Android (bản ${store.get('android-app')}).`;
      checkAppUpdate();
      return;
    }
    if (isAndroid() && !IN_BUBBLE && !NATIVE) {
      $('#install-btn').hidden = true;
      apk.hidden = false;
      apk.textContent = '';
      apk.append(icon('download'), 'Tải app Android');
      hint.textContent = 'App Think cho Android: tin nhắn hiện thành bong bóng chat như Messenger, trả lời được ngay trong thông báo. Tải về, mở file để cài (nếu máy hỏi thì cho phép cài app từ Chrome).';
      return;
    }
    if (isStandalone()) hint.textContent = 'Bạn đang dùng bản đã cài trên máy.';
    else if (state.installEvent) hint.textContent = 'Cài để mở nhanh từ màn hình chính và nhận thông báo như app thường.';
    else if (isIOS()) hint.textContent = 'Trong Safari, bấm nút Chia sẻ rồi chọn "Thêm vào MH chính".';
    else hint.textContent = 'Mở menu của trình duyệt (nút ⋮) và chọn "Cài đặt ứng dụng" hoặc "Thêm vào màn hình chính".';
  }
  $('#install-btn').addEventListener('click', promptInstall);

  // Bản app Android mới nhất nằm ở /download/version.json (đi kèm file think.apk)
  let latestApp = null;
  async function checkAppUpdate() {
    try {
      if (!latestApp) latestApp = await (await fetch('/download/version.json', { cache: 'no-store' })).json();
    } catch {
      return;
    }
    const mine = Number(store.get('android-app') || 0);
    if (!latestApp || !(Number(latestApp.versionCode) > mine) || !inAndroidApp()) return;
    const apk = $('#apk-link');
    apk.hidden = false;
    apk.textContent = '';
    apk.append(icon('download'), `Cập nhật lên bản ${latestApp.versionName}`);
    $('#install-hint').textContent = `Đã có app Think bản ${latestApp.versionName}. ${latestApp.notes || ''} Tải về rồi mở file để cài đè, không mất dữ liệu.`.trim();
  }

  /* ----- Bong bóng chat (app Android) ----- */
  // Bấm nút thì web mở app kèm một mã dùng một lần, app dùng mã đó để tự đăng nhập cho bong bóng
  // và ô Trả lời nhanh (hai phần này không dùng chung đăng nhập với Chrome).
  // Mã được lấy sẵn trước khi bấm, vì Chrome chỉ cho mở app ngay trong lúc người dùng bấm.
  let bubbleTimer = null;
  async function renderBubblePanel() {
    const panel = $('#bubble-panel');
    clearTimeout(bubbleTimer);
    panel.hidden = !inAndroidApp();
    if (panel.hidden || !state.me) return;
    const link = $('#bubble-link');
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    try {
      const { code } = await api('/api/app/link', { method: 'POST', body: {} });
      const fallback = `${location.origin}/download/think.apk`;
      link.href = `intent://link?code=${encodeURIComponent(code)}#Intent;scheme=thinkchat;package=com.nuwngc.think;`
        + `S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
      link.removeAttribute('aria-disabled');
    } catch (err) {
      $('#bubble-status').textContent = err.message;
    }
    // Mã chỉ dùng được 2 phút: đổi mã mới trước khi hết hạn
    bubbleTimer = setTimeout(() => { if (state.tab === 'me') renderBubblePanel(); }, 90_000);
  }
  $('#bubble-link').addEventListener('click', (e) => {
    if (e.currentTarget.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      toast('Đang chuẩn bị, bấm lại sau một giây nhé.');
      return;
    }
    // Mã đã dùng: lấy mã mới cho lần bấm sau
    setTimeout(() => { if (state.tab === 'me') renderBubblePanel(); }, 1500);
  });

  /* =========================================================
     Tài khoản của tôi
     ========================================================= */
  function renderMe() {
    if (!state.me) return;
    fillAvatar($('#tab-avatar'), state.me, { dot: false });
    $('#tab-admin').hidden = state.me.role !== 'admin';
  }
  function applyMe(user) {
    Object.assign(state.me, user);
    state.users.set(user.id, { ...(state.users.get(user.id) || {}), ...user });
    renderMe();
    renderSettingsProfile();
    if (social) social.onUser(state.users.get(user.id));
    renderConvList();
    renderChatHeader();
    if (state.currentId != null) renderMessages();
  }
  function renderSettingsProfile() {
    if (!state.me) return;
    fillAvatar($('#settings-avatar'), state.me, { dot: false });
    $('#me-name').replaceChildren(
      h('span', { text: state.me.displayName }),
      ...(state.me.role === 'admin' ? [h('span', { class: 'tag tag-admin', text: 'Admin' })] : []));
    $('#settings-username').textContent = `Tên đăng nhập: ${state.me.username}`;
    $('#remove-avatar').hidden = !state.me.avatar;
    const cover = $('#cover-preview');
    cover.style.backgroundImage = state.me.cover ? `url("${state.me.cover}")` : '';
    cover.classList.toggle('is-empty', !state.me.cover);
    $('#remove-cover').hidden = !state.me.cover;
  }
  function renderSettings() {
    renderSettingsProfile();
    renderLocal();
    $('#name-form').elements.displayName.value = state.me.displayName;
    $('#name-form').elements.bio.value = state.me.bio || '';
    const theme = window.ThinkTheme ? window.ThinkTheme.get() : 'system';
    for (const r of $$('input[name="theme"]')) r.checked = r.value === theme;
    const pw = $('#password-form');
    pw.reset();
    pw.elements.username.value = state.me.username;
    setFormError(pw, '');
    $('#sound-toggle').checked = state.sound;
    renderNotify();
    renderInstall();
    renderBubblePanel();
  }

  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = form.elements.displayName.value.trim();
    const bio = form.elements.bio.value.replace(/\s+/g, ' ').trim();
    if (!name) {
      toast('Tên hiển thị không được để trống.');
      return;
    }
    if (name === state.me.displayName && bio === (state.me.bio || '')) {
      toast('Chưa có gì thay đổi.');
      return;
    }
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const { user } = await api('/api/me', { method: 'PATCH', body: { displayName: name, bio } });
        applyMe(user);
        toast('Đã lưu tên và lời giới thiệu.');
      } catch (err) {
        toast(err.message);
      }
    });
  });

  $('#password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const { currentPassword, newPassword, confirm } = form.elements;
    if (!currentPassword.value) return setFormError(form, 'Nhập mật khẩu hiện tại.');
    if (newPassword.value.length < 6) return setFormError(form, 'Mật khẩu mới cần ít nhất 6 ký tự.');
    if (newPassword.value !== confirm.value) return setFormError(form, 'Hai lần nhập mật khẩu mới chưa khớp.');
    return withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        await api('/api/me/password', { method: 'POST', body: { currentPassword: currentPassword.value, newPassword: newPassword.value } });
        form.reset();
        form.elements.username.value = state.me.username;
        setFormError(form, '');
        toast('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  });

  $('#avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.type && !/^image\//.test(file.type)) {
      toast('Hãy chọn một file ảnh.');
      return;
    }
    const wrap = $('.avatar-edit');
    wrap.classList.add('busy');
    try {
      const { blob } = await prepareImage(file, { max: 320, square: true, quality: 0.88 });
      const { user } = await api('/api/me/avatar', { method: 'POST', raw: blob });
      applyMe(user);
      toast('Đã đổi ảnh đại diện.');
    } catch (err) {
      toast(err.message || 'Không đổi được ảnh đại diện.');
    } finally {
      wrap.classList.remove('busy');
    }
  });

  // Ảnh bìa: thu nhỏ còn tối đa 1500px trước khi gửi
  $('#cover-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.type && !/^image\//.test(file.type)) {
      toast('Hãy chọn một file ảnh.');
      return;
    }
    for (const el of $$('.cover-preview, .profile-cover')) el.classList.add('busy');
    try {
      const { blob } = await prepareImage(file, { max: 1500, quality: 0.85 });
      const { user } = await api('/api/me/cover', { method: 'POST', raw: blob });
      applyMe(user);
      toast('Đã đổi ảnh bìa.');
    } catch (err) {
      toast(err.message || 'Không đổi được ảnh bìa.');
    } finally {
      for (const el of $$('.cover-preview, .profile-cover')) el.classList.remove('busy');
    }
  });

  async function removeCover() {
    if (!window.confirm('Gỡ ảnh bìa hiện tại?')) return;
    try {
      const { user } = await api('/api/me/cover', { method: 'DELETE' });
      applyMe(user);
      toast('Đã gỡ ảnh bìa.');
    } catch (err) {
      toast(err.message);
    }
  }

  // Giao diện sáng / tối (public/theme.js)
  for (const r of $$('input[name="theme"]')) {
    r.addEventListener('change', () => {
      if (r.checked && window.ThinkTheme) window.ThinkTheme.set(r.value);
    });
  }

  async function openDmWith(userId) {
    try {
      const { conversation } = await api('/api/conversations/dm', { method: 'POST', body: { userId } });
      state.convs.set(conversation.id, conversation);
      navigate(`#/c/${conversation.id}`);
    } catch (err) {
      toast(err.message);
    }
  }

  async function removeAvatar() {
    if (!window.confirm('Gỡ ảnh đại diện hiện tại?')) return;
    try {
      const { user } = await api('/api/me/avatar', { method: 'DELETE' });
      applyMe(user);
      toast('Đã gỡ ảnh đại diện.');
    } catch (err) {
      toast(err.message);
    }
  }

  $('#sound-toggle').addEventListener('change', (e) => {
    state.sound = e.target.checked;
    store.set('sound', state.sound ? 'on' : 'off');
    if (state.sound) {
      unlockAudio();
      setTimeout(() => playSound(true), 80);
    }
  });

  async function logout() {
    forgetMe();
    const socket = state.socket;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      state.socket = null;
    }
    try {
      await api('/api/logout', { method: 'POST', body: {} });
    } catch {
      /* phiên đã hết thì thôi */
    }
    showLogin();
    history.replaceState(null, '', '#/');
  }

  /* =========================================================
     Nhắn riêng
     ========================================================= */
  function renderPeople() {
    if (!state.me) return;
    const q = fold($('#people-search').value);
    const people = [...state.users.values()]
      .filter((u) => u.id !== state.me.id && !u.disabled && (!q || fold(u.displayName).includes(q) || u.username.includes(q)))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName, 'vi'));
    const ul = $('#people-list');
    ul.replaceChildren(...people.map((u) => h('li', null,
      h('button', { class: 'person', type: 'button', onclick: () => startDm(u.id) },
        avatarEl(u),
        h('span', { class: 'person-main' },
          h('span', { class: 'person-name', text: u.displayName }),
          h('span', { class: `person-sub${u.online ? ' is-online' : ''}`, text: u.online ? 'Đang hoạt động' : `@${u.username}` }))))));
    if (!people.length) {
      ul.append(h('li', { class: 'people-empty', text: q ? 'Không tìm thấy ai khớp.' : 'Nhóm chưa có ai khác. Nhờ admin tạo thêm tài khoản.' }));
    }
  }
  $('#people-search').addEventListener('input', renderPeople);

  async function startDm(userId) {
    try {
      const { conversation } = await api('/api/conversations/dm', { method: 'POST', body: { userId } });
      state.convs.set(conversation.id, conversation);
      $('#people-search').value = '';
      navigate(`#/c/${conversation.id}`, { replace: true });
    } catch (err) {
      toast(err.message);
    }
  }

  /* =========================================================
     Nhóm chat riêng
     ========================================================= */
  // Danh sách chọn người (có dấu tích), dùng cho tạo nhóm và thêm thành viên
  function renderPicker(ul, { query, selected, exclude, onToggle }) {
    const q = fold(query);
    const people = [...state.users.values()]
      .filter((u) => !u.disabled && !exclude.has(u.id) && (!q || fold(u.displayName).includes(q) || u.username.includes(q)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
    ul.replaceChildren(...people.map((u) => h('li', null,
      h('button', {
        class: 'person pick', type: 'button', 'aria-pressed': selected.has(u.id) ? 'true' : 'false',
        onclick: () => {
          if (selected.has(u.id)) selected.delete(u.id);
          else selected.add(u.id);
          onToggle();
        },
      },
      avatarEl(u),
      h('span', { class: 'person-main' },
        h('span', { class: 'person-name', text: u.displayName }),
        h('span', { class: `person-sub${u.online ? ' is-online' : ''}`, text: u.online ? 'Đang hoạt động' : `@${u.username}` })),
      h('span', { class: 'check', 'aria-hidden': 'true' }, icon('check'))))));
    if (!people.length) ul.append(h('li', { class: 'people-empty', text: q ? 'Không tìm thấy ai khớp.' : 'Không còn ai để chọn.' }));
  }

  const newGroup = { selected: new Set() };
  function renderNewGroup(reset = false) {
    if (!state.me) return;
    if (reset) {
      newGroup.selected.clear();
      $('#new-group-form').reset();
      $('#new-group-search').value = '';
    }
    renderPicker($('#new-group-list'), {
      query: $('#new-group-search').value, selected: newGroup.selected, exclude: new Set([state.me.id]), onToggle: () => renderNewGroup(),
    });
    const n = newGroup.selected.size;
    $('#new-group-count').textContent = n ? `Đã chọn ${n} người` : 'Chọn thành viên';
    const btn = $('#new-group-create');
    btn.disabled = n < 2;
    btn.textContent = n < 2 ? 'Chọn ít nhất 2 người' : `Tạo nhóm ${n + 1} người`;
  }
  $('#new-group-search').addEventListener('input', () => renderNewGroup());
  $('#new-group-form').addEventListener('submit', (e) => e.preventDefault());
  $('#new-group-create').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    withBusy(btn, async () => {
      try {
        const { conversation } = await api('/api/groups', {
          method: 'POST',
          body: { name: $('#new-group-form').elements.groupName.value.trim(), memberIds: [...newGroup.selected] },
        });
        keepConv(conversation);
        newGroup.selected.clear();
        navigate(`#/c/${conversation.id}`, { replace: true });
      } catch (err) {
        toast(err.message);
      }
    });
  });

  const groupAdd = { selected: new Set(), open: false };
  function renderGroupInfo() {
    const c = state.convs.get(state.currentId);
    if (!c || c.type !== 'group' || !state.me) return;
    const ids = c.memberIds || [];
    const isOwner = c.createdBy === state.me.id;
    $('#group-profile').replaceChildren(
      convAvatarEl(c, 'avatar-xl', { dot: false }),
      h('p', { class: 'profile-title', text: c.name }),
      h('p', { class: 'hint', text: `${ids.length} thành viên` }));
    const nameInput = $('#group-name-form').elements.groupName;
    if (document.activeElement !== nameInput) nameInput.value = c.name;
    const sorted = [...ids].sort((a, b) => (b === c.createdBy) - (a === c.createdBy)
      || (b === state.me.id) - (a === state.me.id)
      || nameOf(a).localeCompare(nameOf(b), 'vi'));
    $('#group-member-heading').textContent = `Thành viên (${ids.length})`;
    $('#group-members').replaceChildren(...sorted.map((uid) => {
      const u = userOf(uid);
      return h('li', { class: 'member-row' },
        avatarEl(u),
        h('span', { class: 'person-main' },
          h('span', { class: 'member-name' },
            h('span', { text: nameOf(uid) }),
            uid === c.createdBy ? h('span', { class: 'tag tag-admin', text: 'Trưởng nhóm' }) : null,
            uid === state.me.id ? h('span', { class: 'tag tag-me', text: 'Bạn' }) : null),
          h('span', { class: `person-sub${u?.online ? ' is-online' : ''}`, text: u?.online ? 'Đang hoạt động' : `@${u?.username || ''}` })),
        isOwner && uid !== state.me.id
          ? h('button', { class: 'btn btn-sm btn-danger-quiet', type: 'button', text: 'Xóa', onclick: () => removeMember(c, uid) })
          : null);
    }));
    $('#group-add').hidden = !groupAdd.open;
    $('#group-add-toggle').textContent = groupAdd.open ? 'Đóng' : 'Thêm người';
    if (groupAdd.open) {
      renderPicker($('#group-add-list'), {
        query: $('#group-add-search').value, selected: groupAdd.selected, exclude: new Set(ids), onToggle: renderGroupInfo,
      });
      const n = groupAdd.selected.size;
      const btn = $('#group-add-confirm');
      btn.disabled = !n;
      btn.textContent = n ? `Thêm ${n} người vào nhóm` : 'Chọn người để thêm';
    }
  }

  $('#group-name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const c = state.convs.get(state.currentId);
    if (!c) return;
    const name = form.elements.groupName.value.trim();
    if (!name) {
      toast('Tên nhóm không được để trống.');
      return;
    }
    if (name === c.name) {
      toast('Nhóm đang dùng tên này rồi.');
      return;
    }
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const { conversation } = await api(`/api/groups/${c.id}`, { method: 'PATCH', body: { name } });
        keepConv(conversation);
        form.elements.groupName.blur();
        toast('Đã đổi tên nhóm.');
        renderGroupInfo();
        renderChatHeader();
        renderConvList();
      } catch (err) {
        toast(err.message);
      }
    });
  });
  $('#group-add-toggle').addEventListener('click', () => {
    groupAdd.open = !groupAdd.open;
    groupAdd.selected.clear();
    $('#group-add-search').value = '';
    renderGroupInfo();
  });
  $('#group-add-search').addEventListener('input', renderGroupInfo);
  $('#group-add-confirm').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const c = state.convs.get(state.currentId);
    if (!c || !groupAdd.selected.size) return;
    withBusy(btn, async () => {
      try {
        const { conversation } = await api(`/api/groups/${c.id}/members`, { method: 'POST', body: { userIds: [...groupAdd.selected] } });
        keepConv(conversation);
        groupAdd.open = false;
        groupAdd.selected.clear();
        toast('Đã thêm vào nhóm.');
        renderGroupInfo();
        renderChatHeader();
      } catch (err) {
        toast(err.message);
      }
    });
  });

  async function removeMember(c, uid) {
    if (!window.confirm(`Xóa ${nameOf(uid)} khỏi nhóm “${c.name}”?`)) return;
    try {
      await api(`/api/groups/${c.id}/members/${uid}`, { method: 'DELETE' });
      await fetchConv(c.id);
      toast(`Đã xóa ${nameOf(uid)} khỏi nhóm.`);
      renderGroupInfo();
      renderChatHeader();
    } catch (err) {
      toast(err.message);
    }
  }

  $('#group-leave').addEventListener('click', async () => {
    const c = state.convs.get(state.currentId);
    if (!c) return;
    const handOver = c.createdBy === state.me.id && (c.memberIds || []).length > 1
      ? ' Quyền trưởng nhóm sẽ chuyển cho người vào nhóm sớm nhất.' : '';
    if (!window.confirm(`Rời nhóm “${c.name}”?${handOver} Bạn sẽ không xem được tin nhắn của nhóm nữa.`)) return;
    try {
      await api(`/api/groups/${c.id}/members/${state.me.id}`, { method: 'DELETE' });
      state.convs.delete(c.id);
      state.msgs.delete(c.id);
      LocalDB.deleteConversation(c.id).catch(() => {});
      state.replying.delete(c.id);
      navigate('#/', { replace: true });
      renderConvList();
      updateBadge();
      toast('Bạn đã rời nhóm.');
    } catch (err) {
      toast(err.message);
    }
  });

  /* =========================================================
     Quản lý tài khoản (admin)
     ========================================================= */
  async function renderAdmin() {
    $('#credential').hidden = true;
    setFormError($('#create-form'), '');
    $('#admin-list').replaceChildren(h('li', { class: 'people-empty', text: 'Đang tải danh sách…' }));
    showAdminSeg(state.adminSeg);
    await Promise.all([loadAdminUsers(), loadStorage()]);
  }

  /* ----- Quản trị: chuyển mục Tài khoản / Bộ nhớ máy chủ ----- */
  function showAdminSeg(seg) {
    state.adminSeg = seg;
    for (const btn of $$('.seg-btn')) {
      const on = btn.dataset.seg === seg;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
    }
    $('#admin-accounts').hidden = seg !== 'accounts';
    $('#admin-storage').hidden = seg !== 'storage';
    $('#admin-errors').hidden = seg !== 'errors';
  }
  const ADMIN_SEGS = ['accounts', 'storage', 'errors'];
  $('.seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.dataset.seg === state.adminSeg) return;
    showAdminSeg(btn.dataset.seg);
    $(`#admin-${btn.dataset.seg}`).scrollTop = 0;
    if (btn.dataset.seg === 'storage') loadStorage();
    if (btn.dataset.seg === 'errors') loadErrors();
  });
  $('.seg').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = ADMIN_SEGS.indexOf(state.adminSeg);
    const next = ADMIN_SEGS[(i + (e.key === 'ArrowRight' ? 1 : ADMIN_SEGS.length - 1)) % ADMIN_SEGS.length];
    showAdminSeg(next);
    $(`#seg-${next}`).focus();
    if (next === 'storage') loadStorage();
    if (next === 'errors') loadErrors();
  });

  /* ----- Quản trị: báo lỗi app (crash, lỗi JavaScript) ----- */
  const ERROR_KINDS = { crash: 'App bị tắt (crash)', native: 'Lỗi Android', js: 'Lỗi màn hình', promise: 'Lỗi chạy ngầm', anr: 'App bị treo', web: 'Lỗi trang web', other: 'Lỗi khác' };
  async function loadErrors() {
    const ul = $('#errors-list');
    if (!ul.children.length) ul.replaceChildren(h('li', { class: 'people-empty', text: 'Đang tải…' }));
    try {
      const data = await api('/api/admin/errors');
      renderErrors(data);
    } catch (err) {
      ul.replaceChildren(h('li', { class: 'people-empty', text: err.message }));
    }
  }
  function renderErrors({ errors, total, times }) {
    $('#errors-badge').hidden = true;
    $('#errors-clear').hidden = !errors.length;
    $('#errors-summary').textContent = errors.length ? `${fmtNum(total)} loại lỗi, xảy ra tổng cộng ${fmtNum(times)} lần.` : '';
    const ul = $('#errors-list');
    if (!errors.length) {
      ul.replaceChildren(h('li', { class: 'people-empty', text: 'Chưa có báo lỗi nào. App đang chạy ổn 🎉' }));
      return;
    }
    ul.replaceChildren(...errors.map((e) => h('li', { class: `error-card${e.fatal ? ' is-fatal' : ''}` },
      h('div', { class: 'error-head' },
        h('span', { class: `error-kind kind-${e.kind}`, text: ERROR_KINDS[e.kind] || e.kind }),
        h('span', { class: 'error-count', text: e.count > 1 ? `${fmtNum(e.count)} lần` : '1 lần' }),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Xóa báo lỗi này',
          onclick: async () => {
            try {
              await api(`/api/admin/errors/${e.id}`, { method: 'DELETE' });
              loadErrors();
            } catch (err) {
              toast(err.message);
            }
          },
        }, icon('close'))),
      h('p', { class: 'error-msg', text: e.message }),
      h('p', { class: 'error-meta' },
        [e.device, e.osVersion, e.platform === 'web' ? null : e.appVersion && `app ${e.appVersion}`].filter(Boolean).join(' · ') || e.platform),
      h('p', { class: 'error-meta' },
        `Lần cuối ${shortTime(e.lastAt)} ${hm(e.lastAt)}`,
        e.where ? ` · ở ${e.where}` : '',
        e.userIds.length ? ` · ${e.userIds.map(nameOf).join(', ')}` : ''),
      e.stack ? h('details', { class: 'error-stack' }, h('summary', { text: 'Chi tiết kỹ thuật' }), h('pre', { text: e.stack })) : null)));
  }
  $('#errors-clear').addEventListener('click', async () => {
    if (!window.confirm('Xóa hết báo lỗi? Chỉ nên xóa sau khi đã sửa xong.')) return;
    try {
      await api('/api/admin/errors', { method: 'DELETE' });
      loadErrors();
    } catch (err) {
      toast(err.message);
    }
  });

  /* ----- Quản trị: bộ nhớ máy chủ ----- */
  const LIMIT_SOURCE = {
    firebase: 'Mặc định theo Firebase miễn phí (1 GB, chừa lại một ít cho an toàn).',
    disk: 'Mặc định theo ổ đĩa máy chủ: phần app đang dùng cộng phần ổ đĩa còn trống.',
    env: 'Đang lấy từ biến STORAGE_LIMIT_MB.',
    custom: 'Đang dùng giới hạn bạn đặt.',
    default: 'Giới hạn mặc định.',
  };

  function storageLevel(percent, cleanAt) {
    if (percent >= cleanAt) return 'crit';
    if (percent >= cleanAt - 15) return 'warn';
    return 'good';
  }

  async function loadStorage() {
    try {
      renderStorage(await api('/api/admin/storage'));
    } catch (err) {
      if (err.status !== 403) $('#storage-view').replaceChildren(h('p', { class: 'form-error', text: err.message }));
    }
  }

  function renderStorage({ usage: u, settings: st, lastClean }) {
    const pct = Math.max(0, u.percent);
    const shown = pct < 1 && u.total > 0 ? '<1' : decFmt.format(Math.min(pct, 999));
    const level = storageLevel(pct, st.cleanAt);
    const STATE = {
      good: { icon: 'check', text: 'Còn nhiều chỗ trống.' },
      warn: { icon: 'alert', text: `Sắp đầy. Khi đạt ${st.cleanAt}% ${st.autoClean ? 'máy chủ sẽ tự dọn ảnh và tin nhắn cũ nhất' : 'nên dọn bớt dữ liệu cũ (tự dọn đang tắt)'}.` },
      crit: { icon: 'alert', text: st.autoClean ? 'Gần hết chỗ. Máy chủ đang tự dọn dữ liệu cũ nhất.' : 'Gần hết chỗ. Hãy dọn bớt dữ liệu cũ ở phần bên dưới.' },
    }[level];
    const width = Math.min(100, pct);
    const tick = Math.min(100, st.cleanAt);
    const rows = [
      ['Ảnh trong tin nhắn', `${fmtNum(u.images.count)} ảnh`, u.images.bytes],
      ['Tin nhắn', `${fmtNum(u.db.messages)} tin`, u.db.bytes],
      ['Ảnh đại diện', `${fmtNum(u.avatars.count)} ảnh`, u.avatars.bytes],
    ];
    const meter = h('div', {
      class: `meter is-${level}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(Math.min(pct, 100))),
      'aria-label': `Đã dùng ${fmtBytes(u.total)} trên ${fmtBytes(u.limit)}`,
      title: `Đã dùng ${fmtBytes(u.total)} trên ${fmtBytes(u.limit)} (${shown}%)`,
    }, h('span', { class: 'meter-fill', style: `width:${width}%` }),
    st.autoClean ? h('span', { class: 'meter-tick', style: `left:${tick}%`, 'aria-hidden': 'true' }) : null);
    const scale = h('div', { class: 'meter-scale', 'aria-hidden': 'true' },
      h('span', { style: 'left:0', text: '0' }),
      st.autoClean && tick <= 88 ? h('span', { style: `left:${tick}%`, text: `tự dọn ${st.cleanAt}%` }) : null,
      h('span', { style: 'left:100%;transform:translateX(-100%)', text: fmtBytes(u.limit) }));
    const note = lastClean
      ? `${lastClean.auto ? 'Tự dọn' : 'Dọn thủ công'} gần nhất lúc ${new Date(lastClean.at).toLocaleString('vi-VN')}: xóa ${fmtNum(lastClean.images || 0)} ảnh và ${fmtNum(lastClean.messages || 0)} tin nhắn, giải phóng khoảng ${fmtBytes(lastClean.bytes || 0)}.`
      : 'Chưa dọn lần nào.';
    $('#storage-view').replaceChildren(
      h('p', { class: 'storage-figure' },
        h('span', { class: 'storage-percent', text: `${shown}%` }),
        h('span', { class: 'storage-amount', text: `đã dùng ${fmtBytes(u.total)} trên ${fmtBytes(u.limit)}` })),
      meter,
      scale,
      h('p', { class: `storage-state is-${level}` }, icon(STATE.icon), h('span', { text: STATE.text })),
      h('table', { class: 'storage-table' },
        h('caption', { class: 'visually-hidden', text: 'Dung lượng theo loại dữ liệu' }),
        h('tbody', null, rows.map(([label, count, bytes]) => h('tr', null,
          h('th', { scope: 'row', text: label }),
          h('td', { class: 'num-muted', text: count }),
          h('td', { text: fmtBytes(bytes) })))),
        h('tfoot', null, h('tr', null,
          h('th', { scope: 'row', text: 'Tổng' }), h('td'), h('td', { text: fmtBytes(u.total) })))),
      h('p', { class: 'storage-note', text: `${u.cloud ? 'Dữ liệu đang lưu trên Firebase.' : 'Dữ liệu đang lưu trên ổ đĩa máy chủ.'} ${note}` }));

    // Cài đặt tự dọn
    const form = $('#clean-settings');
    if (!form.contains(document.activeElement)) {
      form.elements.autoClean.checked = st.autoClean;
      form.elements.cleanAt.value = String(st.cleanAt);
      form.elements.cleanTo.value = String(st.cleanTo);
      form.elements.limitMb.value = st.limitMb || '';
      form.elements.limitMb.placeholder = `Mặc định: ${fmtNum(Math.round(u.defaultLimit / 1048576))} MB`;
    }
    $('#limit-hint').textContent = LIMIT_SOURCE[u.limitSource] || '';

    // Nhắc ở mục Tài khoản khi sắp đầy
    const alert = $('#storage-alert');
    alert.replaceChildren();
    if (level !== 'good') {
      alert.append(h('div', { class: `storage-alert${level === 'crit' ? ' is-crit' : ''}`, role: 'status' },
        icon('alert'),
        h('span', { text: `Bộ nhớ máy chủ đã dùng ${shown}%.` }),
        h('button', { type: 'button', text: 'Xem', onclick: () => { showAdminSeg('storage'); loadStorage(); } })));
    }
  }

  $('#storage-refresh').addEventListener('click', (e) => withBusy(e.currentTarget, loadStorage));

  $('#clean-settings').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = form.elements;
    const body = {
      autoClean: f.autoClean.checked,
      cleanAt: Number(f.cleanAt.value),
      cleanTo: Number(f.cleanTo.value),
      limitMb: f.limitMb.value.trim() === '' ? null : Number(f.limitMb.value),
    };
    if (body.cleanTo >= body.cleanAt) {
      setFormError(form, 'Mức "dọn cho đến khi còn" phải thấp hơn mức "bắt đầu dọn".');
      return;
    }
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const data = await api('/api/admin/storage/settings', { method: 'PATCH', body });
        setFormError(form, '');
        document.activeElement.blur();
        renderStorage(data);
        toast('Đã lưu cài đặt bộ nhớ.');
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  });

  // Dọn thủ công: bấm "Kiểm tra" để xem trước, rồi mới "Xóa ngay"
  let cleanPlan = null;
  function resetCleanPreview() {
    cleanPlan = null;
    $('#clean-preview').hidden = true;
    $('#clean-run').hidden = true;
  }
  $('#clean-form').addEventListener('change', resetCleanPreview);
  $('#clean-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const plan = { kind: f.kind.value, olderThanDays: Number(f.olderThanDays.value) };
    withBusy($('#clean-check'), async () => {
      try {
        const { result } = await api('/api/admin/storage/cleanup', { method: 'POST', body: { ...plan, dryRun: true } });
        const what = plan.kind === 'images' ? 'ảnh' : 'tin nhắn';
        const age = plan.olderThanDays ? `cũ hơn ${f.olderThanDays.selectedOptions[0].textContent}` : 'từ trước đến nay';
        const preview = $('#clean-preview');
        preview.hidden = false;
        if (!result.count) {
          cleanPlan = null;
          $('#clean-run').hidden = true;
          preview.replaceChildren(`Không có ${what} nào ${age}.`);
          return;
        }
        cleanPlan = { ...plan, count: result.count };
        preview.replaceChildren(
          'Sẽ xóa ', h('strong', { text: `${fmtNum(result.count)} ${what}` }), ` ${age}, giải phóng khoảng `,
          h('strong', { text: fmtBytes(result.bytes) }), '.');
        $('#clean-run').hidden = false;
      } catch (err) {
        toast(err.message);
      }
    });
  });
  $('#clean-run').addEventListener('click', (e) => {
    if (!cleanPlan) return;
    const plan = cleanPlan;
    const what = plan.kind === 'images' ? 'ảnh' : 'tin nhắn';
    if (!window.confirm(`Xóa vĩnh viễn ${fmtNum(plan.count)} ${what} khỏi máy chủ? Không hoàn tác được. Ai đã lưu trên máy vẫn xem lại được bản của họ.`)) return;
    withBusy(e.currentTarget, async () => {
      try {
        const data = await api('/api/admin/storage/cleanup', { method: 'POST', body: { kind: plan.kind, olderThanDays: plan.olderThanDays } });
        resetCleanPreview();
        renderStorage(data);
        toast(`Đã xóa ${fmtNum(data.result.count)} ${what}, giải phóng khoảng ${fmtBytes(data.result.bytes)}.`);
      } catch (err) {
        toast(err.message);
      }
    });
  });
  async function loadAdminUsers() {
    try {
      const { users } = await api('/api/admin/users');
      $('#member-heading').textContent = `Thành viên (${users.length})`;
      $('#admin-list').replaceChildren(...users.map(adminRow));
    } catch (err) {
      toast(err.message);
    }
  }
  function adminRow(u) {
    const self = u.id === state.me.id;
    const tags = [];
    if (u.role === 'admin') tags.push(h('span', { class: 'tag tag-admin', text: 'Admin' }));
    if (u.disabled) tags.push(h('span', { class: 'tag tag-locked', text: 'Đã khóa' }));
    if (u.mustChangePassword && !u.disabled) tags.push(h('span', { class: 'tag tag-pending', text: 'Chưa đổi mật khẩu tạm' }));
    const actions = self
      ? [h('span', { class: 'hint', text: 'Đây là bạn' })]
      : [
          h('button', { class: 'btn btn-sm', type: 'button', text: 'Đặt lại mật khẩu', onclick: () => adminReset(u) }),
          h('button', { class: `btn btn-sm${u.disabled ? '' : ' btn-danger-quiet'}`, type: 'button', text: u.disabled ? 'Mở khóa' : 'Khóa', onclick: () => adminLock(u) }),
          h('button', { class: 'btn btn-sm btn-quiet', type: 'button', text: u.role === 'admin' ? 'Gỡ quyền admin' : 'Cho làm admin', onclick: () => adminRole(u) }),
        ];
    return h('li', { class: 'admin-row' },
      avatarEl(u),
      h('div', { class: 'admin-main' },
        h('p', { class: 'admin-name' }, h('span', { text: u.displayName }), tags),
        h('p', { class: 'admin-sub', text: `@${u.username}` }),
        h('div', { class: 'admin-actions' }, actions)));
  }

  $('#create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = form.elements;
    const body = {
      username: f.username.value.trim().toLowerCase(),
      displayName: f.displayName.value.trim(),
      password: f.password.value,
      role: f.admin.checked ? 'admin' : 'member',
    };
    if (!/^[a-z0-9_.]{3,32}$/.test(body.username)) {
      setFormError(form, 'Tên đăng nhập cần 3–32 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới.');
      return;
    }
    if (body.password && body.password.length < 6) {
      setFormError(form, 'Mật khẩu tạm cần ít nhất 6 ký tự, hoặc để trống để app tự tạo.');
      return;
    }
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const { user, password } = await api('/api/admin/users', { method: 'POST', body });
        form.reset();
        setFormError(form, '');
        showCredential(user, password, false);
        loadAdminUsers();
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  });

  function showCredential(user, password, isReset) {
    const text = [
      `${isReset ? 'Mật khẩu mới' : 'Tài khoản'} ${state.appName} của ${user.displayName}`,
      `Link: ${location.origin}`,
      `Tên đăng nhập: ${user.username}`,
      `Mật khẩu tạm: ${password}`,
      'Đăng nhập xong app sẽ yêu cầu đặt mật khẩu mới.',
    ].join('\n');
    const cardEl = $('#credential');
    cardEl.replaceChildren(
      h('p', { class: 'credential-title', text: isReset ? `Đã đặt lại mật khẩu cho ${user.displayName}` : `Đã tạo tài khoản cho ${user.displayName}` }),
      h('pre', { class: 'credential-text', text }),
      h('p', { class: 'hint', text: 'Gửi nội dung này cho bạn ấy. Mật khẩu tạm chỉ hiện một lần.' }),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-primary btn-sm', type: 'button', text: 'Sao chép',
          onclick: () => copyText(text).then(() => toast('Đã sao chép.'), () => toast('Không sao chép được. Hãy chọn đoạn chữ rồi sao chép.')),
        }),
        navigator.share ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Chia sẻ', onclick: () => navigator.share({ text }).catch(() => {}) }) : null,
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', text: 'Xong', onclick: () => { cardEl.hidden = true; } })));
    cardEl.hidden = false;
    cardEl.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  async function adminReset(u) {
    if (!window.confirm(`Đặt lại mật khẩu cho ${u.displayName}? Bạn ấy sẽ bị đăng xuất khỏi mọi thiết bị.`)) return;
    try {
      const { user, password } = await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST', body: {} });
      showCredential(user, password, true);
      loadAdminUsers();
    } catch (err) {
      toast(err.message);
    }
  }
  async function adminLock(u) {
    const lock = !u.disabled;
    if (lock && !window.confirm(`Khóa tài khoản ${u.displayName}? Bạn ấy sẽ bị đăng xuất và không đăng nhập được nữa.`)) return;
    try {
      await api(`/api/admin/users/${u.id}/disabled`, { method: 'POST', body: { disabled: lock } });
      toast(lock ? `Đã khóa ${u.displayName}.` : `Đã mở khóa ${u.displayName}.`);
      loadAdminUsers();
    } catch (err) {
      toast(err.message);
    }
  }
  async function adminRole(u) {
    const makeAdmin = u.role !== 'admin';
    const question = makeAdmin
      ? `Cho ${u.displayName} làm admin? Admin tạo, khóa và đặt lại mật khẩu được cho tài khoản khác.`
      : `Gỡ quyền admin của ${u.displayName}?`;
    if (!window.confirm(question)) return;
    try {
      await api(`/api/admin/users/${u.id}/role`, { method: 'POST', body: { role: makeAdmin ? 'admin' : 'member' } });
      toast(makeAdmin ? `${u.displayName} đã là admin.` : `Đã gỡ quyền admin của ${u.displayName}.`);
      loadAdminUsers();
    } catch (err) {
      toast(err.message);
    }
  }

  /* =========================================================
     Đăng nhập & đổi mật khẩu lần đầu
     ========================================================= */
  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    if (!username || !password) {
      setFormError(form, 'Nhập tên đăng nhập và mật khẩu.');
      return;
    }
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const { user } = await api('/api/login', { method: 'POST', body: { username, password } });
        form.reset();
        setFormError(form, '');
        state.me = user;
        if (user.mustChangePassword) showForce();
        else await enterApp();
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  });

  $('#force-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const pw = form.elements.newPassword.value;
    if (pw.length < 6) {
      setFormError(form, 'Mật khẩu mới cần ít nhất 6 ký tự.');
      return;
    }
    if (pw !== form.elements.confirm.value) {
      setFormError(form, 'Hai lần nhập mật khẩu chưa khớp.');
      return;
    }
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const { user } = await api('/api/me/password', { method: 'POST', body: { newPassword: pw } });
        state.me = user;
        form.reset();
        toast('Đã lưu mật khẩu mới.');
        await enterApp();
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  });

  /* =========================================================
     Nút bấm chung, phím tắt, khung nhìn
     ========================================================= */
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.pw-toggle');
    if (toggle) {
      const field = toggle.parentElement.querySelector('input');
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      toggle.classList.toggle('on', show);
      toggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'settings': navigate('#/settings'); break;
      case 'close-settings':
        if (history.state && history.state.depth > 0 && !history.state.tabPush) history.back();
        else navigate('#/me', { replace: true });
        break;
      case 'pick-cover': $('#cover-input').click(); break;
      case 'remove-cover': removeCover(); break;
      case 'new': navigate('#/new'); break;
      case 'admin': switchTab('admin'); break;
      case 'close-sheet':
      case 'back': goBack(); break;
      case 'logout': logout(); break;
      case 'pick-image': $('#image-input').click(); break;
      case 'pick-avatar': $('#avatar-input').click(); break;
      case 'remove-avatar': removeAvatar(); break;
      case 'close-lightbox': closeLightbox(); break;
      case 'download-image': downloadImage($('#lightbox img').src); break;
      case 'new-group': navigate('#/new-group', { replace: true }); break;
      case 'group-info': navigate('#/group'); break;
      case 'conv-info': navigate('#/conv'); break;
      case 'chat-search': openChatSearch(); break;
      case 'chat-search-close': closeChatSearch(); break;
      case 'composer-more': openComposerMenu(el); break;
      case 'chess-challenge': {
        const c = state.convs.get(state.currentId);
        if (chess && c && c.type === 'dm') chess.openChallenge(c.peerId);
        break;
      }
      case 'chess-board': if (chess) chess.openLeaderboard(); break;
      case 'games-home':
        // Về trang chọn game: vừa từ đó sang thì lùi lại, không thì thay đường dẫn
        e.preventDefault();
        if (history.state && history.state.fromHub) history.back();
        else navigate('#/games', { replace: true });
        break;
      case 'chess-prefs': if (chess) chess.openPrefs(); break;
      case 'open-app': if (NATIVE && NATIVE.openApp) NATIVE.openApp(location.hash || '#/'); break;
      case 'chat-title':
        if (state.convs.get(state.currentId)?.type === 'group') navigate('#/group');
        break;
      default: break;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#menu-layer').hidden) closeMenu();
    else if (!$('#lightbox').hidden) closeLightbox();
    else if (currentSheet) goBack();
    else if (!$('#chat-search').hidden) closeChatSearch();
    else if (!$('#mention-box').hidden) hideMentions();
    else if (state.currentId != null && state.editing.has(state.currentId)) cancelEdit();
    else if (state.currentId != null && state.replying.has(state.currentId)) cancelReply();
  });

  // Chiều cao thật của màn hình khi bàn phím điện thoại bật lên
  function setupViewport() {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const update = () => {
      root.style.setProperty('--app-h', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
      root.style.setProperty('--vv-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
    };
    update();
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Không đăng ký được service worker:', err));
    navigator.serviceWorker.addEventListener('message', (e) => {
      const data = e.data || {};
      if (data.type === 'open' && data.url && state.me) {
        const hash = new URL(data.url, location.href).hash || '#/';
        navigate(hash, { replace: state.currentId != null });
      }
    });
  }

  /* =========================================================
     Khởi động
     ========================================================= */
  async function enterApp() {
    state.offline = false;
    showScreen('view-main');
    renderMe();
    await LocalDB.open(state.me.id);
    try {
      await Promise.all([loadUsers(), loadConvs()]);
    } catch (err) {
      if (!state.me) return;
      toast(err.message);
    }
    if (!state.me) return;
    setOfflineStatus(false);
    connectSocket();
    renderBanner();
    route();
    if (chess) chess.load(); // để hiện số việc cần làm ở tab Trò chơi
    if (caro) caro.load();
    if (games) games.sync(); // gửi điểm Xếp Khối chơi lúc offline
    if (streaks) streaks.load(); // chuỗi hằng ngày (gửi luôn ngày chơi lúc mất mạng)
    if (puzzles) puzzles.load(); // câu đố: tiến độ trên máy chủ (gửi luôn kết quả giải lúc mất mạng)
    syncPush();
    if (LocalDB.ready()) {
      cacheMe(state.me);
      LocalDB.persist();
      LocalDB.syncMediaFlag();
      syncAll();
    }
  }

  async function boot() {
    setupViewport();
    registerServiceWorker();
    // Có dữ liệu lưu trên máy: mở app xem ngay, không phải chờ máy chủ thức dậy
    const saved = cachedMe();
    let offline = false;
    if (saved && LocalDB.enabled()) {
      try {
        offline = await openOffline(saved);
      } catch {
        offline = false;
      }
    }
    // Máy chủ miễn phí (Render Free) ngủ khi không ai dùng: báo cho người dùng biết là đang chờ
    const slowHint = offline ? null : setTimeout(() => {
      $('#boot-hint').hidden = false;
      $('#boot-play').hidden = false; // chơi Xếp Khối (trang riêng, không cần máy chủ) trong lúc chờ
    }, 3500);
    await connectServer(slowHint);
  }

  async function loadConfig() {
    if (state.configLoaded) return;
    const config = await api('/api/config');
    state.appName = config.appName || state.appName;
    state.vapidKey = config.vapidPublicKey || null;
    state.configLoaded = true;
    $$('[data-appname]').forEach((el) => { el.textContent = state.appName; });
    updateBadge();
  }

  async function connectServer(slowHint) {
    try {
      await loadConfig().catch((err) => {
        if (err.status === 0) throw err;
      });
      const { user } = await api('/api/me');
      clearTimeout(slowHint);
      if (!user) {
        forgetMe();
        showLogin();
        return;
      }
      if (state.offline && state.me && state.me.id !== user.id) teardown();
      state.me = user;
      if (user.mustChangePassword) showForce();
      else await enterApp();
    } catch (err) {
      clearTimeout(slowHint);
      if (state.offline && err.status === 0) {
        setTimeout(() => connectServer(null), 8000); // vẫn đang xem bản trên máy, thử lại sau
        return;
      }
      showLogin(err.status === 0 ? err.message : '');
    }
  }

  boot();
})();
