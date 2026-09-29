'use strict';
/* Trang cá nhân và bảng tin cho bản web của Think: ảnh bìa, giới thiệu, đăng bài (chữ, ảnh, ván cờ),
   thả tim, bình luận, chia sẻ ván cờ vào trang cá nhân hoặc cuộc trò chuyện.
   app.js gọi ThinkSocial.create(host) rồi chuyển cho nó đường dẫn #/u/5, #/p/9 và các sự kiện realtime. */
window.ThinkSocial = (() => {
  function create(host) {
    const { api, h, icon, avatarEl, userOf, nameOf, state, toast, navigate, goBack, withBusy, shortTime } = host;
    const $ = (sel, root = document) => root.querySelector(sel);

    const S = {
      posts: new Map(), // id -> bài đăng
      lists: new Map(), // 'feed' | 'u:5' -> { ids, hasMore, loading, loaded, error }
      profiles: new Map(), // userId -> thống kê
      seg: 'feed', // tab đang xem ở trang của tôi: bảng tin / bài của tôi
      viewUser: null, // trang cá nhân đang mở ở cột phải
      openComments: null, // bài đang mở bình luận
      comments: new Map(), // postId -> [bình luận]
    };
    const me = () => (state.me ? state.me.id : 0);
    const listOf = (key) => {
      if (!S.lists.has(key)) S.lists.set(key, { ids: [], hasMore: false, loading: false, loaded: false, error: null });
      return S.lists.get(key);
    };

    /* ---------------- Tải dữ liệu ---------------- */
    async function loadList(key, more = false) {
      const l = listOf(key);
      if (l.loading || (more && !l.hasMore)) return;
      l.loading = true;
      l.error = null;
      redraw(key);
      try {
        const before = more && l.ids.length ? `&before=${l.ids[l.ids.length - 1]}` : '';
        const url = key === 'feed' ? `/api/posts?limit=20${before}` : `/api/users/${key.slice(2)}/posts?limit=20${before}`;
        const data = await api(url);
        for (const p of data.posts) S.posts.set(p.id, p);
        const ids = data.posts.map((p) => p.id);
        l.ids = more ? [...l.ids, ...ids.filter((id) => !l.ids.includes(id))] : ids;
        l.hasMore = data.hasMore;
        l.loaded = true;
      } catch (err) {
        l.error = err.message;
      } finally {
        l.loading = false;
        redraw(key);
      }
    }

    async function loadProfile(userId) {
      try {
        const data = await api(`/api/users/${userId}/profile`);
        S.profiles.set(userId, data.stats);
        redrawHeaders(userId);
      } catch { /* thống kê không quan trọng */ }
    }

    function reset() {
      S.posts.clear();
      S.lists.clear();
      S.profiles.clear();
      S.comments.clear();
      S.viewUser = null;
      S.openComments = null;
      S.seg = 'feed';
      closeSheet(true);
      const pane = $('#profile-pane');
      if (pane) {
        pane.hidden = true;
        pane.replaceChildren();
      }
      const body = $('#me-social');
      if (body) body.replaceChildren();
    }

    /* ---------------- Vẽ lại ---------------- */
    function redraw(key) {
      if (key === 'feed' || key === `u:${me()}`) {
        if (state.tab === 'me' && !$('#me-profile').hidden) drawMeList();
      }
      if (S.viewUser != null && key === `u:${S.viewUser}`) drawPaneList();
    }
    function redrawHeaders(userId) {
      if (userId === me() && state.tab === 'me') {
        const old = $('#me-social .profile-hero');
        if (old) old.replaceWith(hero(state.me, true));
      }
      if (S.viewUser === userId) {
        const old = $('#profile-pane .profile-hero');
        const u = userOf(userId);
        if (old && u) old.replaceWith(hero(u, userId === me()));
      }
    }
    // Vẽ lại một bài ở mọi nơi đang hiện
    function redrawPost(id) {
      const p = S.posts.get(id);
      for (const el of document.querySelectorAll(`[data-post="${id}"]`)) {
        if (!p) {
          el.remove();
          continue;
        }
        // Đang bấm nút trong bài (thích, bình luận…) thì vẽ lại xong vẫn giữ con trỏ ở nút đó
        const key = el.contains(document.activeElement) ? document.activeElement.getAttribute('data-focus') : null;
        const fresh = postCard(p);
        el.replaceWith(fresh);
        const target = key && fresh.querySelector(`[data-focus="${CSS.escape(key)}"]`);
        if (target) target.focus({ preventScroll: true });
      }
    }

    /* ---------------- Trang của tôi (tab Cá nhân) ---------------- */
    function renderMe() {
      const body = $('#me-social');
      if (!body || !state.me) return;
      const scroll = body.scrollTop;
      body.replaceChildren(
        hero(state.me, true),
        composerCard(),
        h('div', { class: 'seg social-seg', role: 'tablist', 'aria-label': 'Xem bài' },
          segBtn('feed', 'Bảng tin'),
          segBtn('mine', 'Bài của tôi')),
        h('div', { class: 'post-list', id: 'me-posts' }));
      body.scrollTop = scroll;
      if (!S.profiles.has(me())) loadProfile(me());
      drawMeList();
    }
    function segBtn(key, label) {
      return h('button', {
        class: 'seg-btn',
        type: 'button',
        role: 'tab',
        'aria-selected': S.seg === key ? 'true' : 'false',
        onclick: () => {
          S.seg = key;
          renderMe();
        },
        text: label,
      });
    }
    function drawMeList() {
      const wrap = $('#me-posts');
      if (!wrap) return;
      const key = S.seg === 'feed' ? 'feed' : `u:${me()}`;
      const l = listOf(key);
      if (!l.loaded && !l.loading && !l.error) {
        loadList(key);
        return;
      }
      wrap.replaceChildren(...listItems(l, key, S.seg === 'feed' ? 'Chưa có bài đăng nào. Viết bài đầu tiên cho cả nhóm nhé!' : 'Bạn chưa đăng bài nào.'));
    }
    function listItems(l, key, empty) {
      const items = l.ids.map((id) => S.posts.get(id)).filter(Boolean).map(postCard);
      if (l.error && !l.ids.length) {
        items.push(h('div', { class: 'post-empty' }, h('p', { text: l.error }), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => loadList(key), text: 'Thử lại' })));
      } else if (l.loaded && !l.ids.length) {
        items.push(h('p', { class: 'post-empty', text: empty }));
      }
      if (l.loading) items.push(h('p', { class: 'post-empty', text: 'Đang tải…' }));
      else if (l.hasMore) items.push(h('button', { class: 'btn btn-block post-more', type: 'button', onclick: () => loadList(key, true), text: 'Xem thêm bài cũ hơn' }));
      return items;
    }

    /* ---------------- Trang của người khác (cột phải) ---------------- */
    function route(userId) {
      const pane = $('#profile-pane');
      if (!pane) return;
      if (userId != null) {
        if (S.viewUser === userId && !pane.hidden && pane.firstChild) return;
        S.viewUser = userId;
        document.body.classList.add('in-chat');
        $('#chat-empty').hidden = true;
        $('#chat-pane').hidden = true;
        const chessPane = $('#chess-pane');
        if (chessPane) chessPane.hidden = true;
        pane.hidden = false;
        renderPane();
        loadProfile(userId);
        const key = `u:${userId}`;
        const l = listOf(key);
        if (!l.loading) loadList(key);
        return;
      }
      if (S.viewUser != null || !pane.hidden) {
        S.viewUser = null;
        pane.hidden = true;
        pane.replaceChildren();
        const chessOpen = $('#chess-pane') && !$('#chess-pane').hidden;
        if (state.currentId == null && !chessOpen) {
          document.body.classList.remove('in-chat');
          $('#chat-empty').hidden = false;
        }
      }
    }
    function renderPane() {
      const pane = $('#profile-pane');
      const u = userOf(S.viewUser);
      const back = h('button', { class: 'icon-btn back-btn profile-back', type: 'button', 'aria-label': 'Quay lại', onclick: goBack }, icon('back'));
      if (!u) {
        pane.replaceChildren(h('header', { class: 'chat-head' }, back, h('div', { class: 'chat-title' }, h('h2', { text: 'Trang cá nhân' }))),
          h('p', { class: 'post-empty', text: 'Không tìm thấy người này.' }));
        return;
      }
      pane.replaceChildren(
        h('header', { class: 'chat-head' }, back, h('div', { class: 'chat-title' }, h('h2', { text: u.displayName }), h('p', { text: `@${u.username}` }))),
        h('div', { class: 'profile-scroll' },
          h('div', { class: 'profile-col' },
            hero(u, u.id === me()),
            u.id === me() ? composerCard() : null,
            h('div', { class: 'post-list', id: 'pane-posts' }))));
      drawPaneList();
    }
    function drawPaneList() {
      const wrap = $('#pane-posts');
      if (!wrap || S.viewUser == null) return;
      const key = `u:${S.viewUser}`;
      const u = userOf(S.viewUser);
      wrap.replaceChildren(...listItems(listOf(key), key, `${u ? u.displayName : 'Người này'} chưa đăng bài nào.`));
    }

    /* ---------------- Phần đầu trang cá nhân: ảnh bìa, ảnh đại diện, giới thiệu ---------------- */
    function hero(u, mine) {
      const stats = S.profiles.get(u.id);
      const cover = h('div', { class: `profile-cover${u.cover ? '' : ' is-empty'}` });
      if (u.cover) cover.style.backgroundImage = `url("${u.cover}")`;
      if (mine) {
        cover.append(h('button', { class: 'cover-edit', type: 'button', 'data-action': 'pick-cover', 'aria-label': 'Đổi ảnh bìa' }, icon('camera'), h('span', { text: 'Ảnh bìa' })));
      }
      const av = avatarEl(u, 'avatar-hero', { dot: true });
      const joined = u.joinedAt ? new Date(u.joinedAt) : null;
      const bits = [];
      if (stats) {
        bits.push(h('span', {}, h('strong', { text: String(stats.posts) }), ' bài viết'));
        bits.push(h('span', {}, h('strong', { text: String(stats.likes) }), ' lượt thích'));
        if (stats.chess) bits.push(h('span', {}, '♞ ELO ', h('strong', { text: String(stats.chess.rating) })));
        if (stats.blocks) bits.push(h('span', {}, '🧩 Xếp Khối ', h('strong', { text: Number(stats.blocks.best).toLocaleString('vi-VN') })));
      }
      const actions = mine
        ? [h('button', { class: 'btn btn-sm', type: 'button', 'data-action': 'settings' }, icon('settings'), 'Chỉnh sửa trang cá nhân')]
        : [
            h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => host.openDm(u.id) }, icon('chat'), 'Nhắn tin'),
            host.challenge ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => host.challenge(u.id) }, icon('knight'), 'Thách cờ') : null,
          ];
      return h('section', { class: 'profile-hero' },
        cover,
        h('div', { class: 'profile-id' },
          mine
            ? h('button', { class: 'avatar-edit hero-avatar', type: 'button', 'data-action': 'pick-avatar', 'aria-label': 'Đổi ảnh đại diện' }, av, h('span', { class: 'avatar-cam' }, icon('camera')))
            : h('span', { class: 'hero-avatar' }, av),
          h('div', { class: 'profile-actions' }, actions)),
        h('div', { class: 'profile-info' },
          h('h2', { class: 'profile-name' }, u.displayName, u.role === 'admin' ? h('span', { class: 'tag tag-admin', text: 'Admin' }) : null),
          h('p', { class: 'profile-handle', text: `@${u.username}${joined ? ` · Tham gia tháng ${joined.getMonth() + 1}/${joined.getFullYear()}` : ''}` }),
          u.bio ? h('p', { class: 'profile-bio', text: u.bio }) : mine ? h('p', { class: 'profile-bio is-empty' }, h('button', { class: 'link-plain', type: 'button', 'data-action': 'settings', text: '+ Thêm lời giới thiệu' })) : null,
          bits.length ? h('p', { class: 'profile-stats' }, bits) : null));
    }

    function composerCard() {
      return h('button', { class: 'composer-card', type: 'button', onclick: () => openComposer({}) },
        avatarEl(state.me, 'avatar-sm', { dot: false }),
        h('span', { class: 'composer-fake', text: 'Bạn đang nghĩ gì?' }),
        h('span', { class: 'composer-img' }, icon('image')));
    }

    /* ---------------- Một bài đăng ---------------- */
    function postCard(p) {
      const u = userOf(p.userId) || { id: p.userId, displayName: 'Người dùng', username: '' };
      const canDelete = p.userId === me() || (state.me && state.me.role === 'admin');
      const profileLink = (child) => h('a', {
        class: 'post-author',
        href: `#/u/${p.userId}`,
        onclick: (e) => {
          if (e.ctrlKey || e.metaKey || e.button !== 0) return;
          e.preventDefault();
          go(`#/u/${p.userId}`);
        },
      }, child);
      const body = [];
      if (p.text) body.push(h('p', { class: 'post-text', text: p.text }));
      if (p.image) {
        const m = /_(\d+)x(\d+)\.\w+$/.exec(p.image);
        const img = h('img', {
          class: 'post-img', src: p.image, alt: 'Ảnh trong bài đăng', loading: 'lazy', decoding: 'async',
          width: m ? m[1] : null, height: m ? m[2] : null,
        });
        img.addEventListener('click', () => host.openLightbox(p.image));
        img.addEventListener('error', () => img.replaceWith(h('div', { class: 'img-gone' }, icon('image'), h('span', { text: 'Không tải được ảnh' }))), { once: true });
        body.push(img);
      }
      if (p.game) body.push(gameCard(p.game));
      return h('article', { class: 'post', dataset: { post: String(p.id) } },
        h('header', { class: 'post-head' },
          profileLink(avatarEl(u, '', { dot: false })),
          h('div', { class: 'post-meta' },
            profileLink(h('strong', { text: u.displayName })),
            h('time', { datetime: new Date(p.createdAt).toISOString(), title: new Date(p.createdAt).toLocaleString('vi-VN'), text: timeAgo(p.createdAt) })),
          canDelete
            ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Xóa bài', onclick: (e) => withBusy(e.currentTarget, () => removePost(p)) }, icon('close'))
            : null),
        body,
        h('footer', { class: 'post-foot' },
          h('button', {
            class: `post-act${p.liked ? ' is-liked' : ''}`,
            type: 'button',
            'aria-pressed': p.liked ? 'true' : 'false',
            'aria-label': `${p.liked ? 'Bỏ thích' : 'Thích'}, ${p.likes} lượt thích`,
            dataset: { focus: `like-${p.id}` },
            onclick: () => toggleLike(p.id),
          }, icon(p.liked ? 'heart-fill' : 'heart'), h('span', { text: p.likes ? String(p.likes) : 'Thích' })),
          h('button', {
            class: 'post-act',
            type: 'button',
            'aria-label': `${p.comments} bình luận`,
            dataset: { focus: `comments-${p.id}` },
            onclick: () => openComments(p.id),
          }, icon('comment'), h('span', { text: p.comments ? String(p.comments) : 'Bình luận' })),
          p.likes ? h('button', { class: 'post-likers', type: 'button', onclick: () => openLikers(p.id), text: 'Ai đã thích?' }) : null));
    }

    function gameCard(g) {
      const t = host.chessText ? host.chessText.describe(g, nameOf) : { title: 'Ván cờ', sub: '' };
      const board = host.miniBoard ? host.miniBoard(g.fen, 'w') : null;
      return h('button', {
        class: 'post-game',
        type: 'button',
        onclick: () => go(`#/chess/g/${g.id}`),
        'aria-label': `Ván cờ ${t.title}. ${t.sub}. Bấm để xem lại`,
      },
      board,
      h('span', { class: 'post-game-info' },
        h('span', { class: 'post-game-tag' }, icon('knight'), 'Ván cờ'),
        h('strong', { text: t.title }),
        h('span', { text: t.sub }),
        h('em', { text: 'Xem lại ván →' })));
    }

    function timeAgo(ts) {
      const s = Math.max(0, (Date.now() - ts) / 1000);
      if (s < 60) return 'Vừa xong';
      if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
      if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
      if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
      return shortTime(ts);
    }

    /* ---------------- Thả tim, xóa bài ---------------- */
    async function toggleLike(id) {
      const p = S.posts.get(id);
      if (!p) return;
      const want = !p.liked;
      // Hiện ngay trên màn hình, máy chủ trả lời thì cập nhật số thật
      S.posts.set(id, { ...p, liked: want, likes: Math.max(0, p.likes + (want ? 1 : -1)) });
      redrawPost(id);
      try {
        const r = await api(`/api/posts/${id}/like`, { method: 'POST', body: { liked: want } });
        const cur = S.posts.get(id);
        if (cur) S.posts.set(id, { ...cur, liked: r.liked, likes: r.likes });
      } catch (err) {
        const cur = S.posts.get(id);
        if (cur) S.posts.set(id, { ...cur, liked: p.liked, likes: p.likes });
        toast(err.message);
      }
      redrawPost(id);
    }

    async function removePost(p) {
      if (!window.confirm('Xóa bài đăng này? Bình luận và lượt thích cũng mất theo.')) return;
      try {
        await api(`/api/posts/${p.id}`, { method: 'DELETE' });
        forgetPost(p.id);
        toast('Đã xóa bài đăng.');
      } catch (err) {
        toast(err.message);
      }
    }
    function forgetPost(id) {
      const p = S.posts.get(id);
      S.posts.delete(id);
      for (const l of S.lists.values()) l.ids = l.ids.filter((x) => x !== id);
      redrawPost(id);
      if (p && S.profiles.has(p.userId)) {
        const st = S.profiles.get(p.userId);
        S.profiles.set(p.userId, { ...st, posts: Math.max(0, st.posts - 1), likes: Math.max(0, st.likes - (p.likes || 0)) });
        redrawHeaders(p.userId);
      }
      if (S.openComments === id) closeSheet();
    }

    /* ---------------- Sự kiện realtime ---------------- */
    function onEvent(name, data) {
      if (!data || !state.me) return;
      if (name === 'post:new' && data.post) {
        const p = data.post;
        if (S.posts.has(p.id)) return;
        S.posts.set(p.id, { ...p, liked: false });
        for (const key of ['feed', `u:${p.userId}`]) {
          const l = S.lists.get(key);
          if (l && l.loaded) {
            l.ids = [p.id, ...l.ids.filter((x) => x !== p.id)];
            redraw(key);
          }
        }
        if (S.profiles.has(p.userId)) {
          const st = S.profiles.get(p.userId);
          S.profiles.set(p.userId, { ...st, posts: st.posts + 1 });
          redrawHeaders(p.userId);
        }
        return;
      }
      const id = Number(data.postId);
      const p = S.posts.get(id);
      if (name === 'post:deleted') {
        if (p) forgetPost(id);
        return;
      }
      if (name === 'post:likes') {
        if (!p) return;
        S.posts.set(id, { ...p, likes: data.likes, liked: data.userId === me() ? data.liked : p.liked });
        redrawPost(id);
        if (S.profiles.has(p.userId)) loadProfile(p.userId);
        return;
      }
      if (name === 'post:comment' || name === 'post:comment-deleted') {
        if (p) {
          S.posts.set(id, { ...p, comments: data.comments });
          redrawPost(id);
        }
        const list = S.comments.get(id);
        if (list) {
          if (name === 'post:comment' && data.comment && !list.some((c) => c.id === data.comment.id)) list.push(data.comment);
          if (name === 'post:comment-deleted') S.comments.set(id, list.filter((c) => c.id !== data.commentId));
          if (S.openComments === id) drawComments();
        }
      }
    }

    // Có người đổi tên / ảnh / ảnh bìa / giới thiệu
    function onUser(u) {
      if (!u) return;
      redrawHeaders(u.id);
      for (const p of S.posts.values()) if (p.userId === u.id) redrawPost(p.id);
    }

    /* =========================================================
       Bảng chọn (đăng bài, bình luận, chia sẻ)
       ========================================================= */
    let layer = null;
    let hideTimer = null;
    let lastFocus = null;
    function ensureLayer() {
      if (layer) return layer;
      layer = h('div', { class: 'sheet-layer social-layer', hidden: true },
        h('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }),
        h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }));
      layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
      document.body.append(layer);
      window.addEventListener('popstate', () => {
        if (layer && !layer.hidden && !(history.state && history.state.socialSheet)) closeSheet(true);
      });
      return layer;
    }
    function openSheet(title, body, foot, kind) {
      const l = ensureLayer();
      const sheet = l.querySelector('.sheet');
      sheet.setAttribute('aria-label', title);
      sheet.replaceChildren(
        h('header', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onclick: () => closeSheet() }, icon('close'))),
        h('div', { class: 'sheet-body' }, body),
        ...(foot ? [h('div', { class: 'sheet-foot' }, foot)] : []));
      if (l.hidden || !l.classList.contains('open')) {
        clearTimeout(hideTimer);
        if (!(history.state && history.state.socialSheet)) history.pushState({ ...(history.state || {}), socialSheet: true }, '', location.hash || '#/');
        lastFocus = document.activeElement;
        l.hidden = false;
        void l.offsetWidth;
        l.classList.add('open');
      }
      l.dataset.kind = kind || '';
      // Đưa con trỏ vào bảng (để Esc / trình đọc màn hình dùng được), trừ khi đã có ô đang nhập trong bảng
      if (!sheet.contains(document.activeElement)) sheet.focus({ preventScroll: true });
      return sheet;
    }
    /** Mở trang khác; nếu đang ở trong bảng thì đóng bảng và thay luôn mục lịch sử của bảng (nút Back không mở lại bảng) */
    function go(hash) {
      if (layer && !layer.hidden && layer.classList.contains('open')) {
        const inSheet = Boolean(history.state && history.state.socialSheet);
        closeSheet(true);
        navigate(hash, { replace: inSheet });
        return;
      }
      navigate(hash);
    }
    function closeSheet(silent) {
      S.openComments = null;
      if (!layer || layer.hidden) return;
      if (!silent && history.state && history.state.socialSheet) {
        history.back();
        return;
      }
      layer.classList.remove('open');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!layer.classList.contains('open')) layer.hidden = true;
      }, 220);
      // Trả con trỏ về nút vừa mở bảng (nút có thể đã được vẽ lại: tìm nút cùng tên)
      const back = lastFocus;
      lastFocus = null;
      if (back && back !== document.body && layer.contains(document.activeElement)) {
        let target = back.isConnected ? back : null;
        if (!target && back.getAttribute) {
          const key = back.getAttribute('data-focus');
          const label = back.getAttribute('aria-label');
          target = (key && document.querySelector(`[data-focus="${CSS.escape(key)}"]`))
            || (label && document.querySelector(`[aria-label="${CSS.escape(label)}"]:not(.social-layer *)`));
        }
        if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
      }
    }

    /* ---------------- Viết bài ---------------- */
    function openComposer({ game = null, text = '' } = {}) {
      const draft = { blob: null, w: 0, h: 0, url: null };
      const area = h('textarea', { class: 'composer-text', rows: 4, maxlength: 2000, placeholder: game ? 'Nói gì đó về ván cờ này…' : 'Bạn đang nghĩ gì?', 'aria-label': 'Nội dung bài đăng' });
      area.value = text;
      const preview = h('div', { class: 'composer-preview' });
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const submit = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Đăng bài');
      const drawPreview = () => {
        preview.replaceChildren();
        if (draft.url) {
          preview.append(h('div', { class: 'composer-img-wrap' },
            h('img', { src: draft.url, alt: 'Ảnh sẽ đăng' }),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Bỏ ảnh', onclick: () => { URL.revokeObjectURL(draft.url); Object.assign(draft, { blob: null, url: null }); drawPreview(); } }, icon('close'))));
        }
        if (game) preview.append(gameCard(game));
      };
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        try {
          const out = await host.prepareImage(f, { max: 1600, quality: 0.85 });
          if (draft.url) URL.revokeObjectURL(draft.url);
          Object.assign(draft, { blob: out.blob, w: out.w, h: out.h, url: URL.createObjectURL(out.blob) });
          drawPreview();
        } catch (err) {
          toast(err.message);
        }
      });
      submit.addEventListener('click', () => withBusy(submit, async () => {
        const t = area.value.trim();
        if (!t && !draft.blob && !game) {
          error.textContent = 'Viết gì đó hoặc chọn một ảnh nhé.';
          error.hidden = false;
          return;
        }
        error.hidden = true;
        try {
          let image;
          if (draft.blob) image = (await api(`/api/upload?w=${draft.w}&h=${draft.h}`, { method: 'POST', raw: draft.blob })).url;
          const { post } = await api('/api/posts', { method: 'POST', body: { text: t, image, gameId: game ? game.id : undefined } });
          S.posts.set(post.id, post);
          for (const key of ['feed', `u:${me()}`]) {
            const l = S.lists.get(key);
            if (l && l.loaded && !l.ids.includes(post.id)) l.ids.unshift(post.id);
          }
          if (draft.url) URL.revokeObjectURL(draft.url);
          closeSheet();
          toast(game ? 'Đã chia sẻ ván cờ lên trang cá nhân.' : 'Đã đăng bài.');
          redraw('feed');
          redraw(`u:${me()}`);
          if (S.profiles.has(me())) loadProfile(me());
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }));
      drawPreview();
      openSheet(game ? 'Chia sẻ ván cờ' : 'Bài viết mới', [
        h('div', { class: 'composer-who' }, avatarEl(state.me, 'avatar-sm', { dot: false }), h('strong', { text: state.me.displayName }), h('span', { class: 'hint', text: 'Cả nhóm sẽ thấy bài này' })),
        area,
        preview,
        file,
        h('button', { class: 'btn btn-sm composer-add', type: 'button', onclick: () => file.click() }, icon('image'), 'Thêm ảnh'),
        error,
      ], submit, 'composer');
      setTimeout(() => area.focus(), 250);
    }

    /* ---------------- Bình luận ---------------- */
    async function openComments(postId) {
      S.openComments = postId;
      const input = h('textarea', { class: 'comment-input', rows: 1, maxlength: 1000, placeholder: 'Viết bình luận…', 'aria-label': 'Viết bình luận' });
      const send = h('button', { class: 'send-btn', type: 'submit', 'aria-label': 'Gửi bình luận' }, icon('send'));
      const form = h('form', { class: 'comment-form', autocomplete: 'off' }, avatarEl(state.me, 'avatar-sm', { dot: false }), input, send);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          form.requestSubmit();
        }
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        withBusy(send, async () => {
          try {
            const { comment, comments } = await api(`/api/posts/${postId}/comments`, { method: 'POST', body: { text } });
            input.value = '';
            const list = S.comments.get(postId) || [];
            if (!list.some((c) => c.id === comment.id)) list.push(comment);
            S.comments.set(postId, list);
            const p = S.posts.get(postId);
            if (p) S.posts.set(postId, { ...p, comments });
            redrawPost(postId);
            drawComments(true);
          } catch (err) {
            toast(err.message);
          }
        });
      });
      const p = S.posts.get(postId);
      openSheet('Bình luận', [h('div', { class: 'comment-post', id: 'comment-post' }), h('ul', { class: 'comment-list', id: 'comment-list' })], form, 'comments');
      drawComments();
      if (!p) {
        try {
          const { post } = await api(`/api/posts/${postId}`);
          S.posts.set(postId, post);
        } catch (err) {
          toast(err.message);
          closeSheet();
          return;
        }
      }
      try {
        const { comments } = await api(`/api/posts/${postId}/comments`);
        S.comments.set(postId, comments);
      } catch (err) {
        toast(err.message);
      }
      if (S.openComments === postId) drawComments(true);
      setTimeout(() => input.focus(), 250);
    }
    function drawComments(toEnd) {
      const id = S.openComments;
      const ul = document.getElementById('comment-list');
      const top = document.getElementById('comment-post');
      if (id == null || !ul) return;
      const p = S.posts.get(id);
      if (top) top.replaceChildren(...(p ? [postCard(p)] : []));
      const list = S.comments.get(id);
      if (!list) {
        ul.replaceChildren(h('li', { class: 'post-empty', text: 'Đang tải…' }));
        return;
      }
      ul.replaceChildren(...(list.length ? list.map((c) => {
        const u = userOf(c.userId) || { id: c.userId, displayName: 'Người dùng' };
        const canDelete = c.userId === me() || (p && p.userId === me()) || (state.me && state.me.role === 'admin');
        return h('li', { class: 'comment' },
          avatarEl(u, 'avatar-sm', { dot: false }),
          h('div', { class: 'comment-bubble' },
            h('strong', { text: u.displayName }),
            h('p', { text: c.text }),
            h('span', { class: 'comment-meta' },
              h('time', { text: timeAgo(c.createdAt) }),
              canDelete ? h('button', { class: 'link-plain', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => removeComment(c)), text: 'Xóa' }) : null)));
      }) : [h('li', { class: 'post-empty', text: 'Chưa có bình luận nào. Hãy là người đầu tiên!' })]));
      if (toEnd) {
        const body = ul.closest('.sheet-body');
        if (body) body.scrollTop = body.scrollHeight;
      }
    }
    async function removeComment(c) {
      if (!window.confirm('Xóa bình luận này?')) return;
      try {
        const { comments } = await api(`/api/comments/${c.id}`, { method: 'DELETE' });
        S.comments.set(c.postId, (S.comments.get(c.postId) || []).filter((x) => x.id !== c.id));
        const p = S.posts.get(c.postId);
        if (p) S.posts.set(c.postId, { ...p, comments });
        redrawPost(c.postId);
        drawComments();
      } catch (err) {
        toast(err.message);
      }
    }

    // Mở bài từ thông báo (#/p/9)
    function openPost(id) {
      if (S.openComments === id) return;
      openComments(id);
    }

    async function openLikers(postId) {
      const ul = h('ul', { class: 'people-list' }, h('li', { class: 'post-empty', text: 'Đang tải…' }));
      openSheet('Người đã thích', [ul], null, 'likers');
      try {
        const { userIds } = await api(`/api/posts/${postId}/likes`);
        ul.replaceChildren(...userIds.map((id) => {
          const u = userOf(id) || { id, displayName: 'Người dùng', username: '' };
          return h('li', {}, h('button', { class: 'person', type: 'button', onclick: () => go(`#/u/${id}`) },
            avatarEl(u, '', {}),
            h('span', { class: 'person-main' }, h('span', { class: 'person-name', text: u.displayName }), h('span', { class: 'person-sub', text: `@${u.username}` })),
            h('span', { class: 'liker-heart' }, icon('heart-fill'))));
        }));
      } catch (err) {
        ul.replaceChildren(h('li', { class: 'post-empty', text: err.message }));
      }
    }

    /* ---------------- Chia sẻ ván cờ ---------------- */
    function shareGame(g) {
      const t = host.chessText ? host.chessText.describe(g, nameOf) : { title: 'Ván cờ', sub: '' };
      const link = `${location.origin}/#/chess/g/${g.id}`;
      const message = `♟ ${t.title}\n${t.sub}\n${link}`;
      const mine = g.whiteId === me() || g.blackId === me();
      const convs = host.conversations();
      const list = h('ul', { class: 'people-list share-convs' }, convs.map((c) => h('li', {},
        h('button', {
          class: 'person',
          type: 'button',
          onclick: (e) => withBusy(e.currentTarget, async () => {
            try {
              // Gửi lỗi thì app đã báo lỗi và giữ tin để gửi lại: để bảng mở cho người dùng thử lại
              if (!(await host.sendText(c.id, message))) return;
              closeSheet();
              toast(`Đã gửi ván cờ vào “${c.title}”.`);
            } catch (err) {
              toast(err.message);
            }
          }),
        }, c.avatar, h('span', { class: 'person-main' }, h('span', { class: 'person-name', text: c.title })), h('span', { class: 'share-send' }, icon('send'))))));
      openSheet('Chia sẻ ván cờ', [
        gameCard(g),
        mine
          ? h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => openComposer({ game: g }) }, icon('feed'), 'Đăng lên trang cá nhân')
          : null,
        h('div', { class: 'panel' }, h('h3', { text: 'Gửi vào cuộc trò chuyện' }), convs.length ? list : h('p', { class: 'hint', text: 'Chưa có cuộc trò chuyện nào.' })),
      ], null, 'share');
    }

    return { renderMe, route, onEvent, onUser, reset, openPost, shareGame, openComposer };
  }

  return { create };
})();
