'use strict';
/* Mục "Trò chơi" của bản web: trang chọn game (Cờ vua, Cờ caro, Xếp Khối) + mở game Xếp Khối ở cột phải
   (toàn màn hình trên điện thoại). Cờ vua do public/chess-ui.js lo; Cờ caro do public/caro-ui.js; Xếp Khối do public/blocks.js.
   Đường dẫn: #/games (chọn game) · #/chess (cờ vua) · #/chess/g/12 (một ván cờ) · #/caro (cờ caro) · #/blocks (Xếp Khối) */
window.ThinkGames = (() => {
  function create(host) {
    const { h, icon, api, state, navigate, goBack, toast, chess, caro, nameOf, userOf, avatarEl } = host;
    const $ = (sel) => document.querySelector(sel);
    const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
    let view = null; // 'hub' | 'chess' | 'caro' | 'blocks' | null (đang ở tab khác)

    const blocks = window.ThinkBlocks
      ? window.ThinkBlocks.create({
          api,
          me: () => state.me,
          nameOf,
          userOf,
          avatarEl,
          toast,
          back: () => {
            // Mở từ trang chọn game thì lùi lại; mở thẳng từ đường dẫn thì về trang chọn game
            if (history.state && history.state.fromHub) goBack();
            else navigate('#/games', { replace: true });
          },
          onChange: () => { if (view === 'hub' || view === 'blocks') renderHub(); },
        })
      : null;

    // app.js gọi mỗi khi đổi đường dẫn
    function route(next) {
      const was = view;
      view = next;
      $('#games-hub').hidden = next === 'chess' || next === 'caro';
      $('#games-chess').hidden = next !== 'chess';
      const caroView = $('#games-caro');
      if (caroView) caroView.hidden = next !== 'caro';
      const pane = $('#blocks-pane');
      if (next === 'blocks' && blocks) {
        document.body.classList.add('in-chat');
        $('#chat-empty').hidden = true;
        $('#chat-pane').hidden = true;
        $('#chess-pane').hidden = true;
        pane.hidden = false;
        if (!blocks.isMounted()) blocks.mount(pane);
      } else if (pane && !pane.hidden) {
        blocks.unmount();
        pane.hidden = true;
        pane.replaceChildren();
        const caroPane = $('#caro-pane');
        if (state.currentId == null && $('#chess-pane').hidden && $('#profile-pane').hidden && (!caroPane || caroPane.hidden)) {
          document.body.classList.remove('in-chat');
          $('#chat-empty').hidden = false;
        }
      }
      if ((next === 'hub' || next === 'blocks') && was !== next) renderHub();
      if (next === 'hub' && was !== 'hub' && blocks) blocks.sync();
    }

    /* ---------------- Trang chọn game ---------------- */
    function blocksArt() {
      // Hình minh họa nhỏ: vài khối màu xếp trên bàn 4×4
      const art = h('div', { class: 'game-art-blocks', 'aria-hidden': 'true' });
      const layout = [1, 1, 0, 5, 0, 1, 0, 5, 3, 3, 3, 5, 0, 7, 7, 0];
      for (const c of layout) art.append(h('span', { class: c ? `bb-block is-c${c}` : 'game-art-empty' }));
      return art;
    }
    function caroArt() {
      return h('div', { class: 'game-art-caro', 'aria-hidden': 'true' }, window.ThinkCaro && window.ThinkCaro.art ? window.ThinkCaro.art() : null);
    }
    function chessArt() {
      const board = window.ThinkChess && window.ThinkChess.miniBoard
        ? window.ThinkChess.miniBoard('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4')
        : null;
      return h('div', { class: 'game-art-chess', 'aria-hidden': 'true' }, board);
    }

    function renderHub() {
      const body = $('#games-body');
      if (!body || !state.me) return;
      const cs = chess && chess.summary ? chess.summary() : null;
      const bs = blocks ? blocks.summary() : null;
      const ks = caro && caro.summary ? caro.summary() : null;

      const chessSub = cs && cs.rating
        ? `ELO ${cs.rating.rating}${cs.rating.provisional ? '?' : ''}${cs.rank ? ` · hạng #${cs.rank}` : ''}`
        : 'Thách đấu bạn bè, leo bảng ELO';
      const chessChips = [];
      if (cs && cs.todo) chessChips.push(h('span', { class: 'game-chip is-alert', text: `${cs.todo} việc cần làm` }));
      if (cs && cs.active) chessChips.push(h('span', { class: 'game-chip', text: `${cs.active} ván đang chơi` }));
      if (!chessChips.length) chessChips.push(h('span', { class: 'game-chip', text: 'Có máy Stockfish phân tích ván' }));

      const blocksSub = bs && bs.best
        ? `Kỷ lục ${fmt(bs.best)}${bs.weekRank ? ` · hạng #${bs.weekRank} tuần này` : ''}`
        : 'Xếp khối, xóa hàng, lập kỷ lục';
      const blocksChips = [];
      if (bs && bs.playing != null) blocksChips.push(h('span', { class: 'game-chip is-alert', text: `Đang chơi dở · ${fmt(bs.playing)} điểm` }));
      blocksChips.push(h('span', { class: 'game-chip' }, icon('wifi-off'), 'Chơi được khi mất mạng'));
      if (bs && bs.pending) blocksChips.push(h('span', { class: 'game-chip', text: `${bs.pending} ván chờ gửi` }));

      const caroSub = ks && ks.rating && ks.rating.games
        ? `ELO ${ks.rating.rating}${ks.rank ? ` · hạng #${ks.rank}` : ''}`
        : 'Năm quân liền nhau là thắng';
      const caroChips = [];
      if (ks && ks.myTurn) caroChips.push(h('span', { class: 'game-chip is-alert', text: `Tới lượt bạn: ${ks.myTurn}` }));
      if (ks && ks.incoming) caroChips.push(h('span', { class: 'game-chip is-alert', text: `${ks.incoming} lời thách đấu` }));
      if (ks && ks.botPlaying) caroChips.push(h('span', { class: 'game-chip', text: `Ván dở với máy ${ks.botPlaying.level.toLowerCase()}` }));
      if (caroChips.length < 2) caroChips.push(h('span', { class: 'game-chip' }, icon('bot'), 'Chơi với máy · Thách bạn bè'));

      const card = (kind, hash, title, sub, chips, art, cta) => h('a', {
        class: `game-card is-${kind}`,
        href: hash,
        onclick: (e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate(hash);
          // Đánh dấu bước này để nút Quay lại trong game lùi về đúng trang chọn game
          history.replaceState({ ...(history.state || {}), fromHub: true }, '', hash);
        },
      },
      h('div', { class: 'game-card-main' },
        h('h2', { class: 'game-card-title', text: title }),
        h('p', { class: 'game-card-sub', text: sub }),
        h('div', { class: 'game-chips' }, chips),
        h('span', { class: 'game-cta' }, icon('play'), cta)),
      art);

      const parts = [
        h('p', { class: 'games-intro', text: 'Chơi cùng cả nhóm: thách đấu cờ vua, cờ caro, đua điểm Xếp Khối mỗi tuần.' }),
        card('blocks', '#/blocks', 'Xếp Khối', blocksSub, blocksChips, blocksArt(), bs && bs.playing != null ? 'Chơi tiếp' : 'Chơi ngay'),
        card('chess', '#/chess', 'Cờ vua', chessSub, chessChips, chessArt(), cs && cs.todo ? 'Vào xem' : 'Vào chơi'),
      ];
      if (caro) parts.push(card('caro', '#/caro', 'Cờ caro', caroSub, caroChips, caroArt(), ks && ks.todo ? 'Vào xem' : 'Vào chơi'));

      // Bảng xếp hạng tuần của Xếp Khối + top ELO cờ vua
      const boards = [];
      if (bs && bs.top.length) {
        boards.push(h('section', { class: 'games-board' },
          h('h3', {}, 'Xếp Khối · tuần này'),
          h('ol', {}, bs.top.map((r, i) => h('li', { class: r.userId === state.me.id ? 'is-me' : '' },
            h('span', { class: `games-medal is-top${i + 1}`, text: String(i + 1) }),
            avatarEl(userOf(r.userId), 'avatar-sm', { dot: false }),
            h('span', { class: 'games-board-name', text: nameOf(r.userId) }),
            h('strong', { text: fmt(r.score) }))))));
      }
      if (cs && cs.top && cs.top.length) {
        boards.push(h('section', { class: 'games-board' },
          h('h3', {}, 'Cờ vua · điểm ELO'),
          h('ol', {}, cs.top.map((r, i) => h('li', { class: r.userId === state.me.id ? 'is-me' : '' },
            h('span', { class: `games-medal is-top${i + 1}`, text: String(i + 1) }),
            avatarEl(userOf(r.userId), 'avatar-sm', { dot: false }),
            h('span', { class: 'games-board-name', text: nameOf(r.userId) }),
            h('strong', { text: String(r.rating) }))))));
      }
      if (ks && ks.top && ks.top.length) {
        boards.push(h('section', { class: 'games-board' },
          h('h3', {}, 'Cờ caro · điểm ELO'),
          h('ol', {}, ks.top.map((r, i) => h('li', { class: r.userId === state.me.id ? 'is-me' : '' },
            h('span', { class: `games-medal is-top${i + 1}`, text: String(i + 1) }),
            avatarEl(userOf(r.userId), 'avatar-sm', { dot: false }),
            h('span', { class: 'games-board-name', text: nameOf(r.userId) }),
            h('strong', { text: String(r.rating) }))))));
      }
      if (boards.length) parts.push(h('div', { class: 'games-boards' }, boards));
      parts.push(h('p', { class: 'chess-credit', text: 'Âm thanh tự tổng hợp cho Think. Xếp Khối lấy cảm hứng từ các game xếp khối 8×8; hình và tiếng là của riêng Think.' }));
      const scroll = body.scrollTop;
      body.replaceChildren(...parts);
      body.scrollTop = scroll;
    }

    function reset() {
      if (blocks && blocks.isMounted()) blocks.unmount();
      const pane = $('#blocks-pane');
      if (pane) {
        pane.hidden = true;
        pane.replaceChildren();
      }
      view = null;
    }

    return {
      route,
      renderHub,
      reset,
      sync: () => blocks && blocks.sync(),
      onScore: (data) => blocks && blocks.onScore(data),
      refresh: () => { if (view === 'hub' || view === 'blocks') renderHub(); },
    };
  }
  return { create };
})();
