'use strict';
/* Tin 24 giờ (story, 2.13.0) cho bản web của Think. Máy chủ: src/stories.js. Bản app: native/src/stories/.
   - Hàng vòng tròn trên đầu danh sách chat (#story-bar): "Thêm tin", tin của bạn, tin của mọi người
     (viền xanh – vàng = có tin chưa xem, viền xám = đã xem hết).
   - Tạo tin: ảnh (kèm chú thích) hoặc chữ trên nền màu. Xem tin: toàn màn hình, thanh chạy tự chuyển,
     chạm bên trái / phải để lùi / tới, giữ để dừng; thả cảm xúc hoặc trả lời = tin nhắn riêng cho người đăng.
   - app.js gọi ThinkStories.create(host), chuyển sự kiện realtime story:* vào onEvent và vẽ khung
     "Đã trả lời tin của bạn" trong tin nhắn bằng refEl(m). */
window.ThinkStories = (() => {
  // Màu nền tin chữ — giống native/src/stories/bgs.ts (máy chủ chỉ nhận các mã này: STORY_BGS trong src/stories.js)
  const BGS = {
    jade: ['#0B6E56', '#1DB98A'],
    sunset: ['#C2410C', '#F76707'],
    berry: ['#A61E4D', '#E64980'],
    ocean: ['#1C4FD6', '#1098AD'],
    grape: ['#5F3DC4', '#9775FA'],
    night: ['#111418', '#3B4148'],
  };
  const BG_NAMES = { jade: 'Xanh ngọc', sunset: 'Cam', berry: 'Hồng', ocean: 'Xanh biển', grape: 'Tím', night: 'Đêm' };
  const REACTIONS = ['❤️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F44D}']; // ❤️ 😂 😮 😢 😡 👍
  const IMAGE_MS = 5000;
  const HOLD_MS = 220;
  const textMs = (t) => Math.min(10000, Math.max(5000, 3000 + String(t || '').length * 50));
  const bgCss = (key) => {
    const [a, b] = BGS[key] || BGS.jade;
    return `linear-gradient(160deg, ${a}, ${b})`;
  };
  function ago(ts, now = Date.now()) {
    const m = Math.max(0, Math.floor((now - ts) / 60000));
    if (m < 1) return 'Vừa xong';
    if (m < 60) return `${m} phút`;
    return `${Math.floor(m / 60)} giờ`;
  }

  function create(host) {
    const { api, h, icon, avatarEl, userOf, nameOf, state, toast, withBusy, prepareImage, bar: showBar = true, onGone } = host;
    const S = {
      stories: new Map(), // id -> tin
      loaded: false,
      viewer: null, // tin đang xem
      composer: null,
      tick: null,
    };
    const me = () => (state.me ? state.me.id : 0);
    const alive = (s, now = Date.now()) => s.expiresAt > now;

    /* ---------------- Dữ liệu ---------------- */
    async function load() {
      try {
        const data = await api('/api/stories');
        S.stories = new Map(data.stories.map((s) => [s.id, s]));
        S.loaded = true;
        renderBar();
        // Tin hết hạn tự biến mất khỏi hàng vòng tròn
        clearInterval(S.tick);
        S.tick = setInterval(renderBar, 60_000);
      } catch {
        /* thử lại khi nối lại máy chủ */
      }
    }

    function reset() {
      closeViewer(true);
      closeComposer(true);
      S.stories.clear();
      S.loaded = false;
      clearInterval(S.tick);
      const bar = document.getElementById('story-bar');
      if (bar) {
        bar.hidden = true;
        bar.replaceChildren();
      }
    }

    // Tin còn hiện, nhóm theo người: tin của mình trước, rồi người có tin chưa xem (mới nhất trước), rồi người đã xem hết
    function groups() {
      const now = Date.now();
      const map = new Map();
      for (const s of S.stories.values()) {
        if (!alive(s, now)) continue;
        if (!map.has(s.userId)) map.set(s.userId, []);
        map.get(s.userId).push(s);
      }
      const list = [...map.entries()].map(([userId, items]) => {
        items.sort((a, b) => a.id - b.id);
        return { userId, stories: items, unseen: items.some((s) => !s.seen), latest: items[items.length - 1].createdAt };
      });
      const mine = list.filter((g) => g.userId === me());
      const others = list.filter((g) => g.userId !== me()).sort((a, b) => Number(b.unseen) - Number(a.unseen) || b.latest - a.latest);
      return [...mine, ...others];
    }

    function onEvent(name, data) {
      if (!data) return;
      if (name === 'story:new' && data.story) {
        const s = data.story;
        if (!S.stories.has(s.id)) S.stories.set(s.id, s.userId === me() ? { ...s, seen: true, views: 0, reactions: 0 } : s);
        renderBar();
      } else if (name === 'story:deleted') {
        S.stories.delete(data.storyId);
        renderBar();
        if (onGone) onGone(data.storyId); // vẽ lại khung "Đã trả lời tin" trong khung chat đang mở
        if (S.viewer && S.viewer.current && S.viewer.current.id === data.storyId) viewerSkipGone();
      } else if (name === 'story:viewed') {
        const s = S.stories.get(data.storyId);
        if (!s) return;
        s.views = data.views;
        if (data.reaction) s.reactions = (s.reactions || 0) + 1;
        if (S.viewer && S.viewer.current && S.viewer.current.id === s.id) drawOwnerBar();
      }
    }

    /* ---------------- Hàng vòng tròn trên đầu danh sách chat ---------------- */
    function ringItem({ user, label, name, ring, onClick, plus }) {
      return h('li', { class: 'story-li' },
        h('button', { class: 'story-item', type: 'button', 'aria-label': label, onclick: onClick },
          h('span', { class: `story-ring ${ring}` },
            avatarEl(user, 'avatar-story', { dot: false }),
            plus ? h('span', { class: 'story-plus' }, icon('plus')) : null),
          h('span', { class: 'story-name', text: name })));
    }

    function renderBar() {
      const bar = document.getElementById('story-bar');
      if (!bar || !showBar || !state.me) return;
      const gs = groups();
      const items = [ringItem({ user: state.me, label: 'Thêm tin 24 giờ', name: 'Thêm tin', ring: 'is-add', plus: true, onClick: () => openComposer() })];
      for (const g of gs) {
        const own = g.userId === me();
        const u = userOf(g.userId);
        const who = own ? 'Tin của bạn' : u.displayName;
        items.push(ringItem({
          user: u,
          label: `${own ? 'Xem tin của bạn' : `Xem tin của ${u.displayName}`}, ${g.stories.length} tin${!own && g.unseen ? ', có tin chưa xem' : ''}`,
          name: who,
          ring: own ? 'is-mine' : g.unseen ? 'is-new' : 'is-seen',
          onClick: () => openViewer(g.userId),
        }));
      }
      bar.replaceChildren(h('ul', { class: 'story-list' }, items));
      bar.hidden = false;
    }

    /* ---------------- Tạo tin ---------------- */
    function openComposer() {
      if (!state.me) return;
      closeViewer(true);
      closeComposer(true);
      const d = { mode: 'text', bg: 'jade', blob: null, w: 0, h: 0, url: null, back: document.activeElement };
      S.composer = d;
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
      const area = h('textarea', { class: 'story-text-input', rows: 4, maxlength: 250, placeholder: 'Bạn đang nghĩ gì?', 'aria-label': 'Nội dung tin' });
      const caption = h('input', { class: 'story-caption-input', type: 'text', maxlength: 200, placeholder: 'Thêm chú thích…', 'aria-label': 'Chú thích ảnh', enterkeyhint: 'done' });
      const stage = h('div', { class: 'story-stage' });
      const error = h('p', { class: 'story-error', role: 'alert', hidden: true });
      const post = h('button', { class: 'btn btn-primary story-post', type: 'button' }, icon('send'), 'Đăng tin');
      const modeBtn = h('button', { class: 'story-tool', type: 'button' });
      const swatches = h('div', { class: 'story-swatches', role: 'radiogroup', 'aria-label': 'Màu nền' });
      const layer = h('div', { class: 'story-layer story-compose', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tạo tin 24 giờ' },
        h('div', { class: 'story-compose-top' },
          h('button', { class: 'story-close', type: 'button', 'aria-label': 'Đóng', onclick: () => closeComposer() }, icon('close')),
          h('span', { class: 'story-compose-title', text: 'Tin 24 giờ' }),
          modeBtn),
        stage,
        h('div', { class: 'story-compose-bottom' }, error, swatches, h('div', { class: 'story-compose-actions' }, h('span', { class: 'story-compose-hint', text: 'Cả nhóm xem được trong 24 giờ' }), post)),
        file);
      d.layer = layer;

      function draw() {
        layer.classList.toggle('is-photo', d.mode === 'photo');
        if (d.mode === 'text') {
          stage.style.background = bgCss(d.bg);
          stage.replaceChildren(area);
          swatches.hidden = false;
          swatches.replaceChildren(...Object.keys(BGS).map((k) => h('button', {
            type: 'button', class: 'story-swatch', role: 'radio', 'aria-checked': String(k === d.bg), 'aria-label': BG_NAMES[k],
            style: `background:${bgCss(k)}`,
            onclick: () => {
              d.bg = k;
              draw();
              area.focus();
            },
          })));
          modeBtn.replaceChildren(icon('image'), h('span', { text: 'Ảnh' }));
          modeBtn.setAttribute('aria-label', 'Chọn ảnh');
        } else {
          stage.style.background = '#000';
          stage.replaceChildren(h('img', { class: 'story-img', src: d.url, alt: 'Ảnh sẽ đăng' }), h('div', { class: 'story-caption-wrap' }, caption));
          swatches.hidden = true;
          modeBtn.replaceChildren(h('span', { class: 'story-aa', text: 'Aa' }), h('span', { text: 'Chữ' }));
          modeBtn.setAttribute('aria-label', 'Viết tin chữ');
        }
      }
      area.addEventListener('input', () => {
        error.hidden = true;
      });
      modeBtn.addEventListener('click', () => {
        if (d.mode === 'text') file.click();
        else {
          d.mode = 'text';
          draw();
          area.focus();
        }
      });
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        try {
          const out = await prepareImage(f, { max: 1600, quality: 0.85 });
          if (d.url) URL.revokeObjectURL(d.url);
          Object.assign(d, { mode: 'photo', blob: out.blob, w: out.w, h: out.h, url: URL.createObjectURL(out.blob) });
          error.hidden = true;
          draw();
        } catch (err) {
          toast(err.message);
        }
      });
      post.addEventListener('click', () => withBusy(post, async () => {
        const photo = d.mode === 'photo' && d.blob;
        const text = (photo ? caption.value : area.value).trim();
        if (!photo && !text) {
          error.textContent = 'Viết vài chữ hoặc chọn một ảnh nhé.';
          error.hidden = false;
          area.focus();
          return;
        }
        error.hidden = true;
        try {
          let body;
          if (photo) {
            const { url } = await api(`/api/upload?w=${d.w}&h=${d.h}`, { method: 'POST', raw: d.blob });
            body = { image: url, text };
          } else body = { text, bg: d.bg };
          const { story } = await api('/api/stories', { method: 'POST', body });
          S.stories.set(story.id, story);
          renderBar();
          closeComposer();
          toast('Đã đăng tin. Tin tự mất sau 24 giờ.');
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }));
      layer.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeComposer();
        }
      });
      draw();
      document.body.append(layer);
      document.body.classList.add('story-open');
      setTimeout(() => area.focus(), 60);
    }

    function closeComposer(silent) {
      const d = S.composer;
      if (!d) return;
      S.composer = null;
      if (d.url) URL.revokeObjectURL(d.url);
      d.layer.remove();
      if (!S.viewer) document.body.classList.remove('story-open');
      if (!silent && d.back && d.back.isConnected) d.back.focus({ preventScroll: true });
    }

    /* ---------------- Xem tin ---------------- */
    function openViewer(userId, storyId) {
      if (!state.me) return;
      const gs = groups();
      const order = gs.map((g) => g.userId);
      // Mở từ hàng vòng tròn: chỉ đi tiếp qua người khác nếu mở tin của người khác (tin của mình xem riêng)
      const queue = userId === me() ? [userId] : order.filter((id) => id !== me());
      const gi = queue.indexOf(userId);
      if (gi < 0) {
        toast('Tin này không còn nữa.');
        return;
      }
      closeComposer(true);
      closeViewer(true);
      const v = { queue, gi, si: 0, current: null, paused: 0, back: document.activeElement, holdTimer: null, held: false };
      S.viewer = v;
      const list = storiesOf(userId);
      v.si = storyId != null ? Math.max(0, list.findIndex((s) => s.id === storyId)) : firstUnseen(list);

      v.segs = h('div', { class: 'story-segs' });
      v.head = h('div', { class: 'story-head' });
      v.stage = h('div', { class: 'story-stage' });
      v.bottom = h('div', { class: 'story-bottom' });
      v.layer = h('div', { class: 'story-layer story-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Xem tin 24 giờ' },
        h('div', { class: 'story-view-top' }, v.segs, v.head),
        v.stage,
        v.bottom);
      // Chạm bên trái: tin trước; bên phải: tin sau; giữ: dừng lại
      v.stage.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        v.held = false;
        clearTimeout(v.holdTimer);
        v.holdTimer = setTimeout(() => {
          v.held = true;
          pause('hold');
        }, HOLD_MS);
      });
      const release = (e) => {
        clearTimeout(v.holdTimer);
        if (v.held) {
          v.held = false;
          resume('hold');
          return;
        }
        if (e.type !== 'pointerup') return;
        const r = v.stage.getBoundingClientRect();
        if (e.clientX - r.left < r.width * 0.3) prev();
        else next();
      };
      v.stage.addEventListener('pointerup', release);
      v.stage.addEventListener('pointercancel', release);
      v.stage.addEventListener('contextmenu', (e) => e.preventDefault());
      v.layer.addEventListener('keydown', (e) => {
        const typing = e.target.matches && e.target.matches('input, textarea');
        if (e.key === 'Escape') {
          e.preventDefault();
          if (v.sheet) closeViewersSheet();
          else closeViewer();
        } else if (!typing && e.key === 'ArrowRight') next();
        else if (!typing && e.key === 'ArrowLeft') prev();
      });
      document.body.append(v.layer);
      document.body.classList.add('story-open');
      show();
    }

    const storiesOf = (userId) => groups().find((g) => g.userId === userId)?.stories || [];
    const firstUnseen = (list) => Math.max(0, list.findIndex((s) => !s.seen && s.userId !== me()));

    function show() {
      const v = S.viewer;
      if (!v) return;
      const list = storiesOf(v.queue[v.gi]);
      if (!list.length) return goUser(1);
      v.si = Math.min(v.si, list.length - 1);
      const s = list[v.si];
      v.current = s;
      v.paused = 0;
      v.layer.classList.remove('is-paused');
      const u = userOf(s.userId);
      const own = s.userId === me();
      // Thanh tiến độ: mỗi tin một đoạn, đoạn đang xem chạy trong "dur" mili giây
      const dur = s.kind === 'image' ? IMAGE_MS : textMs(s.text);
      v.segs.replaceChildren(...list.map((x, i) => {
        const fill = h('i');
        const seg = h('span', { class: `story-seg${i < v.si ? ' is-done' : i === v.si ? ' is-active' : ''}` }, fill);
        if (i === v.si) {
          fill.style.animationDuration = `${dur}ms`;
          fill.addEventListener('animationend', () => {
            if (S.viewer === v && v.current === s) next();
          });
        }
        return seg;
      }));
      // replaceChildren không bỏ qua null (sẽ thành chữ "null"), nên lọc trước
      v.head.replaceChildren(...[
        avatarEl(u, 'avatar-sm', { dot: false }),
        h('span', { class: 'story-who' }, h('strong', { text: own ? 'Tin của bạn' : u.displayName }), h('span', { text: ago(s.createdAt) })),
        own ? h('button', { class: 'story-icon', type: 'button', 'aria-label': 'Xóa tin này', onclick: () => removeStory(s) }, icon('trash')) : null,
        h('button', { class: 'story-icon story-close', type: 'button', 'aria-label': 'Đóng', onclick: () => closeViewer() }, icon('close')),
      ].filter(Boolean));
      if (s.kind === 'image') {
        v.stage.style.background = '#000';
        const img = h('img', { class: 'story-img', src: s.image, alt: s.text || `Ảnh trong tin của ${own ? 'bạn' : u.displayName}` });
        // Ảnh chưa tải xong thì chưa chạy thanh tiến độ
        if (!img.complete) {
          pause('load');
          const done = () => resume('load');
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }
        v.stage.replaceChildren(...[img, s.text ? h('p', { class: 'story-caption', text: s.text }) : null].filter(Boolean));
      } else {
        v.stage.style.background = bgCss(s.bg);
        v.stage.replaceChildren(h('p', { class: `story-big-text${s.text.length > 120 ? ' is-long' : ''}`, text: s.text }));
      }
      if (own) drawOwnerBar();
      else drawReplyBar(s, u);
      // Đánh dấu đã xem
      if (!own && !s.seen) {
        s.seen = true;
        api(`/api/stories/${s.id}/view`, { method: 'POST' }).catch(() => {});
      }
      if (!v.layer.contains(document.activeElement)) $close(v).focus({ preventScroll: true });
    }
    const $close = (v) => v.layer.querySelector('.story-close');

    function drawOwnerBar() {
      const v = S.viewer;
      if (!v || !v.current) return;
      const s = v.current;
      const n = s.views || 0;
      v.bottom.replaceChildren(h('button', { class: 'story-viewers-btn', type: 'button', onclick: () => openViewersSheet(s) },
        icon('eye'),
        h('span', { text: n ? `${n} người đã xem` : 'Chưa có ai xem' }),
        s.reactions ? h('span', { class: 'story-viewers-react', text: `· ${s.reactions} cảm xúc` }) : null));
    }

    function drawReplyBar(s, u) {
      const v = S.viewer;
      const input = h('input', { class: 'story-reply-input', type: 'text', maxlength: 1000, placeholder: `Trả lời ${u.displayName}…`, 'aria-label': `Trả lời tin của ${u.displayName}`, enterkeyhint: 'send' });
      const send = h('button', { class: 'story-icon story-send', type: 'submit', 'aria-label': 'Gửi trả lời' }, icon('send'));
      const form = h('form', { class: 'story-reply' }, input, send);
      input.addEventListener('focus', () => pause('type'));
      input.addEventListener('blur', () => resume('type'));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        withBusy(send, async () => {
          try {
            await api(`/api/stories/${s.id}/reply`, { method: 'POST', body: { text } });
            input.value = '';
            input.blur();
            toast(`Đã gửi cho ${u.displayName}.`);
          } catch (err) {
            toast(err.message);
          }
        });
      });
      const reacts = h('div', { class: 'story-reacts', role: 'group', 'aria-label': 'Thả cảm xúc' }, REACTIONS.map((emoji) => h('button', {
        class: `story-react${s.myReaction === emoji ? ' is-on' : ''}`, type: 'button', text: emoji, 'aria-label': `Thả ${emoji}`,
        onclick: async (e) => {
          const btn = e.currentTarget;
          floatEmoji(emoji, btn);
          try {
            await api(`/api/stories/${s.id}/reply`, { method: 'POST', body: { emoji } });
            s.myReaction = emoji;
            if (S.viewer === v && v.current === s) drawReplyBar(s, u);
            toast(`Đã gửi ${emoji} cho ${u.displayName}.`);
          } catch (err) {
            toast(err.message);
          }
        },
      })));
      v.bottom.replaceChildren(reacts, form);
    }

    function floatEmoji(emoji, from) {
      const v = S.viewer;
      if (!v || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const r = from.getBoundingClientRect();
      const el = h('span', { class: 'story-float', text: emoji, 'aria-hidden': 'true' });
      el.style.left = `${r.left + r.width / 2}px`;
      el.style.top = `${r.top}px`;
      v.layer.append(el);
      el.addEventListener('animationend', () => el.remove());
    }

    function pause(reason) {
      const v = S.viewer;
      if (!v) return;
      v.paused |= REASON[reason];
      v.layer.classList.add('is-paused');
    }
    function resume(reason) {
      const v = S.viewer;
      if (!v) return;
      v.paused &= ~REASON[reason];
      if (!v.paused) v.layer.classList.remove('is-paused');
    }
    const REASON = { hold: 1, type: 2, sheet: 4, load: 8, hidden: 16 };

    function goUser(step) {
      const v = S.viewer;
      if (!v) return;
      const gi = v.gi + step;
      if (gi < 0 || gi >= v.queue.length) {
        if (step > 0) closeViewer();
        else show();
        return;
      }
      v.gi = gi;
      const list = storiesOf(v.queue[gi]);
      v.si = step > 0 ? firstUnseen(list) : 0;
      show();
    }
    function next() {
      const v = S.viewer;
      if (!v) return;
      const list = storiesOf(v.queue[v.gi]);
      if (v.si + 1 < list.length) {
        v.si += 1;
        show();
      } else goUser(1);
    }
    function prev() {
      const v = S.viewer;
      if (!v) return;
      if (v.si > 0) {
        v.si -= 1;
        show();
      } else if (v.gi > 0) goUser(-1);
      else show(); // tin đầu tiên: chạy lại từ đầu
    }
    // Tin đang xem vừa bị xóa / hết hạn
    function viewerSkipGone() {
      const v = S.viewer;
      if (!v) return;
      const list = storiesOf(v.queue[v.gi]);
      if (!list.length) return goUser(1);
      v.si = Math.min(v.si, list.length - 1);
      show();
    }

    async function removeStory(s) {
      pause('sheet');
      if (!window.confirm('Xóa tin này? Mọi người sẽ không xem được nữa.')) {
        resume('sheet');
        return;
      }
      try {
        await api(`/api/stories/${s.id}`, { method: 'DELETE' });
        S.stories.delete(s.id);
        renderBar();
        if (onGone) onGone(s.id);
        toast('Đã xóa tin.');
        resume('sheet');
        viewerSkipGone();
      } catch (err) {
        resume('sheet');
        toast(err.message);
      }
    }

    // Ai đã xem (chỉ người đăng)
    async function openViewersSheet(s) {
      const v = S.viewer;
      if (!v) return;
      pause('sheet');
      const body = h('ul', { class: 'story-viewers' }, h('li', { class: 'hint', text: 'Đang tải…' }));
      const sheet = h('div', { class: 'story-sheet', role: 'dialog', 'aria-label': 'Người đã xem tin' },
        h('div', { class: 'story-sheet-head' },
          h('strong', { text: 'Người đã xem' }),
          h('button', { class: 'story-icon', type: 'button', 'aria-label': 'Đóng danh sách', onclick: () => closeViewersSheet() }, icon('close'))),
        body);
      v.sheet = sheet;
      v.layer.append(sheet);
      sheet.querySelector('button').focus();
      try {
        const { viewers } = await api(`/api/stories/${s.id}/viewers`);
        body.replaceChildren(...(viewers.length
          ? viewers.map((x) => {
              const u = userOf(x.userId);
              return h('li', null, avatarEl(u, 'avatar-sm', { dot: false }),
                h('span', { class: 'story-viewer-name' }, h('strong', { text: u.displayName }), h('span', { text: `Đã xem ${ago(x.viewedAt).toLowerCase()}${x.viewedAt > Date.now() - 60000 ? '' : ' trước'}` })),
                x.reaction ? h('span', { class: 'story-viewer-react', text: x.reaction, 'aria-label': `Đã thả ${x.reaction}` }) : null);
            })
          : [h('li', { class: 'hint', text: 'Chưa có ai xem tin này.' })]));
      } catch (err) {
        body.replaceChildren(h('li', { class: 'hint', text: err.message }));
      }
    }
    function closeViewersSheet() {
      const v = S.viewer;
      if (!v || !v.sheet) return;
      v.sheet.remove();
      v.sheet = null;
      resume('sheet');
      $close(v).focus({ preventScroll: true });
    }

    function closeViewer(silent) {
      const v = S.viewer;
      if (!v) return;
      S.viewer = null;
      clearTimeout(v.holdTimer);
      v.layer.remove();
      if (!S.composer) document.body.classList.remove('story-open');
      renderBar();
      if (!silent && v.back && v.back.isConnected) v.back.focus({ preventScroll: true });
    }

    // Ẩn trang (chuyển app khác) thì dừng
    document.addEventListener('visibilitychange', () => (document.hidden ? pause('hidden') : resume('hidden')));

    /* ---------------- Khung "Đã trả lời tin của bạn" trong tin nhắn ---------------- */
    function refEl(m) {
      const st = m.story;
      if (!st || m.deleted) return null;
      const mine = m.senderId === me();
      const owner = st.ownerId === me() ? 'bạn' : nameOf(st.ownerId);
      const label = st.reaction
        ? `${mine ? 'Bạn đã bày tỏ' : 'Đã bày tỏ'} cảm xúc về tin của ${owner}`
        : `${mine ? 'Bạn đã trả lời' : 'Đã trả lời'} tin của ${owner}`;
      const local = S.stories.get(st.id);
      const live = S.loaded ? Boolean(local && alive(local)) : Boolean(st.alive);
      let thumb;
      if (!live) thumb = h('span', { class: 'story-thumb-gone', text: 'Tin không còn xem được' });
      else if (st.kind === 'image' && st.image) thumb = h('img', { src: st.image, alt: '', loading: 'lazy' });
      else thumb = h('span', { class: 'story-thumb-text', style: `background:${bgCss(st.bg)}`, text: st.text });
      return h('div', { class: 'story-ref' },
        h('span', { class: 'story-ref-label', text: label }),
        live
          ? h('button', { class: 'story-thumb', type: 'button', 'aria-label': `Xem tin của ${owner}`, onclick: () => openViewer(st.ownerId, st.id) }, thumb)
          : h('span', { class: 'story-thumb is-gone' }, thumb));
    }

    // Chữ xem trước trong danh sách chat cho tin thả cảm xúc
    function previewOf(m) {
      const st = m.story;
      if (!st || !st.reaction || m.deleted) return null;
      const owner = st.ownerId === me() ? 'bạn' : nameOf(st.ownerId);
      return `${m.senderId === me() ? 'Bạn đã bày tỏ' : 'Đã bày tỏ'} cảm xúc ${m.text} về tin của ${owner}`;
    }

    return { load, reset, onEvent, renderBar, openComposer, openViewer, refEl, previewOf, _state: S };
  }

  return { create, BGS, REACTIONS, ago, textMs };
})();
