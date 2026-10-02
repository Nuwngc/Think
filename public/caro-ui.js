'use strict';
/* Cờ caro cho bản web của Think: chơi với máy (chạy hẳn trên máy, không cần mạng), thách đấu bạn bè
   có giới hạn thời gian mỗi nước, điểm ELO, bảng xếp hạng.
   Luật và máy chơi ở public/caro-core.js (dùng chung với máy chủ). Máy chủ (src/caro.js) giữ luật và đồng hồ
   của ván với bạn bè; trang này chỉ vẽ bàn cờ và gửi nước đi.
   Đường dẫn: #/caro (trang caro) · #/caro/bot (ván với máy) · #/caro/g/12 (một ván / lời thách đấu).
   app.js gọi ThinkCaro.create(host) rồi chuyển cho nó đường dẫn và các sự kiện realtime caro:game, caro:challenge. */
window.ThinkCaro = (() => {
  const C = window.CaroCore;
  const N = C ? C.SIZE : 15;
  const CELLS = N * N;
  const SVG = 'http://www.w3.org/2000/svg';
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const SOUNDS = ['place-x', 'place-o', 'turn', 'invalid', 'threat', 'start', 'win', 'lose', 'draw'];
  const KEY_BOT = 'caro-bot-v1'; // ván với máy đang chơi (chơi tiếp sau khi tải lại trang)
  const KEY_PREFS = 'caro-bot-prefs-v1'; // lựa chọn lần trước: mức máy, bên đi, luật
  const KEY_STATS = 'caro-bot-stats-v1'; // thành tích với máy của từng người trên máy này
  const KEY_SOUND = 'caro-sound';
  const CHALLENGE_MS = 15 * 60 * 1000; // lời thách đấu hết hạn sau 15 phút (giống src/caro.js)

  const LEVELS = {
    easy: { label: 'Dễ', about: 'Mới tập chơi, hay đi lung tung' },
    medium: { label: 'Vừa', about: 'Biết tấn công và chặn đường 4' },
    hard: { label: 'Khó', about: 'Tính trước vài nước, khó thắng' },
  };
  const LEVEL_ORDER = ['easy', 'medium', 'hard'];
  const RULES = {
    free: { label: 'Tự do', about: 'Có 5 quân liền nhau là thắng, kể cả khi bị chặn hai đầu.' },
    block2: { label: 'Chặn hai đầu', about: '5 quân mà bị quân đối phương chặn cả hai đầu thì không tính thắng (mép bàn không tính là chặn).' },
  };
  const TURN_SUB = { 15: 'Chớp nhoáng', 30: 'Nhanh', 60: 'Thong thả', 120: 'Chậm rãi', 0: 'Đi lúc nào cũng được' };

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

  /* ---------------- Chữ hiển thị ---------------- */
  const markName = (s) => (s === 'x' ? 'X' : 'O');
  const otherSide = (s) => (s === 'x' ? 'o' : 'x');
  const sideOfNum = (v) => (v === 1 ? 'x' : v === 2 ? 'o' : null);
  const signed = (n) => (n >= 0 ? `+${n}` : String(n));
  const secondsLabel = (s) => (!s ? 'Không giới hạn' : s >= 60 ? `${s / 60} phút` : `${s} giây`);
  function turnLabel(ms) {
    if (!ms) return 'Không giới hạn giờ';
    const s = Math.round(ms / 1000);
    return s >= 60 && s % 60 === 0 ? `${s / 60} phút/nước` : `${s} giây/nước`;
  }
  function clockText(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /* ---------------- Hình quân X / O ---------------- */
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }
  function markSvg(side, cls = '') {
    const svg = svgEl('svg', { viewBox: '0 0 100 100', class: `caro-mark is-${side} ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
    if (side === 'x') {
      svg.append(svgEl('path', { d: 'M29 29L71 71', pathLength: 1 }), svgEl('path', { d: 'M71 29L29 71', pathLength: 1 }));
    } else {
      svg.append(svgEl('circle', { cx: 50, cy: 50, r: 24, pathLength: 1, transform: 'rotate(-90 50 50)' }));
    }
    return svg;
  }
  // Đường gạch qua hàng thắng: tọa độ theo ô (bàn n × n)
  function winLineSvg(line, side, n = N) {
    const a = line[0];
    const b = line[line.length - 1];
    const pt = (i) => [(i % n) + 0.5, Math.floor(i / n) + 0.5];
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    const d = `M${x1} ${y1}L${x2} ${y2}`;
    const svg = svgEl('svg', { viewBox: `0 0 ${n} ${n}`, class: `caro-winline is-${side}`, 'aria-hidden': 'true' });
    svg.append(svgEl('path', { d, class: 'halo' }), svgEl('path', { d, class: 'core', pathLength: 1 }));
    return svg;
  }
  // Bàn nhỏ để trang trí (trang chọn game, thẻ ván dở): cells = mảng n×n giá trị 0/1/2
  function miniBoard(cells, n, line, winSide) {
    const el = document.createElement('div');
    el.className = 'caro-mini';
    el.style.setProperty('--n', String(n));
    el.setAttribute('aria-hidden', 'true');
    cells.forEach((v) => {
      const cell = document.createElement('span');
      if (v) cell.append(markSvg(sideOfNum(v)));
      el.append(cell);
    });
    if (line && line.length) el.append(winLineSvg(line, winSide || 'x', n));
    return el;
  }
  function art() {
    // 6×6: X thắng theo đường chéo, vài quân O xung quanh
    const n = 6;
    const cells = new Array(n * n).fill(0);
    for (const i of [7, 14, 21, 28]) cells[i] = 1;
    for (const i of [8, 13, 15, 22, 9]) cells[i] = 2;
    cells[0] = 0;
    cells[35] = 1;
    return miniBoard(cells, n, [7, 14, 21, 28, 35], 'x');
  }

  /* ---------------- Nước đi tạo thế "4" (sắp thắng) ---------------- */
  // Quân vừa đi ở ô i: còn một ô trống nào mà đi vào là có 5 quân (có cả ô i) không?
  function makesThreat(board, i, rule) {
    const p = board[i];
    if (!p || !C) return false;
    const r0 = Math.floor(i / N);
    const c0 = i % N;
    const b = board.slice();
    for (const [dr, dc] of DIRS) {
      for (let k = -4; k <= 4; k++) {
        if (!k) continue;
        const r = r0 + dr * k;
        const c = c0 + dc * k;
        if (r < 0 || c < 0 || r >= N || c >= N) continue;
        const j = r * N + c;
        if (b[j]) continue;
        b[j] = p;
        const line = C.winLine(b, j, rule);
        b[j] = 0;
        if (line && line.includes(i)) return true;
      }
    }
    return false;
  }

  /* =========================================================
     Bộ điều khiển (một cho mỗi lần mở trang)
     ========================================================= */
  function create(host) {
    const { api, h, icon, avatarEl, userOf, nameOf, state, toast, pushToast, navigate, goBack, withBusy, shortTime, fold } = host;
    const $ = (sel, root = document) => root.querySelector(sel);
    const meId = () => (state.me ? state.me.id : 0);
    const isDesktop = () => window.matchMedia('(min-width: 860px)').matches;
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const S = {
      loaded: false,
      loading: null,
      error: null,
      rating: null, // điểm của mình
      leaderboard: null,
      options: { turnSeconds: [0, 15, 30, 60, 120], rules: ['free', 'block2'] },
      games: new Map(),
      skew: 0, // giờ máy chủ - giờ máy này
      tab: false, // đang ở trang Cờ caro
      open: null, // id ván đang mở
      sending: new Set(),
      summaryTry: 0,
    };
    // Màn chơi đang mở ở cột phải
    const V = { key: null, mode: null, els: null, board: null, lastId: null, lastPly: null, lastStatus: null, ticker: null, lateFetch: 0, ghostHint: null, flashTimer: null, flashUntil: 0 };
    // Ván với máy
    const B = { game: null, timer: null, thinking: false, stateKey: '', state: null };

    /* ---------------- Âm thanh (Web Audio: giải mã một lần, phát ngay, chồng được nhiều tiếng) ---------------- */
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
              const res = await fetch(`/caro/sounds/${name}.wav`);
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
    function play(name, volume = 1, delay = 0) {
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
        src.start(audio.ctx.currentTime + delay / 1000);
      } catch { /* bỏ qua */ }
    }
    function toggleSound() {
      audio.on = !audio.on;
      store.set(KEY_SOUND, audio.on);
      if (audio.on) {
        unlockAudio();
        setTimeout(() => play('place-x', 0.8), 80);
      }
      drawSoundBtn();
    }
    function drawSoundBtn() {
      const btn = V.els && V.els.soundBtn;
      if (!btn) return;
      btn.replaceChildren(icon(audio.on ? 'volume' : 'volume-off'));
      btn.setAttribute('aria-label', audio.on ? 'Tắt âm thanh' : 'Bật âm thanh');
      btn.setAttribute('aria-pressed', audio.on ? 'true' : 'false');
    }
    // Trình duyệt chỉ cho bật âm thanh sau một lần chạm: chạm vào trang caro, thẻ Cờ caro hoặc màn chơi
    const pageGames = $('#page-games');
    if (pageGames) {
      pageGames.addEventListener('pointerdown', (e) => {
        if (e.target.closest && e.target.closest('#games-caro, .game-card.is-caro')) unlockAudio();
      }, { capture: true });
    }
    const paneEl = $('#caro-pane');
    if (paneEl) paneEl.addEventListener('pointerdown', unlockAudio, { capture: true });

    /* ---------------- Đọc to cho trình đọc màn hình ---------------- */
    let live = null;
    function announce(text) {
      if (!live) {
        live = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
        document.body.append(live);
      }
      live.textContent = '';
      setTimeout(() => { live.textContent = text; }, 50);
    }

    /* =========================================================
       Dữ liệu ván với bạn bè
       ========================================================= */
    const mySide = (g) => (g.xId === meId() ? 'x' : g.oId === meId() ? 'o' : null);
    const idOf = (g, side) => (side === 'x' ? g.xId : g.oId);
    const oppOf = (g) => {
      const me = meId();
      if (g.xId != null || g.oId != null) return g.xId === me ? g.oId : g.oId === me ? g.xId : null;
      return g.challengerId === me ? g.opponentId : g.challengerId;
    };
    const serverNow = () => Date.now() + S.skew;
    const turnLeft = (g) => (g.status === 'active' && g.turnMs ? g.turnStartedAt + g.turnMs - serverNow() : null);
    const isMyTurn = (g) => g.status === 'active' && mySide(g) === g.turn;

    // Thứ tự trạng thái: lời thách đấu → đang chơi → đã xong. Không bao giờ lùi lại.
    const STAGE = { challenge: 0, active: 1 };
    const stageOf = (g) => STAGE[g.status] ?? 2;
    function upsert(list) {
      for (const g of list) {
        if (!g || g.id == null) continue;
        if (g.serverTime) S.skew = g.serverTime - Date.now();
        const prev = S.games.get(g.id);
        if (prev) {
          // Bản cũ đến trễ (phản hồi của lần tải đang dở, sự kiện đến không theo thứ tự): bỏ qua
          if (stageOf(g) < stageOf(prev)) continue;
          if (g.status === 'active' && prev.status === 'active' && prev.moves.length > g.moves.length) continue;
        }
        S.games.set(g.id, g);
      }
    }
    const stateCache = new Map();
    function stateOf(g) {
      const key = `${g.rule}:${g.moves.join(',')}`;
      let st = stateCache.get(g.id);
      if (!st || st.key !== key) {
        st = { key, s: C.fromMoves(g.moves, g.rule) };
        stateCache.set(g.id, st);
      }
      return st.s;
    }

    let loadAgain = false;
    async function load() {
      if (S.loading) {
        loadAgain = true; // có thay đổi trong lúc đang tải: tải thêm một lần nữa cho chắc
        return S.loading;
      }
      S.loading = (async () => {
        try {
          const data = await api('/api/caro');
          const fresh = new Set(data.games.map((g) => g.id));
          for (const id of [...S.games.keys()]) if (!fresh.has(id) && id !== S.open) S.games.delete(id);
          upsert(data.games);
          S.rating = data.me;
          S.leaderboard = data.leaderboard || [];
          if (data.options) S.options = data.options;
          S.loaded = true;
          S.error = null;
        } catch (err) {
          S.error = err.message;
        } finally {
          S.loading = null;
        }
        refresh();
        if (loadAgain) {
          loadAgain = false;
          load();
        }
      })();
      return S.loading;
    }

    async function fetchGame(id, { quiet = false } = {}) {
      try {
        const { game } = await api(`/api/caro/games/${id}`);
        upsert([game]);
        refresh();
      } catch (err) {
        if (quiet) return;
        toast(err.message);
        if (S.open === id) navigate('#/caro', { replace: true });
      }
    }

    function reset() {
      closePane();
      closeSheet(true);
      clearTimeout(B.timer);
      Object.assign(B, { game: null, timer: null, thinking: false, stateKey: '', state: null });
      Object.assign(S, { loaded: false, loading: null, error: null, rating: null, leaderboard: null, tab: false, open: null, summaryTry: 0 });
      S.games.clear();
      S.sending.clear();
      stateCache.clear();
      const home = $('#caro-home');
      if (home) home.replaceChildren();
      updateBadge();
    }

    // Vẽ lại phần đang hiện
    function refresh() {
      updateBadge();
      if (S.tab) renderHome();
      if (S.open != null) renderOnline();
      if (layer && !layer.hidden && layer.dataset.kind === 'board' && S.drawBoard) S.drawBoard();
      if (host.onChange) host.onChange();
    }

    /* ---------------- Việc cần làm (số trên tab Trò chơi) ---------------- */
    function counts() {
      const me = meId();
      let incoming = 0;
      let myTurn = 0;
      let active = 0;
      for (const g of S.games.values()) {
        if (g.status === 'challenge' && g.opponentId === me) incoming++;
        else if (g.status === 'active' && mySide(g)) {
          active++;
          if (isMyTurn(g)) myTurn++;
        }
      }
      return { incoming, myTurn, active };
    }
    const todo = () => {
      const c = counts();
      return c.incoming + c.myTurn;
    };
    function updateBadge() {
      if (host.updateBadge) host.updateBadge();
    }

    // Tóm tắt cho trang chọn game
    function summary() {
      if (state.me && !state.offline && !S.loaded && !S.loading && Date.now() - S.summaryTry > 15000) {
        S.summaryTry = Date.now();
        load();
      }
      const c = counts();
      const me = meId();
      const rank = S.leaderboard ? S.leaderboard.findIndex((r) => r.userId === me) + 1 : 0;
      const bot = loadBot();
      return {
        rating: S.rating,
        rank: rank || null,
        todo: c.incoming + c.myTurn,
        incoming: c.incoming,
        myTurn: c.myTurn,
        active: c.active,
        top: (S.leaderboard || []).slice(0, 3),
        botPlaying: bot && !bot.result && bot.moves.length > 0 ? { level: LEVELS[bot.level].label, moves: bot.moves.length } : null,
      };
    }

    /* =========================================================
       Điều hướng
       ========================================================= */
    // app.js gọi mỗi khi đổi đường dẫn. onTab: đang ở mục Cờ caro; target: 'bot' | id ván | null
    function route(onTab, target) {
      const was = S.tab;
      S.tab = onTab;
      if (onTab && !was) {
        load();
        renderHome();
      }
      if (onTab && target != null) {
        openPane(target);
        return;
      }
      if (V.key && V.key !== 'empty') {
        const wasBot = V.key === 'bot';
        closePane();
        if (wasBot && onTab) renderHome(); // cập nhật thẻ "Ván với máy đang dở"
      }
      // Máy tính: cột phải khi chưa mở ván nào
      const wantEmpty = onTab && isDesktop() && state.currentId == null;
      if (wantEmpty && V.key !== 'empty') renderEmptyPane();
      else if (!wantEmpty && V.key === 'empty') closePane();
    }

    function otherPaneOpen() {
      return ['#chat-pane', '#chess-pane', '#blocks-pane', '#farm-pane', '#profile-pane', '#puzzle-pane'].some((sel) => {
        const el = $(sel);
        return el && !el.hidden;
      });
    }
    function closePane() {
      const pane = $('#caro-pane');
      stopTicker();
      clearTimeout(B.timer);
      clearTimeout(V.flashTimer);
      B.timer = null;
      B.thinking = false;
      // Ván với máy đã lưu sau mỗi nước: lần mở sau đọc lại từ bộ nhớ (thẻ khác có thể đã chơi tiếp)
      B.game = null;
      B.stateKey = '';
      Object.assign(V, { key: null, mode: null, els: null, board: null, lastId: null, lastPly: null, lastStatus: null, ghostHint: null, flashTimer: null, flashUntil: 0 });
      S.open = null;
      if (!pane || pane.hidden) return;
      pane.hidden = true;
      pane.replaceChildren();
      if (state.currentId == null && !otherPaneOpen()) {
        document.body.classList.remove('in-chat');
        $('#chat-empty').hidden = false;
      }
    }
    function showPane() {
      const pane = $('#caro-pane');
      document.body.classList.add('in-chat');
      $('#chat-empty').hidden = true;
      $('#chat-pane').hidden = true;
      pane.hidden = false;
      return pane;
    }
    function openPane(target) {
      const key = target === 'bot' ? 'bot' : `g${target}`;
      const justOpened = V.key !== key;
      if (justOpened) closePane();
      V.key = key;
      showPane();
      if (target === 'bot') {
        S.open = null;
        openBot(justOpened);
        return;
      }
      S.open = target;
      if (justOpened) hideToastsFor(target);
      renderOnline();
      // Luôn lấy bản mới nhất (đồng hồ chính xác); chưa có sẵn thì báo lỗi nếu không tải được
      if (justOpened) fetchGame(target, { quiet: S.games.has(target) });
    }

    function renderEmptyPane() {
      const pane = $('#caro-pane');
      if (!pane) return;
      V.key = 'empty';
      $('#chat-empty').hidden = true;
      pane.hidden = false;
      const n = 9;
      const cells = new Array(n * n).fill(0);
      [[3, 3, 1], [3, 4, 2], [4, 4, 1], [5, 5, 1], [2, 2, 2], [5, 3, 2], [6, 6, 1], [4, 5, 2], [2, 6, 2], [7, 7, 1]].forEach(([r, c, v]) => { cells[r * n + c] = v; });
      const board = miniBoard(cells, n, [3 * n + 3, 4 * n + 4, 5 * n + 5, 6 * n + 6, 7 * n + 7], 'x');
      board.classList.add('is-preview');
      pane.replaceChildren(h('div', { class: 'caro-empty' },
        board,
        h('p', { text: 'Chọn một ván đang chơi, nhận lời thách đấu, hoặc chơi với máy. Ai có 5 quân liền nhau trước là thắng.' })));
    }

    const gameHash = (id) => `#/caro/g/${id}`;
    function openGame(id) {
      navigate(gameHash(id), { replace: /^#\/caro\/(g\/|bot)/.test(location.hash) });
    }
    // Nút Quay lại trong ván: về bước trước trong app, mở thẳng từ đường dẫn thì về trang caro
    function backFromGame() {
      if (history.state && history.state.depth > 0) goBack();
      else navigate('#/caro', { replace: true });
    }
    function goHome() {
      navigate('#/caro', { replace: true });
    }

    /* ---------------- Thông báo nhỏ ---------------- */
    function caroToast(text, { title, userId, gameId } = {}) {
      const el = h('button', {
        class: 'toast toast-msg',
        type: 'button',
        dataset: { caroGame: String(gameId || 0) },
        onclick: () => {
          el.remove();
          navigate(gameId ? gameHash(gameId) : '#/caro', { replace: state.currentId != null });
        },
      },
      userId != null ? avatarEl(userOf(userId), 'avatar-sm', { dot: false }) : h('span', { class: 'chess-toast-ic caro-toast-ic' }, icon('caro')),
      h('span', { class: 'toast-text' }, title ? h('strong', { text: title }) : null, h('span', { text })));
      pushToast(el, 5000);
    }
    function hideToastsFor(id) {
      for (const el of document.querySelectorAll(`#toasts [data-caro-game="${id}"]`)) el.remove();
    }

    /* ---------------- Sự kiện realtime ---------------- */
    function onEvent(name, data) {
      const g = data && data.game;
      if (!g || !state.me) return;
      const me = meId();
      const prev = S.games.get(g.id);
      upsert([g]);
      const cur = S.games.get(g.id);
      if (cur !== g) return; // bản cũ đến trễ
      const visible = document.visibilityState === 'visible';
      const open = S.open === g.id && visible;

      if (name === 'caro:challenge') {
        if (g.status === 'challenge' && g.opponentId === me && !prev && visible) {
          caroToast(`${nameOf(g.challengerId)} thách bạn một ván caro (${turnLabel(g.turnMs)}, luật ${RULES[g.rule].label.toLowerCase()}). Bấm để xem.`, {
            title: '⭕ Thách đấu cờ caro',
            userId: g.challengerId,
            gameId: g.id,
          });
        } else if (g.status === 'declined' && g.challengerId === me && prev && prev.status === 'challenge') {
          toast(`${nameOf(g.opponentId)} đã từ chối lời thách đấu caro.`);
        }
        refresh();
        return;
      }
      if (g.status === 'active' && prev && prev.status === 'challenge' && g.challengerId === me && S.open !== g.id) {
        // Lời thách đấu mình gửi vừa được nhận
        if (S.tab && (V.key == null || V.key === 'empty') && state.currentId == null) openGame(g.id);
        else caroToast(`${nameOf(g.opponentId)} đã nhận lời. Bấm để vào chơi!`, { title: '⭕ Vào ván caro thôi', userId: g.opponentId, gameId: g.id });
      }
      if ((g.status === 'finished' || g.status === 'aborted') && prev && prev.status === 'active') {
        load(); // điểm ELO, bảng xếp hạng mới
        if (!open && mySide(g) && visible) caroToast(`Ván caro với ${nameOf(oppOf(g))} vừa kết thúc. Bấm để xem.`, { gameId: g.id });
      }
      if (g.status === 'active' && prev && prev.moves.length < g.moves.length && !open && isMyTurn(g) && visible) {
        caroToast(`${nameOf(oppOf(g))} vừa đi. Tới lượt bạn!`, { title: '⭕ Cờ caro', userId: oppOf(g), gameId: g.id });
      }
      refresh();
    }

    /* ---------------- Gửi yêu cầu ---------------- */
    async function act(url, body) {
      try {
        const { game } = await api(url, { method: 'POST', body: body || {} });
        upsert([game]);
        refresh();
        return game;
      } catch (err) {
        toast(err.message);
        load();
        return null;
      }
    }
    async function answer(id, action) {
      const game = await act(`/api/caro/challenges/${id}/${action}`);
      if (game && action === 'accept' && game.status === 'active') openGame(game.id);
      return game;
    }
    async function rematch(g) {
      const game = await act(`/api/caro/games/${g.id}/rematch`);
      if (!game) return;
      toast(`Đã gửi lời mời đấu lại cho ${nameOf(game.opponentId)}. Bạn cầm ${game.sidePref === 'x' ? 'X (đi trước)' : game.sidePref === 'o' ? 'O (đi sau)' : 'bên ngẫu nhiên'}.`);
      openGame(game.id);
    }
    async function resign(g) {
      const abort = g.moves.length < 2;
      const q = abort
        ? 'Hủy ván này? Chưa ai mất điểm vì ván chưa bắt đầu.'
        : g.rated ? 'Đầu hàng? Bạn sẽ thua ván này và bị trừ điểm ELO.' : 'Đầu hàng? Bạn sẽ thua ván này.';
      if (!window.confirm(q)) return;
      await act(`/api/caro/games/${g.id}/resign`);
    }

    async function sendMove(i) {
      const g = S.games.get(S.open);
      if (!g || g.status !== 'active' || !isMyTurn(g) || S.sending.has(g.id)) return;
      const st = stateOf(g);
      if (st.winner || st.board[i]) return;
      const ply = g.moves.length;
      // Hiện ngay trên bàn cờ, máy chủ trả lời sau
      const optimistic = { ...g, moves: [...g.moves, i], turn: otherSide(g.turn), turnStartedAt: serverNow() };
      S.games.set(g.id, optimistic);
      S.sending.add(g.id);
      V.ghostHint = null;
      refresh();
      try {
        const { game } = await api(`/api/caro/games/${g.id}/move`, { method: 'POST', body: { index: i, ply } });
        upsert([game]);
      } catch (err) {
        // Trả bàn cờ về như trước (nếu chưa có bản mới hơn), rồi lấy bản của máy chủ
        if (S.games.get(g.id) === optimistic) S.games.set(g.id, g);
        if (V.lastId === g.id) V.lastPly = S.games.get(g.id).moves.length;
        toast(err.message);
        fetchGame(g.id, { quiet: true });
      } finally {
        S.sending.delete(g.id);
        refresh();
      }
    }

    /* =========================================================
       Bàn cờ 15 × 15 (dùng chung cho ván với máy và với bạn)
       ========================================================= */
    function linesSvg() {
      let d = '';
      for (let k = 1; k < N; k++) d += `M${k} 0V${N}M0 ${k}H${N}`;
      const svg = svgEl('svg', { viewBox: `0 0 ${N} ${N}`, preserveAspectRatio: 'none', class: 'caro-lines', 'aria-hidden': 'true' });
      svg.append(svgEl('path', { d }));
      return svg;
    }

    // opts: { label, side() -> 'x' | 'o', place(i), invalid(i, why), onGhost(i | null) }. Có đánh được hay không do set({ playable }) quyết định.
    function makeBoard(opts) {
      const grid = h('div', { class: 'caro-board', role: 'grid', 'aria-label': opts.label });
      grid.append(linesSvg());
      const cells = [];
      for (let r = 0; r < N; r++) {
        const row = h('div', { class: 'caro-row', role: 'row' });
        for (let c = 0; c < N; c++) {
          const i = r * N + c;
          const cell = h('button', { class: 'caro-cell', type: 'button', role: 'gridcell', tabindex: '-1', 'aria-label': `${C.cellName(i)}, trống`, dataset: { i: String(i) } });
          cells.push(cell);
          row.append(cell);
        }
        grid.append(row);
      }
      const ghost = h('div', { class: 'caro-ghost', 'aria-hidden': 'true', hidden: true });
      const fx = h('div', { class: 'caro-fx', 'aria-hidden': 'true' });
      grid.append(ghost, fx);
      const cur = { vals: new Array(CELLS).fill(0), last: -1, win: '', cursor: Math.floor(CELLS / 2), ghost: -1, hover: -1, playable: false };
      cells[cur.cursor].tabIndex = 0;

      function drawGhost() {
        const i = cur.ghost >= 0 ? cur.ghost : cur.hover;
        if (i < 0) {
          ghost.hidden = true;
          return;
        }
        const side = opts.side();
        ghost.hidden = false;
        ghost.className = `caro-ghost is-${side}${cur.ghost >= 0 ? ' is-armed' : ''}`;
        ghost.style.left = `${((i % N) * 100) / N}%`;
        ghost.style.top = `${(Math.floor(i / N) * 100) / N}%`;
        if (ghost.dataset.side !== side) {
          ghost.replaceChildren(markSvg(side));
          ghost.dataset.side = side;
        }
      }
      function clearGhost() {
        const had = cur.ghost >= 0;
        cur.ghost = -1;
        drawGhost();
        if (had && opts.onGhost) opts.onGhost(null);
      }
      function setHover(i) {
        if (i === cur.hover) return;
        cur.hover = i;
        drawGhost();
      }
      function shake(i) {
        const cell = cells[i];
        cell.classList.remove('is-shake');
        void cell.offsetWidth;
        cell.classList.add('is-shake');
        setTimeout(() => cell.classList.remove('is-shake'), 320);
      }
      function moveCursor(i, focus) {
        if (i === cur.cursor) {
          if (focus) cells[i].focus({ preventScroll: true });
          return;
        }
        cells[cur.cursor].tabIndex = -1;
        cur.cursor = i;
        cells[i].tabIndex = 0;
        if (focus) cells[i].focus({ preventScroll: true });
      }

      function set({ board, last = -1, line = null, winner = null, playable = false, animate = true }) {
        cur.playable = playable;
        grid.classList.toggle('is-playable', playable);
        grid.classList.toggle('win-o', winner === 'o');
        const winSet = new Set(line || []);
        let changed = 0;
        for (let i = 0; i < CELLS; i++) if (board[i] !== cur.vals[i]) changed++;
        // Mở ván giữa chừng (nhiều ô thay đổi một lúc) thì không chạy hiệu ứng từng quân
        const anim = animate && changed <= 2 && !reducedMotion();
        for (let i = 0; i < CELLS; i++) {
          const v = board[i];
          const cell = cells[i];
          if (v !== cur.vals[i]) {
            cell.replaceChildren();
            if (v) cell.append(markSvg(sideOfNum(v), anim ? 'is-new' : ''));
            cur.vals[i] = v;
          }
          cell.classList.toggle('is-last', i === last && !winSet.size);
          cell.classList.toggle('is-win', winSet.has(i));
          const label = `${C.cellName(i)}, ${v ? markName(sideOfNum(v)) : 'trống'}${i === last ? ', nước vừa đi' : ''}${winSet.has(i) ? ', hàng thắng' : ''}`;
          if (cell.getAttribute('aria-label') !== label) cell.setAttribute('aria-label', label);
        }
        if (cur.last !== last && last >= 0 && document.activeElement && !grid.contains(document.activeElement)) moveCursor(last, false);
        cur.last = last;
        if (cur.ghost >= 0 && (board[cur.ghost] || !playable)) clearGhost();
        if (cur.hover >= 0 && (board[cur.hover] || !playable)) setHover(-1);
        else drawGhost();
        const key = line && line.length ? line.join(',') : '';
        if (key !== cur.win) {
          cur.win = key;
          for (const el of fx.querySelectorAll('.caro-winline')) el.remove();
          if (key) fx.append(winLineSvg(line, winner || sideOfNum(board[line[0]]) || 'x'));
        }
      }

      // Pháo giấy X/O rơi xuống khi thắng
      function celebrate(side) {
        if (reducedMotion()) return;
        for (let k = 0; k < 16; k++) {
          const piece = h('span', {
            class: 'caro-confetti',
            style: `left:${(4 + Math.random() * 88).toFixed(1)}%;--d:${(Math.random() * 0.5).toFixed(2)}s;--t:${(1.2 + Math.random() * 0.8).toFixed(2)}s;--r:${Math.round(180 + Math.random() * 360) * (Math.random() < 0.5 ? -1 : 1)}deg`,
          }, markSvg(k % 3 === 2 ? otherSide(side) : side));
          fx.append(piece);
          setTimeout(() => piece.remove(), 2600);
        }
      }

      let lastPointer = null;
      grid.addEventListener('pointerdown', (e) => {
        lastPointer = { type: e.pointerType || 'mouse', t: Date.now() };
      });
      grid.addEventListener('click', (e) => {
        const cell = e.target.closest('.caro-cell');
        if (!cell || !grid.contains(cell)) return;
        const i = Number(cell.dataset.i);
        // Bàn phím (Enter / Space): đánh luôn. Chuột: bấm là đánh. Ngón tay: chạm lần đầu để ngắm, chạm lần nữa mới đánh.
        const via = e.detail === 0 ? 'key' : lastPointer && Date.now() - lastPointer.t < 2000 ? lastPointer.type : 'mouse';
        moveCursor(i, false);
        if (!cur.playable) {
          opts.invalid(i, 'turn');
          return;
        }
        if (cur.vals[i]) {
          shake(i);
          clearGhost();
          opts.invalid(i, 'taken');
          return;
        }
        if (via === 'touch' || via === 'pen') {
          if (cur.ghost === i) {
            cur.ghost = -1;
            drawGhost();
            opts.place(i);
          } else {
            cur.ghost = i;
            drawGhost();
            if (opts.onGhost) opts.onGhost(i);
          }
          return;
        }
        cur.ghost = -1;
        cur.hover = -1;
        drawGhost();
        opts.place(i);
      });
      grid.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const cell = e.target.closest('.caro-cell');
        const i = cell ? Number(cell.dataset.i) : -1;
        setHover(i >= 0 && cur.playable && !cur.vals[i] ? i : -1);
      });
      grid.addEventListener('pointerleave', () => setHover(-1));
      grid.addEventListener('keydown', (e) => {
        const r = Math.floor(cur.cursor / N);
        const c = cur.cursor % N;
        let next = null;
        if (e.key === 'ArrowUp') next = r > 0 ? cur.cursor - N : null;
        else if (e.key === 'ArrowDown') next = r < N - 1 ? cur.cursor + N : null;
        else if (e.key === 'ArrowLeft') next = c > 0 ? cur.cursor - 1 : null;
        else if (e.key === 'ArrowRight') next = c < N - 1 ? cur.cursor + 1 : null;
        else if (e.key === 'Home') next = r * N;
        else if (e.key === 'End') next = r * N + N - 1;
        else return;
        e.preventDefault();
        if (next != null) moveCursor(next, true);
      });

      // Câu đố: tô ô gợi ý (null = bỏ tô)
      let hintAt = -1;
      function hint(i) {
        if (hintAt >= 0) cells[hintAt].classList.remove('is-hint');
        hintAt = i == null || i < 0 ? -1 : i;
        if (hintAt >= 0) cells[hintAt].classList.add('is-hint');
      }

      return { el: grid, set, clearGhost, celebrate, shake, hint, focus: () => cells[cur.cursor].focus({ preventScroll: true }) };
    }

    // Bàn câu đố (Quiz hằng ngày, Thử thách nhanh: public/puzzles-ui.js): cùng bàn, cách chạm ngắm rồi đánh và âm thanh của caro
    function puzzleBoard(opts) {
      const board = makeBoard(opts);
      board.el.addEventListener('pointerdown', unlockAudio, { capture: true });
      return {
        ...board,
        play,
        unlock: unlockAudio,
        soundOn: () => audio.on,
        setSound: (on) => { if (audio.on !== Boolean(on)) toggleSound(); },
      };
    }

    /* =========================================================
       Khung màn chơi (đầu trang, hai người chơi, bàn cờ, trạng thái, nút)
       ========================================================= */
    function buildScreen(mode, boardOpts) {
      const pane = $('#caro-pane');
      stopTicker();
      const back = h('button', { class: 'icon-btn back-btn', type: 'button', 'aria-label': 'Quay lại', onclick: backFromGame }, icon('back'));
      const title = h('h2');
      const sub = h('p');
      const soundBtn = h('button', { class: 'icon-btn', type: 'button', onclick: toggleSound });
      const extra = h('span', { class: 'caro-head-extra' });
      const players = h('div', { class: 'caro-players' });
      const stage = h('div', { class: 'caro-stage' });
      const status = h('p', { class: 'caro-status' });
      const side = h('div', { class: 'caro-col-body' });
      const board = makeBoard(boardOpts);
      stage.append(board.el);
      const body = h('div', { class: 'caro-game' },
        h('div', { class: 'caro-play' }, players, stage),
        h('div', { class: 'caro-col' }, status, side));
      pane.replaceChildren(
        h('header', { class: 'chat-head caro-head' }, back, h('div', { class: 'chat-title' }, title, sub), extra, soundBtn),
        body);
      V.mode = mode;
      V.els = { pane, title, sub, soundBtn, extra, players, stage, status, side, body };
      V.board = board;
      drawSoundBtn();
      return V.els;
    }
    function setText(el, text) {
      if (el.textContent !== text) el.textContent = text;
    }
    // Vẽ lại vùng nút mà không làm mất chỗ đang chọn bằng bàn phím
    function fillSide(parts) {
      const box = V.els.side;
      const focusKey = box.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
      box.replaceChildren(...parts.filter(Boolean));
      if (focusKey) {
        const again = box.querySelector(`[data-focus="${focusKey}"]:not([disabled])`);
        if (again) again.focus({ preventScroll: true });
      }
    }

    function ringSvg() {
      const svg = svgEl('svg', { viewBox: '0 0 44 44', class: 'caro-ring', 'aria-hidden': 'true' });
      svg.append(svgEl('circle', { cx: 22, cy: 22, r: 20, class: 'track' }), svgEl('circle', { cx: 22, cy: 22, r: 20, class: 'left', pathLength: 1 }));
      return svg;
    }
    function botAvatar() {
      return h('span', { class: 'avatar caro-bot-av' }, icon('bot'));
    }
    // Thẻ người chơi: ảnh (vòng đếm giờ khi tới lượt), tên, dòng phụ, dấu X/O
    function playerCard({ side, avatar, name, sub, turn, right, timed }) {
      return h('div', { class: `caro-player is-${side}${turn ? ' is-turn' : ''}${right ? ' is-right' : ''}`, dataset: { side } },
        h('span', { class: 'caro-av' }, avatar, turn && timed ? ringSvg() : null, h('span', { class: 'caro-player-mark' }, markSvg(side))),
        h('span', { class: 'caro-player-main' },
          h('span', { class: 'caro-player-name' }, name, h('span', { class: 'visually-hidden', text: `, cầm ${markName(side)}${turn ? ', đang tới lượt' : ''}` })),
          h('span', { class: 'caro-player-sub' }, sub)));
    }

    /* =========================================================
       Ván với bạn bè
       ========================================================= */
    function renderOnline() {
      const id = S.open;
      const pane = $('#caro-pane');
      if (id == null || !pane || pane.hidden) return;
      const g = S.games.get(id);
      if (!g) {
        if (V.mode !== 'loading') {
          stopTicker();
          V.mode = 'loading';
          V.els = null;
          V.board = null;
          pane.replaceChildren(
            h('header', { class: 'chat-head' }, h('button', { class: 'icon-btn back-btn', type: 'button', 'aria-label': 'Quay lại', onclick: backFromGame }, icon('back')), h('div', { class: 'chat-title' }, h('h2', { text: 'Cờ caro' }))),
            h('div', { class: 'caro-loading' }, h('span', { class: 'spinner' }), 'Đang tải…'));
        }
        return;
      }
      if (g.status !== 'active' && g.status !== 'finished' && g.status !== 'aborted') {
        renderChallenge(pane, g);
        return;
      }
      if (V.mode !== 'game') {
        buildScreen('game', {
          label: 'Bàn cờ caro 15 × 15',
          side: () => {
            const cur = S.games.get(S.open);
            return (cur && mySide(cur)) || 'x';
          },
          place: (i) => sendMove(i),
          invalid: (i, why) => {
            const cur = S.games.get(S.open);
            if (!cur || cur.status !== 'active' || !mySide(cur)) return;
            play('invalid', 0.6);
            if (why === 'turn') flashStatus(S.sending.has(cur.id) ? 'Đang gửi nước đi…' : `Chưa tới lượt bạn. Chờ ${nameOf(oppOf(cur))} đi.`);
          },
          onGhost: (i) => {
            V.ghostHint = i;
            renderOnline();
          },
        });
      }
      drawOnline(g);
    }

    // Nhắc nhanh ở dòng trạng thái (vd bấm khi chưa tới lượt), tự trở lại sau chưa đầy 2 giây
    function flashStatus(text) {
      if (!V.els) return;
      V.flashUntil = Date.now() + 1800;
      V.els.status.className = 'caro-status is-hint';
      V.els.status.textContent = text;
      clearTimeout(V.flashTimer);
      V.flashTimer = setTimeout(() => {
        V.flashUntil = 0;
        if (V.key === 'bot') drawBot();
        else if (S.open != null) renderOnline();
      }, 1800);
    }
    function setStatus(text, cls, show) {
      const el = V.els.status;
      el.hidden = !show;
      if (Date.now() < V.flashUntil && V.ghostHint == null) return;
      if (el.className !== cls) el.className = cls;
      setText(el, text);
    }

    function outcomeFor(g, mine) {
      if (g.status === 'aborted') return 'aborted';
      if (!g.result) return null;
      if (g.result === 'draw') return 'draw';
      if (!mine) return 'none';
      return g.result === mine ? 'win' : 'loss';
    }
    function reasonText(g, mine) {
      const o = outcomeFor(g, mine);
      switch (g.reason) {
        case 'five': return o === 'loss' ? `${nameOf(oppOf(g))} có 5 quân liền` : '5 quân liền';
        case 'resign': return o === 'win' ? 'Đối thủ đầu hàng' : o === 'loss' ? 'Bạn đã đầu hàng' : 'Đầu hàng';
        case 'timeout': return o === 'win' ? 'Đối thủ hết giờ' : o === 'loss' ? 'Bạn hết giờ' : 'Hết giờ';
        case 'full': return 'Kín bàn, không ai có 5 quân liền';
        case 'no-start': return 'Không ai đi nước đầu nên ván bị hủy';
        case 'aborted': return 'Ván bị hủy trước khi bắt đầu, không tính điểm';
        default: return '';
      }
    }
    function resultTitle(g, mine) {
      const o = outcomeFor(g, mine);
      if (o === 'aborted') return 'Ván đã hủy';
      if (o === 'draw') return 'Hòa';
      if (o === 'win') return 'Bạn thắng!';
      if (o === 'loss') return 'Bạn thua';
      return g.result ? `${nameOf(idOf(g, g.result))} thắng` : '';
    }
    function resultCard({ outcome, title, reason, delta, after }) {
      const ic = outcome === 'win' ? 'trophy' : outcome === 'loss' ? 'flag' : outcome === 'draw' ? 'handshake' : 'close';
      return h('div', { class: `caro-result is-${outcome || 'none'}`, role: 'status' },
        h('span', { class: 'caro-result-ic' }, icon(ic)),
        h('div', { class: 'caro-result-main' }, h('strong', { text: title }), reason ? h('span', { text: reason }) : null),
        delta != null ? h('div', { class: 'caro-result-delta' }, h('strong', { text: signed(delta) }), after != null ? h('span', { text: `ELO ${after}` }) : null) : null);
    }

    function drawOnline(g) {
      const E = V.els;
      const mine = mySide(g);
      const st = stateOf(g);
      const active = g.status === 'active';
      const n = g.moves.length;
      const last = n ? g.moves[n - 1] : -1;
      const line = g.winLine || st.line;
      const winner = g.result === 'x' || g.result === 'o' ? g.result : sideOfNum(st.winner);
      const outcome = outcomeFor(g, mine);

      // Âm thanh: bàn cờ tiến thêm đúng một nước, ván vừa bắt đầu / kết thúc
      if (V.lastId === g.id) {
        if (V.lastPly != null && n === V.lastPly + 1) {
          const mover = n % 2 === 1 ? 'x' : 'o';
          play(`place-${mover}`, 0.9);
          if (!st.winner && makesThreat(st.board, last, g.rule)) play('threat', 0.8, 150);
          else if (active && mine && mover !== mine) play('turn', 0.6, 170);
          if (mine && mover !== mine && active) announce(`${nameOf(oppOf(g))} đi ${C.cellName(last)}. Tới lượt bạn.`);
        }
        if (V.lastStatus === 'challenge' && active) play('start', 0.8);
        if (V.lastStatus === 'active' && !active) {
          if (outcome === 'win') {
            play('win', 0.9, 300);
            V.board.celebrate(mine);
          } else if (outcome === 'loss') play('lose', 0.9, 300);
          else if (outcome === 'draw') play('draw', 0.9, 300);
          announce(`${resultTitle(g, mine)}. ${reasonText(g, mine)}.`);
        }
      } else if (active && n === 0) {
        play('start', 0.8);
      }
      V.lastId = g.id;
      V.lastPly = n;
      V.lastStatus = g.status;

      // Đầu trang
      const oppId = oppOf(g);
      setText(E.title, mine ? `Với ${nameOf(oppId)}` : `${nameOf(g.xId)} vs ${nameOf(g.oId)}`);
      setText(E.sub, `${turnLabel(g.turnMs)} · ${RULES[g.rule] ? RULES[g.rule].label : g.rule} · ${g.rated ? 'Tính điểm' : 'Giao hữu'}`);

      // Hai người chơi: mình bên trái (người xem: X bên trái)
      const leftSide = mine || 'x';
      const rightSide = otherSide(leftSide);
      const finished = g.status === 'finished';
      const card = (side, right) => {
        const uid = idOf(g, side);
        const isMe = uid === meId();
        const rating = finished && g.rated && (side === 'x' ? g.xRating : g.oRating) != null
          ? (side === 'x' ? g.xRating : g.oRating)
          : ratingOf(uid);
        const delta = finished && g.rated ? (side === 'x' ? g.xDelta : g.oDelta) : null;
        return playerCard({
          side,
          right,
          avatar: avatarEl(userOf(uid), '', { dot: !isMe }),
          name: isMe ? 'Bạn' : nameOf(uid),
          sub: [`ELO ${rating}`, delta != null ? h('span', { class: delta >= 0 ? 'is-up' : 'is-down', text: ` ${signed(delta)}` }) : null],
          turn: active && g.turn === side,
          timed: Boolean(g.turnMs),
        });
      };
      const center = h('div', { class: 'caro-center', id: 'caro-center' });
      const bar = active && g.turnMs ? h('div', { class: `caro-timebar is-${g.turn}`, id: 'caro-timebar' }, h('span')) : null;
      E.players.replaceChildren(card(leftSide, false), center, card(rightSide, true), ...(bar ? [bar] : []));

      // Bàn cờ
      const playable = Boolean(active && mine && g.turn === mine && !S.sending.has(g.id) && !st.winner);
      V.board.set({ board: st.board, last, line, winner, playable });

      // Trạng thái
      let status = '';
      let cls = 'caro-status';
      if (active) {
        if (!mine) status = `Lượt ${markName(g.turn)}`;
        else if (S.sending.has(g.id)) {
          status = 'Đang gửi nước đi';
          cls += ' is-wait';
        } else if (g.turn === mine) {
          if (V.ghostHint != null && !st.board[V.ghostHint]) {
            status = `Chạm lần nữa vào ${C.cellName(V.ghostHint)} để đánh`;
            cls += ' is-hint';
          } else {
            status = n === 0 ? 'Tới lượt bạn: đi nước đầu tiên' : 'Tới lượt bạn';
            cls += ' is-turn';
          }
        } else {
          status = `Chờ ${nameOf(oppId)} đi`;
          cls += ' is-wait';
        }
      }
      setStatus(status, cls, active);

      // Kết quả, nút
      const parts = [];
      if (!active) {
        const delta = mine && g.rated ? (mine === 'x' ? g.xDelta : g.oDelta) : null;
        const before = mine ? (mine === 'x' ? g.xRating : g.oRating) : null;
        parts.push(resultCard({ outcome, title: resultTitle(g, mine), reason: reasonText(g, mine), delta, after: delta != null && before != null ? before + delta : null }));
      }
      if (active && mine && g.turnMs && n < 2) {
        parts.push(h('p', { class: 'caro-note', text: `Mỗi bên cần đi nước đầu trong ${Math.round(g.turnMs / 1000)} giây, không thì ván bị hủy.` }));
      }
      if (active && mine) {
        const abort = n < 2;
        parts.push(h('div', { class: 'caro-actions' },
          h('button', {
            class: 'btn btn-danger', type: 'button', dataset: { focus: 'resign' },
            onclick: (e) => withBusy(e.currentTarget, () => resign(S.games.get(g.id) || g)),
          }, icon(abort ? 'close' : 'flag'), abort ? 'Hủy ván' : 'Đầu hàng')));
      } else if (!active) {
        parts.push(h('div', { class: 'caro-actions' },
          mine ? h('button', { class: 'btn btn-primary', type: 'button', dataset: { focus: 'rematch' }, onclick: (e) => withBusy(e.currentTarget, () => rematch(g)) }, icon('replay'), 'Đấu lại') : null,
          h('button', { class: 'btn', type: 'button', dataset: { focus: 'home' }, onclick: goHome }, 'Về trang caro')));
      }
      parts.push(h('p', { class: 'caro-note', text: n ? `${n} nước · nước vừa đi ${C.cellName(last)}` : 'Chưa có nước nào' }));
      if (active && mine) parts.push(h('p', { class: 'caro-keys', text: 'Dùng phím mũi tên để chọn ô, Enter để đánh.' }));
      fillSide(parts);

      stopTicker();
      if (active) {
        tick();
        if (g.turnMs) V.ticker = setInterval(tick, 250);
      } else {
        const c = $('#caro-center');
        if (c) c.replaceChildren(document.createTextNode(outcome === 'draw' ? 'HÒA' : 'VS'));
      }
    }

    function stopTicker() {
      clearInterval(V.ticker);
      V.ticker = null;
    }
    // Đồng hồ mỗi nước: số giây ở giữa, thanh thời gian, vòng quanh ảnh người đang tới lượt
    function tick() {
      const g = S.games.get(S.open);
      const center = $('#caro-center');
      if (!g || !center) return;
      if (g.status !== 'active' || !g.turnMs) {
        const text = g.status === 'active' ? 'VS' : '';
        if (center.textContent !== text) center.replaceChildren(document.createTextNode(text));
        return;
      }
      const left = Math.max(0, turnLeft(g));
      const frac = Math.max(0, Math.min(1, left / g.turnMs));
      const low = left <= Math.min(10000, g.turnMs * 0.34);
      let clock = center.querySelector('.caro-clock');
      if (!clock) {
        clock = h('span', { class: 'caro-clock', role: 'timer' });
        center.replaceChildren(clock, h('small', { text: 'còn lại' }));
      }
      clock.className = `caro-clock is-${g.turn}${low ? ' is-low' : ''}`;
      const txt = clockText(left);
      if (clock.textContent !== txt) clock.textContent = txt;
      clock.setAttribute('aria-label', `${isMyTurn(g) ? 'Bạn' : nameOf(idOf(g, g.turn))} còn ${Math.ceil(left / 1000)} giây`);
      const bar = $('#caro-timebar');
      if (bar) {
        bar.classList.toggle('is-low', low);
        bar.firstElementChild.style.transform = `scaleX(${frac.toFixed(4)})`;
      }
      const card = V.els && V.els.players.querySelector(`.caro-player[data-side="${g.turn}"]`);
      if (card) {
        card.classList.toggle('is-low', low);
        const ring = card.querySelector('.caro-ring .left');
        if (ring) ring.style.strokeDashoffset = String((1 - frac).toFixed(4));
      }
      // Hết giờ mà chưa nhận được kết quả từ máy chủ: hỏi lại
      if (left <= 0 && Date.now() - V.lateFetch > 4000) {
        V.lateFetch = Date.now();
        setTimeout(() => { if (S.open === g.id) fetchGame(g.id, { quiet: true }); }, 1500);
      }
    }

    function ratingOf(uid) {
      if (uid === meId() && S.rating) return S.rating.rating;
      const r = (S.leaderboard || []).find((x) => x.userId === uid);
      return r ? r.rating : 1200;
    }
    function sidePrefText(g, forChallenger) {
      if (g.sidePref === 'random') return 'bên ngẫu nhiên';
      const challengerX = g.sidePref === 'x';
      return challengerX === forChallenger ? 'bạn đi trước (X)' : 'bạn đi sau (O)';
    }
    const challengeLeft = (g) => Math.max(0, g.createdAt + CHALLENGE_MS - serverNow());

    // Lời thách đấu (chưa bắt đầu / đã bị từ chối, hủy, hết hạn)
    function renderChallenge(pane, g) {
      stopTicker();
      V.mode = 'challenge';
      V.els = null;
      V.board = null;
      V.lastId = g.id;
      V.lastPly = g.moves.length;
      V.lastStatus = g.status;
      const me = meId();
      const incoming = g.opponentId === me;
      const statusText = g.status === 'declined' ? 'Lời thách đấu đã bị từ chối.'
        : g.status === 'cancelled' ? 'Lời thách đấu đã được hủy.'
          : g.status === 'expired' ? 'Lời thách đấu đã hết hạn.'
            : incoming ? `${nameOf(g.challengerId)} thách bạn một ván caro.` : `Đang chờ ${nameOf(g.opponentId)} nhận lời…`;
      const info = [
        g.turnMs ? `Mỗi nước tối đa ${secondsLabel(Math.round(g.turnMs / 1000))}, hết giờ là thua` : 'Không giới hạn thời gian mỗi nước',
        `Luật ${RULES[g.rule] ? RULES[g.rule].label.toLowerCase() : g.rule}: ${RULES[g.rule] ? RULES[g.rule].about.charAt(0).toLowerCase() + RULES[g.rule].about.slice(1) : ''}`,
        g.rated ? 'Có tính điểm ELO' : 'Giao hữu, không tính điểm',
        `${sidePrefText(g, !incoming).replace(/^b/, 'B')}`,
        g.status === 'challenge' ? `Hết hạn sau khoảng ${Math.max(1, Math.ceil(challengeLeft(g) / 60000))} phút` : null,
      ].filter(Boolean);
      let actions;
      if (g.status !== 'challenge') actions = [h('button', { class: 'btn', type: 'button', onclick: goHome, text: 'Về trang caro' })];
      else if (incoming) {
        actions = [
          h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => answer(g.id, 'accept')) }, icon('check'), 'Nhận lời'),
          h('button', { class: 'btn', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => { await answer(g.id, 'decline'); goHome(); }) }, icon('close'), 'Từ chối'),
        ];
      } else {
        actions = [h('button', { class: 'btn btn-danger', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => { await answer(g.id, 'cancel'); goHome(); }), text: 'Hủy lời thách đấu' })];
      }
      const side = (uid) => h('div', {}, avatarEl(userOf(uid), 'avatar-xl', { dot: false }), h('strong', { text: nameOf(uid) }));
      pane.replaceChildren(
        h('header', { class: 'chat-head' },
          h('button', { class: 'icon-btn back-btn', type: 'button', 'aria-label': 'Quay lại', onclick: backFromGame }, icon('back')),
          h('div', { class: 'chat-title' }, h('h2', { text: 'Thách đấu cờ caro' }), h('p', { text: `${turnLabel(g.turnMs)} · ${g.rated ? 'Tính điểm ELO' : 'Giao hữu'}` }))),
        h('div', { class: 'chess-challenge' },
          h('div', { class: 'chess-vs' }, side(g.challengerId), h('span', { class: 'chess-vs-text', text: 'VS' }), side(g.opponentId)),
          h('p', { class: 'chess-challenge-status', role: 'status', text: statusText }),
          h('ul', { class: 'chess-info' }, info.map((t) => h('li', { text: t }))),
          h('div', { class: 'btn-row chess-actions' }, actions)));
    }

    /* =========================================================
       Ván với máy (chạy hẳn trên máy này)
       ========================================================= */
    function validBot(g) {
      if (!g || g.v !== 1 || !LEVELS[g.level] || !RULES[g.rule] || (g.side !== 'x' && g.side !== 'o') || !Array.isArray(g.moves)) return false;
      if (!g.moves.every((m) => Number.isInteger(m) && m >= 0 && m < CELLS)) return false;
      return C.fromMoves(g.moves, g.rule).moves.length === g.moves.length;
    }
    function loadBot() {
      if (B.game) return B.game;
      const saved = store.get(KEY_BOT, null);
      return C && validBot(saved) ? saved : null;
    }
    function saveBot() {
      if (B.game) store.set(KEY_BOT, B.game);
    }
    function botState() {
      const g = B.game;
      const key = `${g.rule}:${g.moves.join(',')}`;
      if (B.stateKey !== key) {
        B.stateKey = key;
        B.state = C.fromMoves(g.moves, g.rule);
      }
      return B.state;
    }
    function botPrefs() {
      const p = store.get(KEY_PREFS, {}) || {};
      return {
        level: LEVELS[p.level] ? p.level : 'medium',
        side: ['x', 'o', 'random'].includes(p.side) ? p.side : 'x',
        rule: RULES[p.rule] ? p.rule : 'free',
      };
    }
    // Thành tích với máy: { [người dùng]: { easy: { win, loss, draw }, ... } }
    function botStats() {
      const all = store.get(KEY_STATS, {}) || {};
      const mine = all[String(meId() || 'local')] || {};
      const out = {};
      for (const k of LEVEL_ORDER) {
        const s = mine[k] || {};
        out[k] = { win: Number(s.win) || 0, loss: Number(s.loss) || 0, draw: Number(s.draw) || 0 };
      }
      return out;
    }
    function bumpStat(level, result, d) {
      const all = store.get(KEY_STATS, {}) || {};
      const key = String(meId() || 'local');
      const mine = all[key] || {};
      const s = mine[level] || { win: 0, loss: 0, draw: 0 };
      s[result] = Math.max(0, (Number(s[result]) || 0) + d);
      mine[level] = s;
      all[key] = mine;
      store.set(KEY_STATS, all);
    }

    function openBot(justOpened) {
      if (!C) return;
      if (!B.game) B.game = loadBot();
      if (!B.game) {
        const p = botPrefs();
        newBotGame({ level: p.level, side: p.side, rule: p.rule }, { navigateAway: false });
        return;
      }
      if (justOpened || V.mode !== 'bot') buildBotScreen();
      drawBot();
      scheduleBot();
    }
    function buildBotScreen() {
      buildScreen('bot', {
        label: 'Bàn cờ caro 15 × 15, chơi với máy',
        side: () => (B.game ? B.game.side : 'x'),
        place: (i) => myBotMove(i),
        invalid: (i, why) => {
          const g = B.game;
          if (!g || g.result) return;
          play('invalid', 0.6);
          if (why === 'turn') flashStatus('Máy đang nghĩ, chờ chút nhé.');
        },
        onGhost: (i) => {
          V.ghostHint = i;
          drawBot();
        },
      });
      V.els.extra.replaceChildren(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Luật chơi', onclick: openRules }, icon('info')));
    }

    function newBotGame({ level, side, rule }, { navigateAway = true } = {}) {
      store.set(KEY_PREFS, { level, side, rule });
      const real = side === 'random' ? (Math.random() < 0.5 ? 'x' : 'o') : side;
      clearTimeout(B.timer);
      B.timer = null;
      B.thinking = false;
      B.game = { v: 1, id: Date.now(), level, side: real, pref: side, rule, moves: [], result: null, startedAt: Date.now(), updatedAt: Date.now() };
      saveBot();
      V.ghostHint = null;
      if (navigateAway && V.key !== 'bot') {
        navigate('#/caro/bot', { replace: /^#\/caro\/(g\/|bot)/.test(location.hash) });
        play('start', 0.8);
        return;
      }
      if (V.key === 'bot') {
        if (V.mode !== 'bot') buildBotScreen();
        V.board.set({ board: new Array(CELLS).fill(0), playable: false, animate: false });
        drawBot();
        play('start', 0.8);
        announce(`Ván mới với máy ${LEVELS[level].label}. Bạn cầm ${markName(real)}${real === 'x' ? ', đi trước' : ', máy đi trước'}.`);
        scheduleBot();
      }
      botChanged();
    }

    function myBotMove(i) {
      const g = B.game;
      if (!g || g.result || B.thinking) return;
      const st = botState();
      const next = C.play(st, i);
      if (!next) return;
      V.ghostHint = null;
      applyBot(i, g.side);
      // Chuỗi hằng ngày: chơi với máy cũng tính (lưu trên máy, có mạng thì gửi)
      if (window.ThinkStreaks) window.ThinkStreaks.mark('caro', state.me ? state.me.id : null);
      scheduleBot();
    }
    // Áp một nước (của mình hoặc của máy) vào ván, lưu lại, phát tiếng
    function applyBot(i, mover) {
      const g = B.game;
      g.moves.push(i);
      g.updatedAt = Date.now();
      const st = botState();
      play(`place-${mover}`, 0.9);
      if (st.winner) finishBot(st);
      else if (makesThreat(st.board, i, g.rule)) play('threat', 0.8, 150);
      saveBot();
      drawBot();
      if (g.moves.length === 1 || st.winner) botChanged();
    }
    function finishBot(st) {
      const g = B.game;
      const mine = g.side === 'x' ? C.X : C.O;
      g.result = st.winner === 3 ? 'draw' : st.winner === mine ? 'win' : 'loss';
      bumpStat(g.level, g.result, 1);
      if (g.result === 'win') {
        play('win', 0.9, 320);
        V.board && V.board.celebrate(g.side);
      } else play(g.result === 'loss' ? 'lose' : 'draw', 0.9, 320);
      announce(g.result === 'win' ? 'Bạn thắng!' : g.result === 'loss' ? 'Máy thắng.' : 'Hòa, kín bàn.');
    }
    // Tới lượt máy: nghĩ một chút cho tự nhiên (vẽ bàn trước, tính sau)
    function scheduleBot() {
      const g = B.game;
      if (!g || g.result || B.timer || V.key !== 'bot') return;
      const st = botState();
      if (st.winner) return;
      const botNum = g.side === 'x' ? C.O : C.X;
      if (C.turnAfter(g.moves.length) !== botNum) return;
      B.thinking = true;
      drawBot();
      const delay = g.moves.length === 0 ? 450 : 300 + Math.random() * 400;
      B.timer = setTimeout(() => {
        B.timer = null;
        if (B.game !== g || V.key !== 'bot') {
          B.thinking = false;
          return;
        }
        const i = C.bestMove(botState(), g.level);
        B.thinking = false;
        if (C.play(botState(), i)) {
          applyBot(i, otherSide(g.side));
          if (!g.result) announce(`Máy đi ${C.cellName(i)}. Tới lượt bạn.`);
        } else drawBot();
      }, delay);
    }

    function undoBot() {
      const g = B.game;
      if (!g) return;
      const mineNum = g.side === 'x' ? C.X : C.O;
      const mineAt = (k) => C.turnAfter(k) === mineNum; // nước thứ k (tính từ 0) là của mình?
      if (!g.moves.some((_, k) => mineAt(k))) return;
      clearTimeout(B.timer);
      B.timer = null;
      B.thinking = false;
      if (g.result) {
        bumpStat(g.level, g.result, -1); // ván đã tính thành tích: đi lại thì bỏ kết quả đó
        g.result = null;
      }
      // Bỏ nước của máy (nếu có) rồi bỏ nước gần nhất của mình
      while (g.moves.length && !mineAt(g.moves.length - 1)) g.moves.pop();
      if (g.moves.length) g.moves.pop();
      g.updatedAt = Date.now();
      V.ghostHint = null;
      saveBot();
      play(`place-${g.side}`, 0.3);
      drawBot();
      announce('Đã đi lại.');
      scheduleBot();
      botChanged();
    }
    function swapBot() {
      const g = B.game;
      if (!g) return;
      const inProgress = !g.result && g.moves.length >= 2;
      if (inProgress && !window.confirm('Bỏ ván này và chơi ván mới, đổi bên với máy?')) return;
      newBotGame({ level: g.level, side: otherSide(g.side), rule: g.rule });
    }

    function drawBot() {
      const g = B.game;
      if (!g || V.mode !== 'bot' || !V.els) return;
      const E = V.els;
      const st = botState();
      const n = g.moves.length;
      const last = n ? g.moves[n - 1] : -1;
      const mine = g.side;
      const botSide = otherSide(mine);
      const turn = C.turnAfter(n) === C.X ? 'x' : 'o';
      const over = Boolean(g.result || st.winner);
      const level = LEVELS[g.level];

      setText(E.title, 'Chơi với máy');
      setText(E.sub, `Máy ${level.label.toLowerCase()} · ${RULES[g.rule].label} · Bạn cầm ${markName(mine)}`);
      const stats = botStats()[g.level];
      E.players.replaceChildren(
        playerCard({
          side: mine,
          avatar: avatarEl(state.me, '', { dot: false }),
          name: 'Bạn',
          sub: `${stats.win} thắng · ${stats.loss} thua`,
          turn: !over && turn === mine,
        }),
        h('div', { class: 'caro-center' }, over ? (g.result === 'draw' ? 'HÒA' : 'VS') : 'VS'),
        playerCard({ side: botSide, right: true, avatar: botAvatar(), name: 'Máy', sub: `Mức ${level.label.toLowerCase()}`, turn: !over && turn === botSide }));

      const playable = !over && !B.thinking && turn === mine;
      V.board.set({ board: st.board, last, line: st.line, winner: sideOfNum(st.winner), playable });

      let status = '';
      let cls = 'caro-status';
      if (!over) {
        if (B.thinking || turn !== mine) {
          status = 'Máy đang nghĩ';
          cls += ' is-wait';
        } else if (V.ghostHint != null && !st.board[V.ghostHint]) {
          status = `Chạm lần nữa vào ${C.cellName(V.ghostHint)} để đánh`;
          cls += ' is-hint';
        } else {
          status = n === 0 ? 'Tới lượt bạn: đi nước đầu tiên' : 'Tới lượt bạn';
          cls += ' is-turn';
        }
      }
      setStatus(status, cls, !over);

      const mineNum = mine === 'x' ? C.X : C.O;
      const canUndo = g.moves.some((_, k) => C.turnAfter(k) === mineNum);
      const parts = [];
      if (over) {
        const r = g.result || (st.winner === 3 ? 'draw' : st.winner === mineNum ? 'win' : 'loss');
        parts.push(resultCard({
          outcome: r,
          title: r === 'win' ? 'Bạn thắng!' : r === 'loss' ? 'Máy thắng' : 'Hòa',
          reason: r === 'draw' ? 'Kín bàn, không ai có 5 quân liền' : `${r === 'win' ? 'Bạn' : 'Máy'} có 5 quân liền · ${n} nước`,
        }));
      }
      parts.push(h('div', { class: 'caro-actions' },
        h('button', { class: 'btn', type: 'button', disabled: !canUndo, dataset: { focus: 'undo' }, 'aria-keyshortcuts': 'Control+Z', onclick: undoBot }, icon('undo'), 'Đi lại'),
        h('button', { class: `btn${over ? ' btn-primary' : ''}`, type: 'button', dataset: { focus: 'new' }, onclick: () => openBotSheet() }, icon('replay'), 'Ván mới'),
        h('button', { class: 'btn', type: 'button', dataset: { focus: 'swap' }, onclick: swapBot }, icon('swap'), 'Đổi bên')));
      parts.push(h('p', { class: 'caro-botline' },
        h('span', {}, 'Với máy ', h('strong', { text: level.label.toLowerCase() }), `: ${stats.win} thắng · ${stats.loss} thua${stats.draw ? ` · ${stats.draw} hòa` : ''}`),
        h('span', { text: `${n} nước` })));
      parts.push(h('p', { class: 'caro-keys', text: 'Phím mũi tên để chọn ô, Enter để đánh, Ctrl+Z để đi lại.' }));
      fillSide(parts);
    }
    function botChanged() {
      if (S.tab) renderHome();
      if (host.onChange) host.onChange();
    }
    // Ctrl+Z: đi lại khi đang chơi với máy
    document.addEventListener('keydown', (e) => {
      if (V.key !== 'bot' || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || e.altKey) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (layer && !layer.hidden) return;
      e.preventDefault();
      undoBot();
    });

    /* =========================================================
       Trang Cờ caro (cột trái)
       ========================================================= */
    function renderHome() {
      const home = $('#caro-home');
      if (!home || !state.me) return;
      const me = meId();
      const list = [...S.games.values()];
      const incoming = list.filter((g) => g.status === 'challenge' && g.opponentId === me).sort((a, b) => b.createdAt - a.createdAt);
      const outgoing = list.filter((g) => g.status === 'challenge' && g.challengerId === me).sort((a, b) => b.createdAt - a.createdAt);
      const active = list
        .filter((g) => g.status === 'active' && mySide(g))
        .sort((a, b) => Number(isMyTurn(b)) - Number(isMyTurn(a)) || b.updatedAt - a.updatedAt);
      const recent = list
        .filter((g) => (g.status === 'finished' || g.status === 'aborted') && mySide(g))
        .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
        .slice(0, 10);
      const r = S.rating;
      const rank = S.leaderboard ? S.leaderboard.findIndex((x) => x.userId === me) + 1 : 0;
      const bot = loadBot();
      const botPlaying = bot && !bot.result && bot.moves.length > 0;
      const scroll = home.scrollTop;

      const hero = h('div', { class: 'caro-hero' },
        h('div', { class: 'caro-hero-top' },
          h('span', { class: 'caro-medal' }, icon('trophy')),
          h('div', { class: 'caro-hero-main' },
            h('span', { class: 'caro-hero-label', text: 'Điểm ELO cờ caro' }),
            h('span', { class: 'caro-hero-rating', text: r ? String(r.rating) : '—' })),
          rank ? h('div', { class: 'caro-hero-rank' }, h('span', { class: 'caro-hero-label', text: 'Hạng' }), h('strong', { text: `#${rank}` })) : null,
          window.ThinkStreaks && window.ThinkStreaks.instance ? window.ThinkStreaks.instance.badge('caro') : null),
        h('p', {
          class: 'caro-hero-stats',
          text: r && r.games
            ? `${r.games} ván xếp hạng · ${r.wins} thắng · ${r.draws} hòa · ${r.losses} thua · cao nhất ${r.peak}`
            : 'Chưa chơi ván xếp hạng nào. Mọi người bắt đầu từ 1200 điểm.',
        }),
        h('div', { class: 'caro-hero-actions' },
          h('button', { class: 'caro-action', type: 'button', onclick: startBotFromHome },
            icon('bot'), h('strong', { text: 'Chơi với máy' }), h('span', { text: botPlaying ? 'Chơi tiếp ván dở' : 'Dễ · Vừa · Khó' })),
          h('button', { class: 'caro-action is-ghost', type: 'button', onclick: () => openChallenge() },
            icon('swords'), h('strong', { text: 'Thách đấu' }), h('span', { text: 'Tính điểm với bạn bè' }))));

      const parts = [hero];
      // Quiz hôm nay + Thử thách nhanh (public/puzzles-ui.js)
      const puzzles = window.ThinkPuzzles && window.ThinkPuzzles.instance;
      if (puzzles) parts.push(puzzles.entry('caro'));
      if (botPlaying) {
        const st = C.fromMoves(bot.moves, bot.rule);
        parts.push(h('button', { class: 'caro-resume', type: 'button', onclick: () => navigate('#/caro/bot') },
          miniCrop(st.board, bot.moves[bot.moves.length - 1]),
          h('span', { class: 'caro-resume-main' },
            h('strong', { text: 'Ván dở với máy' }),
            h('span', { text: `Máy ${LEVELS[bot.level].label.toLowerCase()} · ${RULES[bot.rule].label} · ${bot.moves.length} nước · bạn cầm ${markName(bot.side)}` })),
          h('span', { class: 'caro-resume-go' }, icon('play'), 'Chơi tiếp')));
      }
      if (S.error && !S.loaded) {
        parts.push(h('div', { class: 'chess-alert' }, h('span', { text: `${S.error} Bạn vẫn chơi với máy được.` }), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => load(), text: 'Thử lại' })));
      }
      if (incoming.length) parts.push(section('Lời thách đấu gửi tới bạn', incoming.map((g) => challengeRow(g, true))));
      if (active.length) parts.push(section('Đang chơi', active.map(gameRow)));
      if (outgoing.length) parts.push(section('Đang chờ nhận lời', outgoing.map((g) => challengeRow(g, false))));
      if (!S.loaded && S.loading) parts.push(h('p', { class: 'people-empty', text: 'Đang tải…' }));

      // Bảng xếp hạng: 5 người đầu, mình ở dưới nếu ngoài top 5
      const lb = S.leaderboard;
      const rows = lb == null
        ? [h('li', { class: 'people-empty', text: S.error ? 'Chưa tải được bảng xếp hạng.' : 'Đang tải…' })]
        : lb.length === 0
          ? [h('li', { class: 'people-empty', text: 'Chưa ai chơi ván xếp hạng. Thách đấu một người để mở màn!' })]
          : lb.slice(0, 5).map((x, i) => rankRow(x, i + 1));
      if (lb && rank > 5) rows.push(rankRow(lb[rank - 1], rank));
      parts.push(section('Bảng xếp hạng', rows, lb && lb.length > 5 ? h('button', { class: 'chess-more', type: 'button', onclick: openLeaderboard, text: 'Xem tất cả' }) : null));
      if (recent.length) parts.push(section('Ván gần đây', recent.map(recentRow)));

      // Thành tích với máy (lưu trên máy này)
      const stats = botStats();
      parts.push(h('section', { class: 'chess-section' },
        h('div', { class: 'chess-section-head' }, h('h2', { text: 'Thành tích với máy' })),
        h('div', { class: 'caro-bots' }, LEVEL_ORDER.map((k) => {
          const s = stats[k];
          return h('button', {
            class: 'caro-bot-stat', type: 'button',
            'aria-label': `Máy ${LEVELS[k].label.toLowerCase()}: ${s.win} thắng, ${s.loss} thua, ${s.draw} hòa. Bấm để chơi.`,
            onclick: () => openBotSheet(k),
          },
          h('span', { class: `caro-level is-${k}`, text: LEVELS[k].label }),
          h('strong', { text: String(s.win) }),
          h('small', { text: `thắng · ${s.loss} thua${s.draw ? ` · ${s.draw} hòa` : ''}` }));
        })),
        h('p', { class: 'hint', text: 'Ván với máy chơi ngay trên máy này, không cần mạng và không tính điểm ELO.' })));
      parts.push(h('p', { class: 'chess-credit', text: 'Cờ caro 15 × 15: ai có 5 quân liền nhau trước là thắng. Máy chơi và âm thanh là của riêng Think.' }));
      home.replaceChildren(...parts);
      home.scrollTop = scroll;
    }

    // Góc 5×5 quanh nước gần nhất (hình nhỏ của ván dở)
    function miniCrop(board, center) {
      const n = 5;
      const r0 = Math.max(0, Math.min(N - n, Math.floor(center / N) - 2));
      const c0 = Math.max(0, Math.min(N - n, (center % N) - 2));
      const cells = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells.push(board[(r0 + r) * N + c0 + c]);
      return miniBoard(cells, n);
    }

    function startBotFromHome() {
      const bot = loadBot();
      if (bot && !bot.result && bot.moves.length > 0) navigate('#/caro/bot');
      else openBotSheet();
    }

    function section(title, rows, extra) {
      return h('section', { class: 'chess-section' },
        h('div', { class: 'chess-section-head' }, h('h2', { text: title }), extra || null),
        h('ul', { class: 'chess-list' }, rows));
    }
    function gameLink(id, ...children) {
      return h('a', {
        class: 'chess-row-main',
        href: gameHash(id),
        onclick: (e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          if (history.state && history.state.caroSheet) {
            closeSheet(true);
            history.replaceState({ depth: history.state.depth || 0 }, '', gameHash(id));
            navigate(gameHash(id), { replace: true });
          } else openGame(id);
        },
      }, ...children);
    }
    function challengeRow(g, incoming) {
      const otherId = incoming ? g.challengerId : g.opponentId;
      const mins = Math.max(1, Math.ceil(challengeLeft(g) / 60000));
      const actions = incoming
        ? [
            h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => answer(g.id, 'accept')), text: 'Nhận' }),
            h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => answer(g.id, 'decline')), text: 'Từ chối' }),
          ]
        : [h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => answer(g.id, 'cancel')), text: 'Hủy' })];
      return h('li', { class: 'chess-row caro-ch-row' },
        gameLink(g.id,
          avatarEl(userOf(otherId), '', {}),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name', text: incoming ? `${nameOf(otherId)} thách bạn` : `Chờ ${nameOf(otherId)}` }),
            h('span', { class: 'person-sub', text: `${turnLabel(g.turnMs)} · ${RULES[g.rule].label} · ${g.rated ? 'tính điểm' : 'giao hữu'} · ${sidePrefText(g, !incoming)} · còn ${mins} phút` }))),
        h('span', { class: 'chess-row-actions' }, actions));
    }
    function gameRow(g) {
      const mine = mySide(g);
      const oppId = oppOf(g);
      const my = isMyTurn(g);
      return h('li', { class: 'chess-row' },
        gameLink(g.id,
          avatarEl(userOf(oppId), '', {}),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name' }, nameOf(oppId), h('span', { class: 'chess-elo', text: ` ${ratingOf(oppId)}` })),
            h('span', { class: 'person-sub', text: `Bạn cầm ${markName(mine)} · ${g.moves.length} nước · ${turnLabel(g.turnMs)}` })),
          h('span', { class: `chess-pill${my ? ' is-caro-turn' : ''}`, text: my ? 'Tới lượt bạn' : 'Chờ' })));
    }
    function recentRow(g) {
      const mine = mySide(g);
      const oppId = oppOf(g);
      const o = outcomeFor(g, mine);
      const delta = g.rated ? (mine === 'x' ? g.xDelta : g.oDelta) : null;
      const label = o === 'win' ? 'Thắng' : o === 'loss' ? 'Thua' : o === 'draw' ? 'Hòa' : 'Hủy';
      return h('li', { class: 'chess-row' },
        gameLink(g.id,
          avatarEl(userOf(oppId), '', { dot: false }),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name', text: nameOf(oppId) }),
            h('span', { class: 'person-sub', text: `${reasonText(g, mine)} · ${RULES[g.rule].label} · ${shortTime(g.endedAt || g.createdAt)}` })),
          h('span', { class: `chess-outcome is-${o || 'none'}` }, h('strong', { text: label }), delta != null ? h('small', { text: signed(delta) }) : null)));
    }
    function rankRow(x, rank) {
      const me = x.userId === meId();
      return h('li', { class: `chess-row chess-rank${me ? ' is-me' : ''}` },
        h('span', { class: 'chess-row-main' },
          h('span', { class: `chess-rank-no${rank <= 3 ? ` is-top${rank}` : ''}`, text: String(rank) }),
          avatarEl(userOf(x.userId), 'avatar-sm', { dot: false }),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name', text: `${nameOf(x.userId)}${me ? ' (bạn)' : ''}` }),
            h('span', { class: 'person-sub', text: `${x.wins} thắng · ${x.draws} hòa · ${x.losses} thua` })),
          h('span', { class: 'chess-rank-rating', text: String(x.rating) })));
    }

    /* =========================================================
       Bảng trượt: thách đấu, chơi với máy, bảng xếp hạng, luật chơi
       ========================================================= */
    let layer = null;
    let hideTimer = null;
    let returnFocus = null;
    function ensureLayer() {
      if (layer) return layer;
      layer = h('div', { class: 'sheet-layer caro-layer', hidden: true },
        h('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }),
        h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }));
      layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
      layer.addEventListener('pointerdown', unlockAudio, { capture: true });
      document.body.append(layer);
      window.addEventListener('popstate', () => {
        if (layer && !layer.hidden && !(history.state && history.state.caroSheet)) closeSheet(true);
      });
      return layer;
    }
    function openSheet(title, body, foot, kind = '') {
      const l = ensureLayer();
      const sheet = l.querySelector('.sheet');
      sheet.setAttribute('aria-label', title);
      sheet.replaceChildren(
        h('header', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onclick: () => closeSheet() }, icon('close'))),
        h('div', { class: 'sheet-body' }, body),
        ...(foot ? [h('div', { class: 'sheet-foot' }, foot)] : []));
      if (l.hidden || !l.classList.contains('open')) {
        clearTimeout(hideTimer);
        returnFocus = document.activeElement;
        if (!(history.state && history.state.caroSheet)) history.pushState({ ...(history.state || {}), caroSheet: true }, '', location.hash || '#/');
        l.hidden = false;
        void l.offsetWidth;
        l.classList.add('open');
      }
      l.dataset.kind = kind;
      sheet.focus({ preventScroll: true });
      return sheet;
    }
    function closeSheet(silent) {
      if (!layer || layer.hidden) return;
      if (!silent && history.state && history.state.caroSheet) {
        history.back(); // popstate sẽ đóng bảng
        return;
      }
      layer.classList.remove('open');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!layer.classList.contains('open')) layer.hidden = true;
      }, 220);
      const back = returnFocus;
      returnFocus = null;
      if (back && back.isConnected && back.focus && !window.matchMedia('(pointer: coarse)').matches) back.focus({ preventScroll: true });
    }
    // Đóng bảng rồi sang trang khác: thay bước lịch sử của bảng bằng trang mới
    function sheetThen(hash) {
      closeSheet(true);
      if (history.state && history.state.caroSheet) {
        history.replaceState({ depth: history.state.depth || 0 }, '', hash);
        navigate(hash, { replace: true });
      } else navigate(hash);
    }

    // Nhóm lựa chọn (role=radiogroup); items: [{ key, title, sub, art, wide }]
    function choices(label, items, value, onChange, cls = '') {
      const group = h('div', { class: `caro-choices ${cls}`.trim(), role: 'radiogroup', 'aria-label': label });
      const draw = () => {
        const focused = group.contains(document.activeElement);
        group.replaceChildren(...items.map((it) => h('button', {
          class: `caro-choice${it.wide ? ' is-wide' : ''}${it.cls ? ` ${it.cls}` : ''}`,
          type: 'button',
          role: 'radio',
          'aria-checked': value.v === it.key ? 'true' : 'false',
          tabindex: value.v === it.key ? '0' : '-1',
          dataset: { key: String(it.key) },
          onclick: () => {
            value.v = it.key;
            draw();
            if (onChange) onChange(it.key);
          },
        }, it.art || null, h('strong', { text: it.title }), it.sub ? h('span', { text: it.sub }) : null, it.extra || null)));
        if (focused) group.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
      };
      // Phím mũi tên chuyển lựa chọn (như nút radio thật)
      group.addEventListener('keydown', (e) => {
        const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const k = items.findIndex((it) => it.key === value.v);
        const next = items[(k + dir + items.length) % items.length];
        value.v = next.key;
        draw();
        group.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
        if (onChange) onChange(next.key);
      });
      draw();
      return group;
    }
    const sideItems = () => [
      { key: 'random', title: 'Ngẫu nhiên', sub: 'Bốc thăm', art: h('span', { class: 'caro-choice-art' }, markSvg('x'), markSvg('o')) },
      { key: 'x', title: 'Đi trước', sub: 'Cầm X', art: h('span', { class: 'caro-choice-art' }, markSvg('x')) },
      { key: 'o', title: 'Đi sau', sub: 'Cầm O', art: h('span', { class: 'caro-choice-art' }, markSvg('o')) },
    ];
    function rulePicker(value) {
      const hint = h('p', { class: 'hint caro-rule-hint', text: RULES[value.v].about });
      const group = choices('Luật', Object.entries(RULES).map(([key, r]) => ({ key, title: r.label, sub: key === 'free' ? 'Phổ biến nhất' : 'Kiểu Việt Nam' })), value, (k) => { hint.textContent = RULES[k].about; }, 'is-2');
      return [group, hint];
    }

    function openChallenge(presetId) {
      if (!C) return;
      const pick = { id: presetId != null ? presetId : null };
      const opts = { turn: { v: 30 }, rule: { v: 'free' }, side: { v: 'random' }, rated: true };
      const people = [...state.users.values()]
        .filter((u) => u.id !== meId() && !u.disabled)
        .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName, 'vi'));
      const list = h('ul', { class: 'people-list chess-people', role: 'radiogroup', 'aria-label': 'Đối thủ' });
      const search = h('input', { class: 'search-input', type: 'search', placeholder: 'Tìm người', 'aria-label': 'Tìm người để thách đấu', autocomplete: 'off' });
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const submit = h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: pick.id == null }, 'Gửi lời thách đấu');
      const drawPeople = () => {
        const q = fold(search.value);
        const shown = presetId != null ? people.filter((u) => u.id === presetId) : people.filter((u) => !q || fold(u.displayName).includes(q) || fold(u.username).includes(q));
        list.replaceChildren(...shown.map((u) => h('li', {},
          h('button', {
            class: 'person pick',
            type: 'button',
            role: 'radio',
            'aria-checked': pick.id === u.id ? 'true' : 'false',
            'aria-pressed': pick.id === u.id ? 'true' : 'false',
            'aria-label': `${u.displayName}, ELO caro ${ratingOf(u.id)}${u.online ? ', đang hoạt động' : ''}`,
            onclick: () => {
              if (presetId != null) return;
              pick.id = u.id;
              submit.disabled = false;
              drawPeople();
            },
          },
          avatarEl(u, '', {}),
          h('span', { class: 'person-main' }, h('span', { class: 'person-name', text: u.displayName }), h('span', { class: `person-sub${u.online ? ' is-online' : ''}`, text: `ELO ${ratingOf(u.id)}${u.online ? ' · đang hoạt động' : ''}` })),
          h('span', { class: 'check' }, icon('check'))))));
        if (!shown.length) list.append(h('li', { class: 'people-empty', text: q ? 'Không tìm thấy ai.' : 'Chưa có ai khác để thách đấu.' }));
      };
      search.addEventListener('input', drawPeople);
      drawPeople();
      const turnHint = h('p', { class: 'hint' });
      const drawTurnHint = () => {
        turnHint.textContent = opts.turn.v
          ? `Mỗi nước phải đi trong ${secondsLabel(opts.turn.v)}, hết giờ là thua cả ván.`
          : 'Không tính giờ: đi lúc nào cũng được. 3 ngày không đi thì xử thua người tới lượt.';
      };
      drawTurnHint();
      const order = [15, 30, 60, 120, 0].filter((s) => S.options.turnSeconds.includes(s));
      const turnGroup = choices('Thời gian mỗi nước', order.map((s) => ({ key: s, title: secondsLabel(s), sub: TURN_SUB[s], wide: s === 0 })), opts.turn, drawTurnHint, 'is-4');
      const rated = h('input', { class: 'switch', type: 'checkbox', checked: true, 'aria-label': 'Tính điểm ELO' });
      const ratedHint = h('span', { class: 'hint', text: 'Thắng được cộng điểm, thua bị trừ điểm trên bảng xếp hạng caro.' });
      rated.addEventListener('change', () => {
        opts.rated = rated.checked;
        ratedHint.textContent = rated.checked ? 'Thắng được cộng điểm, thua bị trừ điểm trên bảng xếp hạng caro.' : 'Ván giao hữu, không ảnh hưởng điểm.';
      });
      submit.addEventListener('click', () => withBusy(submit, async () => {
        if (pick.id == null) return;
        error.hidden = true;
        try {
          const { game } = await api('/api/caro/challenges', { method: 'POST', body: { opponentId: pick.id, turnSeconds: opts.turn.v, rule: opts.rule.v, side: opts.side.v, rated: opts.rated } });
          upsert([game]);
          closeSheet();
          toast(`Đã gửi lời thách đấu tới ${nameOf(pick.id)}. Họ nhận là vào ván ngay.`);
          refresh();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }));
      openSheet('Thách đấu cờ caro', [
        h('div', { class: 'panel' }, h('h3', { text: 'Đối thủ' }), presetId == null && people.length > 6 ? search : null, list),
        h('div', { class: 'panel' }, h('h3', { text: 'Thời gian mỗi nước' }), turnGroup, turnHint),
        h('div', { class: 'panel' }, h('h3', { text: 'Luật' }), rulePicker(opts.rule)),
        h('div', { class: 'panel' }, h('h3', { text: 'Bạn đi' }), choices('Bạn đi', sideItems(), opts.side)),
        h('div', { class: 'panel' }, h('label', { class: 'switch-row' }, h('span', { class: 'chess-switch-text' }, h('strong', { text: 'Tính điểm ELO' }), ratedHint), rated)),
        error,
      ], submit, 'challenge');
    }

    function openBotSheet(levelKey) {
      if (!C) return;
      const p = botPrefs();
      const opts = { level: { v: levelKey || p.level }, side: { v: p.side }, rule: { v: p.rule } };
      const stats = botStats();
      const levelGroup = choices('Mức máy', LEVEL_ORDER.map((k) => ({
        key: k,
        cls: 'is-level',
        title: LEVELS[k].label,
        sub: LEVELS[k].about,
        extra: h('em', { text: `${stats[k].win} thắng · ${stats[k].loss} thua` }),
      })), opts.level);
      const start = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, icon('play'), 'Bắt đầu');
      start.addEventListener('click', () => {
        const cfg = { level: opts.level.v, side: opts.side.v, rule: opts.rule.v };
        if (V.key === 'bot') {
          closeSheet();
          newBotGame(cfg);
        } else {
          newBotGame(cfg, { navigateAway: false });
          sheetThen('#/caro/bot');
          play('start', 0.8);
        }
      });
      const cur = loadBot();
      openSheet('Chơi với máy', [
        h('p', { class: 'hint', text: 'Máy chơi ngay trên máy của bạn, không cần mạng. Ván với máy không tính điểm ELO.' }),
        h('div', { class: 'panel' }, h('h3', { text: 'Mức máy' }), levelGroup),
        h('div', { class: 'panel' }, h('h3', { text: 'Bạn đi' }), choices('Bạn đi', sideItems(), opts.side)),
        h('div', { class: 'panel' }, h('h3', { text: 'Luật' }), rulePicker(opts.rule)),
        cur && !cur.result && cur.moves.length >= 2 ? h('p', { class: 'hint', text: 'Bắt đầu ván mới sẽ bỏ ván đang chơi dở.' }) : null,
      ], start, 'bot');
    }

    function openLeaderboard() {
      load();
      const wrap = h('ul', { class: 'chess-list' });
      const draw = () => {
        const rows = S.leaderboard || [];
        wrap.replaceChildren(...(rows.length ? rows.map((x, i) => rankRow(x, i + 1)) : [h('li', { class: 'people-empty', text: S.leaderboard ? 'Chưa ai chơi ván xếp hạng.' : 'Đang tải…' })]));
      };
      draw();
      openSheet('Bảng xếp hạng cờ caro', [h('p', { class: 'hint', text: 'Xếp theo điểm ELO từ các ván tính điểm với bạn bè. Mọi người bắt đầu từ 1200 điểm.' }), wrap], null, 'board');
      S.drawBoard = draw;
    }

    function openRules() {
      const n = 7;
      const demo = new Array(n * n).fill(0);
      // Ví dụ luật chặn hai đầu: 5 quân X bị O chặn cả hai đầu
      for (let c = 1; c <= 5; c++) demo[3 * n + c] = 1;
      demo[3 * n] = 2;
      demo[3 * n + 6] = 2;
      demo[1 * n + 2] = 2;
      demo[5 * n + 4] = 2;
      const demoFree = new Array(n * n).fill(0);
      for (let k = 1; k <= 5; k++) demoFree[k * n + k] = 1;
      demoFree[1 * n + 3] = 2;
      demoFree[4 * n + 2] = 2;
      demoFree[2 * n + 5] = 2;
      const board = (cells, line, cap) => h('figure', { class: 'caro-rule-fig' }, miniBoard(cells, n, line, 'x'), h('figcaption', { class: 'hint', text: cap }));
      openSheet('Luật chơi cờ caro', [
        h('div', { class: 'caro-rules' },
          h('ul', {},
            h('li', { text: 'Hai người lần lượt đánh X và O vào các ô trống trên bàn 15 × 15. X luôn đi trước.' }),
            h('li', { text: 'Ai có 5 quân liền nhau theo hàng ngang, hàng dọc hoặc đường chéo trước là thắng.' }),
            h('li', { text: 'Luật chặn hai đầu: 5 quân mà bị quân đối phương chặn cả hai đầu thì không tính thắng. Mép bàn không tính là chặn.' }),
            h('li', { text: 'Ván có giới hạn giờ: mỗi nước phải đi trong thời gian đã chọn, hết giờ là thua. Chưa ai đi đủ nước đầu thì ván tự hủy, không tính điểm.' }),
            h('li', { text: 'Trên điện thoại: chạm một lần để ngắm (hiện quân mờ), chạm lần nữa vào đúng ô đó để đánh. Dùng chuột thì bấm một lần là đánh.' })),
          h('div', { class: 'caro-rule-demo' },
            board(demoFree, [n + 1, 2 * n + 2, 3 * n + 3, 4 * n + 4, 5 * n + 5], '5 quân chéo: thắng.'),
            board(demo, null, 'Bị chặn hai đầu: luật tự do thì thắng, luật chặn hai đầu thì chưa.'))),
      ], null, 'rules');
    }

    // Nút ở đầu trang Cờ caro (index.html)
    const rulesBtn = $('#caro-rules-btn');
    if (rulesBtn) rulesBtn.addEventListener('click', openRules);
    const boardBtn = $('#caro-board-btn');
    if (boardBtn) boardBtn.addEventListener('click', openLeaderboard);

    return {
      route,
      load,
      reload: () => {
        if (S.loaded || S.error) load();
        if (S.open != null) fetchGame(S.open, { quiet: true });
      },
      reset,
      onEvent,
      openChallenge,
      openLeaderboard,
      badge: todo,
      summary,
      puzzleBoard,
    };
  }

  return { create, art, markSvg, _test: { makesThreat, turnLabel, clockText } };
})();
