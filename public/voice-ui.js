'use strict';
/* Tin nhắn thoại trên bản web (máy chủ: server.js /api/upload/audio; phần dùng chung: public/voice-core.js).
   - Ghi âm: giữ nút micro để nói, thả tay là gửi, kéo ngón tay ra xa nút để hủy. Chạm nhanh (hoặc Enter / Space)
     thì ghi âm rảnh tay: bấm Gửi hoặc Hủy trên thanh ghi âm. Tối đa 2 phút.
   - Nghe: nút phát / tạm dừng, dạng sóng chạy theo tiến độ (chạm vào sóng để tua), đổi tốc độ 1× / 1,5× / 2×.
     Mỗi lúc chỉ phát một tin; phát xong tự chuyển sang tin thoại kế tiếp chưa nghe trong cùng khung chat. */
window.ThinkVoice = (() => {
  const V = window.VoiceCore;
  const RATES = [1, 1.5, 2];
  const KEY_RATE = 'voice-rate';
  const HOLD_TAP_MS = 300; // thả tay sớm hơn thế này: coi là chạm nhanh → ghi âm rảnh tay
  const CANCEL_DIST = 70; // kéo ngón tay ra xa nút micro hơn thế này: thả tay là hủy

  function create(host) {
    const { h, icon, toast } = host;

    /* =================== Nghe =================== */
    const P = { audio: null, key: null, el: null, raf: 0, ms: 0, onEnd: null };
    let rate = 1;
    try { rate = RATES.includes(Number(localStorage.getItem(KEY_RATE))) ? Number(localStorage.getItem(KEY_RATE)) : 1; } catch { /* thôi */ }

    const durationOf = (ms) => {
      const d = P.audio && Number.isFinite(P.audio.duration) && P.audio.duration > 0 ? P.audio.duration * 1000 : 0;
      return d || ms || 0;
    };

    function paint() {
      cancelAnimationFrame(P.raf);
      const el = P.el && P.el.isConnected ? P.el : document.querySelector(`.voice[data-key="${CSS.escape(P.key || '')}"]`);
      if (el) {
        P.el = el;
        const playing = Boolean(P.audio && !P.audio.paused);
        const total = durationOf(P.ms);
        const pos = P.audio ? P.audio.currentTime * 1000 : 0;
        const frac = total ? Math.min(1, pos / total) : 0;
        el.classList.toggle('is-playing', playing);
        el.classList.add('is-active');
        const bars = el.querySelectorAll('.voice-wave i');
        const n = Math.round(frac * bars.length);
        bars.forEach((b, i) => b.classList.toggle('is-played', i < n));
        const t = el.querySelector('.voice-time');
        if (t) t.textContent = V.clock(playing || pos > 0 ? pos : total);
        const btn = el.querySelector('.voice-play');
        if (btn) {
          btn.replaceChildren(icon(playing ? 'pause' : 'play'));
          btn.setAttribute('aria-label', playing ? 'Tạm dừng' : 'Phát tin nhắn thoại');
        }
      }
      if (P.audio && !P.audio.paused) P.raf = requestAnimationFrame(paint);
    }

    function stop() {
      if (P.audio) {
        P.audio.pause();
        P.audio.removeAttribute('src');
        P.audio.load();
      }
      const old = P.el;
      P.audio = null;
      P.key = null;
      P.el = null;
      cancelAnimationFrame(P.raf);
      if (old) resetEl(old);
    }

    function resetEl(el) {
      el.classList.remove('is-playing', 'is-active');
      el.querySelectorAll('.voice-wave i').forEach((b) => b.classList.remove('is-played'));
      const t = el.querySelector('.voice-time');
      if (t) t.textContent = V.clock(Number(el.dataset.ms) || 0);
      const btn = el.querySelector('.voice-play');
      if (btn) {
        btn.replaceChildren(icon('play'));
        btn.setAttribute('aria-label', 'Phát tin nhắn thoại');
      }
    }

    function play(key, url, ms, el, at = null) {
      if (P.key !== key) {
        stop();
        const audio = new Audio();
        audio.preload = 'auto';
        audio.src = url;
        audio.playbackRate = rate;
        P.audio = audio;
        P.key = key;
        P.ms = ms;
        P.el = el;
        audio.addEventListener('ended', () => {
          const done = P.el;
          const next = done ? nextAfter(done) : null;
          stop();
          if (next) next.querySelector('.voice-play')?.click(); // phát tiếp tin thoại kế tiếp
        });
        audio.addEventListener('error', () => {
          if (P.audio !== audio) return;
          stop();
          toast('Không phát được tin nhắn thoại này.');
        });
        audio.addEventListener('pause', paint);
        audio.addEventListener('play', paint);
      }
      if (at != null) {
        const total = durationOf(ms);
        if (total) P.audio.currentTime = (at * total) / 1000;
      }
      P.audio.play().catch((err) => {
        if (err && err.name === 'AbortError') return;
        stop();
        toast('Không phát được tin nhắn thoại này.');
      });
      paint();
    }

    // Tin thoại kế tiếp (chưa phát) ngay bên dưới trong khung chat
    function nextAfter(el) {
      const all = [...document.querySelectorAll('#messages .voice')];
      const i = all.indexOf(el);
      return i >= 0 ? all.slice(i + 1).find((x) => !x.closest('.is-mine')) || null : null;
    }

    /** Khung nghe tin nhắn thoại trong bong bóng (m.audio = { url, ms, wave }) */
    function player(m) {
      const a = m.audio;
      if (!a || !a.url) {
        return h('div', { class: 'voice is-gone' }, icon('mic'), h('span', { text: m.audioPurged ? 'Tin nhắn thoại đã được dọn khỏi máy chủ' : 'Tin nhắn thoại' }));
      }
      const key = a.url;
      const bars = V.decodeWave(a.wave);
      const wave = h('span', {
        class: 'voice-wave',
        role: 'slider',
        tabindex: '-1',
        'aria-label': 'Tua tin nhắn thoại',
        'aria-valuemin': '0',
        'aria-valuemax': String(Math.round((a.ms || 0) / 1000)),
        onclick: (e) => {
          e.stopPropagation();
          const r = wave.getBoundingClientRect();
          const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          play(key, a.url, a.ms, el, frac);
        },
      }, bars.map((v) => h('i', { style: `height:${Math.round(18 + v * 82)}%` })));
      const speed = h('button', {
        class: 'voice-speed', type: 'button', text: `${String(rate).replace('.', ',')}×`, 'aria-label': `Tốc độ ${rate}×. Bấm để đổi`,
        onclick: (e) => {
          e.stopPropagation();
          rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
          try { localStorage.setItem(KEY_RATE, String(rate)); } catch { /* thôi */ }
          if (P.audio) P.audio.playbackRate = rate;
          for (const b of document.querySelectorAll('.voice-speed')) {
            b.textContent = `${String(rate).replace('.', ',')}×`;
            b.setAttribute('aria-label', `Tốc độ ${rate}×. Bấm để đổi`);
          }
        },
      });
      const el = h('div', { class: 'voice', dataset: { key, ms: String(a.ms || 0) } },
        h('button', {
          class: 'voice-play', type: 'button', 'aria-label': 'Phát tin nhắn thoại',
          onclick: (e) => {
            e.stopPropagation();
            if (P.key === key && P.audio && !P.audio.paused) P.audio.pause();
            else play(key, a.url, a.ms, el);
          },
        }, icon('play')),
        wave,
        h('span', { class: 'voice-time', text: V.clock(a.ms) }),
        speed);
      if (P.key === key) {
        P.el = el;
        requestAnimationFrame(paint); // đang phát tin này: vẽ lại sau khi khung chat dựng lại
      }
      return el;
    }

    /* =================== Ghi âm =================== */
    const R = {
      state: 'idle', // idle | starting | recording | finishing
      held: false,
      locked: false,
      cancelZone: false,
      downAt: 0,
      start: null,
      stream: null,
      rec: null,
      chunks: [],
      levels: [],
      ctx: null,
      timer: 0,
      startedAt: 0,
      onSend: null,
      bar: null,
      button: null,
    };

    const supported = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    const pickType = () => {
      for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
        try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* thử loại khác */ }
      }
      return '';
    };

    function drawBar() {
      const b = R.bar;
      if (!b) return;
      const on = R.state !== 'idle';
      b.hidden = !on;
      R.button.classList.toggle('is-recording', on);
      if (R.button.parentElement) R.button.parentElement.classList.toggle('is-recording', on); // thanh ghi âm thay chỗ ô nhập
      R.button.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('is-locked', R.locked);
      b.classList.toggle('is-cancel', R.cancelZone && !R.locked);
      if (!on) return;
      const ms = R.startedAt ? performance.now() - R.startedAt : 0;
      b.querySelector('.voice-rec-time').textContent = V.clock(ms);
      b.querySelector('.voice-rec-hint').textContent = R.state === 'starting'
        ? 'Đang bật micro…'
        : R.locked ? 'Đang ghi âm' : R.cancelZone ? 'Thả tay để hủy' : 'Thả để gửi · kéo xa để hủy';
      const live = b.querySelector('.voice-rec-live');
      const recent = R.levels.slice(-live.children.length);
      [...live.children].forEach((bar, i) => {
        const v = recent[i - (live.children.length - recent.length)] || 0;
        bar.style.height = `${Math.round(12 + v * 88)}%`;
      });
    }

    function attach({ button, bar, onSend, canRecord }) {
      R.button = button;
      R.bar = bar;
      R.onSend = onSend;
      bar.replaceChildren(
        h('span', { class: 'voice-rec-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'voice-rec-time', text: '0:00' }),
        h('span', { class: 'voice-rec-live', 'aria-hidden': 'true' }, Array.from({ length: 28 }, () => h('i'))),
        h('span', { class: 'voice-rec-hint', role: 'status' }),
        h('button', { class: 'voice-rec-cancel', type: 'button', 'aria-label': 'Hủy ghi âm', onclick: () => cancel() }, icon('trash')),
        h('button', { class: 'voice-rec-send', type: 'button', 'aria-label': 'Gửi tin nhắn thoại', onclick: () => finish() }, icon('send')));
      bar.hidden = true;

      button.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || R.state === 'finishing') return;
        e.preventDefault();
        if (R.state !== 'idle') { // đang ghi rảnh tay: chạm nút micro lần nữa là gửi
          R.held = false;
          finish();
          return;
        }
        if (canRecord && !canRecord()) return;
        try { button.setPointerCapture(e.pointerId); } catch { /* thôi */ }
        R.held = true;
        R.locked = false;
        R.cancelZone = false;
        R.downAt = performance.now();
        R.start = { x: e.clientX, y: e.clientY };
        begin();
      });
      button.addEventListener('pointermove', (e) => {
        if (!R.held || !R.start) return;
        const far = Math.hypot(e.clientX - R.start.x, e.clientY - R.start.y) > CANCEL_DIST;
        if (far !== R.cancelZone) {
          R.cancelZone = far;
          drawBar();
        }
      });
      button.addEventListener('pointerup', () => {
        if (!R.held) return;
        R.held = false;
        if (performance.now() - R.downAt < HOLD_TAP_MS || R.state === 'starting') {
          R.locked = true; // chạm nhanh (hoặc máy còn đang hỏi quyền micro): ghi âm rảnh tay
          drawBar();
        } else if (R.cancelZone) {
          cancel();
        } else {
          finish();
        }
      });
      button.addEventListener('pointercancel', () => {
        if (!R.held) return;
        R.held = false;
        cancel();
      });
      // Bàn phím / trình đọc màn hình: Enter / Space bật ghi rảnh tay, bấm lần nữa để gửi
      button.addEventListener('click', (e) => {
        if (e.detail !== 0) return;
        if (R.state === 'idle') {
          if (canRecord && !canRecord()) return;
          R.locked = true;
          begin();
        } else {
          finish();
        }
      });
      button.addEventListener('contextmenu', (e) => e.preventDefault()); // giữ lâu không mở menu của trình duyệt
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && R.state !== 'idle') cancel();
      });
    }

    async function begin() {
      if (!supported()) {
        R.held = false;
        toast('Trình duyệt này chưa ghi âm được. Hãy cập nhật trình duyệt hoặc dùng App Think Beta.');
        return;
      }
      stop(); // đang nghe tin thoại thì dừng
      R.state = 'starting';
      R.levels = [];
      R.startedAt = 0;
      drawBar();
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (err) {
        R.state = 'idle';
        R.locked = false;
        R.held = false;
        drawBar();
        toast(err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
          ? 'Think chưa được dùng micro. Bật quyền micro cho trang này trong cài đặt trình duyệt rồi thử lại.'
          : 'Không bật được micro. Kiểm tra micro của máy rồi thử lại.');
        return;
      }
      if (R.state !== 'starting') { // đã hủy trong lúc chờ quyền micro
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const type = pickType();
      let rec;
      try {
        rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
      } catch {
        rec = new MediaRecorder(stream);
      }
      R.stream = stream;
      R.rec = rec;
      R.chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) R.chunks.push(e.data); };
      rec.start(250);
      R.startedAt = performance.now();
      R.state = 'recording';
      // Mức âm lượng để vẽ sóng
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        R.ctx = new Ctx();
        const src = R.ctx.createMediaStreamSource(stream);
        const an = R.ctx.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        R.sample = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          R.levels.push(Math.min(1, Math.pow(rms * 5, 0.8)));
        };
      } catch {
        R.sample = () => R.levels.push(0.3);
      }
      R.timer = setInterval(() => {
        if (R.state !== 'recording') return;
        R.sample();
        drawBar();
        if (performance.now() - R.startedAt >= V.MAX_MS) {
          toast('Tin nhắn thoại dài tối đa 2 phút — đã gửi.');
          finish();
        }
      }, 80);
      drawBar();
    }

    function release() {
      clearInterval(R.timer);
      if (R.stream) R.stream.getTracks().forEach((t) => t.stop());
      if (R.ctx) R.ctx.close().catch(() => {});
      R.stream = null;
      R.ctx = null;
      R.rec = null;
      R.state = 'idle';
      R.locked = false;
      R.cancelZone = false;
      R.held = false;
      drawBar();
    }

    function cancel() {
      if (R.state === 'idle') return;
      const rec = R.rec;
      R.chunks = [];
      if (rec && rec.state !== 'inactive') {
        rec.ondataavailable = null;
        try { rec.stop(); } catch { /* đã dừng */ }
      }
      release();
    }

    function finish() {
      if (R.state === 'starting') {
        cancel();
        return;
      }
      if (R.state !== 'recording') return;
      const rec = R.rec;
      const ms = Math.round(performance.now() - R.startedAt);
      const wave = V.encodeWave(R.levels);
      R.state = 'finishing';
      drawBar();
      rec.onstop = () => {
        const blob = new Blob(R.chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
        R.chunks = [];
        release();
        if (ms < V.MIN_MS || !blob.size) {
          toast('Tin nhắn thoại ngắn quá. Giữ nút micro trong lúc nói nhé.');
          return;
        }
        if (R.onSend) R.onSend({ blob, ms: Math.min(ms, V.MAX_MS), wave });
      };
      try { rec.stop(); } catch { release(); }
    }

    return { player, stop, attach, cancel, get recording() { return R.state !== 'idle'; } };
  }

  return { create };
})();
