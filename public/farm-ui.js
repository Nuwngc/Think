'use strict';
/* Game Nông trại bản web của Think: trồng cây, nuôi gà bò, chế biến món ăn (mì cay, trà sữa…), giao đơn hàng,
   bán ở chợ, ghé vườn bạn bè (bắt sâu giúp, hái trộm), bảng xếp hạng.
   Máy chủ (src/farm.js, luật ở src/farm-logic.js) giữ mọi thứ; trang này chỉ vẽ và gửi thao tác.
   Đường dẫn: #/farm (vườn của mình) · #/farm/u/5 (ghé vườn người khác).
   games-ui.js gọi ThinkFarm.create(host) rồi mount(pane) / open(userId) / unmount(). */
window.ThinkFarm = (() => {
  const SOUNDS = ['plant', 'harvest', 'coin', 'order', 'craft', 'collect', 'levelup', 'bug', 'steal', 'dog', 'build', 'gift', 'error'];
  const KEY_SOUND = 'farm-sound';
  const KEY_ALL = 'farm-plant-all';
  const KEY_TAB = 'farm-tab';
  const KEY_CAT = 'farm-catalog-v1';
  const TABS = [
    { key: 'field', label: 'Ruộng', emoji: '🌱' },
    { key: 'build', label: 'Chế biến', emoji: '🏭' },
    { key: 'orders', label: 'Đơn hàng', emoji: '📋' },
    { key: 'storage', label: 'Kho', emoji: '📦' },
    { key: 'friends', label: 'Bạn bè', emoji: '👥' },
  ];
  const KINDS = [
    ['food', 'Món ăn, thức uống'],
    ['goods', 'Nguyên liệu'],
    ['animal', 'Chăn nuôi'],
    ['feed', 'Thức ăn cho vật nuôi'],
    ['crop', 'Nông sản'],
  ];

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* hết chỗ / ẩn danh */ }
    },
  };

  /* ---------------- Hình Twemoji ---------------- */
  // Tên file giống Twemoji: mã Unicode viết thường nối bằng "-", bỏ FE0F nếu không phải chuỗi ghép (ZWJ)
  function emojiKey(ch) {
    const cps = Array.from(String(ch)).map((c) => c.codePointAt(0));
    return (cps.includes(0x200d) ? cps : cps.filter((c) => c !== 0xfe0f)).map((c) => c.toString(16)).join('-');
  }
  function emo(ch, cls = '', label = '') {
    const img = document.createElement('img');
    img.className = `fe ${cls}`.trim();
    img.alt = label;
    if (!label) img.setAttribute('aria-hidden', 'true');
    img.draggable = false;
    img.decoding = 'async';
    img.src = `/farm/emoji/${emojiKey(ch)}.svg`;
    img.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = `${img.className} fe-text`;
      span.textContent = ch;
      if (!label) span.setAttribute('aria-hidden', 'true');
      img.replaceWith(span);
    }, { once: true });
    return img;
  }

  /* ---------------- Chữ ---------------- */
  const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
  function minutes(m) {
    if (m < 60) return `${m} phút`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} giờ ${m % 60} phút` : `${h} giờ`;
  }
  // Đồng hồ ngắn trên ô đất: 12:05, 1g20
  function clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    if (s >= 3600) return `${Math.floor(s / 3600)}g${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function longLeft(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    if (s < 60) return `${s} giây`;
    const m = Math.ceil(s / 60);
    return minutes(m);
  }
  function ago(t, nowMs) {
    const s = Math.max(0, Math.round((nowMs - t) / 1000));
    if (s < 60) return 'vừa xong';
    if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
    if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
    return `${Math.floor(s / 86400)} ngày trước`;
  }

  function create(host) {
    const { api, h, icon, avatarEl, userOf, nameOf, state, toast, navigate, goBack, withBusy } = host;
    const S = {
      cat: null, // danh mục (cây, món, công trình) từ máy chủ
      cv: null,
      items: {},
      farm: null,
      market: null,
      skew: 0,
      loading: null,
      error: null,
      tab: store.get(KEY_TAB, 'field'),
      pane: null,
      root: null,
      visit: null, // id người đang ghé vườn
      visitFarm: null,
      visitError: null,
      friends: null,
      board: null,
      boardTab: 'level',
      ticker: null,
      sig: '',
      onChange: host.onChange || (() => {}),
    };
    if (!TABS.some((t) => t.key === S.tab)) S.tab = 'field';
    const now = () => Date.now() + S.skew;
    const meId = () => (state.me ? state.me.id : 0);
    const item = (id) => S.items[id] || { id, name: id, emoji: '❓', price: 0, kind: 'crop' };
    const have = (id) => (S.farm && S.farm.inv[id]) || 0;
    const level = () => (S.farm ? S.farm.level : 1);

    /* ---------------- Âm thanh ---------------- */
    const audio = { ctx: null, buffers: new Map(), loading: null, on: store.get(KEY_SOUND, true) !== false };
    function unlockAudio() {
      if (!audio.on) return;
      try {
        if (!audio.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          audio.ctx = new AC();
        }
        if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
        if (!audio.loading) {
          audio.loading = Promise.all(SOUNDS.map(async (name) => {
            try {
              const res = await fetch(`/farm/sounds/${name}.wav`);
              if (!res.ok) return;
              const data = await res.arrayBuffer();
              const buf = await new Promise((resolve, reject) => {
                const p = audio.ctx.decodeAudioData(data, resolve, reject);
                if (p && p.then) p.then(resolve, reject);
              });
              audio.buffers.set(name, buf);
            } catch { /* thiếu một tiếng thì thôi */ }
          }));
        }
      } catch { /* trình duyệt không hỗ trợ */ }
    }
    function play(name, delay = 0) {
      if (!audio.on || !audio.ctx) return;
      const buf = audio.buffers.get(name);
      if (!buf) return;
      try {
        const src = audio.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(audio.ctx.destination);
        src.start(audio.ctx.currentTime + delay / 1000);
      } catch { /* bỏ qua */ }
    }

    /* ---------------- Dữ liệu ---------------- */
    function setCatalog(cat, cv) {
      S.cat = cat;
      S.cv = cv;
      S.items = {};
      for (const c of cat.crops) S.items[c.id] = { ...c, kind: 'crop' };
      for (const p of cat.products) S.items[p.id] = { ...p };
    }
    function applyFarm(farm, nowMs) {
      if (nowMs) S.skew = nowMs - Date.now();
      if (farm) S.farm = farm;
      S.onChange();
    }
    async function load({ peek = false } = {}) {
      if (S.loading) return S.loading;
      if (!S.cat) {
        const cached = store.get(KEY_CAT, null);
        if (cached && cached.v && cached.cat) setCatalog(cached.cat, cached.v);
      }
      S.loading = (async () => {
        try {
          const data = await api(`/api/farm?cv=${encodeURIComponent(S.cv || '')}${peek ? '&peek=1' : ''}`);
          if (data.catalog) {
            setCatalog(data.catalog, data.catalogVersion);
            store.set(KEY_CAT, { v: data.catalogVersion, cat: data.catalog });
          }
          S.market = data.market || S.market;
          S.error = null;
          applyFarm(data.farm, data.now);
        } catch (err) {
          S.error = err.message;
        } finally {
          S.loading = null;
        }
        render();
      })();
      return S.loading;
    }

    /* ---------------- Trạng thái ô đất ---------------- */
    function plotState(pl, t) {
      if (!pl.c) return 'empty';
      return pl.r <= t ? 'ripe' : 'growing';
    }
    const bugOn = (pl, t) => pl.c && pl.b > 0 && !pl.bd && pl.b <= t;
    function growth(pl, t) {
      const p = Math.min(1, Math.max(0, (t - pl.p) / Math.max(1, pl.r - pl.p)));
      return { p, scale: 0.45 + 0.55 * p, sat: 0.35 + 0.65 * p, sprout: p < 0.22 };
    }

    /* ---------------- Khung chính ---------------- */
    function mount(pane) {
      S.pane = pane;
      S.root = h('div', { class: 'farm', onpointerdown: unlockAudio });
      pane.replaceChildren(S.root);
      render();
      load(); // mở lại là lấy bản mới (bạn bè có thể vừa ghé vườn)
      clearInterval(S.ticker);
      S.ticker = setInterval(tick, 1000);
    }
    function unmount() {
      clearInterval(S.ticker);
      S.ticker = null;
      if (S.pane) S.pane.replaceChildren();
      S.pane = null;
      S.root = null;
    }
    const isMounted = () => Boolean(S.root);

    /** Mở vườn của mình (null) hoặc vườn người khác */
    function open(userId) {
      const next = userId && userId !== meId() ? userId : null;
      if (next !== S.visit) {
        S.visit = next;
        S.visitFarm = null;
        S.visitError = null;
        if (next) loadVisit();
      }
      render();
    }
    async function loadVisit() {
      const id = S.visit;
      try {
        const data = await api(`/api/farm/u/${id}`);
        if (S.visit !== id) return;
        S.skew = data.now - Date.now();
        S.visitFarm = data.farm;
        S.visitError = null;
      } catch (err) {
        if (S.visit !== id) return;
        S.visitError = err.message;
      }
      render();
    }

    function header() {
      const f = S.farm;
      const visiting = S.visit != null;
      const back = h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': visiting ? 'Về vườn của mình' : 'Về trang Trò chơi',
        onclick: () => {
          if (visiting) navigate('#/farm', { replace: true });
          else if (history.state && history.state.fromHub) goBack();
          else navigate('#/games', { replace: true });
        },
      }, icon('back'));
      const title = visiting ? `Vườn của ${nameOf(S.visit)}` : 'Nông trại';
      const lvl = visiting ? (S.visitFarm ? S.visitFarm.level : null) : f ? f.level : null;
      const meter = !visiting && f
        ? h('span', { class: 'farm-xp', role: 'progressbar', 'aria-label': 'Kinh nghiệm', 'aria-valuemin': '0', 'aria-valuemax': String(f.xpNext || 1), 'aria-valuenow': String(f.xpCur) },
          h('i', { style: `--p:${f.xpNext ? Math.min(100, (f.xpCur / f.xpNext) * 100) : 100}%` }))
        : null;
      const sub = lvl != null
        ? h('div', { class: 'farm-level' },
          h('span', { class: 'farm-level-badge', text: `Cấp ${lvl}` }),
          meter,
          !visiting && f && f.xpNext ? h('span', { text: `${fmt(f.xpCur)}/${fmt(f.xpNext)}` }) : null)
        : null;
      const coins = f ? h('span', { class: 'farm-coins', 'aria-label': `${fmt(f.coins)} xu`, 'data-coins': '' }, emo('🪙'), fmt(f.coins)) : null;
      const sound = h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': audio.on ? 'Tắt âm thanh' : 'Bật âm thanh', 'aria-pressed': audio.on ? 'true' : 'false',
        onclick: () => {
          audio.on = !audio.on;
          store.set(KEY_SOUND, audio.on);
          if (audio.on) unlockAudio();
          render();
        },
      }, icon(audio.on ? 'volume' : 'volume-off'));
      const help = visiting ? null : h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cách chơi', onclick: openHelp }, icon('info'));
      return h('header', { class: 'farm-head' }, back, h('div', { class: 'farm-title' }, h('h1', { text: title }), sub), coins, sound, help);
    }

    function badges() {
      const f = S.farm;
      const t = now();
      if (!f) return {};
      const ripe = f.plots.filter((p) => plotState(p, t) === 'ripe').length;
      let done = 0;
      for (const b of Object.values(f.buildings)) done += b.q.filter((x) => x.e <= t).length;
      const ready = f.orders.filter((o) => o.at <= t && o.items.every(([id, q]) => have(id) >= q)).length;
      const friends = S.friends ? S.friends.filter((x) => x.bugs || x.stealable).length : 0;
      return { field: ripe, build: done, orders: ready, friends };
    }

    function tabs() {
      const b = badges();
      return h('nav', { class: 'farm-tabs', role: 'tablist', 'aria-label': 'Các mục nông trại' },
        TABS.map((t) => h('button', {
          class: 'farm-tab', type: 'button', role: 'tab', 'aria-selected': S.tab === t.key ? 'true' : 'false',
          'aria-label': b[t.key] ? `${t.label}, ${b[t.key]}` : t.label,
          onclick: () => {
            S.tab = t.key;
            store.set(KEY_TAB, t.key);
            if (t.key === 'friends') loadSocial();
            render();
            const body = S.root && S.root.querySelector('.farm-body');
            if (body) body.scrollTop = 0;
          },
        }, emo(t.emoji), t.label, b[t.key] ? h('span', { class: 'farm-tab-badge', text: b[t.key] > 99 ? '99+' : String(b[t.key]) }) : null)));
    }

    function render() {
      if (!S.root) return;
      const scroller = S.root.querySelector('.farm-body');
      const scroll = scroller ? scroller.scrollTop : 0;
      const parts = [header()];
      let body;
      let dock = null;
      if (S.visit != null) {
        body = h('div', { class: 'farm-body is-field' }, renderVisit());
      } else if (!S.farm || !S.cat) {
        body = h('div', { class: 'farm-body' }, S.error
          ? h('div', { class: 'farm-error' }, h('p', { text: S.error }), h('button', { class: 'fbtn', type: 'button', onclick: () => load() }, 'Thử lại'))
          : h('div', { class: 'farm-loading' }, emo('🚜', '', ''), h('p', { text: 'Đang ra đồng…' })));
      } else {
        parts.push(tabs());
        const view = { field: renderField, build: renderBuild, orders: renderOrders, storage: renderStorage, friends: renderFriends }[S.tab] || renderField;
        body = h('div', { class: `farm-body${S.tab === 'field' ? ' is-field' : ''}`, role: 'tabpanel' }, view());
        if (S.tab === 'field') dock = fieldDock();
      }
      parts.push(body);
      if (dock) parts.push(dock);
      parts.push(h('div', { class: 'farm-fx', 'aria-hidden': 'true' }));
      S.root.replaceChildren(...parts);
      body.scrollTop = scroll;
      S.sig = signature();
    }

    // Đổi trạng thái (cây chín, món xong, khách tới) thì vẽ lại; còn lại chỉ cập nhật đồng hồ
    function signature() {
      const f = S.visit != null ? S.visitFarm : S.farm;
      if (!f) return '';
      const t = now();
      const parts = f.plots.map((p) => (p.c ? `${p.r <= t ? 1 : 0}${(p.bug || bugOn(p, t)) ? 1 : 0}${p.c && p.r > t && growth(p, t).sprout ? 1 : 0}` : '-'));
      if (S.visit == null) {
        for (const b of Object.values(f.buildings)) parts.push(b.q.map((x) => `${x.s <= t ? 1 : 0}${x.e <= t ? 1 : 0}`).join(''));
        parts.push(f.orders.map((o) => (o.at <= t ? 1 : 0)).join(''));
      }
      return parts.join('|');
    }
    function tick() {
      if (!S.root) return;
      if (signature() !== S.sig) {
        render();
        return;
      }
      const t = now();
      for (const el of S.root.querySelectorAll('[data-until]')) el.textContent = clock(Number(el.dataset.until) - t);
      for (const el of S.root.querySelectorAll('[data-until-long]')) el.textContent = longLeft(Number(el.dataset.untilLong) - t);
      for (const el of S.root.querySelectorAll('[data-grow]')) {
        const [p, r] = el.dataset.grow.split(',').map(Number);
        const g = growth({ p, r }, t);
        el.style.setProperty('--g', g.scale.toFixed(3));
        el.style.setProperty('--sat', g.sat.toFixed(2));
      }
      for (const el of S.root.querySelectorAll('[data-work]')) {
        const [s, e] = el.dataset.work.split(',').map(Number);
        el.style.setProperty('--p', `${Math.min(100, Math.max(0, ((t - s) / (e - s)) * 100)).toFixed(1)}%`);
      }
    }

    /* ---------------- Hiệu ứng ---------------- */
    // anchor: phần tử (hoặc khung đã đo trước) để chữ bay lên từ đó
    function floatText(parts, anchor) {
      const fx = S.root && S.root.querySelector('.farm-fx');
      if (!fx) return;
      const box = S.root.getBoundingClientRect();
      let x = box.width / 2;
      let y = box.height * 0.45;
      const r = anchor && (anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor);
      if (r && r.width) {
        x = Math.min(box.width - 60, Math.max(60, r.left + r.width / 2 - box.left));
        y = Math.max(40, r.top - box.top);
      }
      const el = h('span', { class: 'farm-float', style: `left:${x}px;top:${y}px` }, parts);
      fx.append(el);
      setTimeout(() => el.remove(), 1400);
    }
    function bumpCoins() {
      const el = S.root && S.root.querySelector('.farm-coins');
      if (!el) return;
      el.classList.remove('is-bump');
      void el.offsetWidth;
      el.classList.add('is-bump');
    }
    // Sản phẩm vừa thu bay về mục Kho
    function flyToStore(ch, from) {
      if (!S.root || !from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const target = S.root.querySelector('.farm-tab:nth-child(4) .fe');
      if (!target) return;
      const a = from.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const el = emo(ch, 'farm-fly');
      el.style.left = `${a.left + a.width / 2 - 17}px`;
      el.style.top = `${a.top + a.height / 2 - 17}px`;
      document.body.append(el);
      requestAnimationFrame(() => {
        el.style.transform = `translate(${b.left - a.left - a.width / 2 + 29}px, ${b.top - a.top - a.height / 2 + 29}px) scale(.5)`;
        el.style.opacity = '0.2';
      });
      setTimeout(() => el.remove(), 700);
    }

    /* ---------------- Gửi thao tác ---------------- */
    async function act(action, payload = {}, { btn, anchor } = {}) {
      // Đo chỗ bấm trước: vẽ lại xong thì nút cũ không còn
      const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      const run = async () => {
        try {
          const data = await api('/api/farm/act', { method: 'POST', body: { action, ...payload } });
          const before = S.farm;
          applyFarm(data.farm, data.now);
          render();
          afterAct(action, data.result || {}, before, rect);
          return data.result;
        } catch (err) {
          play('error');
          toast(err.message);
          if (err.status === 400 || err.status === 404) load();
          return null;
        }
      };
      return btn ? withBusy(btn, run) : run();
    }

    function afterAct(action, r, before, anchor) {
      const coinsDelta = before ? S.farm.coins - before.coins : 0;
      if (action === 'plant') play('plant');
      if (action === 'harvest') play('harvest');
      if (action === 'clearBug') play('bug');
      if (action === 'craft') play('craft');
      if (action === 'collect' && Object.keys(r.gained || {}).length) play('collect');
      if (action === 'sell') play('coin');
      if (action === 'deliver') play('order');
      if (['build', 'addSlot', 'buyPlot', 'upgradeStorage', 'buyDecor', 'buyDog'].includes(action)) play('build');
      if (action === 'gift') play('gift');
      const gained = r.gained || {};
      const xp = (r.xp || 0);
      const bits = [];
      for (const [id, n] of Object.entries(gained)) bits.push(h('span', {}, emo(item(id).emoji), `+${n}`));
      if (coinsDelta > 0) bits.push(h('span', {}, emo('🪙'), `+${fmt(coinsDelta)}`));
      if (xp > 0) bits.push(h('span', {}, emo('⭐'), `+${xp}`));
      if (bits.length) floatText(bits, anchor);
      if (coinsDelta) bumpCoins();
      if (action === 'harvest' && r.full) toast('Kho đầy rồi. Bán bớt hàng hoặc nâng kho để thu hoạch tiếp.');
      if (action === 'collect' && r.full) toast('Kho đầy, chưa lấy hết hàng. Bán bớt hoặc nâng kho nhé.');
      if (action === 'plant' && r.skipped) toast(`Không đủ xu, mới gieo được ${r.planted.length} ô.`);
      const ups = r.levelUps || [];
      if (ups.length) setTimeout(() => showLevelUp(ups), 350);
    }

    /* =========================================================
       Ruộng
       ========================================================= */
    function yard(decor, dog) {
      const list = (decor || []).map((id) => S.cat.decor.find((d) => d.id === id)).filter(Boolean);
      if (!list.length && !dog) return null;
      return h('div', { class: 'farm-yard', 'aria-label': `Sân vườn: ${[...list.map((d) => d.name), dog ? 'chó giữ vườn' : null].filter(Boolean).join(', ')}` },
        list.map((d) => emo(d.emoji, '', d.name)),
        dog ? emo('🐕', 'is-dog', 'Chó giữ vườn') : null);
    }

    function plotEl(pl, i, t, { visiting = false } = {}) {
      const st = plotState(pl, t);
      const crop = pl.c ? item(pl.c) : null;
      const bug = visiting ? pl.bug : bugOn(pl, t);
      const kids = [];
      let label;
      if (st === 'empty') {
        kids.push(h('span', { class: 'fplot-plus', 'aria-hidden': 'true', text: visiting ? '' : '+' }));
        label = visiting ? `Ô ${i + 1}: đất trống` : `Ô ${i + 1}: đất trống, bấm để gieo hạt`;
      } else {
        const g = growth(pl, t);
        const wrap = h('span', { class: 'fplot-crop', 'data-grow': st === 'growing' ? `${pl.p},${pl.r}` : null, style: st === 'growing' ? `--g:${g.scale.toFixed(3)};--sat:${g.sat.toFixed(2)}` : null },
          emo(st === 'growing' && g.sprout ? '🌱' : crop.emoji));
        kids.push(wrap);
        if (st === 'ripe') {
          kids.push(emo('✨', 'fplot-spark'));
          let tag = bug ? 'Bắt sâu' : 'Thu hoạch';
          let muted = false;
          if (visiting) {
            if (pl.st === 'me') { tag = 'Đã hái'; muted = true; } else if (pl.canSteal) tag = 'Hái trộm'; else { tag = 'Đã chín'; muted = true; }
          }
          kids.push(h('span', { class: `fplot-tag${muted ? ' is-muted' : ''}`, text: tag }));
          label = visiting
            ? `Ô ${i + 1}: ${crop.name} đã chín${pl.canSteal ? ', bấm để hái trộm' : ''}`
            : `Ô ${i + 1}: ${crop.name} đã chín${pl.st ? ', bị hái trộm 1' : ''}, ${bug ? 'đang có sâu, bấm để bắt sâu' : 'bấm để thu hoạch'}`;
        } else {
          kids.push(h('span', { class: 'fplot-time', 'data-until': String(pl.r), text: clock(pl.r - t) }));
          label = `Ô ${i + 1}: ${crop.name}, còn ${longLeft(pl.r - t)}${bug ? ', đang có sâu' : ''}`;
        }
        if (bug) kids.push(emo('🐛', 'fplot-bug'));
        else if (!visiting && pl.st) kids.push(emo('😤', 'fplot-bug is-stolen')); // bạn bè đã hái trộm 1 sản phẩm
      }
      return h('button', {
        class: `fplot is-${st}`, type: 'button', role: 'listitem', 'aria-label': label,
        onclick: (e) => (visiting ? tapVisit(i, e.currentTarget) : tapPlot(i, e.currentTarget)),
      }, kids);
    }

    function tapPlot(i, el) {
      const f = S.farm;
      const pl = f.plots[i];
      const t = now();
      const st = plotState(pl, t);
      if (st === 'empty') return openSeeds(i);
      if (bugOn(pl, t)) return act('clearBug', { plot: i }, { anchor: el });
      if (st === 'ripe') {
        flyToStore(item(pl.c).emoji, el);
        return act('harvest', { plots: [i] }, { anchor: el });
      }
      return openPlotInfo(i);
    }

    function fieldDock() {
      const f = S.farm;
      const t = now();
      const ripe = f.plots.filter((p) => plotState(p, t) === 'ripe').length;
      const empty = f.plots.filter((p) => !p.c).length;
      const kids = [];
      if (ripe) {
        kids.push(h('button', {
          class: 'fbtn is-gold', type: 'button',
          onclick: (e) => act('harvest', { plots: 'all' }, { btn: e.currentTarget, anchor: e.currentTarget }),
        }, emo('🧺'), ripe > 1 ? `Thu hoạch ${ripe} ô` : 'Thu hoạch'));
      }
      if (empty) {
        kids.push(h('button', { class: 'fbtn', type: 'button', onclick: () => openSeeds(null) }, emo('🌱'), empty > 1 ? `Gieo ${empty} ô trống` : 'Gieo ô trống'));
      }
      return h('div', { class: 'farm-dock' }, kids);
    }

    function giftBanner() {
      const f = S.farm;
      if (!S.market || f.giftDay === S.market.day) return null;
      const yesterday = new Date(Date.parse(`${S.market.day}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10);
      const streak = f.giftDay === yesterday ? f.giftStreak + 1 : 1;
      const list = S.cat.rules.dailyGift;
      const coins = list[Math.min(streak, list.length) - 1];
      return h('div', { class: 'farm-gift' },
        emo('🎁'),
        h('p', {}, h('b', { text: `Quà hôm nay: ${coins} xu` }), h('br'), streak > 1 ? `Ngày thứ ${streak} liên tiếp, quà tăng dần tới ${list[list.length - 1]} xu.` : 'Ghé mỗi ngày, quà tăng dần.'),
        h('button', { class: 'fbtn is-gold is-small', type: 'button', onclick: (e) => act('gift', {}, { btn: e.currentTarget, anchor: e.currentTarget }) }, 'Nhận'));
    }

    function buyPlotTile() {
      const f = S.farm;
      const n = f.plots.length + 1;
      const info = S.cat.plotCosts.find((x) => x.n === n);
      if (!info) return null;
      const locked = level() < info.level;
      return h('button', {
        class: 'fplot is-buy', type: 'button', disabled: locked,
        'aria-label': locked ? `Ô đất thứ ${n} mở ở cấp ${info.level}` : `Mua ô đất thứ ${n} giá ${info.cost} xu`,
        onclick: (e) => act('buyPlot', {}, { btn: e.currentTarget, anchor: e.currentTarget }),
      }, emo(locked ? '🔒' : '🪙'), locked ? `Cấp ${info.level}` : `Mua ô đất`, locked ? null : h('span', { text: `${fmt(info.cost)} xu` }));
    }

    function renderField() {
      const f = S.farm;
      const t = now();
      const firstTime = f.stats.harvest === 0 && f.plots.some((p) => plotState(p, t) === 'ripe');
      return [
        giftBanner(),
        yard(f.decor, f.dog),
        h('div', { class: 'fgrid', role: 'list', 'aria-label': 'Ruộng' }, f.plots.map((pl, i) => plotEl(pl, i, t)), buyPlotTile()),
        firstTime ? h('p', { class: 'farm-note', text: 'Lúa mì đã chín sẵn: bấm vào ô có viền vàng để thu hoạch, rồi bấm ô trống để gieo hạt mới. Hạt lúa mì miễn phí.' }) : null,
      ];
    }

    /* ---------------- Bảng gieo hạt ---------------- */
    function openSeeds(plot) {
      const f = S.farm;
      const empties = f.plots.map((p, i) => (p.c ? -1 : i)).filter((i) => i >= 0);
      if (!empties.length) return;
      let all = plot == null ? true : store.get(KEY_ALL, false);
      const draw = (sheet) => {
        const body = sheet.querySelector('.sheet-body');
        const rows = S.cat.crops.map((c) => {
          const locked = level() < c.level;
          const poor = c.seed > f.coins;
          return h('button', {
            class: 'fseed', type: 'button', disabled: locked || poor,
            onclick: async (e) => {
              const plots = all ? empties : [plot];
              closeSheet();
              await act('plant', { plots, crop: c.id }, { anchor: e.currentTarget });
            },
          },
          emo(c.emoji),
          h('b', { text: c.name }),
          h('small', { text: locked ? `Mở ở cấp ${c.level}` : `${minutes(c.min)} · thu ${c.yield} · bán ~${c.price} xu/cái` }),
          h('span', { class: 'fseed-cost' }, locked ? emo('🔒') : c.seed ? [emo('🪙'), String(c.seed)] : 'Miễn phí'));
        });
        const toggle = plot != null && empties.length > 1
          ? h('label', { class: 'fcheck' }, h('input', {
            type: 'checkbox', checked: all,
            onchange: (e) => {
              all = e.target.checked;
              store.set(KEY_ALL, all);
            },
          }), `Gieo cho cả ${empties.length} ô trống`)
          : null;
        body.replaceChildren(
          plot == null ? h('p', { class: 'farm-note', text: `Gieo cùng một loại cây cho ${empties.length} ô trống.` }) : toggle,
          h('div', { class: 'fseeds' }, rows),
          h('p', { class: 'farm-note', text: 'Cây ngắn ngày hợp lúc đang chơi; cây lâu ngày (dưa hấu, bơ, cà phê, xoài) gieo trước khi đi ngủ là vừa.' }));
      };
      const sheet = openSheet('Gieo hạt', h('div'), null);
      draw(sheet);
    }

    function openPlotInfo(i) {
      const pl = S.farm.plots[i];
      const c = item(pl.c);
      const t = now();
      const g = growth(pl, t);
      openSheet(c.name, h('div', { class: 'farm-help' },
        h('div', { class: 'fvisit-bar' }, emo(c.emoji), h('div', {},
          h('b', {}, 'Còn ', h('span', { 'data-until-long': String(pl.r), text: longLeft(pl.r - t) }), ' nữa chín'),
          h('div', { class: 'fcap-bar', style: 'margin-top:6px' }, h('i', { style: `--p:${Math.round(g.p * 100)}%` })))),
        h('ul', {},
          h('li', {}, emo('🧺'), h('span', { text: `Thu được ${c.yield} ${c.name.toLowerCase()} (thỉnh thoảng được mùa thêm 1), bán khoảng ${c.price} xu mỗi cái.` })),
          h('li', {}, emo('🐛'), h('span', { text: 'Cây lâu ngày có thể bị sâu: bấm vào con sâu để bắt, không thì mất 1 sản phẩm. Bạn bè ghé vườn cũng bắt giúp được.' })),
          h('li', {}, emo('😤'), h('span', { text: 'Cây chín mà để lâu, bạn bè ghé chơi có thể hái trộm 1 sản phẩm mỗi ô. Nuôi chó giữ vườn để đuổi kẻ trộm.' })))), null);
    }

    /* =========================================================
       Chế biến
       ========================================================= */
    function renderBuild() {
      const f = S.farm;
      const t = now();
      const stalls = S.cat.buildings.map((b) => {
        const own = f.buildings[b.id];
        if (!own) {
          const locked = level() < b.level;
          return h('section', { class: `fstall ${locked ? 'is-locked' : 'is-new'}` },
            h('div', { class: 'fstall-head' }, emo(b.emoji), h('div', {}, h('h3', { text: b.name }), h('p', { text: b.desc }))),
            h('div', { class: 'fstall-actions' }, locked
              ? h('span', { class: 'fchip' }, emo('🔒'), `Mở ở cấp ${b.level}`)
              : h('button', {
                class: 'fbtn', type: 'button', disabled: f.coins < b.cost,
                onclick: (e) => act('build', { building: b.id }, { btn: e.currentTarget, anchor: e.currentTarget }),
              }, emo('🔨'), `Xây · ${fmt(b.cost)} xu`)));
        }
        const done = own.q.filter((x) => x.e <= t).length;
        const working = own.q.find((x) => x.s <= t && x.e > t);
        const slots = [];
        for (let k = 0; k < own.slots; k++) {
          const x = own.q[k];
          if (!x) {
            slots.push(h('button', { class: 'fslot is-empty', type: 'button', 'aria-label': 'Chỗ trống, bấm để làm món', onclick: () => openRecipes(b.id) }, '+'));
            continue;
          }
          const p = item(x.id);
          if (x.e <= t) {
            slots.push(h('button', {
              class: 'fslot is-done', type: 'button', 'aria-label': `${p.name} đã xong, bấm để lấy`,
              onclick: (e) => act('collect', { building: b.id }, { anchor: e.currentTarget }),
            }, emo(p.emoji)));
          } else if (x.s <= t) {
            slots.push(h('span', { class: 'fslot is-work', 'data-work': `${x.s},${x.e}`, style: `--p:${(((t - x.s) / (x.e - x.s)) * 100).toFixed(1)}%`, role: 'img', 'aria-label': `Đang làm ${p.name}` }, emo(p.emoji)));
          } else {
            slots.push(h('span', { class: 'fslot is-wait', role: 'img', 'aria-label': `${p.name} đang chờ` }, emo(p.emoji)));
          }
        }
        const slotCost = own.slots < S.cat.rules.maxSlots ? S.cat.slotCosts[b.id][own.slots - S.cat.rules.startSlots] : null;
        return h('section', { class: 'fstall' },
          h('div', { class: 'fstall-head' }, emo(b.emoji), h('div', {}, h('h3', { text: b.name }), h('p', { text: b.desc }))),
          h('div', { class: 'fqueue' }, slots),
          h('p', { class: 'fstall-time' }, working
            ? ['Đang làm ', item(working.id).name.toLowerCase(), ', còn ', h('span', { 'data-until-long': String(working.e), text: longLeft(working.e - t) })]
            : done ? `${done} món đã xong, bấm để lấy` : 'Đang rảnh'),
          h('div', { class: 'fstall-actions' },
            done ? h('button', { class: 'fbtn is-gold is-small', type: 'button', onclick: (e) => act('collect', { building: b.id }, { btn: e.currentTarget, anchor: e.currentTarget }) }, emo('🧺'), `Lấy hàng (${done})`) : null,
            h('button', { class: 'fbtn is-small', type: 'button', onclick: () => openRecipes(b.id) }, 'Làm món'),
            slotCost != null
              ? h('button', {
                class: 'fbtn is-ghost is-small', type: 'button', disabled: f.coins < slotCost,
                onclick: (e) => act('addSlot', { building: b.id }, { btn: e.currentTarget, anchor: e.currentTarget }),
              }, `+1 chỗ · ${fmt(slotCost)} xu`)
              : null));
      });
      const doneAll = Object.values(f.buildings).reduce((a, b) => a + b.q.filter((x) => x.e <= t).length, 0);
      return [
        doneAll > 1 ? h('button', { class: 'fbtn is-gold', type: 'button', onclick: (e) => act('collect', { building: 'all' }, { btn: e.currentTarget, anchor: e.currentTarget }) }, emo('🧺'), `Lấy hết ${doneAll} món đã xong`) : null,
        h('div', { class: 'fstalls' }, stalls),
        h('p', { class: 'farm-note', text: 'Mỗi nơi làm lần lượt từng món theo hàng chờ. Món làm xong cần lấy về kho; thêm chỗ để xếp được nhiều món hơn.' }),
      ];
    }

    function openRecipes(bid) {
      const b = S.cat.buildings.find((x) => x.id === bid);
      const draw = (sheet) => {
        const f = S.farm;
        const own = f.buildings[bid];
        if (!own) return;
        const full = own.q.length >= own.slots;
        const list = S.cat.products.filter((p) => p.building === bid).map((p) => {
          const locked = level() < p.level;
          const ins = Object.entries(p.inputs);
          const ok = ins.every(([id, q]) => have(id) >= q);
          return h('div', { class: `frecipe${locked ? ' is-locked' : ''}` },
            emo(p.emoji),
            h('h4', { text: p.name }),
            h('p', { class: 'frecipe-sub', text: locked ? `Mở ở cấp ${p.level}` : `${minutes(p.min)} · bán ~${p.price} xu · +${p.xp} kinh nghiệm` }),
            h('div', { class: 'frecipe-in' }, ins.map(([id, q]) => h('span', { class: `fneed${have(id) < q ? ' is-short' : ''}`, title: item(id).name },
              emo(item(id).emoji), `×${q}`, h('small', { text: ` có ${have(id)}` }), h('span', { class: 'visually-hidden', text: ` ${item(id).name}` })))),
            h('button', {
              class: 'fbtn is-small', type: 'button', disabled: locked || !ok || full,
              'aria-label': `Làm ${p.name}`,
              onclick: async (e) => {
                await act('craft', { building: bid, product: p.id }, { btn: e.currentTarget, anchor: e.currentTarget });
                if (sheetOpen()) draw(sheet);
              },
            }, 'Làm'));
        });
        sheet.querySelector('.sheet-body').replaceChildren(
          h('p', { class: 'farm-note', text: full ? `Hàng chờ đã đầy (${own.slots} chỗ). Chờ món xong rồi lấy hàng, hoặc thêm chỗ.` : `Còn ${own.slots - own.q.length} chỗ trong hàng chờ.` }),
          h('div', { class: 'frecipes' }, list));
      };
      const sheet = openSheet(b.name, h('div'), null);
      draw(sheet);
    }

    /* =========================================================
       Đơn hàng
       ========================================================= */
    function renderOrders() {
      const f = S.farm;
      const t = now();
      const cards = f.orders.map((o) => {
        const who = S.cat.customers[o.who] || { name: 'Khách', emoji: '🧑' };
        if (o.at > t) {
          return h('article', { class: 'forder is-wait' },
            h('div', { class: 'forder-who' }, emo('⏳'), 'Khách đang tới'),
            h('div', { class: 'forder-lines' }, h('span', { 'data-until': String(o.at), text: clock(o.at - t) })));
        }
        const ok = o.items.every(([id, q]) => have(id) >= q);
        return h('article', { class: 'forder', 'aria-label': `Đơn của ${who.name}` },
          h('div', { class: 'forder-who' }, emo(who.emoji), who.name),
          h('div', { class: 'forder-lines' }, o.items.map(([id, q]) => {
            const it = item(id);
            const n = have(id);
            return h('div', { class: `forder-line ${n >= q ? 'is-ok' : 'is-short'}` }, emo(it.emoji), h('span', { text: it.name }), h('b', { text: `${Math.min(n, q)}/${q}${n >= q ? ' ✓' : ''}` }));
          })),
          h('div', { class: 'forder-reward' }, h('span', {}, emo('🪙'), ` ${fmt(o.coins)}`), h('span', {}, emo('⭐'), ` ${o.xp}`)),
          h('div', { class: 'forder-actions' },
            h('button', { class: 'fbtn', type: 'button', disabled: !ok, onclick: (e) => act('deliver', { order: o.id }, { btn: e.currentTarget, anchor: e.currentTarget }) }, 'Giao hàng'),
            h('button', {
              class: 'fbtn is-ghost', type: 'button', 'aria-label': `Đổi đơn của ${who.name}`, title: 'Đổi đơn khác (khách mới tới sau 3 phút)',
              onclick: (e) => act('discard', { order: o.id }, { btn: e.currentTarget }),
            }, emo('🗑️'))));
      });
      return [
        h('div', { class: 'forders' }, cards),
        h('p', { class: 'farm-note', text: 'Giao đơn được nhiều xu hơn bán ở chợ, kèm kinh nghiệm. Đơn khó quá thì đổi đơn khác, khách mới tới sau 3 phút.' }),
      ];
    }

    /* =========================================================
       Kho, chợ, cửa hàng
       ========================================================= */
    function neededByOrders() {
      const need = {};
      const t = now();
      for (const o of S.farm.orders) if (o.at <= t) for (const [id, q] of o.items) need[id] = (need[id] || 0) + q;
      return need;
    }

    function renderStorage() {
      const f = S.farm;
      const m = S.market;
      const used = f.used;
      const pct = Math.min(100, (used / f.storage) * 100);
      const capIdx = (f.storage - S.cat.rules.startStorage) / S.cat.rules.storageStep;
      const capCost = f.storage < S.cat.rules.maxStorage ? S.cat.storageCosts[capIdx] : null;
      const need = neededByOrders();
      const hot = m && item(m.hot);
      const groups = KINDS.map(([kind, label]) => {
        const rows = Object.entries(f.inv)
          .filter(([id, n]) => n > 0 && item(id).kind === kind)
          .sort((a, b) => item(b[0]).price - item(a[0]).price)
          .map(([id, n]) => {
            const it = item(id);
            const pr = m && m.prices[id] ? m.prices[id] : { price: it.price, trend: 0 };
            return h('div', { class: 'fitem' },
              emo(it.emoji),
              h('div', { class: 'fitem-name' }, it.name, h('span', { text: `×${n}` })),
              h('div', { class: 'fitem-sub' },
                `${fmt(pr.price)} xu/cái `,
                pr.trend ? h('span', { class: pr.trend > 0 ? 'is-up' : 'is-down', text: pr.trend > 0 ? '▲' : '▼', 'aria-label': pr.trend > 0 ? 'giá tăng' : 'giá giảm' }) : null,
                m && m.hot === id ? h('span', { class: 'is-up', text: ' · đang hot' }) : null,
                need[id] ? h('span', { class: 'is-need', text: ` · đơn hàng cần ${need[id]}` }) : null),
              h('div', { class: 'fitem-actions' },
                h('button', { class: 'fbtn is-soft is-small', type: 'button', 'aria-label': `Bán 1 ${it.name}`, onclick: (e) => act('sell', { item: id, qty: 1 }, { btn: e.currentTarget, anchor: e.currentTarget }) }, 'Bán 1'),
                n > 1 ? h('button', {
                  class: 'fbtn is-small', type: 'button', 'aria-label': `Bán hết ${n} ${it.name}`,
                  onclick: (e) => {
                    if (need[id] && !window.confirm(`Đơn hàng đang cần ${need[id]} ${it.name.toLowerCase()}. Vẫn bán hết?`)) return;
                    act('sell', { item: id, qty: n }, { btn: e.currentTarget, anchor: e.currentTarget });
                  },
                }, `Bán hết · ${fmt(pr.price * n)}`) : null));
          });
        return rows.length ? h('section', { class: 'fstock' }, h('h3', { text: label }), rows) : null;
      }).filter(Boolean);

      return [
        h('div', { class: 'fcap' },
          h('div', { class: 'fcap-row' }, emo('📦'), h('strong', { style: 'flex:1', text: `Kho: ${used}/${f.storage}` }),
            capCost != null ? h('button', {
              class: 'fbtn is-soft is-small', type: 'button', disabled: f.coins < capCost,
              onclick: (e) => act('upgradeStorage', {}, { btn: e.currentTarget, anchor: e.currentTarget }),
            }, `+${S.cat.rules.storageStep} chỗ · ${fmt(capCost)} xu`) : null),
          h('div', { class: `fcap-bar${pct >= 100 ? ' is-full' : pct >= 85 ? ' is-warn' : ''}` }, h('i', { style: `--p:${pct}%` }))),
        hot ? h('div', { class: 'fhot' }, emo(hot.emoji), h('p', {}, h('b', { text: `Hôm nay ${hot.name.toLowerCase()} đang hot` }), `: bán ở chợ được giá gấp rưỡi${level() < hot.level ? ` (món này mở ở cấp ${hot.level})` : ''}. Giá các món đổi mỗi ngày.`)) : null,
        groups.length ? groups : h('p', { class: 'farm-note', text: 'Kho đang trống. Thu hoạch ở Ruộng hoặc làm món ở mục Chế biến để có hàng bán.' }),
        h('h2', { class: 'farm-h2' }, emo('🛒'), 'Cửa hàng'),
        h('div', { class: 'fshop' }, dogDeal(), S.cat.decor.map(decorDeal)),
        h('p', { class: 'farm-credit', text: 'Hình biểu tượng: Twemoji (CC-BY 4.0). Âm thanh tự tổng hợp cho Think.' }),
      ];
    }

    function dogDeal() {
      const f = S.farm;
      const R = S.cat.rules;
      const locked = level() < R.dogLevel;
      return h('div', { class: `fdeal${f.dog ? ' is-owned' : locked ? ' is-locked' : ''}` },
        emo('🐕'), h('h4', { text: 'Chó giữ vườn' }),
        h('p', { text: `Đuổi kẻ hái trộm (${Math.round(R.dogCatch * 100)}% bắt được, phải đền ${R.dogFine} xu)` }),
        f.dog ? h('span', { class: 'fchip', text: 'Đã có' })
          : locked ? h('span', { class: 'fchip' }, emo('🔒'), `Cấp ${R.dogLevel}`)
            : h('button', { class: 'fbtn is-small', type: 'button', disabled: f.coins < R.dogCost, onclick: (e) => act('buyDog', {}, { btn: e.currentTarget, anchor: e.currentTarget }) }, `${fmt(R.dogCost)} xu`));
    }
    function decorDeal(d) {
      const f = S.farm;
      const owned = (f.decor || []).includes(d.id);
      const locked = level() < d.level;
      return h('div', { class: `fdeal${owned ? ' is-owned' : locked ? ' is-locked' : ''}` },
        emo(d.emoji), h('h4', { text: d.name }), h('p', { text: `Trang trí sân vườn, +${d.beauty} điểm vườn đẹp` }),
        owned ? h('span', { class: 'fchip', text: 'Đã có' })
          : locked ? h('span', { class: 'fchip' }, emo('🔒'), `Cấp ${d.level}`)
            : h('button', { class: 'fbtn is-small', type: 'button', disabled: f.coins < d.cost, onclick: (e) => act('buyDecor', { decor: d.id }, { btn: e.currentTarget, anchor: e.currentTarget }) }, `${fmt(d.cost)} xu`));
    }

    /* =========================================================
       Bạn bè: bảng xếp hạng, ghé vườn, nhật ký
       ========================================================= */
    async function loadSocial() {
      try {
        const [fr, lb] = await Promise.all([api('/api/farm/friends'), api('/api/farm/leaderboard')]);
        S.skew = fr.now - Date.now();
        S.friends = fr.friends;
        S.board = lb;
      } catch (err) {
        if (!S.friends) S.friends = [];
        toast(err.message);
      }
      render();
    }

    function renderFriends() {
      const f = S.farm;
      if (!S.friends) {
        loadSocial();
        return h('div', { class: 'farm-loading' }, h('p', { text: 'Đang xem vườn của mọi người…' }));
      }
      const R = S.cat.rules;
      const medal = (i) => (i < 3 ? emo(['🥇', '🥈', '🥉'][i], '', `Hạng ${i + 1}`) : h('span', { class: 'frank-n', text: String(i + 1) }));
      const rows = S.board
        ? (S.boardTab === 'level' ? S.board.level : S.board.week).slice(0, 10).map((r, i) => h('li', { class: r.userId === meId() ? 'is-me' : '' },
          medal(i), avatarEl(userOf(r.userId), 'avatar-sm', { dot: false }),
          h('span', { class: 'frank-name', text: r.userId === meId() ? `${nameOf(r.userId)} (bạn)` : nameOf(r.userId) }),
          h('strong', { text: S.boardTab === 'level' ? `Cấp ${r.level}` : `${fmt(r.coins)} xu` })))
        : [];
      const friends = S.friends.map((x) => h('div', { class: 'ffriend' },
        avatarEl(userOf(x.userId), 'avatar-sm', { dot: false }),
        h('div', { class: 'ffriend-main' },
          h('strong', { text: nameOf(x.userId) }),
          h('div', { class: 'fchips' },
            h('span', { class: 'fchip', text: `Cấp ${x.level}` }),
            x.stealable ? h('span', { class: 'fchip is-hot' }, emo('🧺'), `${x.stealable} ô hái được`) : null,
            x.bugs ? h('span', { class: 'fchip is-hot' }, emo('🐛'), `${x.bugs} con sâu`) : null,
            x.dog ? h('span', { class: 'fchip' }, emo('🐕'), 'Có chó') : null)),
        h('button', { class: 'fbtn is-soft is-small', type: 'button', onclick: () => navigate(`#/farm/u/${x.userId}`) }, 'Ghé vườn')));
      const t = now();
      const log = (f.log || []).slice(0, 15).map((e) => {
        const crop = e.c ? item(e.c) : null;
        const who = nameOf(e.by);
        const text = e.type === 'help'
          ? `${who} bắt sâu giúp ruộng ${crop ? crop.name.toLowerCase() : ''}`
          : e.type === 'caught'
            ? `Chó đuổi ${who} khỏi vườn, ${who} đền ${e.coins} xu`
            : `${who} hái trộm 1 ${crop ? crop.name.toLowerCase() : ''}`;
        return h('li', {}, emo(e.type === 'help' ? '🐛' : e.type === 'caught' ? '🐕' : '😤'), h('span', { text }), h('time', { text: ago(e.t, t) }));
      });
      return [
        h('div', { style: 'display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap' },
          h('h2', { class: 'farm-h2' }, emo('🏆'), 'Bảng xếp hạng'),
          h('div', { class: 'fseg', role: 'group', 'aria-label': 'Xếp theo' },
            [['level', 'Cấp độ'], ['week', 'Xu tuần này']].map(([k, label]) => h('button', {
              type: 'button', 'aria-pressed': S.boardTab === k ? 'true' : 'false',
              onclick: () => { S.boardTab = k; render(); },
            }, label)))),
        rows.length ? h('ol', { class: 'frank' }, rows) : h('p', { class: 'farm-note', text: S.boardTab === 'week' ? 'Tuần này chưa ai bán được hàng. Giao đơn hoặc bán ở chợ để lên bảng.' : 'Chưa có ai.' }),
        h('h2', { class: 'farm-h2' }, emo('👥'), 'Ghé vườn bạn bè'),
        h('p', { class: 'farm-note', text: `Bắt sâu giúp bạn được ${R.helpCoins} xu mỗi con. Cây chín chưa hái thì hái trộm được 1 sản phẩm mỗi ô (mỗi ngày tối đa ${R.stealsPerDay} lần, ${R.stealsPerFarmPerDay} lần mỗi vườn). Hôm nay bạn đã giúp ${f.helps}/${R.helpsPerDay} lần, hái trộm ${f.steals}/${R.stealsPerDay} lần.` }),
        friends.length ? h('div', { class: 'ffriends' }, friends) : h('p', { class: 'farm-note', text: 'Chưa ai khác có nông trại. Rủ cả nhóm vào chơi nhé!' }),
        h('h2', { class: 'farm-h2' }, emo('📒'), 'Nhật ký vườn'),
        log.length ? h('ul', { class: 'flog' }, log) : h('p', { class: 'farm-note', text: 'Chưa ai ghé vườn của bạn.' }),
      ];
    }

    function renderVisit() {
      if (S.visitError) {
        return h('div', { class: 'farm-error' }, h('p', { text: S.visitError }), h('button', { class: 'fbtn', type: 'button', onclick: () => navigate('#/farm', { replace: true }) }, 'Về vườn của mình'));
      }
      const v = S.visitFarm;
      if (!v || !S.cat) return h('div', { class: 'farm-loading' }, emo('🚜'), h('p', { text: 'Đang sang vườn bạn…' }));
      const t = now();
      const R = S.cat.rules;
      const me = S.farm;
      return [
        h('div', { class: 'fvisit-bar' }, avatarEl(userOf(S.visit), 'avatar-sm', { dot: false }),
          h('span', {}, `Bấm vào con sâu để bắt giúp (+${R.helpCoins} xu). Ô có chữ "Hái trộm" thì hái được 1 sản phẩm.`,
            v.dog ? h('b', { text: ' Vườn này có chó giữ vườn, coi chừng bị cắn!' }) : null,
            me ? ` Hôm nay: giúp ${me.helps}/${R.helpsPerDay}, hái trộm ${me.steals}/${R.stealsPerDay}.` : '')),
        yard(v.decor, v.dog),
        h('div', { class: 'fgrid', role: 'list', 'aria-label': `Ruộng của ${nameOf(S.visit)}` }, v.plots.map((pl, i) => plotEl(pl, i, t, { visiting: true }))),
      ];
    }

    async function tapVisit(i, el) {
      const v = S.visitFarm;
      const pl = v.plots[i];
      const t = now();
      let action = null;
      if (pl.bug) action = 'help';
      else if (pl.c && pl.r <= t && pl.canSteal) action = 'steal';
      if (!action) {
        if (!pl.c) toast('Ô đất trống.');
        else if (pl.r > t) toast(`${item(pl.c).name} còn ${longLeft(pl.r - t)} nữa mới chín.`);
        else if (pl.st === 'me') toast('Bạn đã hái ô này rồi.');
        else toast('Ô này không hái được nữa, để lại cho chủ vườn nhé.');
        return;
      }
      if (action === 'steal') flyToStore(item(pl.c).emoji, el);
      try {
        const id = S.visit;
        const data = await api(`/api/farm/u/${id}/act`, { method: 'POST', body: { action, plot: i } });
        if (S.visit !== id) return;
        S.visitFarm = data.farm;
        const before = S.farm;
        applyFarm(data.me, data.now);
        const r = data.result;
        const rect = el.getBoundingClientRect();
        render();
        if (action === 'help') {
          play('bug');
          floatText([h('span', {}, emo('🪙'), `+${r.coins}`), h('span', {}, emo('⭐'), `+${r.xp}`)], rect);
        } else if (r.caught) {
          play('dog');
          toast(`Bị chó giữ vườn đuổi! Bạn phải đền ${r.fine} xu cho ${nameOf(id)}.`);
        } else {
          play('steal');
          floatText([h('span', {}, emo(item(r.item).emoji), '+1')], rect);
        }
        if (before && S.farm.coins !== before.coins) bumpCoins();
        if (r.levelUps && r.levelUps.length) setTimeout(() => showLevelUp(r.levelUps), 350);
      } catch (err) {
        play('error');
        toast(err.message);
        loadVisit();
      }
    }

    /* =========================================================
       Bảng trượt
       ========================================================= */
    let layer = null;
    let hideTimer = null;
    function ensureLayer() {
      if (layer) return layer;
      layer = h('div', { class: 'sheet-layer farm-layer', hidden: true },
        h('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }),
        h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }));
      // Esc đóng bảng (kể cả khi nút vừa bấm đã bị vẽ lại, tiêu điểm rơi ra ngoài bảng)
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });
      layer.addEventListener('pointerdown', unlockAudio, { capture: true });
      document.body.append(layer);
      window.addEventListener('popstate', () => {
        if (layer && !layer.hidden && !(history.state && history.state.farmSheet)) closeSheet(true);
      });
      return layer;
    }
    const sheetOpen = () => Boolean(layer && !layer.hidden && layer.classList.contains('open'));
    function openSheet(title, body, foot) {
      const l = ensureLayer();
      const sheet = l.querySelector('.sheet');
      sheet.setAttribute('aria-label', title);
      sheet.replaceChildren(
        h('header', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onclick: () => closeSheet() }, icon('close'))),
        h('div', { class: 'sheet-body' }, body),
        ...(foot ? [h('div', { class: 'sheet-foot' }, foot)] : []));
      if (l.hidden || !l.classList.contains('open')) {
        clearTimeout(hideTimer);
        if (!(history.state && history.state.farmSheet)) history.pushState({ ...(history.state || {}), farmSheet: true }, '', location.hash || '#/farm');
        l.hidden = false;
        void l.offsetWidth;
        l.classList.add('open');
      }
      sheet.focus({ preventScroll: true });
      return sheet;
    }
    function closeSheet(silent) {
      if (!layer || layer.hidden) return;
      if (!silent && history.state && history.state.farmSheet) {
        history.back();
        return;
      }
      layer.classList.remove('open');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!layer.classList.contains('open')) layer.hidden = true;
      }, 220);
    }

    function showLevelUp(ups) {
      const last = ups[ups.length - 1];
      const coins = ups.reduce((a, u) => a + u.coins, 0);
      const unlocks = ups.flatMap((u) => u.unlocks);
      const nameOfUnlock = (id) => {
        if (id === 'dog') return { name: 'Chó giữ vườn', emoji: '🐕' };
        return S.items[id] || S.cat.buildings.find((b) => b.id === id) || S.cat.decor.find((d) => d.id === id) || { name: id, emoji: '✨' };
      };
      play('levelup');
      openSheet('Lên cấp!', h('div', { class: 'flevelup' },
        emo('🎉', 'is-big'),
        h('h3', { text: `Cấp ${last.level}` }),
        h('p', {}, 'Thưởng ', h('b', { text: `${fmt(coins)} xu` }), '.'),
        unlocks.length ? h('p', { class: 'farm-note', text: 'Vừa mở khóa:' }) : null,
        unlocks.length ? h('ul', {}, unlocks.map((id) => {
          const u = nameOfUnlock(id);
          return h('li', {}, emo(u.emoji), h('span', { text: u.name }));
        })) : null),
      h('button', { class: 'fbtn', type: 'button', style: 'width:100%', onclick: () => closeSheet() }, 'Tuyệt!'));
    }

    function openHelp() {
      openSheet('Cách chơi', h('div', { class: 'farm-help' }, h('ul', {},
        h('li', {}, emo('🌱'), h('span', { text: 'Ruộng: bấm ô trống để gieo hạt (lúa mì miễn phí). Cây lớn cả khi bạn tắt máy; chín rồi bấm để thu hoạch.' })),
        h('li', {}, emo('🏭'), h('span', { text: 'Chế biến: xây máy xay, chuồng gà, chuồng bò, xưởng, bếp, quầy nước… rồi làm trứng, sữa, đường, trân châu, mì cay, trà sữa…' })),
        h('li', {}, emo('📋'), h('span', { text: 'Đơn hàng: khách đặt mua, giao đủ hàng được nhiều xu và kinh nghiệm hơn bán ở chợ.' })),
        h('li', {}, emo('📦'), h('span', { text: 'Kho: bán hàng ở chợ (giá đổi mỗi ngày, có món hot giá gấp rưỡi), nâng kho, mua chó giữ vườn và đồ trang trí.' })),
        h('li', {}, emo('⭐'), h('span', { text: 'Thu hoạch, làm món, giao đơn đều có kinh nghiệm. Lên cấp được thưởng xu và mở thêm cây, món, ô đất.' })),
        h('li', {}, emo('👥'), h('span', { text: 'Bạn bè: ghé vườn nhau để bắt sâu giúp hoặc hái trộm cây chín. Bảng xếp hạng theo cấp và theo xu kiếm được mỗi tuần.' })),
        h('li', {}, emo('🎁'), h('span', { text: 'Mỗi ngày ghé nhận quà, ghé liên tục thì quà tăng dần.' }))),
      h('p', { class: 'farm-credit', text: 'Hình biểu tượng: Twemoji (CC-BY 4.0). Âm thanh tự tổng hợp cho Think.' })), null);
    }

    /* ---------------- Sự kiện realtime, trang Trò chơi ---------------- */
    function onEvent(data) {
      if (!data || !S.farm) return;
      const who = nameOf(data.by);
      const crop = data.item ? item(data.item).name.toLowerCase() : 'rau';
      if (data.type === 'steal') toast(`${who} vừa hái trộm ${crop} của bạn! 😤`);
      else if (data.type === 'caught') toast(`Chó nhà bạn vừa đuổi ${who} khỏi vườn 🐕`);
      else if (data.type === 'help') toast(`${who} vừa bắt sâu giúp ruộng ${crop} của bạn 🐛`);
      if (isMounted() && data.type === 'caught') play('dog');
      load();
    }

    /** Cho thẻ ở trang Trò chơi */
    function summary() {
      const f = S.farm;
      if (!f) return null;
      const b = badges();
      return { level: f.level, coins: f.coins, ripe: b.field, done: b.build, orders: b.orders, plots: f.plots.length };
    }

    function reset() {
      unmount();
      S.farm = null;
      S.visit = null;
      S.visitFarm = null;
      S.friends = null;
      S.board = null;
      S.error = null;
    }

    return { mount, unmount, isMounted, open, load, summary, onEvent, reset, _test: { emojiKey, clock } };
  }

  return { create, emojiKey, emo };
})();
