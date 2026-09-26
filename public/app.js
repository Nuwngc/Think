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

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
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
  };

  /* =========================================================
     Gọi API
     ========================================================= */
  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.status = status;
      this.code = code;
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
      const err = new ApiError(data.error || `Có lỗi xảy ra (mã ${res.status}).`, res.status, data.code);
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
      default: return 'Nhóm vừa được cập nhật';
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
    state.currentId = null;
    state.everConnected = false;
    $('#conv-list').replaceChildren();
    $('#messages').replaceChildren();
    $('#banner').replaceChildren();
    $('#conn-status').hidden = true;
    document.body.classList.remove('in-chat');
    closeSheetNow();
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
    const sheet = { '#/settings': 'settings', '#/new': 'new', '#/admin': 'admin', '#/new-group': 'new-group', '#/group': 'group' }[hash] || null;
    if (sheet === 'admin' && state.me.role !== 'admin') {
      navigate('#/', { replace: true });
      return;
    }
    if (sheet === 'group' && state.convs.get(state.currentId)?.type !== 'group') {
      navigate(state.currentId != null ? `#/c/${state.currentId}` : '#/', { replace: true });
      return;
    }
    const match = /^#\/c\/(\d+)$/.exec(hash);
    if (match) openConversation(Number(match[1]));
    else if (!sheet) closeConversation();
    showSheet(sheet);
  }
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);

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
    if (name === 'settings') renderSettings();
    if (name === 'new') renderPeople();
    if (name === 'admin') renderAdmin();
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
    const hasImage = Boolean(m.image || m.localUrl);
    if (hasImage && !m.text) return 'Đã gửi một ảnh';
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
      .sort((a, b) => lastActivity(b) - lastActivity(a));
    ul.replaceChildren(...list.map(convItem));
    if (!list.length) {
      ul.append(h('li', { class: 'conv-empty', text: q ? 'Không có cuộc trò chuyện nào khớp.' : 'Chưa có cuộc trò chuyện nào.' }));
    }
  }

  function convItem(c) {
    const isDm = c.type === 'dm';
    const lm = c.lastMessage;
    const typers = [...(state.typing.get(c.id)?.keys() || [])];
    const unread = c.unread || 0;
    const preview = typers.length
      ? h('span', { class: 'conv-preview is-typing', text: isDm ? 'Đang nhập…' : `${nameOf(typers[0])} đang nhập…` })
      : h('span', { class: 'conv-preview', text: lm ? previewText(lm, c) : isDm ? 'Chưa có tin nhắn' : 'Nơi cả nhóm cùng nói chuyện' });
    return h('li', { class: `conv${unread ? ' has-unread' : ''}${c.id === state.currentId ? ' is-active' : ''}` },
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
    $('#group-info-btn').hidden = c.type !== 'group';
    $('.chat-title').classList.toggle('is-link', c.type === 'group');
    const status = $('#chat-status');
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
      $('#jump-btn').hidden = true;
      clearNotifications(id);
    }
    const b = box(id);
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
  }

  function closeConversation() {
    if (state.currentId == null) return;
    state.currentId = null;
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
      const data = await api(`/api/conversations/${id}/messages?limit=40${older && firstId ? `&before=${firstId}` : ''}`);
      if (!older) {
        // Giữ lại tin đang gửi dở và tin mới đến trong lúc tải
        const maxId = data.messages.length ? data.messages[data.messages.length - 1].id : 0;
        b.list = b.list.filter((m) => !m.id || m.id > maxId);
      }
      merge(b, data.messages);
      b.hasMore = data.hasMore;
      b.loaded = true;
      b.error = null;
      applyReads(id, data.reads);
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
    for (const m of incoming) byId.set(m.id, byId.has(m.id) ? { ...byId.get(m.id), ...m } : m);
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
    col.append(bubbleEl(m));
    const reacts = reactionsEl(m);
    if (reacts) col.append(reacts);
    if (m.failed) col.append(h('span', { class: 'msg-meta', text: 'Chưa gửi được. Chạm để gửi lại.' }));
    else if (last) col.append(h('span', { class: 'msg-meta', text: m.pending ? 'Đang gửi…' : hm(m.createdAt) }));
    row.append(col);
    return row;
  }

  function bubbleEl(m) {
    if (m.deleted) return h('div', { class: 'bubble is-deleted', text: 'Tin nhắn đã được thu hồi' });
    const hasImage = Boolean(m.image || m.localUrl);
    const hasQuote = Boolean(m.replyTo);
    const emoji = !hasImage && !hasQuote && isEmojiOnly(m.text);
    const cls = ['bubble'];
    if (hasImage && !m.text && !hasQuote) cls.push('is-image');
    else if (hasImage) cls.push('has-image');
    if (emoji) cls.push('is-emoji');
    const b = h('div', { class: cls.join(' ') });
    if (hasQuote) b.append(quoteEl(m.replyTo));
    if (hasImage) b.append(imageEl(m));
    if (m.text) b.append(h('span', { class: 'bubble-text' }, linkify(m.text)));
    return b;
  }

  // Khung trích dẫn tin được trả lời, bấm vào để nhảy tới tin gốc
  function quoteEl(r) {
    const who = r.senderId === state.me.id ? 'Bạn' : nameOf(r.senderId);
    const text = r.deleted ? 'Tin nhắn đã được thu hồi' : r.text || (r.image ? '📷 Ảnh' : '');
    return h('button', { class: `quote${r.deleted ? ' is-gone' : ''}`, type: 'button', dataset: { reply: r.id }, 'aria-label': `Xem tin nhắn gốc của ${who}` },
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
    return h('img', {
      class: 'msg-img', src, alt: 'Ảnh', loading: 'lazy', decoding: 'async',
      width: Math.max(1, Math.round(dims.w * scale)), height: Math.max(1, Math.round(dims.h * scale)),
      dataset: { full: src },
    });
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
    if (m.text) items.push({ label: 'Sao chép', run: () => copyText(m.text).then(() => toast('Đã sao chép tin nhắn.'), () => toast('Không sao chép được.')) });
    if (m.image) items.push({ label: 'Xem ảnh', run: () => openLightbox(m.localUrl || m.image) });
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
    const m = state.msgs.get(conversationId)?.list.find((item) => item.id === messageId);
    if (!m) return;
    m.reactions = reactions;
    if (state.currentId === conversationId) renderMessages();
  }

  // Trả lời tin nhắn
  const quoteOf = (m) => ({ id: m.id, senderId: m.senderId, deleted: false, text: m.text ? oneLine(m.text).slice(0, 140) : null, image: Boolean(m.image || m.localUrl) });
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
        h('span', { class: 'reply-bar-text', text: m.text ? oneLine(m.text) : m.image || m.localUrl ? '📷 Ảnh' : '' })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Hủy trả lời', onclick: cancelReply }, icon('close')));
    bar.hidden = false;
  }

  // Nhảy tới tin gốc (tự tải thêm tin cũ nếu cần)
  async function jumpTo(messageId) {
    const convId = state.currentId;
    const b = state.msgs.get(convId);
    if (!b || !messageId) return;
    for (let tries = 0; !b.list.some((x) => x.id === messageId) && b.hasMore && tries < 12; tries++) {
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
  $('#lightbox').addEventListener('click', closeLightbox);

  /* =========================================================
     Gửi tin nhắn
     ========================================================= */
  const newClientId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function syncComposer() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 140)}px`;
    $('.send-btn').classList.toggle('is-ready', Boolean(input.value.trim()));
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
    return isNew;
  }

  function sendText() {
    const text = input.value.trim();
    const convId = state.currentId;
    if (!text || convId == null) return;
    if (text.length > 4000) {
      toast('Tin nhắn dài quá 4000 ký tự. Hãy chia nhỏ ra.');
      return;
    }
    input.value = '';
    state.drafts.delete(convId);
    syncComposer();
    const target = state.replying.get(convId);
    state.replying.delete(convId);
    renderReplyBar();
    const m = {
      id: null, clientId: newClientId(), conversationId: convId, senderId: state.me.id, text, image: null,
      replyTo: target ? quoteOf(target) : null, reactions: [], createdAt: Date.now(), pending: true,
    };
    addLocal(m);
    deliver(m);
  }

  async function deliver(m) {
    m.pending = true;
    m.failed = false;
    try {
      if (m.blob && !m.uploadedUrl) {
        const up = await api(`/api/upload?w=${m.w}&h=${m.h}`, { method: 'POST', raw: m.blob });
        m.uploadedUrl = up.url;
      }
      const { message } = await api(`/api/conversations/${m.conversationId}/messages`, {
        method: 'POST',
        body: { text: m.text || '', image: m.uploadedUrl || undefined, replyTo: m.replyTo ? m.replyTo.id : undefined, clientId: m.clientId },
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

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    sendText();
  });
  input.addEventListener('keydown', (e) => {
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
      if (state.everConnected) resync();
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
    socket.on('conversation:changed', onConvChanged);
    socket.on('read', onRead);
    socket.on('typing', onTyping);
    socket.on('presence', onPresence);
    socket.on('user:updated', onUserUpdated);
    socket.on('session:ended', (data) => sessionEnded((data && data.reason) || 'Bạn đã bị đăng xuất.'));
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
      renderMe();
      if (currentSheet === 'settings') renderSettingsProfile();
      if (state.me.role !== 'admin' && currentSheet === 'admin') navigate('#/', { replace: true });
    }
    renderConvList();
    renderChatHeader();
    if (state.currentId != null) renderMessages();
    if (currentSheet === 'new') renderPeople();
    if (currentSheet === 'admin') loadAdminUsers();
    if (currentSheet === 'group') renderGroupInfo();
    if (currentSheet === 'new-group') renderNewGroup();
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
    const total = [...state.convs.values()].reduce((sum, c) => sum + (c.unread || 0), 0);
    document.title = total ? `(${total}) ${state.appName}` : state.appName;
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
      if (currentSheet === 'settings') renderNotify();
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
    if (currentSheet === 'settings') renderInstall();
  });
  window.addEventListener('appinstalled', () => {
    state.installEvent = null;
    renderBanner();
    if (currentSheet === 'settings') renderInstall();
    toast('Đã cài app lên máy.');
  });
  async function promptInstall() {
    const e = state.installEvent;
    if (!e) return;
    state.installEvent = null;
    e.prompt();
    try { await e.userChoice; } catch { /* bỏ qua */ }
    renderBanner();
    if (currentSheet === 'settings') renderInstall();
  }
  function renderInstall() {
    const hint = $('#install-hint');
    $('#install-btn').hidden = !state.installEvent;
    if (isStandalone()) hint.textContent = 'Bạn đang dùng bản đã cài trên máy.';
    else if (state.installEvent) hint.textContent = 'Cài để mở nhanh từ màn hình chính và nhận thông báo như app thường.';
    else if (isIOS()) hint.textContent = 'Trong Safari, bấm nút Chia sẻ rồi chọn "Thêm vào MH chính".';
    else hint.textContent = 'Mở menu của trình duyệt (nút ⋮) và chọn "Cài đặt ứng dụng" hoặc "Thêm vào màn hình chính".';
  }
  $('#install-btn').addEventListener('click', promptInstall);

  /* =========================================================
     Tài khoản của tôi
     ========================================================= */
  function renderMe() {
    if (!state.me) return;
    fillAvatar($('#me-avatar'), state.me, { dot: false });
    $('#admin-btn').hidden = state.me.role !== 'admin';
  }
  function applyMe(user) {
    Object.assign(state.me, user);
    state.users.set(user.id, { ...(state.users.get(user.id) || {}), ...user });
    renderMe();
    renderSettingsProfile();
    renderConvList();
    renderChatHeader();
    if (state.currentId != null) renderMessages();
  }
  function renderSettingsProfile() {
    if (!state.me) return;
    fillAvatar($('#settings-avatar'), state.me, { dot: false });
    $('#settings-username').textContent = `Tên đăng nhập: ${state.me.username}`;
    $('#remove-avatar').hidden = !state.me.avatar;
  }
  function renderSettings() {
    renderSettingsProfile();
    $('#name-form').elements.displayName.value = state.me.displayName;
    const pw = $('#password-form');
    pw.reset();
    pw.elements.username.value = state.me.username;
    setFormError(pw, '');
    $('#sound-toggle').checked = state.sound;
    renderNotify();
    renderInstall();
  }

  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = form.elements.displayName.value.trim();
    if (!name) {
      toast('Tên hiển thị không được để trống.');
      return;
    }
    if (name === state.me.displayName) {
      toast('Bạn đang dùng tên này rồi.');
      return;
    }
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const { user } = await api('/api/me', { method: 'PATCH', body: { displayName: name } });
        applyMe(user);
        toast('Đã lưu tên hiển thị.');
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
    await loadAdminUsers();
  }
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
      case 'new': navigate('#/new'); break;
      case 'admin': navigate('#/admin'); break;
      case 'close-sheet':
      case 'back': goBack(); break;
      case 'logout': logout(); break;
      case 'pick-image': $('#image-input').click(); break;
      case 'pick-avatar': $('#avatar-input').click(); break;
      case 'remove-avatar': removeAvatar(); break;
      case 'close-lightbox': closeLightbox(); break;
      case 'new-group': navigate('#/new-group', { replace: true }); break;
      case 'group-info': navigate('#/group'); break;
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
    showScreen('view-main');
    renderMe();
    try {
      await Promise.all([loadUsers(), loadConvs()]);
    } catch (err) {
      if (!state.me) return;
      toast(err.message);
    }
    if (!state.me) return;
    connectSocket();
    renderBanner();
    route();
    syncPush();
  }

  async function boot() {
    setupViewport();
    registerServiceWorker();
    // Máy chủ miễn phí (Render Free) ngủ khi không ai dùng: báo cho người dùng biết là đang chờ
    const slowHint = setTimeout(() => { $('#boot-hint').hidden = false; }, 3500);
    try {
      const config = await api('/api/config');
      state.appName = config.appName || state.appName;
      state.vapidKey = config.vapidPublicKey || null;
    } catch {
      /* dùng mặc định */
    }
    $$('[data-appname]').forEach((el) => { el.textContent = state.appName; });
    document.title = state.appName;
    try {
      const { user } = await api('/api/me');
      clearTimeout(slowHint);
      if (!user) {
        showLogin();
        return;
      }
      state.me = user;
      if (user.mustChangePassword) showForce();
      else await enterApp();
    } catch (err) {
      clearTimeout(slowHint);
      showLogin(err.status === 0 ? err.message : '');
    }
  }

  boot();
})();
