'use strict';
/* Cờ vua cho bản web của Think: thách đấu, đồng hồ, điểm ELO, bảng xếp hạng, chơi với máy.
   Máy chủ giữ luật và đồng hồ (src/chess.js). Trang này chỉ vẽ bàn cờ và gửi nước đi.
   app.js gọi ThinkChess.create(host) rồi chuyển cho nó đường dẫn #/chess và các sự kiện realtime. */
window.ThinkChess = (() => {
  const FILES = 'abcdefgh';
  const SVG = 'http://www.w3.org/2000/svg';
  const NAMES = { k: 'Vua', q: 'Hậu', r: 'Xe', b: 'Tượng', n: 'Mã', p: 'Tốt' };
  const TIME_CONTROLS = [
    { base: 1, inc: 0, label: '1+0', kind: 'Chớp nhoáng' },
    { base: 2, inc: 1, label: '2+1', kind: 'Chớp nhoáng' },
    { base: 3, inc: 0, label: '3+0', kind: 'Cờ chớp' },
    { base: 3, inc: 2, label: '3+2', kind: 'Cờ chớp' },
    { base: 5, inc: 0, label: '5+0', kind: 'Cờ chớp' },
    { base: 5, inc: 3, label: '5+3', kind: 'Cờ chớp' },
    { base: 10, inc: 0, label: '10+0', kind: 'Cờ nhanh' },
    { base: 15, inc: 10, label: '15+10', kind: 'Cờ nhanh' },
    { base: 30, inc: 0, label: '30+0', kind: 'Cờ chậm' },
    { base: 0, inc: 0, label: '∞', kind: 'Không giới hạn' },
  ];
  const REASONS = {
    checkmate: 'chiếu hết',
    resign: 'đầu hàng',
    timeout: 'hết giờ',
    stalemate: 'hết nước đi (hòa pat)',
    insufficient: 'không đủ quân chiếu hết',
    repetition: 'lặp lại 3 lần',
    fifty: 'luật 50 nước',
    agreement: 'hai bên đồng ý hòa',
    aborted: 'ván bị hủy',
    'no-start': 'không ai đi nước đầu',
  };
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Luật cờ (chess.js) chỉ tải khi mở một ván
  let Chess = null;
  let rulesLoading = null;
  function loadRules() {
    if (Chess) return Promise.resolve(Chess);
    if (!rulesLoading) {
      rulesLoading = import('/vendor/chess.js')
        .then((m) => (Chess = m.Chess))
        .catch((err) => {
          rulesLoading = null;
          throw err;
        });
    }
    return rulesLoading;
  }

  /* ---------------- Chữ hiển thị ---------------- */
  const pieceSrc = (code) => `/chess/pieces/${code}.svg`;
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const colorName = (c) => (c === 'w' ? 'Trắng' : 'Đen');
  const reasonText = (r) => (r ? REASONS[r] || r : '');
  function tcLabel(g) {
    if (!g.base) return 'Không giới hạn';
    return `${Math.round(g.base / 60000)}+${Math.round(g.inc / 1000)}`;
  }
  function clockText(ms) {
    const t = Math.max(0, ms);
    if (t < 10000) return `0:${(t / 1000).toFixed(1).padStart(4, '0')}`;
    const s = Math.ceil(t / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }
  const signed = (n) => (n >= 0 ? `+${n}` : String(n));
  function outcomeFor(g, color) {
    if (g.status === 'aborted') return 'aborted';
    if (!g.result) return null;
    if (g.result === '1/2-1/2') return 'draw';
    if (!color) return null;
    return (g.result === '1-0') === (color === 'w') ? 'win' : 'loss';
  }
  function resultTitle(g, color) {
    const o = outcomeFor(g, color);
    if (o === 'aborted') return 'Ván cờ đã bị hủy';
    if (o === 'draw') return 'Hòa';
    if (o === 'win') return 'Bạn thắng!';
    if (o === 'loss') return 'Bạn thua';
    return g.result === '1-0' ? 'Trắng thắng' : g.result === '0-1' ? 'Đen thắng' : '';
  }
  // Đọc thế cờ từ FEN: mảng 8 hàng (hàng 8 trước), mỗi ô là mã quân như "wK" hoặc null
  function parseFen(fen) {
    const rows = [];
    for (const part of String(fen || START_FEN).split(' ')[0].split('/')) {
      const row = [];
      for (const ch of part) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) row.push(null);
        else row.push(`${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toUpperCase()}`);
      }
      rows.push(row);
    }
    return rows;
  }
  function material(fen) {
    const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const ch of String(fen).split(' ')[0]) {
      const lower = ch.toLowerCase();
      if (!(lower in START)) continue;
      count[ch === lower ? 'b' : 'w'][lower]++;
    }
    const captured = { w: [], b: [] };
    let score = 0;
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      for (let i = count.b[t]; i < START[t]; i++) captured.w.push(`b${t.toUpperCase()}`);
      for (let i = count.w[t]; i < START[t]; i++) captured.b.push(`w${t.toUpperCase()}`);
      score += (count.w[t] - count.b[t]) * VALUE[t];
    }
    return { captured, lead: { w: Math.max(0, score), b: Math.max(0, -score) } };
  }
  // Xếp loại nước đi khi phân tích (ký hiệu quốc tế ?! ? ??)
  const MOVE_CLASS = {
    best: { symbol: '★', label: 'Nước tốt nhất', color: '#1E9E7C' },
    good: { symbol: '', label: 'Nước tốt', color: '' },
    inaccuracy: { symbol: '?!', label: 'Thiếu chính xác', color: '#D99A0B' },
    mistake: { symbol: '?', label: 'Sai lầm', color: '#E07B24' },
    blunder: { symbol: '??', label: 'Sai lầm nghiêm trọng', color: '#D1402F' },
  };
  function evalText(p) {
    if (!p) return '';
    if (p.end === 'checkmate') return p.wp >= 50 ? '1-0' : '0-1';
    if (p.end === 'draw') return '½-½';
    if (p.mate != null) return `#${p.mate > 0 ? '' : '-'}${Math.abs(p.mate)}`;
    const v = (p.cp || 0) / 100;
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
  }
  function moveComment(m, before) {
    if (!m) return '';
    const info = MOVE_CLASS[m.cls] || MOVE_CLASS.good;
    const no = `${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '…'} ${m.san}${info.symbol && m.cls !== 'best' ? info.symbol : ''}`;
    if (m.cls === 'best') return `${no}: nước tốt nhất.`;
    if (m.cls === 'good') return `${no}: nước tốt.${before && before.bestSan ? ` Máy thích ${before.bestSan} hơn một chút.` : ''}`;
    return `${no}: ${info.label.toLowerCase()}.${before && before.bestSan ? ` Nước tốt nhất là ${before.bestSan}.` : ''}`;
  }
  // Tiếng quân cờ (tự tổng hợp bằng scripts/chess-sounds.py)
  function soundForSan(san) {
    if (!san) return 'move';
    if (/[+#]/.test(san)) return 'check';
    if (san.includes('x')) return 'capture';
    if (san.startsWith('O-O')) return 'castle';
    return 'move';
  }

  function botTint(elo) {
    if (elo < 900) return '#5DA271';
    if (elo < 1500) return '#3E8FB0';
    if (elo < 2000) return '#8A5CC2';
    if (elo < 2600) return '#C7612B';
    return '#B3372A';
  }

  /* =========================================================
     Bộ điều khiển (một cho mỗi lần mở trang)
     ========================================================= */
  function create(host) {
    const { api, h, icon, avatarEl, userOf, nameOf, state, toast, pushToast, navigate, goBack, withBusy, shortTime, fold } = host;
    const $ = (sel, root = document) => root.querySelector(sel);

    const S = {
      loaded: false,
      loading: null,
      error: null,
      rating: null,
      bots: [],
      games: new Map(),
      receivedAt: new Map(),
      leaderboard: null,
      openId: null,
      sending: new Set(),
      tab: false, // đang ở tab Cờ vua
    };
    S.analyses = new Map(); // id ván -> { status, progress, total, result }
    S.history = { ids: [], hasMore: false, loading: false, loaded: false };
    // Trạng thái xem ván đang mở (lastPly/lastStatus: để phát tiếng đúng lúc)
    const V = { ply: null, flip: false, selected: null, promo: null, rulesError: false, playing: false, playTimer: null, lastId: null, lastPly: null, lastStatus: null };

    /* ---------------- Tùy chọn bàn cờ (lưu trên máy này) ---------------- */
    const PREF_KEY = 'chess-prefs';
    const DEFAULT_PREFS = { hints: true, lastMove: true, coords: true, arrows: true, sound: true };
    const P = { ...DEFAULT_PREFS };
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      for (const k of Object.keys(DEFAULT_PREFS)) if (typeof saved[k] === 'boolean') P[k] = saved[k];
    } catch { /* dùng mặc định */ }
    function setPref(key, value) {
      P[key] = value;
      try { localStorage.setItem(PREF_KEY, JSON.stringify(P)); } catch { /* chế độ ẩn danh */ }
      if (S.openId != null) renderGame();
    }

    /* ---------------- Âm thanh ---------------- */
    const sounds = new Map();
    function playSound(name) {
      if (!P.sound) return;
      try {
        let a = sounds.get(name);
        if (!a) {
          a = new Audio(`/chess/sounds/${name}.wav`);
          a.preload = 'auto';
          sounds.set(name, a);
        } else if (!a.paused) {
          a = a.cloneNode(); // tiếng trước chưa hết thì phát chồng lên
        }
        a.currentTime = 0;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      } catch { /* trình duyệt chặn âm thanh */ }
    }
    const meId = () => (state.me ? state.me.id : 0);
    const myColor = (g) => (g.whiteId === meId() ? 'w' : g.blackId === meId() ? 'b' : null);
    const isBotSide = (g, color) => g.bot != null && g.botColor === color;
    const sideName = (g, color) => (isBotSide(g, color) ? g.bot.name : nameOf(color === 'w' ? g.whiteId : g.blackId));

    /* ---------------- Dữ liệu ---------------- */
    // Thứ tự trạng thái của một ván: lời thách đấu → đang chơi → đã xong. Không bao giờ lùi lại.
    const STAGE = { challenge: 0, active: 1 };
    const stageOf = (g) => STAGE[g.status] ?? 2;
    function upsert(list) {
      const now = Date.now();
      for (const g of list) {
        const prev = S.games.get(g.id);
        if (prev) {
          // Bản cũ đến trễ (vd phản hồi của lần tải đang dở, sự kiện đến không theo thứ tự): bỏ qua
          if (stageOf(g) < stageOf(prev)) continue;
          if (g.status === 'active' && prev.status === 'active' && prev.moves.length > g.moves.length) continue;
        }
        S.games.set(g.id, g);
        S.receivedAt.set(g.id, now);
      }
    }

    let loadAgain = false;
    async function load() {
      if (S.loading) {
        loadAgain = true; // có thay đổi trong lúc đang tải: tải thêm một lần nữa cho chắc
        return S.loading;
      }
      S.loading = (async () => {
        try {
          const data = await api('/api/chess');
          // Giữ các ván không có trong danh sách trả về chỉ khi đang mở (vd ván cũ xem từ thông báo)
          const fresh = new Set([...data.challenges, ...data.active, ...data.recent].map((g) => g.id));
          const keep = new Set(S.history.ids);
          for (const id of [...S.games.keys()]) if (!fresh.has(id) && id !== S.openId && !keep.has(id)) S.games.delete(id);
          S.rating = data.rating;
          S.bots = data.bots || [];
          upsert([...data.challenges, ...data.active, ...data.recent]);
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

    async function loadLeaderboard() {
      try {
        const data = await api('/api/chess/leaderboard');
        S.leaderboard = data.players;
        S.rating = data.me;
        refresh();
      } catch (err) {
        if (S.tab) toast(err.message);
      }
    }

    function reset() {
      stopTicker();
      closeSheet(true);
      S.loaded = false;
      S.loading = null;
      S.error = null;
      S.rating = null;
      S.bots = [];
      S.games.clear();
      S.receivedAt.clear();
      S.leaderboard = null;
      S.openId = null;
      S.sending.clear();
      S.tab = false;
      S.analyses.clear();
      S.history = { ids: [], hasMore: false, loading: false, loaded: false };
      stopPlaying();
      const pane = $('#chess-pane');
      if (pane) {
        pane.hidden = true;
        pane.replaceChildren();
      }
      const home = $('#chess-home');
      if (home) home.replaceChildren();
      updateBadge();
    }

    // Vẽ lại phần đang hiện
    function refresh() {
      updateBadge();
      if (S.tab) renderHome();
      if (S.openId != null) renderGame();
    }

    function todo() {
      let n = 0;
      for (const g of S.games.values()) {
        if (g.status === 'challenge' && g.opponentId === meId()) n++;
        else if (g.status === 'active' && myColor(g) === g.turn) n++;
      }
      return n;
    }
    function updateBadge() {
      const badge = $('#chess-badge');
      if (!badge) return;
      const n = todo();
      badge.hidden = !n;
      badge.textContent = n > 99 ? '99+' : String(n);
      const tab = $('.tab[data-tab="chess"]');
      if (tab) tab.setAttribute('aria-label', n ? `Cờ vua, ${n} việc cần làm` : 'Cờ vua');
    }

    /* ---------------- Điều hướng ---------------- */
    // app.js gọi mỗi khi đổi đường dẫn: onTab = đang ở tab Cờ vua, gameId = ván đang mở (#/chess/g/12)
    function route(onTab, gameId) {
      const wasTab = S.tab;
      S.tab = onTab;
      if (onTab && !wasTab) {
        load();
        loadLeaderboard();
        renderHome();
      }
      const pane = $('#chess-pane');
      if (gameId != null) {
        const justOpened = S.openId !== gameId;
        if (justOpened) {
          S.openId = gameId;
          V.ply = null;
          V.flip = false;
          V.selected = null;
          V.promo = null;
          V.lastId = null;
          stopPlaying();
          hideToastsFor(gameId);
          const g0 = S.games.get(gameId);
          if (g0 && g0.status === 'active' && g0.moves.length === 0) playSound('start');
        }
        document.body.classList.add('in-chat');
        $('#chat-empty').hidden = true;
        $('#chat-pane').hidden = true;
        pane.hidden = false;
        renderGame();
        // Ván của người khác (được chia sẻ): luôn lấy bản mới, và tự cập nhật khi ván còn đang chơi
        const cached = S.games.get(gameId);
        if (!cached || (justOpened && !myColor(cached))) fetchGame(gameId);
        if (justOpened) watchGame(gameId);
        loadRules().then(
          () => S.openId === gameId && renderGame(),
          () => {
            V.rulesError = true;
            renderGame();
          }
        );
        return;
      }
      if (S.openId != null || !pane.hidden) {
        S.openId = null;
        watchGame(null);
        stopTicker();
        stopPlaying();
        pane.hidden = true;
        pane.replaceChildren();
        if (state.currentId == null) {
          document.body.classList.remove('in-chat');
          $('#chat-empty').hidden = false;
        }
      }
      if (onTab) renderEmptyPane();
    }

    // Máy tính: cột phải khi chưa mở ván nào
    function renderEmptyPane() {
      const pane = $('#chess-pane');
      if (!pane || state.currentId != null) return;
      if (!window.matchMedia('(min-width: 860px)').matches) return;
      $('#chat-empty').hidden = true;
      pane.hidden = false;
      pane.replaceChildren(
        h('div', { class: 'chess-empty' },
          boardPreview(),
          h('p', { text: 'Chọn một ván đang chơi, nhận lời thách đấu, hoặc thách một người bạn một ván cờ.' }))
      );
    }
    function boardPreview() {
      const el = h('div', { class: 'chess-board is-preview', 'aria-hidden': 'true' });
      const rows = parseFen(START_FEN);
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const code = rows[r][f];
          el.append(h('span', { class: `sq ${(r + f) % 2 ? 'is-dark' : 'is-light'}` }, code ? h('img', { class: 'pc', src: pieceSrc(code), alt: '', draggable: 'false' }) : null));
        }
      }
      return el;
    }

    async function fetchGame(id, { quiet = false } = {}) {
      try {
        const { game } = await api(`/api/chess/games/${id}`);
        upsert([game]);
        refresh();
      } catch (err) {
        if (quiet) return;
        toast(err.message);
        if (S.openId === id) navigate('#/chess', { replace: true });
      }
    }

    // Người xem không nhận sự kiện realtime của ván (chỉ hai người chơi nhận): hỏi lại máy chủ mỗi 3 giây
    let watchTimer = null;
    function watchGame(id) {
      clearInterval(watchTimer);
      watchTimer = null;
      if (id == null) return;
      watchTimer = setInterval(() => {
        const g = S.games.get(id);
        if (S.openId !== id || (g && (g.status !== 'active' || myColor(g)))) {
          clearInterval(watchTimer);
          watchTimer = null;
          return;
        }
        if (g && !document.hidden) fetchGame(id, { quiet: true });
      }, 3000);
    }

    const openGameHash = (id) => `#/chess/g/${id}`;
    function openGame(id) {
      navigate(openGameHash(id), { replace: /^#\/chess\/g\//.test(location.hash) });
    }
    // Liên kết mở ván: vẫn là thẻ <a> (mở tab mới được), bấm thường thì đi qua navigate
    function gameLink(id, ...children) {
      const onOpen = typeof children[0] === 'function' ? children.shift() : null;
      return h('a', {
        class: 'chess-row-main',
        href: openGameHash(id),
        onclick: (e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          if (onOpen) onOpen();
          // Bảng lịch sử vừa đóng: thay bước lịch sử của bảng bằng ván cờ
          if (history.state && history.state.chessSheet) {
            history.replaceState({ depth: history.state.depth || 0 }, '', openGameHash(id));
            navigate(openGameHash(id), { replace: true });
          } else openGame(id);
        },
      }, ...children);
    }
    // Nút Quay lại trong ván: về bước trước trong app, mở thẳng từ đường dẫn thì về danh sách cờ
    function backFromGame() {
      if (history.state && history.state.depth > 0) goBack();
      else navigate('#/chess', { replace: true });
    }

    /* ---------------- Thông báo nhỏ ---------------- */
    function chessToast(text, { title, userId, gameId } = {}) {
      const el = h('button', {
        class: 'toast toast-msg',
        type: 'button',
        dataset: { chessGame: String(gameId || 0) },
        onclick: () => {
          el.remove();
          navigate(gameId ? openGameHash(gameId) : '#/chess', { replace: state.currentId != null });
        },
      },
      userId != null ? avatarEl(userOf(userId), 'avatar-sm', { dot: false }) : h('span', { class: 'chess-toast-ic' }, icon('knight')),
      h('span', { class: 'toast-text' }, title ? h('strong', { text: title }) : null, h('span', { text })));
      pushToast(el, 5000);
    }
    function hideToastsFor(id) {
      for (const el of document.querySelectorAll(`#toasts [data-chess-game="${id}"]`)) el.remove();
    }

    /* ---------------- Sự kiện realtime ---------------- */
    // Đọc to cho người dùng trình đọc màn hình (vùng cố định, không bị vẽ lại)
    let live = null;
    function announce(text) {
      if (!live) {
        live = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
        document.body.append(live);
      }
      live.textContent = '';
      setTimeout(() => { live.textContent = text; }, 50);
    }

    function onEvent(name, data) {
      const g = data && data.game;
      if (!g || !state.me) return;
      const me = meId();
      const prev = S.games.get(g.id);
      upsert([g]);
      if (S.openId === g.id && prev && myColor(g) && g.moves.length > prev.moves.length && g.turn === myColor(g) && g.status === 'active') {
        const san = replay(g.moves).san[g.moves.length - 1] || g.moves[g.moves.length - 1];
        announce(`${sideName(g, other(myColor(g)))} đi ${san}. Đến lượt bạn.`);
      }
      if (S.openId === g.id && prev && prev.status === 'active' && g.status !== 'active') {
        announce(`${resultTitle(g, myColor(g))}. ${reasonText(g.reason)}.`);
      }
      const open = S.openId === g.id && document.visibilityState === 'visible';
      const visible = document.visibilityState === 'visible';

      if (name === 'chess:challenge') {
        if (g.status === 'challenge' && g.opponentId === me && !prev && visible) {
          chessToast(`${nameOf(g.challengerId)} thách bạn một ván ${tcLabel(g)}${g.rated ? ' (tính điểm)' : ''}. Bấm để xem.`, {
            title: '♟ Thách đấu cờ vua',
            userId: g.challengerId,
            gameId: g.id,
          });
        } else if (g.status === 'declined' && g.challengerId === me && prev && prev.status === 'challenge') {
          toast(`${nameOf(g.opponentId)} đã từ chối lời thách đấu.`);
        }
        refresh();
        return;
      }
      if (g.status === 'active' && prev && prev.status === 'challenge' && g.challengerId === me) {
        // Lời thách đấu mình gửi vừa được nhận
        if (S.tab && S.openId == null && state.currentId == null) openGame(g.id);
        else chessToast(`${nameOf(g.opponentId)} đã nhận lời. Bấm để vào chơi!`, { title: '♟ Vào ván thôi', userId: g.opponentId, gameId: g.id });
      }
      if ((g.status === 'finished' || g.status === 'aborted') && prev && prev.status === 'active') {
        load();
        if (S.leaderboard) loadLeaderboard();
        if (!open && myColor(g) && visible) chessToast('Một ván cờ của bạn vừa kết thúc. Bấm để xem.', { gameId: g.id });
      }
      if (g.status === 'active' && prev && prev.moves.length < g.moves.length && !open && myColor(g) === g.turn && !g.bot && visible) {
        const oppColor = other(myColor(g));
        chessToast(`${sideName(g, oppColor)} vừa đi. Đến lượt bạn!`, { title: '♟ Cờ vua', userId: oppColor === 'w' ? g.whiteId : g.blackId, gameId: g.id });
      }
      refresh();
    }

    /* ---------------- Phân tích ván (Stockfish trên máy chủ) ---------------- */
    function setAnalysis(id, a) {
      const prev = S.analyses.get(id);
      if (prev && prev.status === 'done' && a.status !== 'done' && a.status !== 'error') return;
      S.analyses.set(id, a);
      if (S.openId !== id) return;
      // Đang chạy: chỉ cập nhật thanh tiến độ tại chỗ
      const panel = document.querySelector('#chess-pane .chess-analysis.is-running');
      if (panel && (a.status === 'running' || a.status === 'queued')) {
        const pct = a.total ? Math.round((a.progress / a.total) * 100) : 0;
        panel.querySelector('.chess-an-pct').textContent = `${pct}%`;
        const bar = panel.querySelector('.chess-progress');
        bar.setAttribute('aria-valuenow', String(pct));
        bar.firstElementChild.style.width = `${Math.max(3, pct)}%`;
        panel.querySelector('.hint').textContent = runningText(a);
        return;
      }
      renderGame();
    }
    const runningText = (a) => (a.status === 'queued' && a.position > 1
      ? `Đang chờ tới lượt (thứ ${a.position}). Bạn cứ làm việc khác, xong sẽ có thông báo.`
      : `Stockfish đang chấm thế cờ ${a.progress}/${a.total}. Bạn cứ làm việc khác, xong sẽ có thông báo.`);
    async function loadAnalysis(id) {
      try {
        const { analysis } = await api(`/api/chess/games/${id}/analysis`);
        setAnalysis(id, analysis);
      } catch {
        // Không tải được (mất mạng…): hiện nút để bấm phân tích / thử lại
        const cur = S.analyses.get(id);
        if (!cur || cur.status === 'loading') setAnalysis(id, { status: 'none', progress: 0, total: 0 });
      }
    }
    async function requestAnalysis(id) {
      try {
        const { analysis } = await api(`/api/chess/games/${id}/analysis`, { method: 'POST', body: {} });
        setAnalysis(id, analysis);
      } catch (err) {
        toast(err.message);
      }
    }
    function onAnalysis(data) {
      if (!data || !data.analysis) return;
      const id = Number(data.gameId);
      const before = S.analyses.get(id);
      setAnalysis(id, data.analysis);
      if (data.analysis.status === 'done' && before && before.status !== 'done' && S.openId !== id && document.visibilityState === 'visible') {
        chessToast('Đã phân tích xong ván cờ. Bấm để xem.', { title: '♟ Phân tích ván đấu', gameId: id });
      }
    }

    /* ---------------- Lịch sử ván đã xong ---------------- */
    async function loadHistory(more = false) {
      const hs = S.history;
      if (hs.loading || (more && !hs.hasMore)) return;
      hs.loading = true;
      drawHistory();
      try {
        const last = more ? S.games.get(hs.ids[hs.ids.length - 1]) : null;
        const data = await api(`/api/chess/history?limit=30${last && last.endedAt ? `&before=${last.endedAt}&beforeId=${last.id}` : ''}`);
        upsert(data.games);
        const ids = data.games.map((g) => g.id);
        hs.ids = more ? [...hs.ids, ...ids.filter((id) => !hs.ids.includes(id))] : ids;
        hs.hasMore = data.hasMore;
        hs.loaded = true;
      } catch (err) {
        toast(err.message);
      } finally {
        hs.loading = false;
        drawHistory();
      }
    }
    let drawHistory = () => {};

    /* ---------------- Tự chạy lại ván ---------------- */
    function stopPlaying() {
      V.playing = false;
      clearTimeout(V.playTimer);
      V.playTimer = null;
    }
    function stepPlaying() {
      clearTimeout(V.playTimer);
      const g = S.games.get(S.openId);
      if (!V.playing || !g) return;
      const total = g.moves.length;
      const ply = V.ply == null ? total : V.ply;
      if (ply >= total) {
        stopPlaying();
        renderGame();
        return;
      }
      V.playTimer = setTimeout(() => {
        if (!V.playing) return;
        V.ply = ply + 1 >= total ? null : ply + 1;
        V.selected = null;
        renderGame();
        stepPlaying();
      }, 1000);
    }
    function togglePlaying() {
      const g = S.games.get(S.openId);
      if (!g) return;
      if (V.playing) {
        stopPlaying();
        renderGame();
        return;
      }
      if (V.ply == null || V.ply >= g.moves.length) V.ply = 0;
      V.playing = true;
      renderGame();
      stepPlaying();
    }
    // Phím mũi tên để xem lại từng nước (khi đang mở ván, không gõ chữ)
    document.addEventListener('keydown', (e) => {
      if (S.openId == null || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (layer && layer.classList.contains('open')) return; // đang mở bảng chọn
      const g = S.games.get(S.openId);
      if (!g || g.status === 'challenge') return;
      const total = g.moves.length;
      const ply = V.ply == null ? total : V.ply;
      let next;
      if (e.key === 'ArrowLeft') next = Math.max(0, ply - 1);
      else if (e.key === 'ArrowRight') next = ply + 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = total;
      else return;
      e.preventDefault();
      setPly(next >= total ? null : next);
    });

    /* ---------------- Gửi yêu cầu ---------------- */
    async function act(url, body) {
      try {
        const { game } = await api(url, { method: 'POST', body: body || {} });
        upsert([game]);
        refresh();
        return game;
      } catch (err) {
        if (err.data && err.data.game) upsert([err.data.game]);
        toast(err.message);
        refresh();
        return null;
      }
    }
    async function answer(id, action) {
      const game = await act(`/api/chess/challenges/${id}/${action}`);
      if (game && action === 'accept' && game.status === 'active') openGame(game.id);
      else if (!game) load();
      return game;
    }

    async function playMove(uci) {
      const g = S.games.get(S.openId);
      if (!g || g.status !== 'active' || S.sending.has(g.id) || !Chess) return;
      const chess = new Chess(g.fen);
      let fen;
      try {
        chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
        fen = chess.fen();
      } catch {
        return;
      }
      const ply = g.moves.length;
      const now = Date.now();
      let clocks = g.clocks;
      if (clocks && ply >= 2) {
        const used = now - (S.receivedAt.get(g.id) || now);
        clocks = { ...clocks, [g.turn]: Math.max(0, clocks[g.turn] - used) + g.inc };
      }
      S.games.set(g.id, {
        ...g,
        moves: [...g.moves, uci],
        fen,
        clocks,
        turn: other(g.turn),
        drawOffer: g.drawOffer && g.drawOffer !== g.turn ? null : g.drawOffer,
      });
      S.receivedAt.set(g.id, now);
      S.sending.add(g.id);
      V.selected = null;
      refresh();
      try {
        const res = await api(`/api/chess/games/${g.id}/move`, { method: 'POST', body: { move: uci, ply } });
        upsert([res.game]);
      } catch (err) {
        // Trả bàn cờ về như trước, rồi lấy bản của máy chủ
        S.games.set(g.id, g);
        if (err.data && err.data.game) upsert([err.data.game]);
        else fetchGame(g.id);
        toast(err.message);
      } finally {
        S.sending.delete(g.id);
        refresh();
      }
    }

    /* =========================================================
       Tab Cờ vua (cột trái)
       ========================================================= */
    function renderHome() {
      const home = $('#chess-home');
      if (!home || !state.me) return;
      const list = [...S.games.values()];
      const me = meId();
      const incoming = list.filter((g) => g.status === 'challenge' && g.opponentId === me).sort((a, b) => b.createdAt - a.createdAt);
      const outgoing = list.filter((g) => g.status === 'challenge' && g.challengerId === me).sort((a, b) => b.createdAt - a.createdAt);
      const active = list
        .filter((g) => g.status === 'active' && myColor(g))
        .sort((a, b) => Number(myColor(b) === b.turn) - Number(myColor(a) === a.turn) || b.id - a.id);
      const recent = list
        .filter((g) => (g.status === 'finished' || g.status === 'aborted') && myColor(g))
        .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
        .slice(0, 20);
      const rank = S.leaderboard ? S.leaderboard.findIndex((r) => r.userId === me) + 1 : 0;
      const r = S.rating;
      const scroll = home.scrollTop;

      const hero = h('div', { class: 'chess-hero' },
        h('div', { class: 'chess-hero-top' },
          h('span', { class: 'chess-medal' }, icon('trophy')),
          h('div', { class: 'chess-hero-main' },
            h('span', { class: 'chess-hero-label', text: 'Điểm ELO của bạn' }),
            h('span', { class: 'chess-hero-rating' }, r ? String(r.rating) : '—', r && r.provisional ? h('small', { text: ' ?' }) : null)),
          rank ? h('div', { class: 'chess-hero-rank' }, h('span', { class: 'chess-hero-label', text: 'Hạng' }), h('strong', { text: `#${rank}` })) : null),
        h('p', {
          class: 'chess-hero-stats',
          text: r && r.games
            ? `${r.games} ván xếp hạng · ${r.wins} thắng · ${r.draws} hòa · ${r.losses} thua · cao nhất ${r.peak}`
            : 'Chưa chơi ván xếp hạng nào. Mọi người bắt đầu từ 1200 điểm.',
        }),
        r && r.provisional && r.games ? h('p', { class: 'chess-hero-hint', text: 'Dấu ? : điểm tạm tính, sau 10 ván sẽ ổn định hơn.' }) : null,
        h('div', { class: 'chess-hero-actions' },
          h('button', { class: 'btn chess-btn-light', type: 'button', onclick: () => openChallenge() }, icon('swords'), 'Thách đấu'),
          h('button', { class: 'btn chess-btn-ghost', type: 'button', onclick: () => openBots() }, icon('bot'), 'Chơi với máy')));

      const parts = [hero];
      if (S.error && !S.loaded) {
        parts.push(h('div', { class: 'chess-alert' }, h('span', { text: S.error }), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => load(), text: 'Thử lại' })));
      }
      if (incoming.length) parts.push(section('Lời thách đấu gửi tới bạn', incoming.map((g) => challengeRow(g, true))));
      if (active.length) parts.push(section('Đang chơi', active.map(gameRow)));
      if (outgoing.length) parts.push(section('Đang chờ nhận lời', outgoing.map((g) => challengeRow(g, false))));
      if (!S.loaded && S.loading) parts.push(h('p', { class: 'people-empty', text: 'Đang tải…' }));
      parts.push(section('Bảng xếp hạng',
        S.leaderboard == null
          ? [h('li', { class: 'people-empty', text: 'Đang tải…' })]
          : S.leaderboard.length === 0
            ? [h('li', { class: 'people-empty', text: 'Chưa ai chơi ván xếp hạng. Thách đấu một người để mở màn!' })]
            : S.leaderboard.slice(0, 5).map((x, i) => rankRow(x, i + 1)),
        S.leaderboard && S.leaderboard.length > 5 ? h('button', { class: 'chess-more', type: 'button', onclick: openLeaderboard, text: 'Xem tất cả' }) : null));
      if (recent.length) {
        parts.push(section('Ván gần đây', recent.map((g) => recentRow(g)),
          h('button', { class: 'chess-more', type: 'button', onclick: openHistory, text: 'Lịch sử' })));
      }
      parts.push(h('p', {
        class: 'chess-credit',
        text: 'Luật cờ: chess.js (BSD-2). Máy cờ: js-chess-engine (MIT), GarboChess-JS (BSD), Stockfish 11 (GPL-3.0). Quân cờ: bộ cburnett của Colin M.L. Burnett (GPLv2+).',
      }));
      home.replaceChildren(...parts);
      home.scrollTop = scroll;
    }

    function section(title, rows, extra) {
      return h('section', { class: 'chess-section' },
        h('div', { class: 'chess-section-head' }, h('h2', { text: title }), extra || null),
        h('ul', { class: 'chess-list' }, rows));
    }

    function sideAvatar(g, color, cls = '') {
      if (isBotSide(g, color)) return botAvatar(g.bot, cls);
      return avatarEl(userOf(color === 'w' ? g.whiteId : g.blackId), cls, { dot: false });
    }
    function botAvatar(bot, cls = '') {
      const el = h('span', { class: `avatar is-bot ${cls}`.trim() }, icon('bot'));
      el.style.setProperty('--av', botTint(bot.elo));
      return el;
    }

    function colorPrefText(g, forChallenger) {
      if (g.colorPref === 'random') return 'màu ngẫu nhiên';
      return (g.colorPref === 'white') === forChallenger ? 'bạn cầm Trắng' : 'bạn cầm Đen';
    }

    function challengeRow(g, incoming) {
      const otherId = incoming ? g.challengerId : g.opponentId;
      const left = g.expiresAt ? Math.max(0, g.expiresAt - g.serverNow - (Date.now() - (S.receivedAt.get(g.id) || Date.now()))) : 0;
      const mins = Math.max(1, Math.ceil(left / 60000));
      const actions = incoming
        ? [
            h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => answer(g.id, 'accept')), text: 'Nhận' }),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Từ chối', onclick: (e) => withBusy(e.currentTarget, () => answer(g.id, 'decline')) }, icon('close')),
          ]
        : [h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => answer(g.id, 'cancel')), text: 'Hủy' })];
      return h('li', { class: 'chess-row' },
        gameLink(g.id,
          avatarEl(userOf(otherId), '', {}),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name', text: incoming ? `${nameOf(otherId)} thách bạn` : `Chờ ${nameOf(otherId)}` }),
            h('span', { class: 'person-sub', text: `${tcLabel(g)} · ${g.rated ? 'tính điểm' : 'giao hữu'} · ${colorPrefText(g, !incoming)} · còn ${mins} phút` }))),
        h('span', { class: 'chess-row-actions' }, actions));
    }

    function gameRow(g) {
      const mine = myColor(g);
      const opp = other(mine);
      const myTurn = g.turn === mine;
      const rating = g.live && g.live[opp];
      return h('li', { class: 'chess-row' },
        gameLink(g.id,
          sideAvatar(g, opp),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name' }, sideName(g, opp), rating != null ? h('span', { class: 'chess-elo', text: ` ${isBotSide(g, opp) ? '~' : ''}${rating}` }) : null),
            h('span', { class: 'person-sub', text: `${tcLabel(g)} · ${g.bot ? 'với máy' : g.rated ? 'tính điểm' : 'giao hữu'} · bạn cầm ${colorName(mine)} · ${g.moves.length} nước` })),
          h('span', { class: `chess-pill${myTurn ? ' is-turn' : ''}`, text: myTurn ? 'Lượt bạn' : 'Chờ' })));
    }

    function recentRow(g, onOpen) {
      const mine = myColor(g);
      const opp = other(mine);
      const o = outcomeFor(g, mine);
      const delta = g.deltas[mine];
      const label = o === 'win' ? 'Thắng' : o === 'loss' ? 'Thua' : o === 'draw' ? 'Hòa' : 'Hủy';
      return h('li', { class: 'chess-row' },
        gameLink(g.id, onOpen,
          sideAvatar(g, opp),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name', text: sideName(g, opp) }),
            h('span', { class: 'person-sub', text: `${reasonText(g.reason)} · ${tcLabel(g)} · ${shortTime(g.endedAt || g.createdAt)}` })),
          h('span', { class: `chess-outcome is-${o || 'none'}` }, h('strong', { text: label }), delta != null ? h('small', { text: signed(delta) }) : null)));
    }

    function rankRow(r, rank) {
      const me = r.userId === meId();
      return h('li', { class: `chess-row chess-rank${me ? ' is-me' : ''}` },
        h('span', { class: 'chess-row-main' },
          h('span', { class: `chess-rank-no${rank <= 3 ? ` is-top${rank}` : ''}`, text: String(rank) }),
          avatarEl(userOf(r.userId), 'avatar-sm', { dot: false }),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name', text: `${nameOf(r.userId)}${me ? ' (bạn)' : ''}` }),
            h('span', { class: 'person-sub', text: `${r.wins} thắng · ${r.draws} hòa · ${r.losses} thua` })),
          h('span', { class: 'chess-rank-rating' }, String(r.rating), r.provisional ? h('small', { text: '?' }) : null)));
    }

    /* =========================================================
       Ván cờ (cột phải / toàn màn hình trên điện thoại)
       ========================================================= */
    let ticker = null;
    function stopTicker() {
      clearInterval(ticker);
      ticker = null;
    }

    function renderGame() {
      const pane = $('#chess-pane');
      const id = S.openId;
      if (!pane || id == null) return;
      const g = S.games.get(id);
      const back = h('button', { class: 'icon-btn back-btn chess-back', type: 'button', 'aria-label': 'Quay lại', onclick: backFromGame }, icon('back'));
      if (!g || (!Chess && !V.rulesError && (g.status === 'active' || g.status === 'finished' || g.status === 'aborted'))) {
        pane.replaceChildren(h('header', { class: 'chat-head' }, back, h('div', { class: 'chat-title' }, h('h2', { text: 'Cờ vua' }))), h('div', { class: 'chess-loading' }, h('span', { class: 'spinner' }), 'Đang tải…'));
        return;
      }
      if (g.status !== 'active' && g.status !== 'finished' && g.status !== 'aborted') {
        stopTicker();
        renderChallenge(pane, g, back);
        return;
      }
      const focusSq = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.sq : null;
      // Nút đang được chọn bằng bàn phím: vẽ lại xong thì chọn lại nút tương ứng
      const focusKey = document.activeElement && document.activeElement.closest && document.activeElement.closest('#chess-pane')
        ? document.activeElement.dataset.focus || null
        : null;
      const mine = myColor(g);
      const bottom = V.flip ? other(mine || 'w') : mine || 'w';
      const top = other(bottom);
      const active = g.status === 'active';
      const { san, fens } = replay(g.moves);
      const total = g.moves.length;
      const ply = V.ply == null ? total : Math.min(V.ply, total);
      const live = ply === total;
      const fen = live ? g.fen : fens[ply] || g.fen;
      const lastMove = ply > 0 ? g.moves[ply - 1] : null;
      const movable = live && active && mine && g.turn === mine && !S.sending.has(g.id) && Chess ? mine : null;
      const mat = material(fen);
      const oppColor = mine ? other(mine) : 'b';
      const oppName = sideName(g, oppColor);
      const analysis = S.analyses.get(g.id);
      const result = analysis && analysis.status === 'done' ? analysis.result : null;
      if (!active && g.status === 'finished' && total >= 2 && !analysis) {
        S.analyses.set(g.id, { status: 'loading' });
        loadAnalysis(g.id);
      }

      // Âm thanh: bàn cờ tiến thêm đúng một nước (đi quân, đối thủ đi, xem lại), hoặc ván vừa kết thúc
      if (V.lastId === g.id) {
        if (V.lastStatus === 'active' && g.status !== 'active') playSound('end');
        else if (V.lastPly != null && ply === V.lastPly + 1) playSound(soundForSan(san[ply - 1]));
      }
      V.lastId = g.id;
      V.lastPly = ply;
      V.lastStatus = g.status;

      const head = h('header', { class: 'chat-head' },
        back,
        h('div', { class: 'chat-title' },
          h('h2', { text: mine ? `Với ${oppName}` : `${sideName(g, 'w')} vs ${sideName(g, 'b')}` }),
          h('p', { text: `${tcLabel(g)} · ${g.bot ? 'Chơi với máy' : g.rated ? 'Tính điểm ELO' : 'Giao hữu'}` })),
        host.share && (g.status !== 'active' || total > 0)
          ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chia sẻ ván cờ', dataset: { focus: 'share' }, onclick: () => host.share(g) }, icon('share'))
          : null,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Tùy chọn bàn cờ', onclick: openPrefs }, icon('tune')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Xoay bàn cờ', dataset: { focus: 'flip' }, onclick: () => { V.flip = !V.flip; renderGame(); } }, icon('flip')));

      const arrow = !active && P.arrows && result && ply < total && result.positions[ply] ? result.positions[ply].best : null;
      const board = renderBoard({ fen, orientation: bottom, movable, lastMove, arrow });

      const side = [];
      // Danh sách nước đi
      const moveList = h('ol', { class: 'chess-moves', 'aria-label': 'Các nước đã đi' });
      for (let i = 0; i < san.length; i += 2) {
        moveList.append(h('li', {},
          h('span', { class: 'chess-move-no', text: `${i / 2 + 1}.` }),
          moveBtn(san[i], i + 1, ply, total, result),
          san[i + 1] ? moveBtn(san[i + 1], i + 2, ply, total, result) : null));
      }
      if (!san.length) moveList.append(h('li', { class: 'chess-moves-empty', text: 'Chưa có nước đi nào' }));
      side.push(h('div', { class: 'chess-nav' },
        navBtn('first', 'Về đầu ván', ply === 0, () => setPly(0)),
        navBtn('prev', 'Nước trước', ply === 0, () => setPly(Math.max(0, ply - 1))),
        moveList,
        navBtn('next', 'Nước sau', live, () => setPly(ply + 1 >= total ? null : ply + 1)),
        navBtn('last', 'Nước mới nhất', live, () => setPly(null))));

      if (!live && active) {
        side.push(h('button', { class: 'chess-banner', type: 'button', onclick: () => setPly(null) },
          `Đang xem lại nước ${ply}/${total}. `, h('strong', { text: 'Về thế cờ hiện tại' })));
      }
      if (V.rulesError) side.push(h('p', { class: 'chess-alert', text: 'Không tải được luật cờ. Kiểm tra mạng rồi tải lại trang.' }));
      if (active) side.push(h('p', { class: `chess-status${g.turn === mine ? ' is-turn' : ''}`, id: 'chess-status', 'aria-live': 'polite', text: statusText(g, mine, oppName) }));

      const offerFromOpp = active && mine && g.drawOffer === other(mine);
      const offerFromMe = active && mine && g.drawOffer === mine;
      if (offerFromOpp) {
        side.push(h('div', { class: 'chess-offer' },
          h('span', { text: `${oppName} mời bạn hòa.` }),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => act(`/api/chess/games/${g.id}/draw`, { action: 'accept' })), text: 'Đồng ý hòa' }),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => act(`/api/chess/games/${g.id}/draw`, { action: 'decline' })), text: 'Không' })));
      } else if (offerFromMe) {
        side.push(h('p', { class: 'chess-note', text: `Bạn đã mời hòa, chờ ${oppName} trả lời.` }));
      }
      if (!active) side.push(resultCard(g, mine));
      if (!active && total > 0) {
        side.push(h('div', { class: 'chess-replay' },
          h('button', { class: 'btn btn-sm', type: 'button', dataset: { focus: 'replay' }, onclick: togglePlaying },
            icon(V.playing ? 'pause' : 'play'), V.playing ? 'Dừng' : ply >= total ? 'Xem lại từ đầu' : 'Tự chạy tiếp'),
          h('span', { class: 'chess-note', text: `Nước ${ply}/${total}` }),
          h('span', { class: 'chess-keys', text: 'Phím ← → để xem từng nước' })));
      }
      if (!active && g.status === 'finished' && total >= 2) side.push(analysisPanel(g, ply, analysis));

      if (active && mine) {
        const canAbort = total < 2;
        side.push(h('div', { class: 'btn-row chess-actions' },
          !g.bot && !canAbort
            ? h('button', {
                class: 'btn', type: 'button', disabled: offerFromMe || offerFromOpp,
                onclick: (e) => {
                  if (!window.confirm(`Gửi lời mời hòa tới ${oppName}?`)) return;
                  withBusy(e.currentTarget, () => act(`/api/chess/games/${g.id}/draw`, { action: 'offer' }));
                },
              }, icon('handshake'), 'Mời hòa')
            : null,
          canAbort
            ? h('button', {
                class: 'btn btn-danger', type: 'button',
                onclick: (e) => {
                  if (!window.confirm('Hủy ván cờ? Chưa ai mất điểm vì ván chưa bắt đầu.')) return;
                  withBusy(e.currentTarget, () => act(`/api/chess/games/${g.id}/abort`));
                },
              }, icon('close'), 'Hủy ván')
            : h('button', {
                class: 'btn btn-danger', type: 'button',
                onclick: (e) => {
                  if (!window.confirm(g.rated ? 'Đầu hàng? Bạn sẽ thua ván này và bị trừ điểm ELO.' : 'Đầu hàng? Bạn sẽ thua ván này.')) return;
                  withBusy(e.currentTarget, () => act(`/api/chess/games/${g.id}/resign`));
                },
              }, icon('flag'), 'Đầu hàng')));
      }
      if (!active && mine) {
        side.push(h('div', { class: 'btn-row chess-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => rematch(g)) }, icon('replay'), g.bot ? 'Chơi lại' : 'Đấu lại'),
          h('button', { class: 'btn', type: 'button', onclick: () => navigate('#/chess', { replace: true }), text: 'Về danh sách' })));
      }

      const body = h('div', { class: 'chess-game' },
        h('div', { class: 'chess-play' },
          playerBar(g, top, mat.captured[top], mat.lead[top]),
          board,
          playerBar(g, bottom, mat.captured[bottom], mat.lead[bottom])),
        h('div', { class: 'chess-side' }, side));
      const prevScroll = pane.querySelector('.chess-game')?.scrollTop || 0;
      pane.replaceChildren(head, body);
      body.scrollTop = prevScroll;
      const list = moveList;
      if (live) list.scrollLeft = list.scrollWidth;
      if (V.promo) pane.querySelector('.chess-promo-row button')?.focus({ preventScroll: true });
      else if (focusSq) pane.querySelector(`.sq[data-sq="${focusSq}"]`)?.focus({ preventScroll: true });
      else if (focusKey) {
        // Nút cũ không còn (vd tới nước cuối thì nút "Nước sau" bị tắt): chọn nút tự chạy / danh sách nước
        const el = pane.querySelector(`[data-focus="${focusKey}"]:not([disabled])`) || pane.querySelector('[data-focus="replay"], [data-focus="nav-prev"]');
        if (el) el.focus({ preventScroll: true });
      }

      // Đồng hồ chạy
      stopTicker();
      if (active && (g.clocks || g.firstMoveDeadline)) ticker = setInterval(tick, 200);
      tick();
    }

    function moveBtn(text, n, ply, total, result) {
      const cls = result && result.moves[n - 1] ? result.moves[n - 1].cls : null;
      const mark = cls && cls !== 'best' && cls !== 'good' ? MOVE_CLASS[cls] : null;
      const el = h('button', {
        class: `chess-move${ply === n ? ' is-current' : ''}${mark ? ` is-${cls}` : ''}`,
        type: 'button',
        dataset: { focus: `move-${n}` },
        'aria-label': `Xem nước ${text}${mark ? `, ${mark.label}` : ''}`,
        onclick: () => setPly(n === total ? null : n),
        text: `${text}${mark ? mark.symbol : ''}`,
      });
      return el;
    }

    /* ---------------- Bảng phân tích ---------------- */
    function analysisPanel(g, ply, a) {
      const head = (title, extra) => h('div', { class: 'chess-an-head' }, icon('chart'), h('h3', { text: title }), extra || null);
      if (!a || a.status === 'loading') return h('div', { class: 'chess-analysis' }, head('Phân tích ván đấu'), h('p', { class: 'hint', text: 'Đang tải…' }));
      if ((a.status === 'none' || a.status === 'error') && !myColor(g)) {
        // Người xem (ván được chia sẻ): chỉ người chơi mới yêu cầu phân tích được
        return h('div', { class: 'chess-analysis' }, head('Phân tích ván đấu'), h('p', { class: 'hint', text: 'Ván này chưa được phân tích. Người chơi có thể bấm phân tích bằng Stockfish.' }));
      }
      if (a.status === 'none' || a.status === 'error') {
        return h('div', { class: 'chess-analysis' },
          head('Phân tích ván đấu'),
          h('p', {
            class: 'hint',
            text: a.status === 'error'
              ? a.error || 'Phân tích bị lỗi.'
              : 'Máy Stockfish trên máy chủ sẽ chấm từng nước: nước hay, thiếu chính xác, sai lầm, và độ chính xác của mỗi bên. Mất khoảng 1 phút.',
          }),
          h('button', { class: 'btn btn-primary', type: 'button', dataset: { focus: 'analyze' }, onclick: (e) => withBusy(e.currentTarget, () => requestAnalysis(g.id)) },
            icon('chart'), a.status === 'error' ? 'Thử lại' : 'Phân tích bằng Stockfish'));
      }
      if (a.status === 'queued' || a.status === 'running') {
        const pct = a.total ? Math.round((a.progress / a.total) * 100) : 0;
        return h('div', { class: 'chess-analysis is-running' },
          head('Đang phân tích…', h('strong', { class: 'chess-an-pct', text: `${pct}%` })),
          h('div', { class: 'chess-progress', role: 'progressbar', 'aria-label': 'Tiến độ phân tích', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
            h('span', { style: `width:${Math.max(3, pct)}%` })),
          h('p', { class: 'hint', text: runningText(a) }));
      }
      const r = a.result;
      const move = ply > 0 ? r.moves[ply - 1] : null;
      const pos = r.positions[ply];
      const sideCard = (color) => {
        const n = r.counts[color];
        return h('div', { class: 'chess-acc' },
          h('div', { class: 'chess-acc-name' }, h('span', { class: `chess-swatch is-${color}` }), h('span', { text: sideName(g, color) })),
          h('strong', { text: `${r.accuracy[color] ?? '—'}%` }),
          h('small', { text: 'độ chính xác' }),
          h('div', { class: 'chess-acc-counts' },
            [['inaccuracy', 'thiếu chính xác'], ['mistake', 'sai lầm'], ['blunder', 'sai lầm nghiêm trọng']].map(([k, label]) =>
              h('span', { 'aria-label': `${n[k]} ${label}` }, h('b', { class: `is-${k}`, text: MOVE_CLASS[k].symbol }), String(n[k])))));
      };
      const good = pos && pos.wp >= 50;
      return h('div', { class: 'chess-analysis' },
        head('Phân tích ván đấu', h('span', { class: 'chess-an-engine', text: r.engine })),
        h('div', { class: 'chess-acc-row' }, sideCard('w'), sideCard('b')),
        evalGraph(r, ply),
        h('div', { class: 'chess-comment' },
          h('span', { class: `chess-eval${good ? ' is-white' : ''}`, text: evalText(pos) }),
          h('p', {
            class: move && move.cls !== 'good' && move.cls !== 'best' ? `is-${move.cls}` : '',
            text: move ? moveComment(move, r.positions[ply - 1]) : 'Thế cờ ban đầu. Bấm vào biểu đồ hoặc dùng nút ‹ › (phím ← →) để xem từng nước.',
          })),
        pos && pos.bestSan && ply < g.moves.length ? h('p', { class: 'hint', text: `Máy gợi ý đi tiếp: ${pos.bestSan}${P.arrows ? ' (mũi tên xanh trên bàn cờ)' : ''}.` }) : null);
    }

    // Biểu đồ khả năng thắng của Trắng qua từng nước; bấm để nhảy tới nước đó
    function evalGraph(r, ply) {
      const W = 300;
      const H = 80;
      const n = r.positions.length - 1;
      const x = (i) => (n ? (i / n) * W : 0);
      const y = (wp) => H - (wp / 100) * H;
      let line = '';
      r.positions.forEach((p, i) => { line += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.wp).toFixed(1)}`; });
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('class', 'chess-graph');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Biểu đồ đánh giá ván cờ. Bấm để xem nước đi đó.');
      const add = (tag, attrs) => {
        const el = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        svg.append(el);
        return el;
      };
      add('rect', { x: 0, y: 0, width: W, height: H, fill: '#26302C' });
      add('path', { d: `${line}L${W},${H}L0,${H}Z`, fill: '#F4F4F0' });
      add('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, stroke: 'rgba(128,128,128,.6)', 'stroke-width': 1, 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke' });
      for (const m of r.moves) {
        if (m.cls !== 'mistake' && m.cls !== 'blunder') continue;
        add('line', { x1: x(m.ply), y1: 0, x2: x(m.ply), y2: H, stroke: MOVE_CLASS[m.cls].color, 'stroke-width': 1.5, opacity: 0.75, 'vector-effect': 'non-scaling-stroke' });
      }
      add('line', { x1: x(ply), y1: 0, x2: x(ply), y2: H, stroke: '#0E7C66', 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke' });
      svg.addEventListener('click', (e) => {
        const box = svg.getBoundingClientRect();
        const i = Math.round(((e.clientX - box.left) / box.width) * n);
        const total = n;
        setPly(Math.max(0, Math.min(total, i)) >= total ? null : Math.max(0, i));
      });
      return svg;
    }
    function navBtn(name, label, disabled, onclick) {
      return h('button', { class: 'icon-btn chess-nav-btn', type: 'button', 'aria-label': label, disabled, dataset: { focus: `nav-${name}` }, onclick }, icon(`nav-${name}`));
    }
    function setPly(p) {
      stopPlaying();
      V.ply = p;
      V.selected = null;
      V.promo = null;
      renderGame();
    }

    function statusText(g, mine, oppName) {
      const elapsed = Date.now() - (S.receivedAt.get(g.id) || Date.now());
      const firstLeft = g.firstMoveDeadline ? g.firstMoveDeadline - g.serverNow - elapsed : null;
      if (firstLeft != null && firstLeft > 0) {
        const who = g.turn === mine ? 'Bạn' : g.turn === 'w' ? 'Bên Trắng' : 'Bên Đen';
        return `${who} cần đi nước đầu trong ${Math.ceil(firstLeft / 1000)} giây, không thì ván bị hủy.`;
      }
      if (g.turn === mine) return S.sending.has(g.id) ? 'Đang gửi nước đi…' : 'Đến lượt bạn.';
      if (g.bot && g.botColor === g.turn) return `${g.bot.name} đang nghĩ…`;
      if (mine) return `Chờ ${oppName} đi…`;
      return g.turn === 'w' ? 'Trắng đi.' : 'Đen đi.';
    }

    function clockMs(g, color) {
      if (!g.clocks) return null;
      const ticking = g.status === 'active' && g.turn === color && g.moves.length >= 2;
      const elapsed = ticking ? Date.now() - (S.receivedAt.get(g.id) || Date.now()) : 0;
      return Math.max(0, g.clocks[color] - elapsed);
    }

    function tick() {
      const g = S.games.get(S.openId);
      if (!g) return;
      for (const color of ['w', 'b']) {
        const el = document.getElementById(`chess-clock-${color}`);
        const ms = clockMs(g, color);
        if (!el || ms == null) continue;
        const txt = clockText(ms);
        const span = el.querySelector('.chess-clock-text');
        if (span.textContent !== txt) span.textContent = txt;
        el.classList.toggle('is-low', ms < 20000 && g.base >= 60000 && g.status === 'active');
      }
      const st = document.getElementById('chess-status');
      if (st && g.status === 'active') {
        const txt = statusText(g, myColor(g), sideName(g, other(myColor(g) || 'b')));
        if (st.textContent !== txt) st.textContent = txt;
      }
    }

    function playerBar(g, color, captured, lead) {
      const isMe = !isBotSide(g, color) && (color === 'w' ? g.whiteId : g.blackId) === meId();
      const active = g.status === 'active';
      const turn = active && g.turn === color;
      const rating = g.status === 'finished' && g.rated ? g.ratings[color] : g.live[color];
      const delta = g.deltas[color];
      const ms = clockMs(g, color);
      return h('div', { class: `chess-player${turn ? ' is-turn' : ''}` },
        sideAvatar(g, color, 'avatar-sm'),
        h('div', { class: 'chess-player-main' },
          h('div', { class: 'chess-player-name' },
            h('span', { class: 'chess-player-label', text: `${sideName(g, color)}${isMe ? ' (bạn)' : ''}` }),
            rating != null ? h('span', { class: 'chess-elo', text: `${isBotSide(g, color) ? '~' : ''}${rating}` }) : null,
            delta != null ? h('span', { class: `chess-delta${delta >= 0 ? ' is-up' : ' is-down'}`, text: signed(delta) }) : null),
          h('div', { class: 'chess-captured' },
            captured.map((p) => h('img', { src: pieceSrc(p), alt: '', draggable: 'false' })),
            lead > 0 ? h('span', { text: `+${lead}` }) : null)),
        ms != null
          ? h('div', { class: `chess-clock${turn ? ' is-running' : ''}`, id: `chess-clock-${color}`, role: 'timer', 'aria-label': `Đồng hồ ${sideName(g, color)}` },
              h('span', { class: 'chess-clock-text', text: clockText(ms) }))
          : turn ? h('span', { class: 'chess-turn-dot', 'aria-label': 'Đang tới lượt' }) : null);
    }

    function resultCard(g, mine) {
      const o = outcomeFor(g, mine);
      const delta = mine ? g.deltas[mine] : null;
      const winner = g.result && g.result !== '1/2-1/2' ? (g.result === '1-0' ? 'Trắng' : 'Đen') : null;
      return h('div', { class: `chess-result is-${o || 'none'}`, 'aria-live': 'polite' },
        h('div', { class: 'chess-result-main' },
          h('strong', { text: resultTitle(g, mine) }),
          h('span', { text: `${winner ? `${winner} thắng do ${reasonText(g.reason)}` : reasonText(g.reason)}${g.result ? ` · ${g.result.replace(/1\/2/g, '½')}` : ''}` })),
        delta != null
          ? h('div', { class: 'chess-result-delta' }, h('strong', { text: signed(delta) }), h('span', { text: `ELO ${(g.ratings[mine] || 0) + delta}` }))
          : null);
    }

    async function rematch(g) {
      const game = await act(`/api/chess/games/${g.id}/rematch`);
      if (!game) return;
      if (game.status === 'active') openGame(game.id);
      else {
        toast(`Đã gửi lời mời đấu lại cho ${nameOf(game.opponentId)}.`);
        navigate('#/chess', { replace: true });
      }
    }

    // Ký hiệu nước đi (e4, Nf3…) và thế cờ sau từng nước
    let replayCache = { key: '', san: [], fens: [START_FEN] };
    function replay(moves) {
      const key = moves.join(' ');
      if (replayCache.key === key && replayCache.fens.length === moves.length + 1) return replayCache;
      const out = { key, san: [], fens: [START_FEN] };
      if (Chess) {
        const chess = new Chess();
        for (const m of moves) {
          try {
            const r = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined });
            out.san.push(r.san);
            out.fens.push(chess.fen());
          } catch {
            break;
          }
        }
      } else {
        out.san = moves.slice();
      }
      replayCache = out;
      return out;
    }

    /* ---------------- Bàn cờ ---------------- */
    let dragging = null;
    let suppressClick = false;

    function renderBoard({ fen, orientation, movable, lastMove, arrow }) {
      const rows = parseFen(fen);
      let chess = null;
      let targets = new Map();
      let checkSq = null;
      if (Chess) {
        try {
          chess = new Chess(fen);
        } catch {
          chess = null;
        }
      }
      if (chess) {
        if (V.selected && movable && chess.turn() === movable) {
          for (const m of chess.moves({ square: V.selected, verbose: true })) {
            const list = targets.get(m.to) || [];
            list.push(m);
            targets.set(m.to, list);
          }
        }
        if (chess.inCheck()) {
          const turn = chess.turn();
          for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === turn) checkSq = p.square;
        }
      }
      const [lf, lt] = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [null, null];
      const order = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
      const board = h('div', { class: `chess-board${movable ? ' is-movable' : ''}`, role: 'grid', 'aria-label': 'Bàn cờ' });
      order.forEach((r, ri) => {
        order.forEach((f, fi) => {
          const sq = `${FILES[f]}${8 - r}`;
          const code = rows[r][f];
          const can = targets.has(sq);
          const hint = P.hints && can ? (code ? 'ring' : 'dot') : null;
          const cls = ['sq', (r + f) % 2 ? 'is-dark' : 'is-light'];
          if (sq === V.selected) cls.push('is-selected');
          else if (sq === checkSq) cls.push('is-check');
          else if (P.lastMove && (sq === lf || sq === lt)) cls.push('is-last');
          if (hint) cls.push(`has-${hint}`);
          // Trình đọc màn hình vẫn báo ô đi được kể cả khi tắt chấm chỉ dẫn
          const label = `${sq}${code ? `, ${NAMES[code[1].toLowerCase()]} ${code[0] === 'w' ? 'trắng' : 'đen'}` : ''}${can ? ', đi được' : ''}`;
          board.append(h('button', { class: cls.join(' '), type: 'button', dataset: { sq }, 'aria-label': label, tabindex: movable ? '0' : '-1' },
            P.coords && fi === 0 ? h('span', { class: 'coord coord-rank', text: String(8 - r) }) : null,
            P.coords && ri === 7 ? h('span', { class: 'coord coord-file', text: FILES[f] }) : null,
            code ? h('img', { class: 'pc', src: pieceSrc(code), alt: '', draggable: 'false' }) : null));
        });
      });
      if (arrow && /^[a-h][1-8][a-h][1-8]/.test(arrow)) board.append(arrowSvg(arrow, orientation));
      if (V.promo) {
        const color = movable || 'w';
        board.append(h('div', { class: 'chess-promo' },
          h('div', { class: 'chess-promo-box', role: 'dialog', 'aria-label': 'Phong cấp thành' },
            h('p', { text: 'Phong cấp thành' }),
            h('div', { class: 'chess-promo-row' },
              ['q', 'r', 'b', 'n'].map((t) => h('button', {
                type: 'button',
                'aria-label': NAMES[t],
                onclick: (e) => {
                  e.stopPropagation();
                  const pr = V.promo;
                  V.promo = null;
                  playMove(`${pr.from}${pr.to}${t}`);
                },
              }, h('img', { src: pieceSrc(`${color}${t.toUpperCase()}`), alt: '' })))),
            h('button', { class: 'btn btn-sm btn-quiet', type: 'button', onclick: (e) => { e.stopPropagation(); V.promo = null; renderGame(); }, text: 'Hủy' }))));
      }

      const press = (sq) => {
        if (!movable || !chess) return;
        const moves = V.selected ? targets.get(sq) : null;
        if (V.selected && moves && moves.length) {
          if (moves.some((m) => m.promotion)) {
            V.promo = { from: V.selected, to: sq };
            renderGame();
            return;
          }
          const from = V.selected;
          V.selected = null;
          playMove(`${from}${sq}`);
          return;
        }
        const p = chess.get(sq);
        V.selected = p && p.color === movable && V.selected !== sq ? sq : null;
        renderGame();
      };

      board.addEventListener('click', (e) => {
        if (suppressClick) return;
        const el = e.target.closest('.sq');
        if (el && board.contains(el)) press(el.dataset.sq);
      });
      // Kéo thả quân (chuột hoặc ngón tay)
      board.addEventListener('pointerdown', (e) => {
        if (!movable || !chess || e.button !== 0 || V.promo) return;
        const el = e.target.closest('.sq');
        if (!el) return;
        const p = chess.get(el.dataset.sq);
        if (!p || p.color !== movable) return;
        dragging = { from: el.dataset.sq, x: e.clientX, y: e.clientY, ghost: null, origin: el, size: el.getBoundingClientRect().width, moves: chess.moves({ square: el.dataset.sq, verbose: true }) };
      });
      return board;
    }

    // Mũi tên gợi ý (nước tốt nhất của máy) vẽ đè lên bàn cờ, tọa độ theo ô (0–8)
    function arrowSvg(uci, orientation) {
      const pt = (sq) => {
        const f = FILES.indexOf(sq[0]);
        const r = Number(sq[1]) - 1;
        return { x: (orientation === 'w' ? f : 7 - f) + 0.5, y: (orientation === 'w' ? 7 - r : r) + 0.5 };
      };
      const a = pt(uci.slice(0, 2));
      const b = pt(uci.slice(2, 4));
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const head = 0.42;
      const ex = b.x - ux * head;
      const ey = b.y - uy * head;
      const px = -uy * head * 0.6;
      const py = ux * head * 0.6;
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', '0 0 8 8');
      svg.setAttribute('class', 'chess-arrow');
      svg.setAttribute('aria-hidden', 'true');
      const line = document.createElementNS(SVG, 'line');
      for (const [k, v] of Object.entries({ x1: a.x + ux * 0.15, y1: a.y + uy * 0.15, x2: ex, y2: ey, 'stroke-width': 0.17, 'stroke-linecap': 'round' })) line.setAttribute(k, v);
      const poly = document.createElementNS(SVG, 'polygon');
      poly.setAttribute('points', `${b.x},${b.y} ${ex + px},${ey + py} ${ex - px},${ey - py}`);
      svg.append(line, poly);
      return svg;
    }

    window.addEventListener('pointermove', (e) => {
      const d = dragging;
      if (!d) return;
      if (!d.ghost) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
        const img = d.origin.querySelector('.pc');
        if (!img) return;
        d.ghost = h('img', { class: 'chess-ghost', src: img.src, alt: '' });
        d.ghost.style.width = d.ghost.style.height = `${d.size}px`;
        document.body.append(d.ghost);
        img.classList.add('is-dragging');
        if (P.hints) for (const m of d.moves) document.querySelector(`#chess-pane .sq[data-sq="${m.to}"]`)?.classList.add(m.captured ? 'has-ring' : 'has-dot');
      }
      d.ghost.style.transform = `translate(${e.clientX - d.size / 2}px, ${e.clientY - d.size / 2}px)`;
    });
    function endDrag(e) {
      const d = dragging;
      dragging = null;
      if (!d || !d.ghost) return;
      d.ghost.remove();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      const el = e && document.elementFromPoint(e.clientX, e.clientY)?.closest('#chess-pane .sq');
      const to = el ? el.dataset.sq : null;
      const moves = to ? d.moves.filter((m) => m.to === to) : [];
      if (moves.length) {
        if (moves.some((m) => m.promotion)) {
          V.promo = { from: d.from, to };
          V.selected = null;
          renderGame();
        } else {
          V.selected = null;
          playMove(`${d.from}${to}`);
        }
      } else {
        V.selected = d.from;
        renderGame();
      }
    }
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', () => endDrag(null));

    /* ---------------- Lời thách đấu (chưa bắt đầu) ---------------- */
    function renderChallenge(pane, g, back) {
      const me = meId();
      const incoming = g.opponentId === me;
      const statusText =
        g.status === 'declined' ? 'Lời thách đấu đã bị từ chối.'
          : g.status === 'cancelled' ? 'Lời thách đấu đã được hủy.'
            : g.status === 'expired' ? 'Lời thách đấu đã hết hạn.'
              : incoming ? `${nameOf(g.challengerId)} thách bạn một ván cờ.` : `Đang chờ ${nameOf(g.opponentId)} nhận lời…`;
      const left = g.expiresAt ? Math.max(0, g.expiresAt - g.serverNow - (Date.now() - (S.receivedAt.get(g.id) || Date.now()))) : 0;
      const info = [
        g.base ? `${tcLabel(g)}: mỗi bên ${Math.round(g.base / 60000)} phút, cộng ${Math.round(g.inc / 1000)} giây mỗi nước` : 'Không giới hạn thời gian',
        g.rated ? 'Có tính điểm ELO' : 'Giao hữu, không tính điểm',
        g.colorPref === 'random' ? 'Màu quân chọn ngẫu nhiên' : `Bạn cầm quân ${(g.colorPref === 'white') === !incoming ? 'Trắng' : 'Đen'}`,
        g.status === 'challenge' ? `Hết hạn sau khoảng ${Math.max(1, Math.ceil(left / 60000))} phút` : null,
      ].filter(Boolean);
      let actions;
      if (g.status !== 'challenge') actions = [h('button', { class: 'btn', type: 'button', onclick: () => navigate('#/chess', { replace: true }), text: 'Về danh sách' })];
      else if (incoming) {
        actions = [
          h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => answer(g.id, 'accept')) }, icon('check'), 'Nhận lời'),
          h('button', { class: 'btn', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => { await answer(g.id, 'decline'); navigate('#/chess', { replace: true }); }) }, icon('close'), 'Từ chối'),
        ];
      } else {
        actions = [h('button', { class: 'btn btn-danger', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => { await answer(g.id, 'cancel'); navigate('#/chess', { replace: true }); }), text: 'Hủy lời thách đấu' })];
      }
      pane.replaceChildren(
        h('header', { class: 'chat-head' }, back, h('div', { class: 'chat-title' }, h('h2', { text: 'Lời thách đấu' }), h('p', { text: `${tcLabel(g)} · ${g.rated ? 'Tính điểm ELO' : 'Giao hữu'}` }))),
        h('div', { class: 'chess-challenge' },
          h('div', { class: 'chess-vs' },
            h('div', {}, avatarEl(userOf(g.challengerId), 'avatar-xl', { dot: false }), h('strong', { text: nameOf(g.challengerId) })),
            h('span', { class: 'chess-vs-text', text: 'VS' }),
            h('div', {}, avatarEl(userOf(g.opponentId), 'avatar-xl', { dot: false }), h('strong', { text: nameOf(g.opponentId) }))),
          h('p', { class: 'chess-challenge-status', text: statusText }),
          h('ul', { class: 'chess-info' }, info.map((t) => h('li', { text: t }))),
          h('div', { class: 'btn-row chess-actions' }, actions)));
    }

    /* =========================================================
       Bảng: thách đấu, chơi với máy, bảng xếp hạng
       ========================================================= */
    let layer = null;
    let hideTimer = null;
    function ensureLayer() {
      if (layer) return layer;
      layer = h('div', { class: 'sheet-layer chess-layer', hidden: true },
        h('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }),
        h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }));
      layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
      document.body.append(layer);
      window.addEventListener('popstate', () => {
        if (layer && !layer.hidden && !(history.state && history.state.chessSheet)) closeSheet(true);
      });
      return layer;
    }
    function openSheet(title, body, foot) {
      const l = ensureLayer();
      const sheet = l.querySelector('.sheet');
      sheet.setAttribute('aria-label', title);
      sheet.replaceChildren(
        h('header', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onclick: () => closeSheet() }, icon('close'))),
        h('div', { class: 'sheet-body' }, body),
        ...(foot ? [h('div', { class: 'sheet-foot' }, foot)] : [])); // replaceChildren(null) sẽ in ra chữ "null"
      if (l.hidden || !l.classList.contains('open')) {
        clearTimeout(hideTimer);
        if (!(history.state && history.state.chessSheet)) history.pushState({ ...(history.state || {}), chessSheet: true }, '', location.hash || '#/');
        l.hidden = false;
        void l.offsetWidth;
        l.classList.add('open');
      }
      l.dataset.kind = '';
      sheet.focus({ preventScroll: true });
      return sheet;
    }
    function closeSheet(silent) {
      if (!layer || layer.hidden) return;
      if (!silent && history.state && history.state.chessSheet) {
        history.back(); // popstate sẽ đóng bảng
        return;
      }
      layer.classList.remove('open');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!layer.classList.contains('open')) layer.hidden = true;
      }, 220);
    }

    function timePicker(value, onChange) {
      const grid = h('div', { class: 'chess-tc', role: 'radiogroup', 'aria-label': 'Thời gian mỗi bên' });
      const draw = () => {
        grid.replaceChildren(...TIME_CONTROLS.map((t) => {
          const on = t.base === value.base && t.inc === value.inc;
          return h('button', {
            class: `chess-tc-item${on ? ' is-on' : ''}${t.base === 0 ? ' is-wide' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': t.base ? `${t.base} phút, cộng ${t.inc} giây mỗi nước` : 'Không giới hạn thời gian',
            onclick: () => {
              value.base = t.base;
              value.inc = t.inc;
              draw();
              onChange && onChange();
            },
          }, h('strong', { text: t.label }), h('span', { text: t.kind }));
        }));
      };
      draw();
      return grid;
    }
    function colorPicker(value) {
      const row = h('div', { class: 'chess-colors', role: 'radiogroup', 'aria-label': 'Bạn cầm quân' });
      const items = [
        { key: 'random', label: 'Ngẫu nhiên', sw: ['w', 'b'] },
        { key: 'white', label: 'Quân trắng', sw: ['w'] },
        { key: 'black', label: 'Quân đen', sw: ['b'] },
      ];
      const draw = () => {
        row.replaceChildren(...items.map((it) => h('button', {
          class: `chess-color${value.color === it.key ? ' is-on' : ''}`,
          type: 'button',
          role: 'radio',
          'aria-checked': value.color === it.key ? 'true' : 'false',
          onclick: () => { value.color = it.key; draw(); },
        }, h('span', { class: 'chess-swatches' }, it.sw.map((c) => h('span', { class: `chess-swatch is-${c}` }))), h('span', { text: it.label }))));
      };
      draw();
      return row;
    }

    function openChallenge(presetId) {
      const pick = { id: presetId != null ? presetId : null };
      const tc = { base: 10, inc: 0 };
      const opts = { color: 'random', rated: true };
      if (!S.leaderboard) loadLeaderboard();
      const ratingOf = (id) => (S.leaderboard || []).find((r) => r.userId === id)?.rating ?? 1200;
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
            'aria-label': `${u.displayName}, ELO ${ratingOf(u.id)}`,
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
      const tcHint = h('p', { class: 'hint' });
      const drawHint = () => {
        tcHint.textContent = tc.base
          ? `Mỗi bên ${tc.base} phút${tc.inc ? `, đi xong mỗi nước được cộng ${tc.inc} giây` : ''}. Hết giờ là thua.`
          : 'Không tính giờ: đi lúc nào cũng được, hợp để chơi thong thả cả ngày.';
      };
      drawHint();
      const rated = h('input', { class: 'switch', type: 'checkbox', checked: true, 'aria-label': 'Tính điểm ELO' });
      const ratedHint = h('span', { class: 'hint', text: 'Thắng được cộng điểm, thua bị trừ điểm trên bảng xếp hạng.' });
      rated.addEventListener('change', () => {
        opts.rated = rated.checked;
        ratedHint.textContent = rated.checked ? 'Thắng được cộng điểm, thua bị trừ điểm trên bảng xếp hạng.' : 'Ván giao hữu, không ảnh hưởng điểm.';
      });
      submit.addEventListener('click', () => withBusy(submit, async () => {
        if (pick.id == null) return;
        error.hidden = true;
        try {
          const { game } = await api('/api/chess/challenges', { method: 'POST', body: { opponentId: pick.id, base: tc.base, inc: tc.inc, color: opts.color, rated: opts.rated } });
          upsert([game]);
          closeSheet();
          toast(`Đã gửi lời thách đấu tới ${nameOf(pick.id)}. Họ nhận là vào ván ngay.`);
          refresh();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }));
      openSheet('Thách đấu cờ vua', [
        h('div', { class: 'panel' }, h('h3', { text: 'Đối thủ' }), presetId == null && people.length > 6 ? search : null, list),
        h('div', { class: 'panel' }, h('h3', { text: 'Thời gian mỗi bên' }), timePicker(tc, drawHint), tcHint),
        h('div', { class: 'panel' }, h('h3', { text: 'Bạn cầm quân' }), colorPicker(opts)),
        h('div', { class: 'panel' }, h('label', { class: 'switch-row' }, h('span', { class: 'chess-switch-text' }, h('strong', { text: 'Tính điểm ELO' }), ratedHint), rated)),
        error,
      ], submit);
    }

    async function openBots() {
      if (!S.bots.length) await load();
      const pick = { id: (S.bots[2] || S.bots[0] || {}).id || null };
      const tc = { base: 0, inc: 0 };
      const opts = { color: 'white' };
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const list = h('ul', { class: 'people-list chess-people', role: 'radiogroup', 'aria-label': 'Chọn máy' });
      const drawBots = () => {
        list.replaceChildren(...S.bots.map((b) => h('li', { class: 'chess-bot-item' },
          h('button', {
            class: 'person pick',
            type: 'button',
            role: 'radio',
            'aria-checked': pick.id === b.id ? 'true' : 'false',
            'aria-pressed': pick.id === b.id ? 'true' : 'false',
            'aria-label': `${b.name}, khoảng ${b.elo} ELO. ${b.about}`,
            onclick: () => { pick.id = b.id; drawBots(); },
          },
          botAvatar(b),
          h('span', { class: 'person-main' },
            h('span', { class: 'person-name' }, b.name, h('span', { class: 'chess-elo', text: ` ~${b.elo}` })),
            h('span', { class: 'person-sub', text: b.about })),
          h('span', { class: 'check' }, icon('check'))),
          h('a', { class: 'chess-source', href: b.source.url, target: '_blank', rel: 'noopener noreferrer', text: `${b.source.name} · ${b.source.license} ↗` }))));
      };
      drawBots();
      const start = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Bắt đầu');
      start.addEventListener('click', () => withBusy(start, async () => {
        if (!pick.id) return;
        error.hidden = true;
        try {
          const { game } = await api('/api/chess/bot', { method: 'POST', body: { bot: pick.id, base: tc.base, inc: tc.inc, color: opts.color } });
          upsert([game]);
          closeSheet(true);
          // Thay bước lịch sử của bảng bằng ván cờ
          if (history.state && history.state.chessSheet) history.replaceState({ depth: (history.state.depth || 0) }, '', openGameHash(game.id));
          navigate(openGameHash(game.id), { replace: true });
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }));
      openSheet('Chơi với máy', [
        h('p', { class: 'hint', text: 'Luyện tập với các máy cờ mã nguồn mở. Ván với máy không tính điểm ELO.' }),
        list,
        h('div', { class: 'panel' }, h('h3', { text: 'Thời gian mỗi bên' }), timePicker(tc)),
        h('div', { class: 'panel' }, h('h3', { text: 'Bạn cầm quân' }), colorPicker(opts)),
        error,
      ], start);
    }

    const PREF_ROWS = [
      ['hints', 'Chỉ dẫn nước đi', 'Chọn quân thì hiện chấm ở các ô đi được.'],
      ['lastMove', 'Tô màu nước vừa đi', 'Tô vàng ô đi và ô đến của nước gần nhất.'],
      ['coords', 'Tọa độ bàn cờ', 'Chữ a–h và số 1–8 ở mép bàn cờ.'],
      ['arrows', 'Mũi tên gợi ý khi phân tích', 'Khi xem lại ván đã phân tích, vẽ mũi tên nước tốt nhất của máy.'],
      ['sound', 'Âm thanh', 'Tiếng quân cờ khi đi, ăn quân, chiếu tướng, bắt đầu và kết thúc ván.'],
    ];
    function openPrefs() {
      const rows = PREF_ROWS.map(([key, title, hint]) => {
        const input = h('input', { class: 'switch', type: 'checkbox', checked: P[key], 'aria-label': title });
        input.addEventListener('change', () => {
          setPref(key, input.checked);
          if (key === 'sound' && input.checked) playSound('move');
        });
        return h('label', { class: 'switch-row chess-pref' }, h('span', { class: 'chess-switch-text' }, h('strong', { text: title }), h('span', { class: 'hint', text: hint })), input);
      });
      openSheet('Tùy chọn bàn cờ', [h('div', { class: 'panel' }, rows)]);
      layer.dataset.kind = 'prefs';
    }

    function openHistory() {
      const list = h('ul', { class: 'chess-list' });
      const more = h('button', { class: 'btn btn-block', type: 'button', onclick: () => loadHistory(true), text: 'Tải thêm' });
      const note = h('p', { class: 'hint' });
      drawHistory = () => {
        if (!layer || layer.hidden || layer.dataset.kind !== 'history') return;
        const games = S.history.ids.map((id) => S.games.get(id)).filter(Boolean);
        list.replaceChildren(...games.map((g) => recentRow(g, () => closeSheet(true))));
        note.textContent = S.history.loading ? 'Đang tải…' : S.history.loaded && !games.length ? 'Bạn chưa chơi xong ván nào.' : '';
        more.hidden = !S.history.hasMore || S.history.loading;
      };
      openSheet('Lịch sử ván đấu', [h('p', { class: 'hint', text: 'Bấm vào một ván để xem lại từng nước và nhờ Stockfish phân tích.' }), list, note, more]);
      layer.dataset.kind = 'history';
      drawHistory();
      loadHistory();
    }

    function openLeaderboard() {
      loadLeaderboard().then(() => {
        if (layer && !layer.hidden && layer.dataset.kind === 'board') drawBoard();
      });
      const wrap = h('ul', { class: 'chess-list' });
      const drawBoard = () => {
        const rows = S.leaderboard || [];
        wrap.replaceChildren(...(rows.length ? rows.map((r, i) => rankRow(r, i + 1)) : [h('li', { class: 'people-empty', text: S.leaderboard ? 'Chưa ai chơi ván xếp hạng.' : 'Đang tải…' })]));
      };
      drawBoard();
      openSheet('Bảng xếp hạng', [h('p', { class: 'hint', text: 'Xếp theo điểm ELO từ các ván tính điểm giữa người với người. Dấu ? là điểm tạm (dưới 10 ván).' }), wrap]);
      layer.dataset.kind = 'board';
    }

    return {
      route,
      load,
      reload: () => (S.loaded ? load() : null),
      reset,
      onEvent,
      openChallenge,
      openLeaderboard,
      openPrefs,
      onAnalysis,
      badge: todo,
    };
  }

  // Bàn cờ nhỏ chỉ để xem (bài đăng có ván cờ)
  function miniBoard(fen, orientation = 'w') {
    const el = document.createElement('div');
    el.className = 'chess-board is-mini';
    el.setAttribute('aria-hidden', 'true');
    const rows = parseFen(fen);
    const order = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    for (const r of order) {
      for (const f of order) {
        const sq = document.createElement('span');
        sq.className = `sq ${(r + f) % 2 ? 'is-dark' : 'is-light'}`;
        const code = rows[r][f];
        if (code) {
          const img = document.createElement('img');
          img.className = 'pc';
          img.src = pieceSrc(code);
          img.alt = '';
          img.draggable = false;
          sq.append(img);
        }
        el.append(sq);
      }
    }
    return el;
  }

  // Mô tả ván để chia sẻ: "An vs Bình" / "Trắng thắng do chiếu hết · 5+3 · 24 nước"
  function describe(g, nameOf) {
    const side = (c) => (g.bot && g.botColor === c ? g.bot.name : nameOf(c === 'w' ? g.whiteId : g.blackId));
    const title = `${side('w')} (Trắng) vs ${side('b')} (Đen)`;
    let state;
    if (g.status === 'active') state = 'Đang chơi';
    else if (g.status === 'aborted') state = 'Ván bị hủy';
    else if (g.result === '1/2-1/2') state = `Hòa (${reasonText(g.reason)})`;
    else state = `${g.result === '1-0' ? side('w') : side('b')} thắng do ${reasonText(g.reason)}`;
    return { title, sub: `${state} · ${tcLabel(g)} · ${g.moves.length} nước` };
  }

  return { create, miniBoard, text: { describe, tcLabel, reasonText }, _test: { tcLabel, clockText, material, parseFen, outcomeFor } };
})();
