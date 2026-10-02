'use strict';
/* Câu đố của Cờ vua, Xếp Khối, Cờ caro trên bản web (máy chủ: src/puzzles.js, luật: public/puzzles-core.js).
   - "Quiz hôm nay": mỗi game một câu mỗi ngày (giờ Việt Nam), cả nhóm cùng giải, xem ai giải nhanh nhất.
   - "Thử thách nhanh": các màn xếp theo chương (số màn lấy từ dữ liệu, thêm được), giải màn trước mới mở màn sau, 1–3 sao.
   Kết quả lưu trên máy ngay (giải lúc mất mạng vẫn được), rồi gửi lên máy chủ; chưa gửi được thì để trong hàng chờ,
   có mạng lại / mở lại app thì gửi tiếp theo đúng thứ tự. Sao trên máy và trên máy chủ: lấy số lớn hơn.
   Bàn chơi dùng lại bàn của từng game: ThinkChess (chess-ui.js), ThinkCaro (caro-ui.js), ThinkBlocks (blocks.js).
   Đường dẫn: #/quiz/chess (quiz hôm nay) · #/levels/chess (bản đồ màn) · #/levels/chess/12 (màn 12).
   app.js tạo một bản (ThinkPuzzles.create) dùng chung: khung "Quiz hôm nay" ở trang Trò chơi (panel),
   hai nút trong từng game (entry), màn câu đố ở cột phải (toàn màn hình trên điện thoại). */
window.ThinkPuzzles = (() => {
  const P = window.PuzzlesCore || null;
  const GAMES = P ? P.GAMES : ['chess', 'blocks', 'caro'];
  const KEY_PROGRESS = 'puzzles-progress-v1'; // { [uid]: { [game]: { lv: { [màn]: sao }, daily: { [ngày]: kết quả } } } }
  const KEY_PENDING = 'puzzles-pending-v1'; // hàng chờ gửi lên máy chủ [{ qid, uid, game, kind, body, tries }]
  const KEY_SUMMARY = 'puzzles-summary-v1'; // bản tóm tắt máy chủ gửi lần gần nhất (xem được khi mất mạng)
  const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

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
  };

  /** 75 giây → "1:15" */
  function fmtTime(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return '—';
    const s = Math.max(0, Math.round(Number(ms) / 1000));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }
  const starText = (n) => '★'.repeat(Math.max(0, Math.min(3, n | 0))) + '☆'.repeat(3 - Math.max(0, Math.min(3, n | 0)));
  /** "2026-10-02" → "Thứ Sáu, 02/10" */
  function dayLabel(day) {
    const d = new Date(`${day}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return day;
    return `${WEEKDAYS[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  /** Mục tiêu ngắn cho dòng ở trang Trò chơi */
  function shortGoal(game, p) {
    if (!P || !p) return '';
    if (game === 'blocks') return `Dọn sạch bàn · ${p.pieces.length} khối`;
    const text = P.goalText(game, p).split(' — ').pop();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let inst = null;

  function create(host) {
    const { h, icon, api, state, navigate, goBack, toast, nameOf, userOf, avatarEl } = host;
    const $ = (sel) => document.querySelector(sel);
    const me = () => (state.me ? state.me.id : null);

    const S = {
      gen: 0, // tăng mỗi lần đăng xuất: phản hồi của người cũ về muộn thì bỏ
      data: {}, // game -> dữ liệu câu đố (public/puzzles/<game>.json)
      dataLoading: {},
      summary: null, // { uid, today, games } từ GET /api/puzzles
      loading: null,
      flushing: null,
      again: false,
      flushTimer: null,
    };
    // Màn đang mở ở cột phải
    const V = { key: null, target: null, token: 0, run: null, layer: null, sheetTimer: null, boardOpen: false, ro: null };

    /* =========================================================
       Dữ liệu câu đố
       ========================================================= */
    function loadData(game) {
      if (S.data[game]) return Promise.resolve(S.data[game]);
      if (!S.dataLoading[game]) {
        const s = serverOf(game);
        const v = s && s.version ? `?v=${encodeURIComponent(s.version)}` : '';
        S.dataLoading[game] = fetch(`/puzzles/${game}.json${v}`, { credentials: 'same-origin' })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((d) => {
            if (!d || !Array.isArray(d.levels) || !Array.isArray(d.daily)) throw new Error('Dữ liệu câu đố hỏng');
            S.data[game] = d;
            S.dataLoading[game] = null;
            return d;
          }, (err) => {
            S.dataLoading[game] = null;
            throw err;
          });
      }
      return S.dataLoading[game];
    }
    let allLoading = null;
    let allFailedAt = 0;
    function loadAllData() {
      if (GAMES.every((g) => S.data[g])) return Promise.resolve();
      if (allLoading) return allLoading;
      // Vừa tải lỗi (mất mạng, máy chủ lỗi): chờ một lúc mới thử lại, không thì vẽ lại → tải lại → lỗi… mãi
      if (Date.now() - allFailedAt < 30000) return Promise.resolve();
      const before = GAMES.filter((g) => S.data[g]).length;
      allLoading = Promise.all(GAMES.map((g) => loadData(g).catch(() => null))).then(() => {
        allLoading = null;
        const got = GAMES.filter((g) => S.data[g]).length;
        if (got < GAMES.length) allFailedAt = Date.now();
        if (got > before) refresh(); // chỉ vẽ lại khi có thêm dữ liệu
      });
      return allLoading;
    }
    window.addEventListener('online', () => {
      allFailedAt = 0;
    });
    // Máy chủ có bộ câu đố mới hơn bản đang có trên máy: tải lại
    function checkVersions() {
      for (const g of GAMES) {
        const s = serverOf(g);
        if (s && S.data[g] && s.version != null && S.data[g].version !== s.version) {
          delete S.data[g];
          loadData(g).then(refresh, () => {});
        }
      }
    }

    /* =========================================================
       Tiến độ trên máy + bản tóm tắt của máy chủ
       ========================================================= */
    function progressAll() {
      const all = store.get(KEY_PROGRESS, {});
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    }
    function localOf(game, uid = me()) {
      const g = ((progressAll()[uid] || {})[game]) || {};
      return { lv: g.lv || {}, daily: g.daily || {} };
    }
    function saveLocal(game, fn) {
      const uid = me();
      if (uid == null) return;
      const all = progressAll();
      const mine = all[uid] || (all[uid] = {});
      const g = mine[game] || (mine[game] = {});
      g.lv = g.lv || {};
      g.daily = g.daily || {};
      fn(g);
      const days = Object.keys(g.daily).sort();
      while (days.length > 14) delete g.daily[days.shift()]; // quiz hằng ngày: giữ 2 tuần gần nhất
      store.set(KEY_PROGRESS, all);
    }

    const serverOf = (game) => (S.summary && S.summary.uid === me() && S.summary.games ? S.summary.games[game] || null : null);
    function saveSummary() {
      if (S.summary) store.set(KEY_SUMMARY, S.summary);
    }
    function restoreSummary() {
      const saved = store.get(KEY_SUMMARY, null);
      S.summary = saved && saved.uid === me() && saved.games ? saved : null;
    }
    function setGameSummary(game, summary) {
      if (!summary || me() == null) return;
      if (!S.summary || S.summary.uid !== me()) S.summary = { uid: me(), today: summary.daily ? summary.daily.day : P.dayKey(), games: {} };
      S.summary.games[game] = summary;
      if (summary.daily && summary.daily.day) S.summary.today = summary.daily.day;
      saveSummary();
    }

    const today = () => P.dayKey();
    function levelCount(game) {
      if (S.data[game]) return S.data[game].levels.length;
      const s = serverOf(game);
      return s ? s.count : 0;
    }
    /** Sao từng màn (mảng, màn 1 ở chỗ 0): số lớn hơn giữa trên máy và trên máy chủ */
    function levelStars(game) {
      const n = levelCount(game);
      const s = serverOf(game);
      const lv = localOf(game).lv;
      const out = new Array(n).fill(0);
      for (let i = 0; i < n; i++) out[i] = Math.max(s && s.stars ? Number(s.stars[i]) || 0 : 0, Number(lv[i + 1]) || 0);
      return out;
    }
    function stats(game) {
      const stars = levelStars(game);
      let total = 0;
      let solved = 0;
      let next = null;
      stars.forEach((v, i) => {
        total += v;
        if (v) solved++;
        if (next == null && !v && (i === 0 || stars[i - 1] > 0)) next = i + 1;
      });
      return { count: stars.length, stars, total, solved, next };
    }
    const isOpen = (stars, n) => n === 1 || stars[n - 2] > 0;

    function dailyPuzzle(game, day = today()) {
      const d = S.data[game];
      if (!d || !d.daily.length) return null;
      const index = P.dailyIndex(day, d.daily.length);
      return { index, puzzle: d.daily[index] };
    }
    /** Kết quả quiz hôm nay của mình (trên máy hoặc máy chủ), null nếu chưa giải */
    function dailyMine(game, day = today()) {
      const loc = localOf(game).daily[day];
      if (loc && !loc.revealed && loc.stars) return loc;
      const s = serverOf(game);
      if (s && s.daily && s.daily.day === day && s.daily.mine) return s.daily.mine;
      return null;
    }
    const dailyRevealed = (game, day = today()) => Boolean((localOf(game).daily[day] || {}).revealed);
    /** Ai đã giải quiz hôm nay: nhiều sao trước, nhanh hơn trước */
    function solvers(game, day = today()) {
      const s = serverOf(game);
      const list = s && s.daily && s.daily.day === day && Array.isArray(s.daily.solvers) ? s.daily.solvers.slice() : [];
      const mine = dailyMine(game, day);
      const uid = me();
      if (mine && uid != null && !list.some((x) => x.userId === uid)) {
        list.push({ userId: uid, ms: mine.ms, mistakes: mine.mistakes, hints: mine.hints, stars: mine.stars, at: mine.at || Date.now() });
      }
      const ms = (x) => (x.ms == null ? Infinity : x.ms);
      return list.sort((a, b) => b.stars - a.stars || ms(a) - ms(b) || (a.at || 0) - (b.at || 0));
    }

    /* =========================================================
       Hàng chờ gửi kết quả
       ========================================================= */
    const pendingAll = () => {
      const list = store.get(KEY_PENDING, []);
      return Array.isArray(list) ? list : [];
    };
    const pendingFor = (uid) => pendingAll().filter((x) => x && x.uid === uid);
    let seq = 0;
    function enqueue(item) {
      const list = pendingAll();
      list.push({ qid: `${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 7)}`, uid: me(), tries: 0, ...item });
      store.set(KEY_PENDING, list.slice(-300));
    }
    function dropPending(qid) {
      store.set(KEY_PENDING, pendingAll().filter((x) => x.qid !== qid));
    }
    function bumpTries(qid) {
      store.set(KEY_PENDING, pendingAll().map((x) => (x.qid === qid ? { ...x, tries: (x.tries || 0) + 1 } : x)));
    }

    /** Gửi hàng chờ lên máy chủ, theo đúng thứ tự. Trả về true nếu có thay đổi */
    function flush() {
      const uid = me();
      if (uid == null || !P) return Promise.resolve(false);
      if (S.flushing) {
        S.again = true;
        return S.flushing;
      }
      const g0 = S.gen;
      const run = (async () => {
        let changed = false;
        for (const item of pendingFor(uid)) {
          if (g0 !== S.gen || me() !== uid) break; // vừa đăng xuất / đổi người: để dành cho đúng người
          try {
            const res = await api(`/api/puzzles/${item.game}/${item.kind === 'daily' ? 'daily' : 'level'}`, { method: 'POST', body: item.body });
            if (g0 !== S.gen) break;
            dropPending(item.qid);
            setGameSummary(item.game, res && res.summary);
            changed = true;
          } catch (err) {
            const st = err && err.status;
            // Mất mạng, máy chủ lỗi, hết phiên đăng nhập, gửi nhiều quá: giữ lại cả hàng, lần sau gửi tiếp
            if (!st || st >= 500 || st === 401 || st === 403 || st === 429) break;
            // Màn chưa mở trên máy chủ (màn trước chưa gửi tới): thử lại sau vài lần
            if (st === 409 && item.kind !== 'daily' && (item.tries || 0) < 5) {
              bumpTries(item.qid);
              continue;
            }
            dropPending(item.qid); // lời giải sai, quiz của ngày đó đã đóng / đã đổi: bỏ
            changed = true;
          }
        }
        return changed;
      })();
      const p = run.finally(() => {
        if (S.flushing === p) S.flushing = null;
        if (S.again && g0 === S.gen) {
          S.again = false;
          flushSoon(200);
        }
      });
      S.flushing = p;
      return p.then((changed) => {
        if (changed && g0 === S.gen) refresh();
        return changed;
      });
    }
    function flushSoon(ms = 400) {
      clearTimeout(S.flushTimer);
      S.flushTimer = setTimeout(() => { flush().catch(() => {}); }, ms);
    }

    /** Tải bản tóm tắt của máy chủ (gửi hàng chờ trước) */
    function load() {
      const uid = me();
      if (uid == null || !P) return Promise.resolve(null);
      if (!S.summary) restoreSummary();
      if (S.loading) return S.loading;
      const g0 = S.gen;
      const p = (async () => {
        try {
          await flush().catch(() => false);
          const data = await api('/api/puzzles');
          if (g0 !== S.gen || me() !== uid) return;
          S.summary = { uid, today: data.today, games: data.games || {}, at: Date.now() };
          saveSummary();
          checkVersions();
        } catch { /* mất mạng: dùng bản lưu trên máy */ } finally {
          if (S.loading === p) S.loading = null;
        }
        if (g0 === S.gen) refresh();
      })();
      S.loading = p;
      return p;
    }

    /** Sự kiện realtime: có người vừa giải quiz hôm nay */
    function onDaily(evt) {
      if (!evt || !S.summary || S.summary.uid !== me() || evt.day !== today()) return;
      const g = S.summary.games && S.summary.games[evt.game];
      if (!g || !g.daily || g.daily.day !== evt.day || !Array.isArray(g.daily.solvers)) return;
      if (!g.daily.solvers.some((x) => x.userId === evt.userId)) {
        g.daily.solvers.push({ userId: evt.userId, ms: evt.ms, mistakes: evt.mistakes, hints: null, stars: evt.stars, at: Date.now() });
      }
      if (evt.userId === me() && !g.daily.mine) g.daily.mine = { ms: evt.ms, mistakes: evt.mistakes, hints: null, stars: evt.stars };
      saveSummary();
      refresh();
    }

    /* ---------------- Cập nhật mọi chỗ đang hiện ---------------- */
    function refresh() {
      for (const el of document.querySelectorAll('[data-pz-entry]')) fillEntry(el);
      for (const el of document.querySelectorAll('[data-pz-solvers]')) fillSolvers(el);
      if (V.target && V.target.kind === 'map' && V.boardOpen) drawMap(V.target.game, { keepScroll: true });
      if (V.run) updateHead(V.run);
      if (host.onChange) host.onChange();
    }

    /* =========================================================
       Mảnh giao diện dùng chung
       ========================================================= */
    function gameIcon(game, cls = '') {
      let glyph;
      if (game === 'chess') glyph = icon('knight');
      else if (game === 'caro') glyph = icon('caro');
      else glyph = h('span', { class: 'pz-gicon-blocks' }, [1, 3, 4, 6].map((c) => h('span', { class: `bb-block is-c${c}` })));
      return h('span', { class: `pz-gicon is-${game} ${cls}`.trim(), 'aria-hidden': 'true' }, glyph);
    }
    function starsEl(n, cls = '') {
      return h('span', { class: `pz-stars ${cls}`.trim(), 'aria-hidden': 'true' }, [1, 2, 3].map((k) => h('span', { class: k <= n ? 'is-on' : '' }, icon('star'))));
    }
    const go = (hash, after) => (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0) return;
      e.preventDefault();
      navigate(hash);
      if (after) after();
    };

    /* ---------------- Khung ở trang Trò chơi ---------------- */
    function panel() {
      if (!P || me() == null) return null;
      if (!GAMES.every((g) => S.data[g])) loadAllData();
      if (!S.summary) restoreSummary();
      const day = today();
      const rows = GAMES.map((game) => {
        const dp = dailyPuzzle(game, day);
        const mine = dailyMine(game, day);
        const revealed = !mine && dailyRevealed(game, day);
        const others = solvers(game, day).filter((x) => x.userId !== me()).length;
        let status;
        let label;
        if (mine) {
          status = [h('strong', { class: 'is-solved', text: `✓ ${fmtTime(mine.ms)}` }), starsEl(mine.stars)];
          label = `đã giải trong ${fmtTime(mine.ms)}, ${mine.stars} sao`;
        } else if (revealed) {
          status = [h('strong', { text: 'Đã xem lời giải' }), h('small', { text: others ? `${others} người đã giải` : 'Mai có câu mới' })];
          label = 'đã xem lời giải';
        } else {
          status = [h('strong', { class: 'is-todo', text: 'Chưa giải' }), h('small', { text: others ? `${others} người đã giải` : 'Chưa ai giải' })];
          label = `chưa giải, ${others} người đã giải`;
        }
        const name = P.NAMES[game];
        return h('li', {},
          h('a', {
            class: `pz-daily-row${mine ? ' is-done' : ''}`,
            href: `#/quiz/${game}`,
            onclick: go(`#/quiz/${game}`),
            'aria-label': `Quiz hôm nay ${name}: ${dp ? shortGoal(game, dp.puzzle) : ''}. ${label}`,
          },
          gameIcon(game),
          h('span', { class: 'pz-daily-main' }, h('strong', { text: name }), h('small', { text: dp ? shortGoal(game, dp.puzzle) : 'Đang tải…' })),
          h('span', { class: 'pz-daily-status' }, status)));
      });
      const quick = GAMES.map((game) => {
        const st = stats(game);
        const max = st.count * 3;
        return h('a', {
          class: `pz-quick-btn is-${game}`,
          href: `#/levels/${game}`,
          onclick: go(`#/levels/${game}`),
          'aria-label': `Thử thách nhanh ${P.NAMES[game]}: ${st.total} trên ${max} sao, ${st.solved} trên ${st.count} màn`,
        }, gameIcon(game, 'is-sm'), h('span', { text: st.count ? `★ ${st.total}/${max}` : '★ …' }));
      });
      return h('section', { class: 'pz-hub', 'aria-label': 'Quiz hôm nay và Thử thách nhanh' },
        h('div', { class: 'pz-hub-head' }, h('h3', { text: 'Quiz hôm nay' }), h('span', { text: dayLabel(day) })),
        h('ul', { class: 'pz-daily' }, rows),
        h('div', { class: 'pz-quick' },
          h('h3', { class: 'pz-quick-label', text: 'Thử thách nhanh' }),
          h('div', { class: 'pz-quick-row' }, quick)));
    }

    /* ---------------- Hai nút trong từng game ---------------- */
    function entry(game, opts = {}) {
      if (!P || me() == null) return null;
      const el = h('div', { class: `pz-entry${opts.dark ? ' is-dark' : ''}`, dataset: { pzEntry: game } });
      fillEntry(el);
      if (!S.data[game]) loadData(game).then(() => fillEntry(el), () => {});
      return el;
    }
    function fillEntry(el) {
      const game = el.dataset.pzEntry;
      if (!GAMES.includes(game)) return;
      const mine = dailyMine(game);
      const revealed = !mine && dailyRevealed(game);
      const st = stats(game);
      const name = P.NAMES[game];
      const dailySub = mine ? `✓ ${fmtTime(mine.ms)} · ${starText(mine.stars)}` : revealed ? 'Đã xem lời giải' : 'Chưa giải';
      el.replaceChildren(
        h('a', {
          class: `pz-entry-btn${mine ? ' is-done' : ''}`,
          href: `#/quiz/${game}`,
          onclick: go(`#/quiz/${game}`),
          'aria-label': `Quiz hôm nay ${name}: ${mine ? `đã giải, ${mine.stars} sao` : revealed ? 'đã xem lời giải' : 'chưa giải'}`,
        }, icon('calendar'), h('span', { class: 'pz-entry-text' }, h('strong', { text: 'Quiz hôm nay' }), h('small', { text: dailySub }))),
        h('a', {
          class: 'pz-entry-btn',
          href: `#/levels/${game}`,
          onclick: go(`#/levels/${game}`),
          'aria-label': `Thử thách nhanh ${name}: ${st.total} trên ${st.count * 3} sao`,
        }, icon('bolt'), h('span', { class: 'pz-entry-text' }, h('strong', { text: 'Thử thách nhanh' }), h('small', { text: st.count ? `★ ${st.total}/${st.count * 3} · ${st.solved}/${st.count} màn` : '…' }))));
    }

    /* =========================================================
       Điều hướng: app.js gọi mỗi khi đổi đường dẫn
       target: null | { kind: 'quiz' | 'map' | 'level', game, level }
       ========================================================= */
    const otherPaneOpen = () => ['#chat-pane', '#chess-pane', '#caro-pane', '#blocks-pane', '#farm-pane', '#profile-pane']
      .some((sel) => { const el = $(sel); return el && !el.hidden; });

    function route(target) {
      const key = target ? `${target.kind}/${target.game}/${target.level || ''}` : null;
      if (key === V.key) return;
      closeSheet(true);
      stopRun();
      V.key = key;
      V.target = target;
      V.boardOpen = false;
      const pane = $('#puzzle-pane');
      if (!pane) return;
      if (!target) {
        if (!pane.hidden) {
          pane.hidden = true;
          pane.replaceChildren();
          if (state.currentId == null && !otherPaneOpen()) {
            document.body.classList.remove('in-chat');
            $('#chat-empty').hidden = false;
          }
        }
        return;
      }
      document.body.classList.add('in-chat');
      $('#chat-empty').hidden = true;
      $('#chat-pane').hidden = true;
      pane.hidden = false;
      const token = ++V.token;
      const name = P ? P.NAMES[target.game] : '';
      pane.replaceChildren(head(target.kind === 'map' ? `Thử thách nhanh · ${name}` : target.kind === 'quiz' ? `Quiz hôm nay · ${name}` : `Màn ${target.level}`, ''),
        h('div', { class: 'pz-loading' }, h('span', { class: 'spinner' }), 'Đang tải…'));
      if (!S.summary) restoreSummary();
      if (!S.summary && !S.loading) load();
      const ready = [loadData(target.game)];
      if (target.game === 'chess' && target.kind !== 'map' && window.ThinkChess && window.ThinkChess.loadRules) ready.push(window.ThinkChess.loadRules());
      Promise.all(ready).then(([data, Chess]) => {
        if (token !== V.token) return;
        open(target, data, Chess);
      }, () => {
        if (token !== V.token) return;
        pane.replaceChildren(head('Câu đố', ''), h('div', { class: 'pz-empty' },
          h('p', { text: 'Không tải được câu đố. Kiểm tra mạng rồi thử lại.' }),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { V.key = null; route(target); }, text: 'Thử lại' })));
      });
    }

    function open(target, data, Chess) {
      const { game } = target;
      if (target.kind === 'map') {
        drawMap(game, { scrollToNext: true });
        return;
      }
      if (target.kind === 'level') {
        const n = target.level;
        const st = stats(game);
        if (!(n >= 1 && n <= data.levels.length)) {
          toast(`Không có màn ${n}.`);
          navigate(`#/levels/${game}`, { replace: true });
          return;
        }
        if (!isOpen(st.stars, n)) {
          toast(`Màn ${n} chưa mở: giải màn ${n - 1} trước nhé.`);
          navigate(`#/levels/${game}`, { replace: true });
          return;
        }
        startPuzzle({ game, kind: 'level', level: n, p: data.levels[n - 1], chapter: chapterOf(data, n), Chess });
        return;
      }
      const day = today();
      const dp = dailyPuzzle(game, day);
      if (!dp) {
        $('#puzzle-pane').replaceChildren(head(`Quiz hôm nay · ${P.NAMES[game]}`, ''), h('div', { class: 'pz-empty' }, h('p', { text: 'Hôm nay chưa có câu đố cho game này.' })));
        return;
      }
      startPuzzle({ game, kind: 'daily', day, p: dp.puzzle, Chess });
    }

    function chapterOf(data, n) {
      let from = 1;
      for (let i = 0; i < (data.chapters || []).length; i++) {
        const c = data.chapters[i];
        if (n < from + c.size) return { index: i, name: c.name, from, size: c.size };
        from += c.size;
      }
      return { index: 0, name: '', from: 1, size: data.levels.length };
    }

    // Nút Quay lại: về bước trước trong app; mở thẳng từ đường dẫn thì về bản đồ màn / trang Trò chơi
    function back() {
      const t = V.target;
      if (t && t.kind === 'level' && history.state && history.state.pzFrom === 'map') history.back();
      else if (history.state && history.state.depth > 0) goBack();
      else navigate(t && t.kind === 'level' ? `#/levels/${t.game}` : '#/games', { replace: true });
    }
    function toMap(game) {
      if (history.state && history.state.pzFrom === 'map') history.back();
      else navigate(`#/levels/${game}`, { replace: true });
    }
    function openLevel(game, n, { replace = false } = {}) {
      const fromMap = !replace || (history.state && history.state.pzFrom === 'map');
      navigate(`#/levels/${game}/${n}`, { replace });
      if (fromMap) history.replaceState({ ...(history.state || {}), pzFrom: 'map' }, '', location.hash);
    }

    function head(title, sub, extra) {
      return h('header', { class: 'chat-head pz-head' },
        h('button', { class: 'icon-btn pz-back', type: 'button', 'aria-label': 'Quay lại', onclick: back }, icon('back')),
        h('div', { class: 'chat-title' }, h('h2', { text: title }), sub ? h('p', { text: sub }) : null),
        extra || null);
    }

    /* =========================================================
       Bản đồ màn (Thử thách nhanh)
       ========================================================= */
    function drawMap(game, { scrollToNext = false, keepScroll = false } = {}) {
      const pane = $('#puzzle-pane');
      const data = S.data[game];
      if (!pane || !data) return;
      const st = stats(game);
      const name = P.NAMES[game];
      const max = st.count * 3;
      const prevScroll = keepScroll ? (pane.querySelector('.pz-scroll') || {}).scrollTop || 0 : 0;

      const hero = h('section', { class: `pz-maphero is-${game}` },
        h('div', { class: 'pz-maphero-top' },
          gameIcon(game, 'is-lg'),
          h('div', { class: 'pz-maphero-main' },
            h('span', { class: 'pz-maphero-label', text: 'Sao đã có' }),
            h('strong', { class: 'pz-maphero-stars' }, icon('star'), h('span', { text: String(st.total) }), h('small', { text: `/${max}` }))),
          h('div', { class: 'pz-maphero-side' }, h('strong', { text: `${st.solved}/${st.count}` }), h('span', { text: 'màn đã giải' }))),
        st.next
          ? h('button', { class: 'btn pz-maphero-go', type: 'button', onclick: () => openLevel(game, st.next) }, icon('play'), `Chơi màn ${st.next}`)
          : h('p', { class: 'pz-maphero-done', text: st.count ? 'Bạn đã giải hết các màn. Giỏi quá!' : '' }));

      const parts = [hero, boardSection(game)];
      let from = 0;
      const chapters = data.chapters && data.chapters.length ? data.chapters : [{ name: '', size: data.levels.length }];
      chapters.forEach((c, ci) => {
        const size = Math.max(0, Math.min(c.size, st.count - from));
        if (!size) return;
        const idx = Array.from({ length: size }, (_, k) => from + k);
        const done = idx.filter((i) => st.stars[i] > 0).length;
        parts.push(h('section', { class: 'pz-chapter', 'aria-label': `Chương ${ci + 1}${c.name ? `: ${c.name}` : ''}` },
          h('div', { class: 'pz-chapter-head' },
            h('h3', {}, h('span', { text: `Chương ${ci + 1}` }), c.name ? ` · ${c.name}` : ''),
            h('span', { class: done === size ? 'is-full' : '', text: `${done}/${size} màn` })),
          h('div', { class: 'pz-levels' }, idx.map((i) => levelBtn(game, st, i + 1)))));
        from += size;
      });
      // Màn thêm sau mà dữ liệu chưa xếp chương
      if (from < st.count) {
        const idx = Array.from({ length: st.count - from }, (_, k) => from + k);
        parts.push(h('section', { class: 'pz-chapter' },
          h('div', { class: 'pz-chapter-head' }, h('h3', { text: 'Màn mới' })),
          h('div', { class: 'pz-levels' }, idx.map((i) => levelBtn(game, st, i + 1)))));
      }
      const scroll = h('div', { class: 'pz-scroll' }, h('div', { class: 'pz-map' }, parts));
      pane.replaceChildren(head(`Thử thách nhanh · ${name}`, `★ ${st.total}/${max} · ${st.solved}/${st.count} màn`), scroll);
      V.boardOpen = true;
      if (keepScroll) scroll.scrollTop = prevScroll;
      else if (scrollToNext && st.next && st.next > 5) {
        const btn = scroll.querySelector('.pz-lv.is-next');
        if (btn) {
          const r = btn.getBoundingClientRect();
          const box = scroll.getBoundingClientRect();
          scroll.scrollTop = Math.max(0, r.top - box.top - box.height / 2 + r.height / 2);
        }
      }
    }

    function levelBtn(game, st, n) {
      const s = st.stars[n - 1];
      const open = isOpen(st.stars, n);
      const next = n === st.next;
      return h('button', {
        class: `pz-lv${s ? ' is-done' : ''}${next ? ' is-next' : ''}${open ? '' : ' is-locked'}`,
        type: 'button',
        disabled: !open,
        'aria-label': !open ? `Màn ${n}, chưa mở` : s ? `Màn ${n}, ${s} sao` : `Màn ${n}, chưa giải`,
        onclick: () => openLevel(game, n),
      },
      h('span', { class: 'pz-lv-no', text: String(n) }),
      open ? starsEl(s, 'is-mini') : h('span', { class: 'pz-lv-lock' }, icon('lock')));
    }

    let boardExpanded = false;
    function boardSection(game) {
      const s = serverOf(game);
      const rows = s && Array.isArray(s.board) ? s.board : null;
      const uid = me();
      let body;
      if (!rows) body = h('p', { class: 'pz-note', text: 'Chưa tải được bảng xếp hạng (mất mạng?).' });
      else if (!rows.length) body = h('p', { class: 'pz-note', text: 'Chưa ai giải màn nào. Mở màn đi!' });
      else {
        body = h('ol', { class: 'pz-rank' }, rows.slice(0, boardExpanded ? 10 : 3).map((r, i) => h('li', { class: r.userId === uid ? 'is-me' : '' },
          h('span', { class: `games-medal${i < 3 ? ` is-top${i + 1}` : ''}`, text: String(i + 1) }),
          avatarEl(userOf(r.userId), 'avatar-sm', { dot: false }),
          h('span', { class: 'pz-rank-name', text: `${nameOf(r.userId)}${r.userId === uid ? ' (bạn)' : ''}` }),
          h('span', { class: 'pz-rank-sub', text: `${r.solved} màn` }),
          h('strong', { class: 'pz-rank-stars', 'aria-label': `${r.stars} sao` }, icon('star'), String(r.stars)))));
      }
      return h('section', { class: 'pz-boardcard' },
        h('div', { class: 'pz-boardcard-head' },
          h('h3', { text: 'Bảng xếp hạng' }),
          rows && rows.length > 3
            ? h('button', {
                class: 'chess-more',
                type: 'button',
                'aria-expanded': boardExpanded ? 'true' : 'false',
                onclick: () => { boardExpanded = !boardExpanded; drawMap(game, { keepScroll: true }); },
                text: boardExpanded ? 'Thu gọn' : `Xem top ${Math.min(10, rows.length)}`,
              })
            : null),
        body);
    }

    /* =========================================================
       Màn câu đố
       ========================================================= */
    function stopRun() {
      const R = V.run;
      V.run = null;
      if (V.ro) V.ro.disconnect();
      V.ro = null;
      if (!R) return;
      for (const t of R.timers) clearTimeout(t);
      R.timers.clear();
      if (R.adapter && R.adapter.destroy) R.adapter.destroy();
    }
    /** Hẹn giờ gắn với màn đang mở (đóng màn là hủy) */
    function later(R, fn, ms) {
      const t = setTimeout(() => {
        R.timers.delete(t);
        if (V.run === R) fn();
      }, ms);
      R.timers.add(t);
    }

    function setStatus(R, text, kind = '') {
      R.status = { text, kind };
      const el = R.els && R.els.status;
      if (!el) return;
      el.className = `pz-status${kind ? ` is-${kind}` : ''}`;
      if (el.textContent !== text) el.textContent = text;
    }
    function flashStatus(R, text, kind) {
      const el = R.els && R.els.status;
      if (!el) return;
      el.className = `pz-status${kind ? ` is-${kind}` : ''}`;
      el.textContent = text;
    }
    const restoreStatus = (R) => setStatus(R, R.status.text, R.status.kind);
    function mistake(R, text) {
      R.mistakes++;
      setStatus(R, text, 'wrong');
      const el = R.els && R.els.status;
      if (el && !reducedMotion()) {
        el.classList.remove('is-shake');
        void el.offsetWidth;
        el.classList.add('is-shake');
      }
    }
    // Nước đầu tiên: tính là có chơi hôm nay (chuỗi hằng ngày; cờ vua do máy chủ ghi khi nhận lời giải)
    function firstMove(R) {
      if (R.moved) return;
      R.moved = true;
      const uid = me();
      if (!window.ThinkStreaks) return;
      if (R.game === 'blocks') window.ThinkStreaks.mark('blocks', uid);
      else if (R.game === 'caro') window.ThinkStreaks.mark('caro', uid);
    }

    function startPuzzle(cfg) {
      const pane = $('#puzzle-pane');
      const { game } = cfg;
      const R = {
        ...cfg,
        key: V.key,
        st: null,
        t0: Date.now(),
        mistakes: 0,
        hints: 0,
        hintLevel: 0,
        done: false,
        busy: false,
        revealed: false,
        moved: false,
        lostCounted: false,
        result: null,
        status: { text: '', kind: '' },
        timers: new Set(),
        els: {},
      };
      if (cfg.kind === 'daily') {
        const mine = dailyMine(game, cfg.day);
        if (mine) {
          R.done = true;
          R.already = true;
          R.result = { ms: mine.ms, stars: mine.stars, mistakes: mine.mistakes, hints: mine.hints };
        } else if (dailyRevealed(game, cfg.day)) {
          R.done = true;
          R.revealed = true;
          R.already = true;
        }
      }
      R.st = game === 'chess' ? P.chessStart(cfg.p) : game === 'blocks' ? P.blocksStart(cfg.p) : P.caroStart(cfg.p);
      let adapter;
      try {
        adapter = game === 'chess' ? chessAdapter(R, cfg.Chess) : game === 'blocks' ? blocksAdapter(R) : caroAdapter(R);
      } catch {
        adapter = null;
      }
      if (!adapter) {
        pane.replaceChildren(head(titleOf(R), ''), h('div', { class: 'pz-empty' },
          h('p', { text: 'Trang vừa được cập nhật. Tải lại trang để chơi câu đố này nhé.' }),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload(), text: 'Tải lại' })));
        return;
      }
      R.adapter = adapter;
      V.run = R;

      const E = R.els;
      E.title = h('h2', { text: titleOf(R) });
      E.sub = h('p', { text: subOf(R) });
      E.sound = h('button', { class: 'icon-btn', type: 'button', onclick: () => { adapter.setSound(!adapter.soundOn()); drawSound(R); } });
      E.status = h('p', { class: 'pz-status', role: 'status', 'aria-live': 'polite' });
      E.goal = h('div', { class: `pz-goal is-${game}` }, goalBadge(R), h('span', { text: P.goalText(game, cfg.p) }));
      E.board = h('div', { class: `pz-board is-${game}` }, adapter.el);
      E.actions = h('div', { class: 'pz-actions' });
      E.more = h('div', { class: 'pz-more' });
      E.done = h('div', { class: 'pz-donebox' });
      E.game = h('div', { class: `pz-game is-${game}` }, E.goal, E.board, E.status, E.done, E.actions, E.more);
      const scroll = h('div', { class: 'pz-scroll' }, E.game);
      pane.replaceChildren(
        h('header', { class: 'chat-head pz-head' },
          h('button', { class: 'icon-btn pz-back', type: 'button', 'aria-label': 'Quay lại', onclick: back }, icon('back')),
          h('div', { class: 'chat-title' }, E.title, E.sub),
          E.sound),
        scroll);
      E.scroll = scroll;
      drawSound(R);
      if (R.done) {
        adapter.showFinal();
        setStatus(R, R.revealed ? 'Bạn đã xem lời giải hôm nay. Mai có câu mới nhé!' : 'Đã giải xong — mai có câu đố mới nhé!', R.revealed ? 'info' : 'done');
      } else {
        adapter.start();
        setStatus(R, 'Đến lượt bạn', 'turn');
      }
      drawButtons(R);
      if (adapter.fit) {
        const fit = () => {
          if (V.run !== R) return;
          const used = E.goal.offsetHeight + E.status.offsetHeight + E.actions.offsetHeight + E.more.offsetHeight + (E.done.offsetHeight || 0) + 70;
          adapter.fit(E.board.clientWidth, Math.max(300, scroll.clientHeight - used));
        };
        V.ro = new ResizeObserver(fit);
        V.ro.observe(scroll);
        fit();
      }
      R.t0 = Date.now(); // tính giờ từ lúc màn câu đố hiện ra (không hiện đồng hồ chạy trên màn hình)
    }

    function titleOf(R) {
      return R.kind === 'daily' ? `Quiz hôm nay · ${P.NAMES[R.game]}` : `Màn ${R.level}`;
    }
    function subOf(R) {
      if (R.kind === 'daily') {
        const n = solvers(R.game, R.day).length;
        return `${dayLabel(R.day)} · ${n ? `${n} người đã giải` : 'chưa ai giải'}`;
      }
      return `${P.NAMES[R.game]}${R.chapter && R.chapter.name ? ` · ${R.chapter.name}` : ''}`;
    }
    function updateHead(R) {
      if (!R.els.sub) return;
      const text = subOf(R);
      if (R.els.sub.textContent !== text) R.els.sub.textContent = text;
    }
    function drawSound(R) {
      const on = R.adapter.soundOn();
      R.els.sound.replaceChildren(icon(on ? 'volume' : 'volume-off'));
      R.els.sound.setAttribute('aria-label', on ? 'Tắt âm thanh' : 'Bật âm thanh');
      R.els.sound.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    function goalBadge(R) {
      if (R.game === 'chess') {
        const side = P.chessSide(R.p);
        return h('span', { class: `pz-side is-${side}`, 'aria-hidden': 'true' });
      }
      if (R.game === 'caro') return h('span', { class: 'pz-side is-x', 'aria-hidden': 'true' }, window.ThinkCaro && window.ThinkCaro.markSvg ? window.ThinkCaro.markSvg('x') : 'X');
      return gameIcon('blocks', 'is-sm');
    }

    // Nút dưới bàn: đang giải (Gợi ý / Làm lại), đã xong (Màn tiếp / Về bản đồ / kết quả)
    function drawButtons(R) {
      const E = R.els;
      const btn = (label, ic, onclick, cls = '', focus = '') => h('button', { class: `btn ${cls}`.trim(), type: 'button', dataset: focus ? { focus } : undefined, onclick }, ic ? icon(ic) : null, label);
      const focusKey = E.game.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
      const actions = [];
      const more = [];
      if (!R.done) {
        actions.push(btn('Gợi ý', 'bulb', () => doHint(R), '', 'hint'));
        actions.push(btn('Làm lại', 'replay', () => doRestart(R), '', 'restart'));
        more.push(h('button', { class: 'pz-link', type: 'button', dataset: { focus: 'solution' }, onclick: () => showSolution(R), text: 'Xem lời giải' }));
      } else if (R.kind === 'level') {
        const count = levelCount(R.game);
        if (R.result && R.level < count) actions.push(btn(`Màn tiếp`, 'play', () => openLevel(R.game, R.level + 1, { replace: true }), 'btn-primary', 'next'));
        actions.push(btn('Về bản đồ', 'grid', () => toMap(R.game), R.result && R.level < count ? '' : 'btn-primary', 'map'));
        if (!R.result) actions.unshift(btn('Làm lại', 'replay', () => doRestart(R, 'retry'), 'btn-primary', 'restart'));
        else more.push(h('button', { class: 'pz-link', type: 'button', dataset: { focus: 'again' }, onclick: () => doRestart(R, 'fresh'), text: 'Giải lại màn này' }));
      } else {
        if (!R.already && R.result) actions.push(btn('Xem kết quả', 'leaderboard', () => showResult(R), 'btn-primary', 'result'));
        actions.push(btn('Thử thách nhanh', 'bolt', () => navigate(`#/levels/${R.game}`, { replace: true }), R.already || !R.result ? 'btn-primary' : '', 'levels'));
        if (R.already) more.push(h('button', { class: 'pz-link', type: 'button', dataset: { focus: 'solution' }, onclick: () => showSolution(R), text: 'Xem lại lời giải' }));
      }
      E.actions.replaceChildren(...actions);
      E.actions.classList.toggle('is-one', actions.length === 1);
      E.more.replaceChildren(...more);
      drawDone(R);
      if (focusKey) {
        const again = E.game.querySelector(`[data-focus="${focusKey}"]`);
        if (again) again.focus({ preventScroll: true });
      }
    }
    // Đã xong: thẻ kết quả ngay trên trang (và danh sách ai đã giải với quiz hôm nay)
    function drawDone(R) {
      const box = R.els.done;
      if (!R.done || (!R.result && !(R.kind === 'daily' && R.revealed))) {
        box.replaceChildren();
        box.hidden = true;
        return;
      }
      box.hidden = false;
      const parts = [];
      if (R.result) {
        const r = R.result;
        parts.push(h('div', { class: 'pz-donecard' },
          starsEl(r.stars, 'is-big'),
          h('div', { class: 'pz-donecard-main' },
            h('strong', { text: R.kind === 'daily' ? 'Bạn đã giải quiz hôm nay' : `Giải xong màn ${R.level}` }),
            h('span', { text: resultLine(r) }))));
      }
      if (R.kind === 'daily') parts.push(solversBox(R.game, R.day));
      box.replaceChildren(...parts);
    }
    function resultLine(r) {
      const bits = [fmtTime(r.ms)];
      bits.push(r.mistakes ? `${r.mistakes} lần sai` : 'không sai lần nào');
      if (r.hints != null) bits.push(r.hints ? `${r.hints} gợi ý` : 'không gợi ý');
      return bits.join(' · ');
    }

    function doHint(R) {
      if (R.done || R.busy) return;
      R.adapter.hint();
    }
    // mode: '' = Làm lại khi đang giải (đồng hồ chạy tiếp); 'retry' = tự giải sau khi xem lời giải (giữ số lần sai, gợi ý);
    // 'fresh' = giải lại màn đã giải xong (lần giải mới, đếm lại từ đầu)
    function doRestart(R, mode = '') {
      for (const t of R.timers) clearTimeout(t);
      R.timers.clear();
      R.busy = false;
      if (mode) Object.assign(R, { done: false, revealed: false, already: false, result: null, hintLevel: 0, lostCounted: false });
      if (mode === 'fresh') Object.assign(R, { mistakes: 0, hints: 0, t0: Date.now() });
      // Tự giải sau khi xem lời giải: tính như đã dùng 3 gợi ý (tối đa 1 sao), giống App
      if (mode === 'retry') R.hints = Math.max(R.hints, 3);
      R.adapter.restart(!mode);
      setStatus(R, 'Đến lượt bạn', 'turn');
      drawButtons(R);
    }

    function showSolution(R) {
      if (R.busy && !R.done) return;
      if (!R.done) {
        const q = R.kind === 'daily'
          ? 'Xem lời giải? Hôm nay bạn sẽ không giải quiz này được nữa (vẫn xem được ai đã giải).'
          : 'Xem lời giải? Lần này không được tính; tự giải lại sau đó chỉ được 1 sao.';
        if (!window.confirm(q)) return;
        R.done = true;
        R.revealed = true;
        if (R.kind === 'daily') saveLocal(R.game, (g) => { g.daily[R.day] = { id: R.p.id, revealed: true, at: Date.now() }; });
        refresh();
      }
      for (const t of R.timers) clearTimeout(t);
      R.timers.clear();
      R.busy = true;
      setStatus(R, 'Lời giải đang chạy…', 'info');
      R.els.actions.replaceChildren();
      R.els.more.replaceChildren();
      R.adapter.solution(() => {
        R.busy = false;
        setStatus(R, R.kind === 'daily' && !R.result ? 'Đó là lời giải. Mai có câu mới nhé!' : R.result ? 'Đó là lời giải' : 'Đó là lời giải. Bấm Làm lại để tự giải.', 'info');
        drawButtons(R);
      });
    }

    /** Giải xong: lưu trên máy, đưa vào hàng chờ, gửi lên máy chủ, hiện kết quả */
    function solved(R) {
      if (R.done) return;
      R.done = true;
      const ms = Date.now() - R.t0;
      const stars = P.stars(R.mistakes, R.hints);
      const moves = R.adapter.moves();
      const at = Date.now();
      R.result = { ms, stars, mistakes: R.mistakes, hints: R.hints };
      if (R.kind === 'level') {
        saveLocal(R.game, (g) => { g.lv[R.level] = Math.max(Number(g.lv[R.level]) || 0, stars); });
        enqueue({ game: R.game, kind: 'level', body: { level: R.level, moves, mistakes: R.mistakes, hints: R.hints, ms, playedAt: at } });
      } else {
        saveLocal(R.game, (g) => { g.daily[R.day] = { id: R.p.id, ms, mistakes: R.mistakes, hints: R.hints, stars, at }; });
        enqueue({ game: R.game, kind: 'daily', body: { day: R.day, id: R.p.id, moves, mistakes: R.mistakes, hints: R.hints, ms, playedAt: at } });
      }
      setStatus(R, 'Giải xong!', 'done');
      drawButtons(R);
      R.adapter.win();
      refresh();
      flush().catch(() => {});
      later(R, () => showResult(R), 750);
    }

    /* ---------------- Bảng kết quả ---------------- */
    function ensureLayer() {
      if (V.layer) return V.layer;
      V.layer = h('div', { class: 'sheet-layer pz-layer', hidden: true },
        h('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }),
        h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }));
      V.layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
      document.body.append(V.layer);
      return V.layer;
    }
    function openSheet(title, body, foot) {
      const l = ensureLayer();
      const sheet = l.querySelector('.sheet');
      sheet.setAttribute('aria-label', title);
      sheet.replaceChildren(
        h('header', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onclick: () => closeSheet() }, icon('close'))),
        h('div', { class: 'sheet-body' }, body),
        ...(foot ? [h('div', { class: 'sheet-foot' }, foot)] : []));
      clearTimeout(V.sheetTimer);
      if (l.hidden) {
        l.hidden = false;
        void l.offsetWidth;
      }
      l.classList.add('open');
      sheet.focus({ preventScroll: true });
    }
    function closeSheet(now) {
      const l = V.layer;
      if (!l || l.hidden) return;
      l.classList.remove('open');
      clearTimeout(V.sheetTimer);
      if (now) l.hidden = true;
      else V.sheetTimer = setTimeout(() => { if (!l.classList.contains('open')) l.hidden = true; }, 220);
    }

    function showResult(R) {
      if (V.run !== R || !R.result) return;
      const r = R.result;
      const words = r.stars === 3 ? 'Xuất sắc!' : r.stars === 2 ? 'Tốt lắm!' : 'Giải được rồi!';
      const confetti = h('div', { class: 'pz-confetti', 'aria-hidden': 'true' });
      if (!reducedMotion()) {
        const colors = ['#F2B01E', '#0E7C66', '#4F7DFF', '#FF5A63', '#35D07F', '#A56BFF'];
        for (let k = 0; k < 18; k++) {
          confetti.append(h('span', { style: `left:${(3 + Math.random() * 94).toFixed(1)}%;background:${colors[k % colors.length]};--d:${(Math.random() * 0.4).toFixed(2)}s;--t:${(1.1 + Math.random() * 0.7).toFixed(2)}s;--r:${Math.round(Math.random() * 540 - 270)}deg` }));
        }
      }
      const queued = pendingFor(me()).some((x) => x.game === R.game && (R.kind === 'daily' ? x.kind === 'daily' && x.body.day === R.day : x.body.level === R.level));
      const body = [
        h('div', { class: 'pz-result' },
          confetti,
          h('div', { class: `pz-bigstars is-${r.stars}`, role: 'img', 'aria-label': `${r.stars} trên 3 sao` }, [1, 2, 3].map((k) => h('span', { class: k <= r.stars ? 'is-on' : '', style: `--k:${k}` }, icon('star')))),
          h('h3', { text: words }),
          h('p', { class: 'pz-result-line', text: resultLine(r) }),
          r.stars < 3 ? h('p', { class: 'pz-note', text: 'Không sai, không gợi ý thì được 3 sao.' }) : null),
        R.kind === 'daily' ? solversBox(R.game, R.day) : null,
        queued ? h('p', { class: 'pz-note pz-queued' }, icon('wifi-off'), 'Đã lưu trên máy. Kết quả sẽ tự gửi lên khi có mạng.') : null,
      ];
      const foot = [];
      if (R.kind === 'level') {
        const count = levelCount(R.game);
        if (R.level < count) foot.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { closeSheet(true); openLevel(R.game, R.level + 1, { replace: true }); } }, icon('play'), 'Màn tiếp'));
        foot.push(h('button', { class: `btn${R.level < count ? '' : ' btn-primary'}`, type: 'button', onclick: () => { closeSheet(true); toMap(R.game); } }, icon('grid'), 'Về bản đồ'));
      } else {
        foot.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { closeSheet(true); back(); }, text: 'Xong' }));
      }
      openSheet(R.kind === 'daily' ? `Quiz hôm nay · ${P.NAMES[R.game]}` : `Màn ${R.level}`, body, h('div', { class: `pz-sheet-actions${foot.length === 1 ? ' is-one' : ''}` }, foot));
    }

    /* ---------------- Danh sách ai đã giải hôm nay ---------------- */
    function solversBox(game, day) {
      const el = h('section', { class: 'pz-solvers', dataset: { pzSolvers: `${game}|${day}` } });
      fillSolvers(el);
      return el;
    }
    function fillSolvers(el) {
      const [game, day] = el.dataset.pzSolvers.split('|');
      const list = solvers(game, day);
      const uid = me();
      el.replaceChildren(
        h('h4', { text: `Ai đã giải hôm nay${list.length ? ` (${list.length})` : ''}` }),
        list.length
          ? h('ol', {}, list.map((x, i) => h('li', { class: x.userId === uid ? 'is-me' : '' },
              h('span', { class: `games-medal${i < 3 ? ` is-top${i + 1}` : ''}`, text: String(i + 1) }),
              avatarEl(userOf(x.userId), 'avatar-sm', { dot: false }),
              h('span', { class: 'pz-solver-name', text: `${nameOf(x.userId)}${x.userId === uid ? ' (bạn)' : ''}` }),
              h('span', { class: 'pz-solver-stars', 'aria-label': `${x.stars} sao` }, starText(x.stars)),
              h('span', { class: 'pz-solver-time', text: fmtTime(x.ms) }))))
          : h('p', { class: 'pz-note', text: 'Chưa ai giải. Bạn sẽ là người đầu tiên!' }));
    }

    /* =========================================================
       Bàn cờ vua (dùng bàn của chess-ui.js)
       ========================================================= */
    function chessAdapter(R, Chess) {
      if (!host.chess || !host.chess.puzzleBoard || !Chess) return null;
      const side = P.chessSide(R.p);
      const view = { fen: R.p.fen, lastMove: R.p.last || null, marks: null, hint: null, arrow: null };
      const B = host.chess.puzzleBoard({ root: '#puzzle-pane', onMove: (uci) => tryMove(uci) });
      const apply = (fen, uci) => {
        try {
          const c = new Chess(fen);
          c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
          return c.fen();
        } catch {
          return null;
        }
      };
      function draw() {
        const marks = { ...(view.marks || {}) };
        if (view.hint) marks[view.hint] = 'is-hint';
        B.set({ fen: view.fen, orientation: side, movable: R.done || R.busy ? null : side, lastMove: view.lastMove, arrow: view.arrow, animKey: `pz:${R.key}`, marks });
      }
      function clearHint() {
        view.hint = null;
        view.arrow = null;
        R.hintLevel = 0;
      }
      function tryMove(uci) {
        if (R.done || R.busy) return;
        const before = R.st.fen;
        const res = P.chessTry(R.p, R.st, uci, Chess);
        if (res.illegal) {
          B.sound('illegal');
          draw();
          return;
        }
        firstMove(R);
        if (!res.ok) {
          // Nước sai: hiện nước vừa đi một chút (ô đỏ) rồi quân trượt về chỗ cũ
          mistake(R, 'Chưa phải nước hay nhất — thử lại');
          B.moveSound(before, uci, true);
          const wrongFen = apply(before, uci);
          if (!wrongFen) {
            draw();
            return;
          }
          const last = view.lastMove;
          R.busy = true;
          Object.assign(view, { fen: wrongFen, lastMove: uci, marks: { [uci.slice(2, 4)]: 'is-wrong' } });
          draw();
          later(R, () => {
            R.busy = false;
            Object.assign(view, { fen: R.st.fen, lastMove: last, marks: null });
            draw();
          }, 700);
          return;
        }
        clearHint();
        B.moveSound(before, res.played, true);
        R.st = res.state;
        Object.assign(view, { fen: res.midFen, lastMove: res.played, marks: null });
        if (res.reply) {
          // Máy đáp lại sau một nhịp (quân trượt)
          R.busy = true;
          draw();
          setStatus(R, 'Đúng rồi! Tiếp tục…', 'ok');
          later(R, () => {
            R.busy = false;
            B.moveSound(res.midFen, res.reply, false);
            Object.assign(view, { fen: R.st.fen, lastMove: res.reply });
            draw();
            if (R.st.done) solved(R);
          }, 550);
          return;
        }
        draw();
        if (res.done) solved(R);
        else setStatus(R, 'Đúng rồi! Tiếp tục…', 'ok');
      }
      const finalFen = () => R.p.moves.reduce((fen, m) => apply(fen, m) || fen, R.p.fen);
      return {
        el: B.el,
        start: draw,
        showFinal() {
          Object.assign(view, { fen: finalFen(), lastMove: R.p.moves[R.p.moves.length - 1], marks: null });
          draw();
        },
        hint() {
          const lvl = Math.min(2, R.hintLevel + 1);
          if (lvl > R.hintLevel) {
            R.hintLevel = lvl;
            R.hints++;
          }
          const mv = P.chessHint(R.p, R.st, lvl);
          if (!mv) return;
          if (lvl === 1) {
            Object.assign(view, { hint: mv, arrow: null });
            setStatus(R, 'Gợi ý: đi quân ở ô sáng vàng', 'info');
          } else {
            let san = mv;
            try {
              san = new Chess(R.st.fen).move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] || undefined }).san;
            } catch { /* giữ dạng e2e4 */ }
            Object.assign(view, { hint: mv.slice(0, 2), arrow: mv });
            setStatus(R, `Gợi ý: đi ${san} (theo mũi tên)`, 'info');
          }
          draw();
        },
        restart() {
          R.st = P.chessStart(R.p);
          clearHint();
          Object.assign(view, { fen: R.p.fen, lastMove: R.p.last || null, marks: null });
          draw();
        },
        solution(done) {
          R.st = P.chessStart(R.p);
          clearHint();
          Object.assign(view, { fen: R.p.fen, lastMove: R.p.last || null, marks: null });
          draw();
          let i = 0;
          const step = () => {
            if (i >= R.p.moves.length) {
              done();
              draw();
              return;
            }
            const uci = R.p.moves[i];
            const next = apply(view.fen, uci);
            if (!next) {
              done();
              return;
            }
            B.moveSound(view.fen, uci, i % 2 === 0);
            Object.assign(view, { fen: next, lastMove: uci });
            draw();
            i++;
            later(R, step, 950);
          };
          later(R, step, 600);
        },
        win: () => later(R, () => B.sound('end'), 300),
        moves: () => R.st.history.filter((_, i) => i % 2 === 0),
        soundOn: B.soundOn,
        setSound: B.setSound,
        destroy() {},
      };
    }

    /* =========================================================
       Bàn cờ caro (dùng bàn của caro-ui.js)
       ========================================================= */
    function caroAdapter(R) {
      const C = window.CaroCore;
      if (!host.caro || !host.caro.puzzleBoard || !C) return null;
      let line = null;
      let hintAt = null;
      const B = host.caro.puzzleBoard({
        label: 'Bàn cờ caro 15 × 15, câu đố: bạn cầm X',
        side: () => 'x',
        place: (i) => tryMove(i),
        invalid: (i, why) => {
          if (R.done) return;
          B.play('invalid', 0.6);
          if (why === 'turn' && R.busy) flashStatus(R, 'Chờ đối thủ chặn một chút…', 'info');
        },
        onGhost: (i) => {
          if (i == null) restoreStatus(R);
          else flashStatus(R, `Chạm lần nữa vào ${C.cellName(i)} để đánh`, 'info');
        },
      });
      function draw(animate = true) {
        B.set({ board: R.st.board, last: R.st.last == null ? -1 : R.st.last, line, winner: line ? 'x' : null, playable: !R.done && !R.busy, animate });
      }
      function setHint(i) {
        hintAt = i;
        B.hint(i);
      }
      function tryMove(i) {
        if (R.done || R.busy) return;
        const res = P.caroTry(R.p, R.st, i);
        if (!res.ok && res.reason === 'taken') {
          B.play('invalid', 0.6);
          B.shake(i);
          return;
        }
        firstMove(R);
        if (!res.ok) {
          // Nước sai: hiện X một chút rồi bỏ đi
          B.play('invalid', 0.6);
          mistake(R, res.reason === 'not-four' ? 'Nước này chưa tạo tứ — đối thủ không phải chặn' : 'Có tứ nhưng chưa thắng được — thử nước khác');
          R.busy = true;
          const tmp = R.st.board.slice();
          tmp[i] = C.X;
          B.set({ board: tmp, last: -1, playable: false });
          B.shake(i);
          later(R, () => {
            R.busy = false;
            draw(false);
            if (hintAt != null) B.hint(hintAt);
          }, 750);
          return;
        }
        setHint(null);
        B.play('place-x', 0.9);
        if (res.won) {
          R.st = res.state;
          line = C.winLine(R.st.board, i, 'free');
          draw();
          B.celebrate('x');
          solved(R);
          return;
        }
        // Tạo tứ: đối thủ (máy) chặn sau một nhịp
        B.play('threat', 0.8, 150);
        R.busy = true;
        const mid = R.st.board.slice();
        mid[i] = C.X;
        B.set({ board: mid, last: i, playable: false });
        setStatus(R, 'Đúng rồi! Tiếp tục…', 'ok');
        later(R, () => {
          R.st = res.state;
          R.busy = false;
          B.play('place-o', 0.9);
          draw();
        }, 500);
      }
      function finalBoard() {
        const board = R.st.board.slice();
        R.p.moves.forEach((m, k) => { board[m] = k % 2 === 0 ? C.X : C.O; });
        const lastX = R.p.moves[R.p.moves.length - 1];
        return { board, lastX };
      }
      return {
        el: B.el,
        start: () => draw(false),
        showFinal() {
          R.st = P.caroStart(R.p);
          const { board, lastX } = finalBoard();
          line = C.winLine(board, lastX, 'free');
          B.set({ board, last: lastX, line, winner: 'x', playable: false, animate: false });
        },
        hint() {
          const c = P.caroHint(R.p, R.st);
          if (c == null) {
            setStatus(R, 'Bạn đã đi khác lời giải — bấm Làm lại để xem gợi ý', 'info');
            return;
          }
          if (hintAt !== c) R.hints++; // bấm lại đúng gợi ý cũ thì không tính thêm (giống App)
          setHint(c);
          setStatus(R, `Gợi ý: đánh vào ô sáng (${C.cellName(c)})`, 'info');
        },
        restart() {
          R.st = P.caroStart(R.p);
          line = null;
          setHint(null);
          B.clearGhost();
          draw(false);
        },
        solution(done) {
          R.st = P.caroStart(R.p);
          line = null;
          setHint(null);
          B.clearGhost();
          draw(false);
          const board = R.st.board.slice();
          let k = 0;
          const step = () => {
            if (k >= R.p.moves.length) {
              done();
              return;
            }
            const m = R.p.moves[k];
            const x = k % 2 === 0;
            board[m] = x ? C.X : C.O;
            if (x && k === R.p.moves.length - 1) line = C.winLine(board, m, 'free');
            B.set({ board: board.slice(), last: m, line, winner: line ? 'x' : null, playable: false });
            B.play(x ? 'place-x' : 'place-o', 0.9);
            k++;
            later(R, step, x ? 550 : 800);
          };
          later(R, step, 500);
        },
        win: () => B.play('win', 0.9, 280),
        moves: () => R.st.xs.slice(),
        soundOn: B.soundOn,
        setSound: B.setSound,
        destroy() {},
      };
    }

    /* =========================================================
       Bàn Xếp Khối (dùng bàn + khay của blocks.js)
       ========================================================= */
    function blocksAdapter(R) {
      const TB = window.ThinkBlocks;
      const BC = window.BlocksCore;
      if (!TB || typeof TB.puzzleBoard !== 'function' || !BC) return null; // blocks.js cũ (đang lưu trên máy) chưa có bàn câu đố
      const N = BC.SIZE;
      const B = TB.puzzleBoard({
        get: () => (R.st ? { board: R.st.board, tray: R.st.tray, over: R.done || R.busy || R.st.won || R.st.lost } : null),
        commit: (slot, r, c) => place(slot, r, c),
        label: 'Bàn câu đố 8 × 8: đặt hết các khối để dọn sạch bàn. Chọn khối bằng phím 1, 2, 3; di chuyển bằng phím mũi tên; Enter để đặt.',
      });
      const leftText = () => {
        const left = R.p.pieces.length - R.st.used;
        return `Còn ${left} khối`;
      };
      function effects(res) {
        B.play('place', 0.9);
        if (res.lines) B.play(res.lines >= 3 ? 'clear3' : res.lines === 2 ? 'clear2' : 'clear1', 0.8);
        B.renderBoard({ placed: res.placed });
        B.renderTray({ refilled: res.refilled });
        const center = B.centerOf(res.placed);
        if (res.clearedCells.length) B.burst(res.clearedCells, center);
        const words = res.won ? 'Sạch bàn!' : BC.praise(res.lines, 0);
        if (words) B.banner(words, res.won ? 'is-gold' : res.lines >= 4 ? 'is-hot' : '');
      }
      function place(slot, r, c) {
        if (R.done || R.busy) return;
        const res = P.blocksPlace(R.p, R.st, slot, r, c);
        if (!res) {
          B.play('invalid', 0.5);
          B.renderTray();
          return;
        }
        firstMove(R);
        R.st = res.state;
        B.setHint(null);
        effects(res);
        if (res.won) {
          later(R, () => B.play('allclear', 0.9), 260);
          solved(R);
        } else if (res.lost) {
          R.lostCounted = true;
          mistake(R, 'Chưa dọn sạch bàn — bấm Làm lại');
          later(R, () => B.play('gameover', 0.6), 450);
          drawButtons(R);
        } else setStatus(R, leftText(), 'ok');
      }
      return {
        el: B.el,
        fit: (w, h) => B.layout(w, h),
        start: () => B.render({ refilled: true }),
        showFinal() {
          R.st = P.blocksStart(R.p);
          B.render();
        },
        hint() {
          const hn = P.blocksHint(R.p, R.st);
          if (!hn) {
            setStatus(R, 'Hãy bấm Làm lại để gợi ý tiếp', 'info');
            return;
          }
          // Bấm lại đúng gợi ý cũ thì không tính thêm (giống App)
          const key = `${R.st.history.length}:${hn.slot}:${hn.r}:${hn.c}`;
          if (R.blocksHintKey !== key) R.hints++;
          R.blocksHintKey = key;
          const piece = R.st.tray[hn.slot];
          const s = BC.shapeOf(piece.shape);
          B.clearSelection();
          B.setHint({ slot: hn.slot, color: piece.color, cells: s.cells.map(([dr, dc]) => (hn.r + dr) * N + hn.c + dc) });
          setStatus(R, 'Gợi ý: đặt khối sáng vào chỗ sáng trên bàn', 'info');
        },
        restart(counts) {
          // Làm lại sau khi đã đặt khối = một lần sai (thua rồi bấm Làm lại thì chỉ tính một lần)
          if (counts && R.st.history.length && !R.lostCounted) R.mistakes++;
          R.lostCounted = false;
          R.blocksHintKey = null;
          R.st = P.blocksStart(R.p);
          B.clearSelection();
          B.setHint(null);
          B.render({ refilled: true });
        },
        solution(done) {
          R.st = P.blocksStart(R.p);
          B.clearSelection();
          B.setHint(null);
          B.render({ refilled: true });
          let k = 0;
          const step = () => {
            const m = R.p.sol[k];
            if (!m) {
              done();
              return;
            }
            const slot = R.st.tray.findIndex((x) => x && x.k === m[0]);
            const res = slot < 0 ? null : P.blocksPlace(R.p, R.st, slot, m[1], m[2]);
            if (!res) {
              done();
              return;
            }
            R.st = res.state;
            effects(res);
            k++;
            later(R, step, res.lines ? 1000 : 750);
          };
          later(R, step, 600);
        },
        win: () => {},
        moves: () => R.st.history.map((m) => m.slice()),
        soundOn: B.soundOn,
        setSound: B.setSound,
        destroy: B.destroy,
      };
    }

    /* ---------------- Đăng xuất ---------------- */
    function reset() {
      S.gen++;
      S.summary = null;
      S.loading = null;
      S.flushing = null;
      S.again = false;
      clearTimeout(S.flushTimer);
      route(null);
      if (V.layer) V.layer.hidden = true;
    }

    window.addEventListener('online', () => flushSoon(800));
    // Mở lại app sang ngày mới: tải quiz của hôm nay
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && me() != null && S.summary && S.summary.today !== today()) load();
    });

    inst = { panel, entry, route, load, flush, onDaily, reset, refresh, get summary() { return S.summary; } };
    return inst;
  }

  return {
    create,
    fmtTime,
    get instance() {
      return inst;
    },
  };
})();
