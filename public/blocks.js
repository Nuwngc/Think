'use strict';
/* Game Xếp Khối cho bản web của Think (kiểu Block Blast): kéo khối vào bàn 8×8, xóa hàng ngang / cột dọc.
   Chơi hoàn toàn trên máy nên mất mạng vẫn chơi được; điểm được giữ lại rồi gửi lên bảng xếp hạng khi có mạng.
   Dùng trong app (public/games-ui.js mở ở #/blocks) và trang riêng /blocks.html (mở được cả khi máy chủ đang ngủ).
   Luật và cách tính điểm ở public/blocks-core.js. */
window.ThinkBlocks = (() => {
  const C = window.BlocksCore;
  const N = C.SIZE;
  const GAP = 4;
  const KEY_GAME = 'blocks-game-v1';
  const KEY_BEST = 'blocks-best-v1';
  const KEY_PENDING = 'blocks-pending-v1';
  const KEY_SOUND = 'blocks-sound';
  const KEY_BOARD = 'blocks-board-v1';
  const SOUNDS = ['pick', 'place', 'invalid', 'clear1', 'clear2', 'clear3', 'combo1', 'combo2', 'combo3', 'combo4', 'combo5', 'combo6', 'combo7', 'combo8', 'allclear', 'best', 'gameover', 'start'];

  /* ---------------- Lưu trên máy ---------------- */
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
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* hết chỗ / chế độ ẩn danh */ }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch { /* bỏ qua */ }
    },
  };
  const bestKey = (uid) => (uid == null ? 'local' : String(uid));
  function localBest(uid) {
    const all = store.get(KEY_BEST, {});
    return Math.max(Number(all[bestKey(uid)]) || 0, uid != null ? Number(all.local) || 0 : 0);
  }
  function setLocalBest(uid, score) {
    const all = store.get(KEY_BEST, {});
    const k = bestKey(uid);
    if (!(score > (Number(all[k]) || 0))) return;
    all[k] = score;
    store.set(KEY_BEST, all);
  }
  const pendingList = () => {
    const list = store.get(KEY_PENDING, []);
    return Array.isArray(list) ? list : [];
  };
  function pendingFor(uid) {
    // Ván chơi lúc chưa đăng nhập (trang riêng, mất mạng) tính cho người đăng nhập tiếp theo trên máy này
    return pendingList().filter((p) => p.uid == null || p.uid === uid);
  }

  /* ---------------- Âm thanh (Web Audio: phát ngay, chồng được nhiều tiếng) ---------------- */
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
            const res = await fetch(`/blocks/sounds/${name}.wav`);
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
  function play(name, volume = 1) {
    if (!audio.on || !audio.ctx) return;
    const buf = audio.buffers.get(name);
    if (!buf) return;
    try {
      const src = audio.ctx.createBufferSource();
      src.buffer = buf;
      const gain = audio.ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain);
      gain.connect(audio.ctx.destination);
      src.start();
    } catch { /* bỏ qua */ }
  }

  /* ---------------- Tiện ích vẽ ---------------- */
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style') e.setAttribute('style', v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }
  const ICONS = {
    back: '<path d="m15 18-6-6 6-6"/>',
    crown: '<path fill="currentColor" stroke="none" d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5Z"/><path d="M5 20.5h14"/>',
    sound: '<path fill="currentColor" stroke="none" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/>',
    mute: '<path fill="currentColor" stroke="none" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    board: '<rect x="3" y="12" width="5" height="8" rx="1"/><rect x="9.5" y="5" width="5" height="15" rx="1"/><rect x="16" y="9" width="5" height="11" rx="1"/>',
    restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    cloud: '<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.3 9.1 4.5 4.5 0 0 0 7 18Z"/>',
  };
  const icon = (name) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'bb-ic');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name];
    return s;
  };
  const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =========================================================
     Bộ điều khiển
     host: { api(path, opts) | null, me() -> người dùng | null, nameOf(id), userOf(id), avatarEl(user, cls)?,
             back(), toast(text), onChange(), standalone }
     ========================================================= */
  function create(host) {
    const S = {
      root: null,
      game: null,
      drag: null,
      selected: null, // chọn khối bằng bàn phím / chạm (không kéo)
      cursor: { r: 3, c: 3 },
      preview: null,
      board: store.get(KEY_BOARD, null), // bảng xếp hạng lần tải gần nhất (xem được khi mất mạng)
      syncing: null,
      syncError: false,
      shownScore: 0,
      scoreAnim: null,
      panel: null,
      overlay: null,
      resize: null,
      mounted: false,
      bestAtStart: 0,
    };
    const E = {};
    const uid = () => {
      const me = host.me && host.me();
      return me ? me.id : null;
    };

    /* ---------------- Ván đang chơi ---------------- */
    function loadGame() {
      const saved = store.get(KEY_GAME, null);
      if (C.validState(saved) && !saved.over) return saved;
      return null;
    }
    function saveGame() {
      if (S.game && !S.game.over) store.set(KEY_GAME, S.game);
    }
    function newGame() {
      S.game = C.newGame();
      S.bestAtStart = localBest(uid());
      store.set(KEY_GAME, S.game);
      S.shownScore = 0;
      hideOverlay();
      renderAll();
      play('start', 0.7);
    }

    /* ---------------- Đồng bộ điểm với máy chủ ---------------- */
    async function sync() {
      if (!host.api || S.syncing) return S.syncing;
      const me = uid();
      if (me == null) return null;
      S.syncing = (async () => {
        try {
          const pending = pendingFor(me);
          let data;
          if (pending.length) {
            data = await host.api('/api/games/blocks/scores', { method: 'POST', body: { scores: pending.slice(0, 50).map(({ uid: _u, ...s }) => s) } });
            const done = new Set([...(data.accepted || []), ...(data.rejected || []).map((r) => r.id)]);
            store.set(KEY_PENDING, pendingList().filter((p) => !done.has(p.id)));
          } else {
            data = await host.api('/api/games/blocks');
          }
          S.board = { ...data, fetchedAt: Date.now(), uid: me };
          if (window.ThinkStreaks) await window.ThinkStreaks.flush(host.api, me).catch(() => null);
          store.set(KEY_BOARD, S.board);
          if (data.me) setLocalBest(me, data.me.best);
          S.syncError = false;
          if (pendingFor(me).length) setTimeout(sync, 500); // còn nữa (quá 50 ván)
        } catch {
          S.syncError = true;
        } finally {
          S.syncing = null;
          if (S.mounted) {
            renderTop();
            renderSync();
            if (S.panel) drawPanel();
          }
          if (host.onChange) host.onChange();
        }
      })();
      return S.syncing;
    }

    // Có người vừa lập kỷ lục (sự kiện realtime từ máy chủ)
    function onScore(data) {
      if (!data || data.game !== 'blocks') return;
      // Chỉ báo khi có người mới vượt lên số 1 (không báo khi người đang số 1 tự phá kỷ lục của mình)
      if (data.userId !== uid() && data.newLeader && host.toast) {
        host.toast(`🏆 ${data.name} vừa đứng đầu Xếp Khối với ${fmt(data.best)} điểm!`);
      }
      sync();
    }

    function summary() {
      const me = uid();
      const board = S.board && S.board.uid === me ? S.board : null;
      const saved = S.game && !S.game.over ? S.game : loadGame();
      return {
        best: Math.max(localBest(me), board && board.me ? board.me.best : 0),
        rank: board && board.me ? board.me.rank : null,
        weekRank: board && board.me ? board.me.weekRank : null,
        weekBest: board && board.me ? board.me.weekBest : 0,
        pending: me != null ? pendingFor(me).length : pendingList().length,
        playing: saved && saved.moves > 0 ? saved.score : null,
        top: board ? board.leaderboard.week.slice(0, 3) : [],
      };
    }

    /* ---------------- Dựng giao diện ---------------- */
    function mount(container) {
      if (S.mounted) unmount();
      S.mounted = true;
      S.game = loadGame();
      S.bestAtStart = localBest(uid());
      if (!S.game) {
        S.game = C.newGame();
        store.set(KEY_GAME, S.game);
      }
      S.shownScore = S.game.score;

      E.best = el('span', { class: 'bb-best-num' });
      E.sound = el('button', { class: 'bb-icon-btn', type: 'button', onclick: toggleSound });
      E.score = el('div', { class: 'bb-score' }); // trình đọc màn hình nghe điểm qua E.live (không đọc từng số khi điểm chạy)
      E.combo = el('div', { class: 'bb-combo', 'aria-hidden': 'true' });
      E.grid = el('div', { class: 'bb-grid', role: 'grid', tabindex: '0', 'aria-label': 'Bàn chơi 8 × 8. Chọn khối bằng phím 1, 2, 3; di chuyển bằng phím mũi tên; Enter để đặt.' });
      E.cells = [];
      for (let i = 0; i < N * N; i++) {
        const cell = el('div', { class: 'bb-cell', role: 'gridcell', dataset: { i: String(i) } });
        E.cells.push(cell);
        E.grid.append(cell);
      }
      E.fx = el('div', { class: 'bb-fx', 'aria-hidden': 'true' });
      E.boardWrap = el('div', { class: 'bb-board' }, E.grid, E.fx);
      E.tray = el('div', { class: 'bb-tray', role: 'group', 'aria-label': 'Ba khối để đặt' });
      E.slots = [0, 1, 2].map((k) => {
        const slot = el('button', { class: 'bb-slot', type: 'button', dataset: { slot: String(k) } });
        E.tray.append(slot);
        return slot;
      });
      E.sync = el('p', { class: 'bb-sync', role: 'status' });
      E.live = el('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

      const top = el('header', { class: 'bb-top' },
        el('button', { class: 'bb-icon-btn', type: 'button', 'aria-label': host.standalone ? 'Về Think' : 'Quay lại', onclick: () => host.back && host.back() }, icon('back')),
        el('div', { class: 'bb-best', title: 'Kỷ lục của bạn' }, icon('crown'), E.best),
        !host.standalone && window.ThinkStreaks && window.ThinkStreaks.instance ? window.ThinkStreaks.instance.badge('blocks') : null,
        el('div', { class: 'bb-spacer' }),
        E.sound,
        el('button', { class: 'bb-icon-btn', type: 'button', 'aria-label': 'Ván mới', onclick: askRestart }, icon('restart')),
        el('button', { class: 'bb-icon-btn', type: 'button', 'aria-label': 'Bảng xếp hạng', onclick: openPanel }, icon('board')));

      S.root = el('div', { class: 'bb', tabindex: '-1' },
        top,
        el('div', { class: 'bb-head' }, E.score, E.combo),
        el('div', { class: 'bb-stage' }, E.boardWrap),
        E.tray,
        E.sync,
        E.live);
      container.replaceChildren(S.root);

      // Kéo thả bằng ngón tay / chuột
      E.tray.addEventListener('pointerdown', onPointerDown);
      E.tray.addEventListener('click', onSlotClick);
      E.grid.addEventListener('click', onGridClick);
      E.grid.addEventListener('pointermove', onGridHover);
      S.root.addEventListener('keydown', onKey);
      S.root.addEventListener('pointerdown', unlockAudio, { capture: true });
      window.addEventListener('online', sync);
      window.addEventListener('popstate', onPopState);
      S.resize = new ResizeObserver(layout);
      S.resize.observe(S.root);
      layout();
      renderAll();
      sync();
    }

    function unmount() {
      if (!S.mounted) return;
      cancelDrag();
      if (S.game && S.game.over) recordGame();
      // Không lưu lại ở đây: mỗi nước đã lưu rồi, lưu thêm có thể đè lên ván đang chơi ở thẻ khác
      if (S.panel) {
        S.panel.remove();
        S.panel = null;
      }
      window.removeEventListener('online', sync);
      window.removeEventListener('popstate', onPopState);
      if (S.resize) S.resize.disconnect();
      S.resize = null;
      clearInterval(S.scoreAnim);
      S.mounted = false;
      S.panel = null;
      S.overlay = null;
      S.root = null;
    }

    // Cỡ ô: vừa màn hình, chừa chỗ cho điểm và khay khối
    function layout() {
      if (!S.root) return;
      const w = S.root.clientWidth;
      const h = S.root.clientHeight;
      const byWidth = Math.min(w - 28, 480);
      const byHeight = h - 56 - 96 - 150 - 40;
      const size = Math.max(200, Math.min(byWidth, byHeight));
      const cell = Math.floor((size - 16 - GAP * (N - 1)) / N);
      S.root.style.setProperty('--cell', `${cell}px`);
      S.root.style.setProperty('--gap', `${GAP}px`);
      S.root.style.setProperty('--mini', `${Math.max(12, Math.min(26, Math.floor(cell * 0.5)))}px`);
    }

    function renderAll() {
      renderTop();
      renderScore(true);
      renderBoard();
      renderTray();
      renderSync();
    }

    function renderTop() {
      if (!S.mounted) return;
      const s = summary();
      E.best.textContent = fmt(Math.max(s.best, S.game ? S.game.score : 0));
      E.sound.replaceChildren(icon(audio.on ? 'sound' : 'mute'));
      E.sound.setAttribute('aria-label', audio.on ? 'Tắt âm thanh' : 'Bật âm thanh');
      E.sound.setAttribute('aria-pressed', audio.on ? 'true' : 'false');
    }

    function renderSync() {
      if (!S.mounted) return;
      const me = uid();
      const n = me != null ? pendingFor(me).length : pendingList().length;
      let text = '';
      if (n && (me == null || !host.api)) text = `${n} ván đang chờ gửi lên bảng xếp hạng (khi bạn mở Think có mạng).`;
      else if (n && S.syncError) text = `Mất mạng: ${n} ván sẽ tự gửi lên bảng xếp hạng khi có mạng lại.`;
      else if (n) text = `Đang gửi ${n} ván lên bảng xếp hạng…`;
      E.sync.textContent = text;
      E.sync.hidden = !text;
    }

    function renderScore(instant) {
      if (!S.mounted) return;
      const target = S.game.score;
      clearInterval(S.scoreAnim);
      if (instant || reducedMotion() || target <= S.shownScore) {
        S.shownScore = target;
        E.score.textContent = fmt(target);
        return;
      }
      const from = S.shownScore;
      const t0 = performance.now();
      S.scoreAnim = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / 450);
        S.shownScore = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
        E.score.textContent = fmt(S.shownScore);
        if (k >= 1) clearInterval(S.scoreAnim);
      }, 30);
      E.score.classList.remove('is-bump');
      void E.score.offsetWidth;
      E.score.classList.add('is-bump');
    }

    function renderCombo(combo) {
      E.combo.textContent = combo >= 2 ? `Combo ×${combo}` : '';
      E.combo.classList.toggle('is-on', combo >= 2);
      if (combo >= 2) {
        E.combo.classList.remove('is-pop');
        void E.combo.offsetWidth;
        E.combo.classList.add('is-pop');
      }
    }

    function renderBoard(opts = {}) {
      if (!S.mounted) return;
      const b = S.game.board;
      const pv = S.preview;
      const ghost = new Set(pv ? pv.cells : []);
      const hot = new Set();
      if (pv) {
        for (const r of pv.rows) for (let j = 0; j < N; j++) hot.add(r * N + j);
        for (const c of pv.cols) for (let j = 0; j < N; j++) hot.add(j * N + c);
      }
      const placed = new Set(opts.placed || []);
      const cursor = S.selected != null && !pv ? S.cursor.r * N + S.cursor.c : -1;
      for (let i = 0; i < N * N; i++) {
        const cell = E.cells[i];
        const v = b[i];
        let cls = 'bb-cell';
        if (v) cls += ` is-c${v}`;
        if (ghost.has(i)) cls += ` is-ghost g${pv.color}`;
        if (hot.has(i)) cls += ` is-hot h${pv.color}`;
        if (placed.has(i)) cls += ' is-placed';
        if (i === cursor) cls += ' is-cursor';
        if (cell.className !== cls) cell.className = cls;
      }
    }

    function pieceEl(p, cls) {
      const s = C.shapeOf(p.shape);
      const box = el('div', { class: `bb-piece ${cls || ''}`.trim(), style: `--w:${s.w};--h:${s.h}` });
      for (const [r, c] of s.cells) box.append(el('span', { class: `bb-block is-c${p.color}`, style: `grid-row:${r + 1};grid-column:${c + 1}` }));
      return box;
    }

    function renderTray(opts = {}) {
      if (!S.mounted) return;
      S.game.tray.forEach((p, k) => {
        const slot = E.slots[k];
        const dragging = S.drag && S.drag.slot === k;
        if (!p) {
          slot.replaceChildren();
          slot.disabled = true;
          slot.className = 'bb-slot is-empty';
          slot.setAttribute('aria-label', 'Đã đặt');
          return;
        }
        const s = C.shapeOf(p.shape);
        const fits = C.fitsAnywhere(S.game.board, p.shape);
        slot.disabled = false;
        slot.className = `bb-slot${fits ? '' : ' is-stuck'}${S.selected === k ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${opts.refilled ? ' is-new' : ''}`;
        slot.style.setProperty('--delay', `${k * 60}ms`);
        slot.setAttribute('aria-label', `Khối ${s.cells.length} ô, rộng ${s.w} cao ${s.h}${fits ? '' : ', không còn chỗ đặt'}${S.selected === k ? ', đang chọn' : ''}`);
        slot.setAttribute('aria-pressed', S.selected === k ? 'true' : 'false');
        slot.replaceChildren(pieceEl(p));
      });
    }

    /* ---------------- Kéo thả ---------------- */
    function gridMetrics() {
      const rect = E.grid.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(E.grid).paddingLeft) || 0;
      const inner = rect.width - pad * 2;
      return { left: rect.left + pad, top: rect.top + pad, pitch: (inner + GAP) / N, cell: (inner + GAP) / N - GAP };
    }

    function onPointerDown(e) {
      if (S.drag) return; // đang kéo bằng ngón khác
      const slot = e.target.closest('.bb-slot');
      if (!slot || !S.game || S.game.over || e.button > 0) return;
      const k = Number(slot.dataset.slot);
      const p = S.game.tray[k];
      if (!p) return;
      e.preventDefault();
      unlockAudio();
      const m = gridMetrics();
      const s = C.shapeOf(p.shape);
      const ghost = pieceEl(p, 'bb-drag');
      ghost.style.setProperty('--cell', `${m.cell}px`);
      ghost.style.setProperty('--gap', `${GAP}px`);
      document.body.append(ghost);
      const from = slot.getBoundingClientRect();
      S.drag = {
        slot: k,
        piece: p,
        shape: s,
        pointerId: e.pointerId,
        touch: e.pointerType !== 'mouse',
        ghost,
        w: s.w * m.pitch - GAP,
        h: s.h * m.pitch - GAP,
        m,
        from,
        moved: false,
        x0: e.clientX,
        y0: e.clientY,
      };
      S.selected = null;
      try { slot.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
      slot.addEventListener('pointermove', onPointerMove);
      slot.addEventListener('pointerup', onPointerUp);
      slot.addEventListener('pointercancel', onPointerCancel);
      moveGhost(e.clientX, e.clientY);
      renderTray();
      play('pick', 0.6);
    }

    function moveGhost(x, y) {
      const d = S.drag;
      if (!d) return;
      // Trên điện thoại khối nổi lên trên ngón tay để không bị che
      const left = x - d.w / 2;
      const top = d.touch ? y - d.h - Math.max(36, d.m.pitch * 1.1) : y - d.h / 2;
      d.ghost.style.transform = `translate(${left}px, ${top}px)`;
      const c = Math.round((left - d.m.left) / d.m.pitch);
      const r = Math.round((top - d.m.top) / d.m.pitch);
      setPreview(d.piece, r, c);
    }

    function setPreview(piece, r, c) {
      let next = null;
      if (piece && C.canPlace(S.game.board, piece.shape, r, c)) {
        const s = C.shapeOf(piece.shape);
        const lines = C.linesIfPlaced(S.game.board, piece.shape, r, c);
        next = { r, c, color: piece.color, cells: s.cells.map(([dr, dc]) => (r + dr) * N + c + dc), rows: lines.rows, cols: lines.cols };
      }
      const same = (S.preview && next && S.preview.r === next.r && S.preview.c === next.c && S.preview.color === next.color) || (!S.preview && !next);
      S.preview = next;
      if (!same) renderBoard();
    }

    function onPointerMove(e) {
      const d = S.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) d.moved = true;
      moveGhost(e.clientX, e.clientY);
    }

    function endListeners(slot) {
      slot.removeEventListener('pointermove', onPointerMove);
      slot.removeEventListener('pointerup', onPointerUp);
      slot.removeEventListener('pointercancel', onPointerCancel);
    }

    function onPointerUp(e) {
      const d = S.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      endListeners(E.slots[d.slot]);
      const pv = S.preview;
      if (!d.moved) {
        // Chạm nhẹ, không kéo: chọn khối (rồi chạm vào bàn để đặt), tiện cho chuột và bàn phím
        d.ghost.remove();
        S.drag = null;
        S.preview = null;
        S.selected = d.slot;
        S.suppressClick = true;
        setTimeout(() => { S.suppressClick = false; }, 0);
        renderTray();
        renderBoard();
        return;
      }
      if (pv) {
        d.ghost.remove();
        S.drag = null;
        S.preview = null;
        commit(d.slot, pv.r, pv.c);
      } else {
        flyBack(d);
      }
    }

    function onPointerCancel() {
      const d = S.drag;
      if (!d) return;
      endListeners(E.slots[d.slot]);
      flyBack(d);
    }

    // Thả sai chỗ: khối bay về khay
    function flyBack(d) {
      S.drag = null;
      S.preview = null;
      renderBoard();
      play('invalid', 0.5);
      const g = d.ghost;
      if (reducedMotion()) {
        g.remove();
        renderTray();
        return;
      }
      g.classList.add('is-back');
      g.style.transform = `translate(${d.from.left + d.from.width / 2 - d.w / 2}px, ${d.from.top + d.from.height / 2 - d.h / 2}px) scale(0.5)`;
      setTimeout(() => {
        g.remove();
        renderTray();
      }, 180);
    }

    function cancelDrag() {
      if (!S.drag) return;
      endListeners(E.slots[S.drag.slot]);
      S.drag.ghost.remove();
      S.drag = null;
      S.preview = null;
    }

    /* ---------------- Chọn khối rồi chạm vào bàn (chuột, bàn phím, trình đọc màn hình) ---------------- */
    function onSlotClick(e) {
      if (S.suppressClick) return;
      const slot = e.target.closest('.bb-slot');
      if (!slot || e.detail > 0) return; // bấm chuột / chạm đã xử lý ở pointerup; đây là phím Enter / Space
      const k = Number(slot.dataset.slot);
      if (!S.game.tray[k]) return;
      S.selected = S.selected === k ? null : k;
      S.preview = null;
      if (S.selected != null) {
        placeCursorNear(S.game.tray[k]);
        showCursorPreview();
        E.grid.focus({ preventScroll: true });
      }
      renderTray();
      renderBoard();
    }
    function placeCursorNear(p) {
      // Đưa con trỏ tới chỗ đầu tiên đặt được
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (C.canPlace(S.game.board, p.shape, r, c)) {
            S.cursor = { r, c };
            return;
          }
        }
      }
    }
    function showCursorPreview() {
      const p = S.selected != null ? S.game.tray[S.selected] : null;
      if (!p) return;
      setPreview(p, S.cursor.r, S.cursor.c);
      const s = C.shapeOf(p.shape);
      E.live.textContent = `Hàng ${S.cursor.r + 1}, cột ${S.cursor.c + 1}${S.preview ? '' : ', không đặt được'}${S.preview && (S.preview.rows.length + S.preview.cols.length) ? `, ăn ${S.preview.rows.length + S.preview.cols.length} hàng` : ''}. Khối ${s.cells.length} ô.`;
    }
    function onGridHover(e) {
      if (S.selected == null || S.drag || e.pointerType !== 'mouse') return;
      const cell = e.target.closest('.bb-cell');
      if (!cell) return;
      const i = Number(cell.dataset.i);
      S.cursor = { r: Math.floor(i / N), c: i % N };
      showCursorPreview();
    }
    function onGridClick(e) {
      if (S.selected == null) return;
      const cell = e.target.closest('.bb-cell');
      if (!cell) return;
      const i = Number(cell.dataset.i);
      const r = Math.floor(i / N);
      const c = i % N;
      const p = S.game.tray[S.selected];
      if (p && C.canPlace(S.game.board, p.shape, r, c)) {
        const k = S.selected;
        S.selected = null;
        S.preview = null;
        commit(k, r, c);
      } else play('invalid', 0.5);
    }
    function onKey(e) {
      if (S.panel || S.overlay) {
        if (e.key === 'Escape' && S.panel) closePanel();
        return;
      }
      if (['1', '2', '3'].includes(e.key)) {
        const k = Number(e.key) - 1;
        if (S.game.tray[k]) {
          S.selected = k;
          placeCursorNear(S.game.tray[k]);
          showCursorPreview();
          renderTray();
          renderBoard();
          E.grid.focus({ preventScroll: true });
          e.preventDefault();
        }
        return;
      }
      if (S.selected == null) return;
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[e.key]) {
        e.preventDefault();
        const [dr, dc] = moves[e.key];
        S.cursor = { r: Math.max(0, Math.min(N - 1, S.cursor.r + dr)), c: Math.max(0, Math.min(N - 1, S.cursor.c + dc)) };
        showCursorPreview();
        renderBoard();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (e.target !== E.grid && e.target !== S.root) return;
        e.preventDefault();
        if (S.preview) {
          const k = S.selected;
          const { r, c } = S.preview;
          S.selected = null;
          S.preview = null;
          commit(k, r, c);
        } else play('invalid', 0.5);
      } else if (e.key === 'Escape') {
        S.selected = null;
        S.preview = null;
        renderTray();
        renderBoard();
      }
    }

    /* ---------------- Đặt khối: điểm, hiệu ứng, âm thanh ---------------- */
    function commit(slot, r, c) {
      const res = C.place(S.game, slot, r, c);
      if (!res) {
        play('invalid', 0.5);
        renderTray();
        return;
      }
      S.game = res.state;
      saveGame();
      // Chuỗi hằng ngày: hôm nay có chơi Xếp Khối (lưu trên máy, có mạng thì gửi)
      if (window.ThinkStreaks) window.ThinkStreaks.mark('blocks', uid());
      play('place', 0.9);
      if (res.lines) {
        play(res.lines >= 3 ? 'clear3' : res.lines === 2 ? 'clear2' : 'clear1', 0.8);
        if (res.combo >= 2) setTimeout(() => play(`combo${Math.min(8, res.combo - 1)}`, 0.7), 90);
      }
      if (res.allClear) setTimeout(() => play('allclear', 0.9), 260);
      renderBoard({ placed: res.placed });
      renderTray({ refilled: res.refilled });
      renderScore();
      renderCombo(res.combo || (S.game.combo >= 2 ? S.game.combo : 0));
      renderTop();
      const center = centerOf(res.placed);
      if (res.clearedCells.length) burst(res.clearedCells, center);
      floatText(`+${res.gained}`, center, 'bb-float');
      const words = res.allClear ? 'Sạch bàn!' : C.praise(res.lines, res.combo);
      if (words) banner(words, res.allClear ? 'is-gold' : res.lines >= 4 ? 'is-hot' : '');
      E.live.textContent = `Đặt khối, được ${res.gained} điểm${res.lines ? `, ăn ${res.lines} hàng` : ''}${res.combo >= 2 ? `, combo ${res.combo}` : ''}. Tổng ${S.game.score}.`;
      if (res.over) {
        const record = recordGame();
        setTimeout(() => showEnd(record), res.lines ? 900 : 550);
      }
      if (host.onChange && (res.over || res.state.moves === 1)) host.onChange();
    }

    function centerOf(cells) {
      const rs = cells.map((i) => Math.floor(i / N));
      const cs = cells.map((i) => i % N);
      return { r: (Math.min(...rs) + Math.max(...rs)) / 2, c: (Math.min(...cs) + Math.max(...cs)) / 2 };
    }

    // Các ô bị xóa vỡ ra thành từng mảnh, lan dần từ chỗ vừa đặt
    function burst(cells, center) {
      if (reducedMotion()) return;
      const frag = document.createDocumentFragment();
      for (const { i, color } of cells) {
        const r = Math.floor(i / N);
        const c = i % N;
        const dist = Math.hypot(r - center.r, c - center.c);
        const shard = el('span', { class: `bb-shard is-c${color}`, style: `--r:${r};--c:${c};--d:${Math.round(dist * 28)}ms;--dx:${((c - center.c) * 6).toFixed(1)}px;--dy:${((r - center.r) * 6 - 10).toFixed(1)}px` });
        frag.append(shard);
        setTimeout(() => shard.remove(), 900);
      }
      E.fx.append(frag);
    }

    function floatText(text, at, cls) {
      if (reducedMotion()) return;
      const f = el('span', { class: cls, text, style: `--r:${at.r};--c:${at.c}` });
      E.fx.append(f);
      setTimeout(() => f.remove(), 1000);
    }

    function banner(text, cls) {
      const b = el('div', { class: `bb-banner ${cls || ''}`.trim(), text, 'aria-hidden': 'true' });
      E.fx.append(b);
      setTimeout(() => b.remove(), 1300);
    }

    /* ---------------- Hết ván ---------------- */
    // Ghi điểm ngay lúc hết nước (kể cả khi người chơi thoát trước khi bảng kết quả hiện ra)
    function recordGame() {
      const g = S.game;
      if (!g || g.recorded) return null;
      g.recorded = true;
      const me = uid();
      const before = Math.max(S.bestAtStart, localBest(me));
      const record = g.score > before && g.score > 0;
      if (g.moves > 0) {
        const list = pendingList().filter((p) => p.id !== g.id);
        list.push({ id: g.id, score: g.score, moves: g.moves, lines: g.lines, durationMs: Math.min(Date.now() - g.startedAt, 7 * 86400000), playedAt: Date.now(), uid: me });
        store.set(KEY_PENDING, list.slice(-200));
        setLocalBest(me, g.score);
      }
      store.del(KEY_GAME);
      sync();
      return { record, best: Math.max(before, g.score) };
    }

    function showEnd(info) {
      if (!S.mounted || !S.game || !S.game.over || !info) return;
      play(info.record ? 'best' : 'gameover', 0.9);
      showOverlay(S.game, info.record, info.best);
      renderTop();
      renderSync();
      if (host.onChange) host.onChange();
    }

    function showOverlay(g, record, best) {
      hideOverlay();
      const again = el('button', { class: 'bb-btn bb-btn-primary', type: 'button', onclick: newGame }, icon('restart'), 'Chơi lại');
      S.overlay = el('div', { class: `bb-over${record ? ' is-record' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hết ván' },
        el('div', { class: 'bb-over-card' },
          el('p', { class: 'bb-over-kicker', text: record ? 'Kỷ lục mới!' : 'Hết chỗ đặt khối' }),
          el('p', { class: 'bb-over-score', text: fmt(g.score) }),
          el('div', { class: 'bb-over-stats' },
            el('span', {}, icon('crown'), `Kỷ lục ${fmt(best)}`),
            el('span', { text: `${g.lines} hàng · ${g.moves} khối` })),
          el('div', { class: 'bb-over-actions' },
            again,
            el('button', { class: 'bb-btn', type: 'button', onclick: openPanel }, icon('board'), 'Bảng xếp hạng'))));
      S.root.append(S.overlay);
      setTimeout(() => again.focus({ preventScroll: true }), 50);
    }
    function hideOverlay() {
      if (S.overlay) S.overlay.remove();
      S.overlay = null;
    }

    function askRestart() {
      if (S.game && !S.game.over && S.game.moves > 0 && !window.confirm('Bỏ ván này và chơi ván mới? Điểm ván này không được tính.')) return;
      newGame();
    }

    function toggleSound() {
      audio.on = !audio.on;
      store.set(KEY_SOUND, audio.on);
      if (audio.on) {
        unlockAudio();
        setTimeout(() => play('pick'), 60);
      }
      renderTop();
    }

    /* ---------------- Bảng xếp hạng ---------------- */
    let tab = 'week';
    function openPanel() {
      if (S.panel) return;
      S.panelReturn = document.activeElement;
      S.panel = el('div', { class: 'bb-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bảng xếp hạng Xếp Khối' });
      S.root.append(S.panel);
      try { history.pushState({ ...(history.state || {}), blocksPanel: true }, '', location.hash || location.pathname); } catch { /* bỏ qua */ }
      drawPanel();
      const close = S.panel.querySelector('[data-focus="close"]');
      if (close) close.focus({ preventScroll: true });
      sync();
      requestAnimationFrame(() => S.panel && S.panel.classList.add('is-open'));
    }
    function closePanel(fromPop) {
      if (!S.panel) return;
      if (!fromPop && history.state && history.state.blocksPanel) {
        history.back();
        return;
      }
      S.panel.remove();
      S.panel = null;
      // Trả focus về nút đã mở bảng
      const back = S.panelReturn;
      S.panelReturn = null;
      if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
      else if (S.root) S.root.focus({ preventScroll: true });
    }
    function onPopState() {
      if (S.panel && !(history.state && history.state.blocksPanel)) closePanel(true);
    }
    function avatarOf(userId) {
      const u = host.userOf ? host.userOf(userId) : null;
      if (host.avatarEl && u) return host.avatarEl(u, 'avatar-sm', { dot: false });
      const name = (host.nameOf && host.nameOf(userId)) || '?';
      return el('span', { class: 'bb-avatar', text: name.trim().slice(0, 1).toUpperCase() });
    }
    function drawPanel() {
      if (!S.panel) return;
      const me = uid();
      const data = S.board && (me == null || S.board.uid === me) ? S.board : null;
      const rows = data ? data.leaderboard[tab] : null;
      const tabs = el('div', { class: 'bb-tabs', role: 'tablist' },
        [['week', 'Tuần này'], ['all', 'Mọi lúc']].map(([k, label]) => el('button', {
          class: `bb-tab${tab === k ? ' is-on' : ''}`, type: 'button', role: 'tab', 'aria-selected': tab === k ? 'true' : 'false', dataset: { focus: `tab-${k}` },
          onclick: () => { tab = k; drawPanel(); },
        }, label)));
      let list;
      if (!host.api || me == null) {
        list = el('p', { class: 'bb-empty', text: 'Đăng nhập Think (có mạng) để xem bảng xếp hạng. Điểm các ván bạn chơi ở đây vẫn được giữ và gửi lên sau.' });
      } else if (!rows) {
        list = el('p', { class: 'bb-empty', text: S.syncError ? 'Chưa tải được bảng xếp hạng (mất mạng?).' : 'Đang tải…' });
      } else if (!rows.length) {
        list = el('p', { class: 'bb-empty', text: tab === 'week' ? 'Tuần này chưa ai chơi. Mở màn đi!' : 'Chưa ai có điểm. Chơi một ván để mở màn!' });
      } else {
        list = el('ol', { class: 'bb-rank-list' }, rows.map((r, i) => el('li', { class: `bb-rank${r.userId === me ? ' is-me' : ''}` },
          el('span', { class: `bb-rank-no${i < 3 ? ` is-top${i + 1}` : ''}`, text: String(i + 1) }),
          avatarOf(r.userId),
          el('span', { class: 'bb-rank-name', text: `${(host.nameOf && host.nameOf(r.userId)) || 'Người dùng'}${r.userId === me ? ' (bạn)' : ''}` }),
          el('span', { class: 'bb-rank-score', text: fmt(r.score) }))));
      }
      const mine = data && data.me;
      const stats = mine
        ? el('div', { class: 'bb-mystats' },
            el('div', {}, el('strong', { text: fmt(mine.best) }), el('span', { text: 'kỷ lục' })),
            el('div', {}, el('strong', { text: mine.rank ? `#${mine.rank}` : '—' }), el('span', { text: 'hạng mọi lúc' })),
            el('div', {}, el('strong', { text: mine.weekRank ? `#${mine.weekRank}` : '—' }), el('span', { text: 'hạng tuần' })),
            el('div', {}, el('strong', { text: fmt(mine.games) }), el('span', { text: 'ván đã chơi' })))
        : null;
      const n = me != null ? pendingFor(me).length : pendingList().length;
      const focusKey = S.panel.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
      S.panel.replaceChildren(el('div', { class: 'bb-panel-card' },
        el('header', { class: 'bb-panel-head' },
          el('h2', { text: 'Bảng xếp hạng' }),
          el('button', { class: 'bb-icon-btn', type: 'button', 'aria-label': 'Đóng', dataset: { focus: 'close' }, onclick: () => closePanel() }, icon('close'))),
        stats,
        tabs,
        list,
        n ? el('p', { class: 'bb-note' }, icon('cloud'), `${n} ván chưa gửi lên (sẽ tự gửi khi có mạng).`) : null,
        el('p', { class: 'bb-note', text: tab === 'week' ? 'Tuần mới bắt đầu 0 giờ thứ Hai.' : 'Điểm cao nhất mỗi người từng đạt.' })));
      if (focusKey) {
        const again = S.panel.querySelector(`[data-focus="${focusKey}"]`);
        if (again) again.focus({ preventScroll: true });
      }
    }

    return { mount, unmount, sync, onScore, summary, openPanel, newGame, isMounted: () => S.mounted };
  }

  return { create, _store: store, _pendingFor: pendingFor };
})();
