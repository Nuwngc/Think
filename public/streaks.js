'use strict';
/* Chuỗi hằng ngày của mọi game (máy chủ: src/streaks.js).
   - Mỗi game có chuỗi riêng + "chuỗi chơi game" chung: ngày nào có chơi thì chuỗi tăng 1, bỏ một ngày là về 0.
   - Game chạy trên máy (Xếp Khối, cờ caro với máy) gọi ThinkStreaks.mark(game, uid): ngày chơi lưu trên máy,
     có mạng thì gửi lên (chơi lúc mất mạng vẫn được tính, như điểm Xếp Khối).
   - app.js tạo một bản (ThinkStreaks.create) dùng chung: huy hiệu 🔥 trên thẻ game, khung chuỗi ở trang Trò chơi,
     huy hiệu trong từng game (ThinkStreaks.instance.badge('chess')), bảng chi tiết, chúc mừng khi đạt mốc. */
window.ThinkStreaks = (() => {
  const KEY_DAYS = 'streak-days-v1';
  const TZ = 7 * 3600 * 1000;
  const WD = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const SVG = 'http://www.w3.org/2000/svg';
  const dayKey = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);

  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_DAYS) || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    try { localStorage.setItem(KEY_DAYS, JSON.stringify(list.slice(-120))); } catch { /* hết chỗ / ẩn danh */ }
  };

  let inst = null;
  /** Ngày chơi đã gửi xong trong lần mở trang này ("uid|game|day"): khỏi gửi lại sau mỗi nước đi */
  const sent = new Set();

  /** Ghi nhận hôm nay có chơi `game` (game chạy trên máy). uid = null: chơi lúc chưa đăng nhập, tính cho người đăng nhập sau. */
  function mark(game, uid = null) {
    const day = dayKey();
    const who = uid == null ? null : uid;
    // Đã gửi ngày này trong lần mở trang này thì thôi. (Không so với "hôm nay" của máy chủ: đồng hồ điện thoại có thể lệch)
    if (who != null && sent.has(`${who}|${game}|${day}`)) return;
    const list = read();
    if (!list.some((x) => x.game === game && x.day === day && x.uid === who)) {
      list.push({ game, day, uid: who, t: Date.now() }); // t: lúc chơi (máy chủ tự trừ độ lệch đồng hồ điện thoại)
      write(list);
    }
    if (inst) inst.flushSoon();
  }

  /** Gửi các ngày đã chơi lên máy chủ; trả về bảng chuỗi mới nhất (hoặc null). stillMe(): còn đúng người đăng nhập không */
  async function flush(api, uid, stillMe = () => true) {
    if (!api || uid == null) return null;
    const mine = read().filter((x) => x.uid == null || x.uid === uid);
    if (!mine.length) return null;
    let summary = null;
    const games = [...new Set(mine.map((x) => x.game))];
    for (const game of games) {
      if (!stillMe()) break; // vừa đăng xuất / đổi người: để dành cho đúng người
      const rows = mine.filter((x) => x.game === game);
      const days = [...new Set(rows.map((x) => x.day))];
      const plays = rows.map((x) => ({ day: x.day, t: x.t }));
      try {
        summary = await api('/api/streaks/played', { method: 'POST', body: { game, days, plays, now: Date.now() } });
        for (const d of days) sent.add(`${uid}|${game}|${d}`);
      } catch (err) {
        // Mất mạng, máy chủ lỗi, hết phiên đăng nhập, phải đổi mật khẩu: để lần sau gửi lại
        if (!err || !err.status || err.status >= 500 || [401, 403, 429].includes(err.status)) continue;
      }
      // Đã nhận (hoặc máy chủ từ chối hẳn): bỏ khỏi hàng chờ
      write(read().filter((x) => !(x.game === game && days.includes(x.day) && (x.uid == null || x.uid === uid))));
    }
    return summary;
  }

  /** Bông tuyết của "đóng băng chuỗi" (vẽ bằng nét, máy Android cũ không có emoji 🧊) */
  function ice(cls = '') {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `streak-ice${cls ? ` ${cls}` : ''}`);
    svg.setAttribute('aria-hidden', 'true');
    for (const deg of [0, 60, 120]) {
      const g = document.createElementNS(SVG, 'path');
      g.setAttribute('d', 'M12 2.5v19M9.2 4.6 12 7.2l2.8-2.6M9.2 19.4 12 16.8l2.8 2.6');
      g.setAttribute('transform', `rotate(${deg} 12 12)`);
      svg.append(g);
    }
    return svg;
  }

  /** Hình ngọn lửa (lit = đang cháy) */
  function flame(lit = true, cls = '') {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `streak-flame${lit ? ' is-lit' : ''}${cls ? ` ${cls}` : ''}`);
    svg.setAttribute('aria-hidden', 'true');
    const outer = document.createElementNS(SVG, 'path');
    outer.setAttribute('class', 'streak-flame-outer');
    outer.setAttribute('d', 'M12.6 1.5c.5 3 2.9 4.6 4.3 6.9 1.6 2.6 1.8 5.9-.1 8.4a6.6 6.6 0 0 1-11.6-2.5c-.5-2.6.6-4.9 2.5-6.6-.1 1.8.5 3.2 1.8 4 0-4.2 1.3-7.6 3.1-10.2z');
    const inner = document.createElementNS(SVG, 'path');
    inner.setAttribute('class', 'streak-flame-inner');
    inner.setAttribute('d', 'M12.3 11.6c1.9 1.6 3 3.2 2.6 5.2a2.9 2.9 0 0 1-5.7.3c-.3-1.9 1-3.4 3.1-5.5z');
    svg.append(outer, inner);
    return svg;
  }

  function create(host) {
    const { h, api, state, toast } = host;
    const KEY_ICE = 'streak-freeze-seen-v1';
    // gen tăng mỗi lần đăng xuất: phản hồi của người cũ về muộn thì bỏ
    const S = { data: null, loading: null, flushTimer: null, gen: 0 };
    const me = () => (state.me ? state.me.id : null);

    async function load() {
      if (!me()) return null;
      if (S.loading) return S.loading;
      const g0 = S.gen;
      const uid = me();
      const p = (async () => {
        try {
          const data = await api('/api/streaks');
          if (g0 !== S.gen) return;
          S.data = data;
          announceFreeze(uid);
          const fresh = await flush(api, uid, () => g0 === S.gen && me() === uid);
          if (fresh && g0 === S.gen) S.data = fresh;
        } catch { /* thôi, lần sau tải lại */ } finally {
          if (S.loading === p) S.loading = null;
        }
        if (g0 === S.gen) refresh();
      })();
      S.loading = p;
      return p;
    }
    function flushSoon() {
      clearTimeout(S.flushTimer);
      S.flushTimer = setTimeout(async () => {
        const uid = me();
        if (!uid || !navigator.onLine) return;
        const g0 = S.gen;
        const fresh = await flush(api, uid, () => g0 === S.gen && me() === uid).catch(() => null);
        if (fresh && g0 === S.gen) {
          S.data = fresh;
          refresh();
        }
      }, 1500);
    }
    /** Máy chủ vừa dùng lượt đóng băng cho ngày quên chơi: báo một lần (mỗi ngày, mỗi người) */
    function announceFreeze(uid) {
      const used = (S.data && S.data.freeze && S.data.freeze.used) || [];
      if (!used.length || !toast) return;
      let seen = {};
      try { seen = JSON.parse(localStorage.getItem(KEY_ICE) || '{}') || {}; } catch { seen = {}; }
      const mine = Array.isArray(seen[uid]) ? seen[uid] : [];
      const fresh = used.filter((d) => !mine.includes(d));
      if (!fresh.length) return;
      seen[uid] = [...mine, ...fresh].slice(-14);
      try { localStorage.setItem(KEY_ICE, JSON.stringify(seen)); } catch { /* thôi */ }
      const o = S.data.overall;
      toast(`❄️ Hôm ${fresh.length > 1 ? 'trước' : 'qua'} bạn quên chơi — đã dùng ${fresh.length} lượt đóng băng để giữ chuỗi${o && o.current ? ` ${o.current} ngày` : ''}.`);
    }

    /** Hôm nay `who` đã chơi `game` (máy chủ đã ghi) */
    const playedToday = (game, day, who) => who === me() && S.data && S.data.today === day && Boolean(gameOf(game) && gameOf(game).today);

    const gameOf = (id) => (S.data && S.data.games ? S.data.games.find((g) => g.id === id) : null) || null;
    const labelFor = (i) => WD[((S.data ? S.data.weekStartDay : 0) + i) % 7];

    /* ---------------- Cập nhật ở mọi chỗ đang hiện ---------------- */
    function refresh() {
      for (const el of document.querySelectorAll('.streak-badge[data-game]')) fillBadge(el);
      if (layer && !layer.hidden && layer.dataset.kind === 'detail') drawDetail();
      if (host.onChange) host.onChange();
    }

    /** Sự kiện realtime: vừa ghi ngày chơi mới */
    function onUpdate(evt) {
      if (!evt || !evt.summary) return;
      S.data = evt.summary;
      refresh();
      if (!evt.isToday) return;
      if (evt.milestone || evt.overallMilestone) {
        celebrate(evt);
      } else if (toast) {
        toast(evt.current <= 1
          ? `🔥 Bắt đầu chuỗi ${evt.name}! Mai chơi tiếp để chuỗi tăng.`
          : `🔥 Chuỗi ${evt.name}: ${evt.current} ngày liên tiếp!`);
      }
    }

    /* ---------------- Mảnh giao diện ---------------- */
    /** showIce: hiện ngày đóng băng (thẻ từng game: chỉ khi chuỗi game đó còn) */
    function week(list, cls = '', showIce = true) {
      const frozen = (showIce && S.data && S.data.freeze && S.data.freeze.week) || [];
      const nFrozen = list.filter((on, i) => !on && frozen[i]).length;
      return h('ol', { class: `streak-week ${cls}`.trim(), 'aria-label': `7 ngày gần nhất: ${list.filter(Boolean).length} ngày có chơi${nFrozen ? `, ${nFrozen} ngày đóng băng` : ''}` },
        list.map((on, i) => {
          const iced = !on && Boolean(frozen[i]);
          return h('li', { class: `${on ? 'is-on' : ''}${iced ? ' is-frozen' : ''}${i === 6 ? ' is-today' : ''}`.trim() },
            h('span', { class: 'streak-dot' }, on ? flame(true) : iced ? ice() : null),
            h('small', { text: i === 6 ? 'Nay' : labelFor(i) }));
        }));
    }

    /** Số lượt đóng băng còn lại (null = máy chủ cũ chưa có) */
    function freezePill(cls = '') {
      const f = S.data && S.data.freeze;
      if (!f) return null;
      return h('span', { class: `streak-freeze-pill${f.count ? '' : ' is-empty'}${cls ? ` ${cls}` : ''}`, title: `Còn ${f.count} lượt đóng băng chuỗi`, 'aria-label': `Còn ${f.count} lượt đóng băng chuỗi` },
        ice(), String(f.count));
    }

    /** Nhãn chuỗi trên thẻ game ở trang Trò chơi (null = chưa có chuỗi) */
    function chip(id) {
      const g = gameOf(id);
      if (!g || !g.current) return null;
      return h('span', {
        class: `game-chip is-streak${g.atRisk ? ' is-risk' : ''}`,
        'aria-label': g.atRisk ? `Chuỗi ${g.current} ngày, chơi hôm nay để giữ chuỗi` : `Chuỗi ${g.current} ngày`,
      }, flame(!g.atRisk), g.atRisk ? `${g.current} ngày · sắp đứt` : `${g.current} ngày`);
    }

    function fillBadge(el) {
      const g = gameOf(el.dataset.game);
      const n = g ? g.current : 0;
      el.classList.toggle('is-lit', Boolean(g && g.today));
      el.classList.toggle('is-risk', Boolean(g && g.atRisk));
      el.setAttribute('aria-label', g
        ? `Chuỗi ${g.name}: ${n} ngày${g.atRisk ? ', chơi hôm nay để giữ chuỗi' : g.today ? ', hôm nay đã chơi' : ''}. Xem chi tiết`
        : 'Chuỗi hằng ngày');
      el.title = el.getAttribute('aria-label');
      el.replaceChildren(flame(Boolean(g && g.today)), h('span', { text: String(n) }));
    }

    /** Huy hiệu chuỗi đặt trong từng game (tự cập nhật) */
    function badge(id) {
      if (!me()) return null;
      const el = h('button', { class: 'streak-badge', type: 'button', dataset: { game: id }, onclick: (e) => { e.stopPropagation(); openDetail(id); } });
      fillBadge(el);
      if (!S.data && !S.loading) load();
      return el;
    }

    /** Khung chuỗi chung ở đầu trang Trò chơi */
    function hero() {
      const o = S.data && S.data.overall;
      if (!o) return null;
      const title = o.current ? `${o.current} ngày liên tiếp chơi game` : 'Chuỗi chơi game';
      const line = o.today
        ? `Hôm nay đã giữ chuỗi${o.best > o.current ? ` · Kỷ lục ${o.best} ngày` : o.current > 1 ? ' · Kỷ lục mới!' : ''}`
        : o.atRisk ? 'Chơi một game hôm nay để giữ chuỗi!' : 'Ngày nào cũng chơi một chút để chuỗi lớn dần.';
      return h('section', {
        class: `streak-hero${o.atRisk ? ' is-risk' : ''}${o.today ? ' is-lit' : ''}`,
        role: 'button',
        tabindex: '0',
        'aria-label': `${title}. ${line}. Xem chuỗi từng game`,
        onclick: () => openDetail(null),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(null); } },
      },
      h('div', { class: 'streak-hero-flame' }, flame(o.today || o.current > 0), h('strong', { text: String(o.current) })),
      h('div', { class: 'streak-hero-main' },
        h('div', { class: 'streak-hero-head' }, h('h3', { text: title }), freezePill()),
        h('p', { text: line }),
        week(o.week)),
      h('span', { class: 'streak-hero-more', 'aria-hidden': 'true', text: '›' }));
    }

    /* ---------------- Bảng chi tiết, chúc mừng ---------------- */
    let layer = null;
    let focusGame = null;
    function ensureLayer() {
      if (layer) return layer;
      layer = h('div', { class: 'sheet-layer streak-layer', hidden: true },
        h('div', { class: 'sheet-backdrop', onclick: () => close() }),
        h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && layer && !layer.hidden) close(); });
      document.body.append(layer);
      return layer;
    }
    function show(kind, title, body, foot) {
      const l = ensureLayer();
      l.dataset.kind = kind;
      const sheet = l.querySelector('.sheet');
      sheet.setAttribute('aria-label', title);
      sheet.replaceChildren(
        h('header', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onclick: () => close() }, host.icon ? host.icon('close') : '×')),
        h('div', { class: 'sheet-body' }, body),
        ...(foot ? [h('div', { class: 'sheet-foot' }, foot)] : []));
      if (l.hidden) {
        l.hidden = false;
        void l.offsetWidth;
      }
      l.classList.add('open'); // kể cả lúc bảng cũ đang đóng dở
      sheet.focus({ preventScroll: true });
    }
    function close() {
      if (!layer || layer.hidden) return;
      layer.classList.remove('open');
      setTimeout(() => { if (!layer.classList.contains('open')) layer.hidden = true; }, 220);
    }

    function openDetail(id) {
      focusGame = id;
      if (!S.data) load();
      drawDetail();
    }
    function drawDetail() {
      const d = S.data;
      if (!d) {
        show('detail', 'Chuỗi hằng ngày', h('p', { class: 'streak-note', text: 'Đang tải…' }));
        return;
      }
      const o = d.overall;
      const rows = d.games.map((g) => h('li', { class: `streak-row${g.id === focusGame ? ' is-focus' : ''}${g.atRisk ? ' is-risk' : ''}` },
        h('div', { class: 'streak-row-main' },
          h('strong', { text: g.name }),
          h('small', { text: g.atRisk ? 'Chơi hôm nay để giữ chuỗi' : g.today ? 'Hôm nay đã chơi' : g.best ? `Kỷ lục ${g.best} ngày` : 'Chưa có chuỗi' }),
          week(g.week, 'is-small', g.current > 0)),
        h('div', { class: `streak-row-count${g.today ? ' is-lit' : ''}`, 'aria-label': `${g.current} ngày, kỷ lục ${g.best} ngày` },
          flame(g.today), h('span', { text: String(g.current) }))));
      const reached = Math.max(o.best, ...d.games.map((g) => g.best));
      const toggle = h('input', {
        type: 'checkbox',
        checked: d.remind,
        onchange: async (e) => {
          const on = e.target.checked;
          try {
            S.data = await api('/api/streaks/prefs', { method: 'POST', body: { remind: on } });
          } catch (err) {
            e.target.checked = !on;
            if (toast) toast(err.message);
          }
        },
      });
      show('detail', 'Chuỗi hằng ngày', [
        h('div', { class: 'streak-top' },
          h('div', { class: `streak-big${o.today ? ' is-lit' : ''}` }, flame(o.today || o.current > 0), h('strong', { text: String(o.current) })),
          h('div', {},
            h('h3', { text: o.current ? `${o.current} ngày liên tiếp chơi game` : 'Chưa có chuỗi chơi game' }),
            h('p', { class: 'streak-note', text: o.best ? `Kỷ lục: ${o.best} ngày` : 'Chơi game bất kỳ hôm nay để bắt đầu.' }),
            week(o.week))),
        h('ul', { class: 'streak-rows' }, rows),
        d.freeze ? h('div', { class: 'streak-freeze' },
          h('div', { class: 'streak-freeze-icons', 'aria-hidden': 'true' },
            Array.from({ length: d.freeze.max }, (_, i) => h('span', { class: i < d.freeze.count ? 'is-have' : '' }, ice()))),
          h('div', {},
            h('b', { text: `Đóng băng chuỗi: còn ${d.freeze.count}/${d.freeze.max} lượt` }),
            h('p', { class: 'streak-note', text: 'Ngày nào lỡ quên không chơi game nào, 1 lượt tự được dùng để giữ mọi chuỗi (ngày đó không cộng thêm). Mỗi thứ Hai được thêm 1 lượt, giữ tối đa 2.' }))) : null,
        h('div', { class: 'streak-miles', 'aria-label': 'Các mốc chuỗi' },
          d.milestones.slice(0, 8).map((m) => h('span', { class: m <= reached ? 'is-done' : '', text: `${m}` }))),
        h('label', { class: 'streak-remind' }, toggle, h('span', {}, h('b', { text: 'Nhắc giữ chuỗi' }), h('br'), 'Khoảng 20 giờ, nếu chuỗi (từ 2 ngày) sắp mất mà hôm nay bạn chưa chơi.')),
        h('p', { class: 'streak-note', text: 'Mỗi game có chuỗi riêng: ngày nào có chơi (đi một nước cờ, đặt một khối, làm một việc ở nông trại…) thì chuỗi tăng 1, bỏ một ngày là chuỗi về 0. Ngày tính theo giờ Việt Nam. Chơi Xếp Khối, cờ caro với máy lúc mất mạng vẫn được tính khi có mạng lại.' }),
      ]);
    }

    function celebrate(evt) {
      const n = evt.milestone || evt.overallMilestone;
      const what = evt.milestone ? `Chuỗi ${evt.name}` : 'Chuỗi chơi game';
      show('milestone', `${n} ngày liên tiếp!`, h('div', { class: 'streak-cheer' },
        h('div', { class: 'streak-cheer-flame' }, flame(true), h('strong', { text: String(n) })),
        h('h3', { text: `${what} vừa đạt mốc ${n} ngày` }),
        h('p', { class: 'streak-note', text: n >= 30 ? 'Quá đỉnh! Giữ lửa tiếp nhé.' : 'Giỏi lắm! Mai nhớ ghé chơi tiếp để chuỗi không bị đứt.' })),
      h('button', { class: 'btn btn-primary', type: 'button', style: 'width:100%', onclick: () => close(), text: 'Tuyệt!' }));
    }

    function reset() {
      S.gen++;
      S.data = null;
      S.loading = null;
      clearTimeout(S.flushTimer);
      close();
    }

    inst = { load, flushSoon, onUpdate, chip, badge, hero, openDetail, reset, game: gameOf, playedToday, get data() { return S.data; } };
    window.addEventListener('online', () => flushSoon());
    return inst;
  }

  return {
    create,
    mark,
    flush,
    flame,
    dayKey,
    get instance() {
      return inst;
    },
  };
})();
