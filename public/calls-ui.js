/* Gọi thoại / gọi video 1-1 (2.10.0) cho bản web. Máy chủ: src/calls.js (chỉ chuyển lời mời và thông tin kết nối).
   Tiếng và hình đi thẳng giữa hai máy bằng WebRTC. App Think Beta có bản riêng: native/src/calls/. */
(function () {
  'use strict';

  const supported = () => Boolean(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const CONNECT_MS = 30000; // trả lời rồi mà 30 giây chưa nối được tiếng / hình thì dừng
  const LOST_MS = 20000; // mất kết nối giữa chừng quá 20 giây thì dừng

  const clock = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  };

  function create(ctx) {
    const { h, icon, toast, state, avatarEl, userOf } = ctx;
    let socket = null;
    let cur = null; // cuộc gọi đang diễn ra trên máy này
    let layer = null;
    let closeTimer = null;
    let tone = null;
    let wakeLock = null;

    /* ---------------- Gửi sự kiện tới máy chủ ---------------- */
    function emit(ev, data) {
      return new Promise((resolve) => {
        if (!socket || !socket.connected) {
          resolve({ error: 'Chưa kết nối được máy chủ. Thử lại sau giây lát.' });
          return;
        }
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          resolve({ error: 'Máy chủ không trả lời. Thử lại sau.' });
        }, 12000);
        socket.emit(ev, data, (res) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve(res || {});
        });
      });
    }
    const signal = (data) => cur && cur.call && emit('call:signal', { callId: cur.call.id, data });
    const sendMedia = () => cur && cur.call && emit('call:media', { callId: cur.call.id, muted: cur.muted, camera: cur.camOn });

    /* ---------------- Chuông (WebAudio, không cần file âm thanh) ---------------- */
    function startTone(kind) {
      stopTone();
      const AC = window.AudioContext || window.webkitAudioContext;
      let ac = null;
      try {
        ac = AC ? new AC() : null;
      } catch {
        ac = null;
      }
      if (ac && ac.resume) ac.resume().catch(() => {});
      const note = (freq, at, dur, vol) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(vol, at + 0.02);
        g.gain.setValueAtTime(vol, at + dur - 0.05);
        g.gain.linearRampToValueAtTime(0, at + dur);
        o.connect(g).connect(ac.destination);
        o.start(at);
        o.stop(at + dur + 0.05);
      };
      const play = () => {
        if (kind === 'in' && navigator.vibrate) navigator.vibrate([350, 200, 350]);
        if (!ac || ac.state === 'closed') return;
        const t = ac.currentTime + 0.05;
        if (kind === 'out') {
          note(425, t, 1, 0.06); // tút… như tổng đài
        } else {
          [659, 784, 1047, 784, 1047].forEach((f, i) => note(f, t + i * 0.16, 0.15, 0.09));
          [659, 784, 1047, 784, 1047].forEach((f, i) => note(f, t + 1 + i * 0.16, 0.15, 0.09));
        }
      };
      play();
      tone = { ac, timer: setInterval(play, kind === 'out' ? 4000 : 3000) };
    }
    function stopTone() {
      if (!tone) return;
      clearInterval(tone.timer);
      if (tone.ac) tone.ac.close().catch(() => {});
      if (navigator.vibrate) navigator.vibrate(0);
      tone = null;
    }

    /* ---------------- Micro, máy ảnh ---------------- */
    function mediaError(err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'Bạn chưa cho phép dùng micro / máy ảnh. Bật quyền trong cài đặt trình duyệt rồi gọi lại.';
      if (name === 'NotFoundError') return 'Không tìm thấy micro trên máy này.';
      if (name === 'NotReadableError') return 'Micro / máy ảnh đang bị app khác dùng.';
      return 'Không mở được micro / máy ảnh.';
    }
    async function getMedia(me, video) {
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      const cam = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } };
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video: video ? cam : false });
      } catch (err) {
        if (!video || err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          toast(mediaError(err));
          return false;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio }); // không có máy ảnh: gọi bằng tiếng
          me.camOn = false;
          toast('Không mở được máy ảnh, cuộc gọi chỉ có tiếng.');
        } catch (err2) {
          toast(mediaError(err2));
          return false;
        }
      }
      if (cur !== me) {
        stream.getTracks().forEach((t) => t.stop()); // đã gác máy trong lúc chờ quyền
        return false;
      }
      me.local = stream;
      if (video && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then((list) => {
          me.cams = list.filter((d) => d.kind === 'videoinput').length;
          render();
        }).catch(() => {});
      }
      return true;
    }

    /* ---------------- Kết nối WebRTC ---------------- */
    function ensurePc(me) {
      if (me.pc) return me.pc;
      const pc = new RTCPeerConnection({ iceServers: (me.call && me.call.iceServers) || [] });
      me.pc = pc;
      pc.onicecandidate = (e) => {
        if (e.candidate && cur === me) signal({ candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
      };
      pc.ontrack = (e) => {
        if (cur !== me) return;
        const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
        me.remote = stream;
        if (e.track.kind === 'video') me.remoteVideo = true;
        const v = layer && layer.querySelector('.call-remote');
        if (v && v.srcObject !== stream) {
          v.srcObject = stream;
          v.play().catch(() => {});
        }
        render();
      };
      pc.onconnectionstatechange = () => onConnState(me, pc.connectionState);
      pc.oniceconnectionstatechange = () => {
        // Safari cũ không có connectionState
        if (pc.connectionState === undefined) onConnState(me, pc.iceConnectionState === 'completed' ? 'connected' : pc.iceConnectionState);
      };
      return pc;
    }
    function addLocalTracks(me, pc) {
      if (me.tracksAdded || !me.local) return;
      me.local.getTracks().forEach((t) => pc.addTrack(t, me.local));
      me.tracksAdded = true;
    }
    async function sendOffer(me, restart) {
      const pc = ensurePc(me);
      addLocalTracks(me, pc);
      const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      me.offered = true;
      signal({ sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    }
    function onConnState(me, st) {
      if (cur !== me) return;
      if (st === 'connected') {
        clearTimeout(me.lostTimer);
        clearTimeout(me.connectTimer);
        me.lostTimer = null;
        if (!me.connectedAt) me.connectedAt = Date.now();
        me.phase = 'active';
        me.reconnecting = false;
        render();
      } else if (st === 'disconnected' || st === 'failed') {
        me.reconnecting = true;
        render();
        if (st === 'failed' && me.role === 'caller' && !me.restarted) {
          me.restarted = true; // thử nối lại một lần (đổi đường mạng, vd wifi → 4G)
          sendOffer(me, true).catch(() => {});
        }
        if (!me.lostTimer) me.lostTimer = setTimeout(() => cur === me && hangup('Mất kết nối cuộc gọi.'), LOST_MS);
      }
    }
    async function onSignal({ callId, data }) {
      const me = cur;
      if (!me || !me.call || me.call.id !== callId || !data) return;
      try {
        if (data.sdp) {
          const pc = ensurePc(me);
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            addLocalTracks(me, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signal({ sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
          }
          for (const c of me.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        } else if (data.candidate) {
          if (!me.pc || !me.pc.remoteDescription) me.pendingIce.push(data.candidate);
          else await me.pc.addIceCandidate(data.candidate).catch(() => {});
        }
      } catch (err) {
        console.warn('[call]', err);
        if (cur === me) hangup('Không kết nối được cuộc gọi.');
      }
    }
    function watchConnect(me) {
      clearTimeout(me.connectTimer);
      me.connectTimer = setTimeout(() => {
        if (cur === me && !me.connectedAt) hangup('Không nối được tiếng. Mạng hai bên có thể đang chặn cuộc gọi (admin có thể cài máy chủ TURN trong Quản trị).');
      }, CONNECT_MS);
    }

    /* ---------------- Gọi đi, nghe máy, gác máy ---------------- */
    async function start(convId, video) {
      if (cur) return toast('Bạn đang trong một cuộc gọi.');
      if (!supported()) return toast('Trình duyệt này chưa gọi được. Hãy dùng Chrome, Edge, Safari hoặc Firefox bản mới.');
      if (!window.isSecureContext) return toast('Cần mở Think bằng https:// để gọi được.');
      const conv = state.convs.get(convId);
      const peer = conv && userOf(conv.peerId);
      if (!conv || conv.type !== 'dm' || !peer) return toast('Chỉ gọi được trong cuộc trò chuyện riêng.');
      if (peer.bot) return toast('Think AI chưa nghe điện thoại được 😅');
      const me = newCall({ role: 'caller', phase: 'preparing', video, convId, peer });
      if (!(await getMedia(me, video))) return finish(me);
      if (cur !== me) return;
      render();
      const res = await emit('call:start', { conversationId: convId, video });
      if (cur !== me) {
        if (res.call) emit('call:end', { callId: res.call.id });
        return;
      }
      if (res.error) {
        toast(res.error);
        return finish(me);
      }
      me.call = res.call;
      me.phase = 'ringing';
      startTone('out');
      render();
    }

    function onIncoming(call) {
      if (!call || !call.id) return;
      if (cur) {
        if (cur.call && cur.call.id === call.id) return;
        emit('call:decline', { callId: call.id, busy: true }); // đang gọi trên máy này
        return;
      }
      const peer = userOf(call.callerId) || { id: call.callerId, displayName: call.caller.displayName, avatar: call.caller.avatar };
      const me = newCall({ role: 'callee', phase: 'incoming', video: call.video, convId: call.conversationId, peer, call });
      startTone('in');
      render();
      const accept = layer.querySelector('.is-accept');
      if (accept) accept.focus({ preventScroll: true });
      if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
        navigator.serviceWorker.ready
          .then((reg) => reg.showNotification(peer.displayName, {
            body: call.video ? '📹 Đang gọi video cho bạn…' : '📞 Đang gọi thoại cho bạn…',
            tag: `call-${call.conversationId}`,
            icon: peer.avatar || '/icons/icon-192.png',
            data: { url: `/#/c/${call.conversationId}` },
            requireInteraction: true,
          }))
          .catch(() => {});
      }
      return me;
    }

    async function accept() {
      const me = cur;
      if (!me || me.phase !== 'incoming') return;
      stopTone();
      me.phase = 'connecting';
      render();
      if (!(await getMedia(me, me.video))) {
        if (cur === me) {
          emit('call:decline', { callId: me.call.id });
          finish(me);
        }
        return;
      }
      if (cur !== me) return;
      const res = await emit('call:accept', { callId: me.call.id });
      if (cur !== me) return;
      if (res.error) {
        toast(res.error);
        return finish(me);
      }
      me.call = res.call;
      ensurePc(me);
      watchConnect(me);
      sendMedia();
      render();
    }

    async function onAccepted({ callId }) {
      const me = cur;
      if (!me || !me.call || me.call.id !== callId || me.role !== 'caller' || me.offered) return;
      stopTone();
      me.phase = 'connecting';
      render();
      watchConnect(me);
      try {
        await sendOffer(me);
        sendMedia();
      } catch (err) {
        console.warn('[call]', err);
        if (cur === me) hangup('Không kết nối được cuộc gọi.');
      }
    }

    const ENDED = {
      ended: () => 'Cuộc gọi đã kết thúc',
      declined: (me) => (me.role === 'caller' ? `${me.peer.displayName} đã từ chối cuộc gọi` : 'Đã từ chối'),
      missed: (me) => (me.role === 'caller' ? 'Không có ai trả lời' : 'Cuộc gọi nhỡ'),
      canceled: (me) => (me.role === 'caller' ? 'Đã hủy cuộc gọi' : 'Cuộc gọi nhỡ'),
      busy: (me) => `${me.peer.displayName} đang bận`,
      elsewhere: () => 'Đã trả lời trên máy khác',
      dropped: () => 'Mất kết nối cuộc gọi',
    };
    function onEnded({ callId, reason }) {
      const me = cur;
      if (!me || !me.call || me.call.id !== callId) return;
      finish(me, (ENDED[reason] || ENDED.ended)(me), reason === 'elsewhere' ? 400 : 1600);
    }

    /** Mình gác máy / từ chối */
    function hangup(text) {
      const me = cur;
      if (!me) return;
      if (me.call) emit(me.phase === 'incoming' ? 'call:decline' : 'call:end', { callId: me.call.id });
      finish(me, typeof text === 'string' ? text : me.phase === 'incoming' ? null : 'Cuộc gọi đã kết thúc', 1400);
    }

    /* ---------------- Trạng thái ---------------- */
    function newCall(fields) {
      clearTimeout(closeTimer);
      cur = { call: null, pc: null, local: null, remote: null, pendingIce: [], muted: false, camOn: Boolean(fields.video), remoteCam: Boolean(fields.video), remoteMuted: false, facing: 'user', cams: 0, ...fields };
      openLayer();
      keepAwake(true);
      return cur;
    }
    function finish(me, text, ms = 1400) {
      if (!me || me.done) return;
      me.done = true;
      stopTone();
      clearTimeout(me.connectTimer);
      clearTimeout(me.lostTimer);
      clearInterval(me.tick);
      if (me.pc) {
        me.pc.onicecandidate = null;
        me.pc.ontrack = null;
        me.pc.onconnectionstatechange = null;
        try {
          me.pc.close();
        } catch {
          /* bỏ qua */
        }
      }
      if (me.local) me.local.getTracks().forEach((t) => t.stop());
      if (cur === me) cur = null;
      keepAwake(false);
      if (!layer) return;
      const v = layer.querySelector('.call-remote');
      if (v) v.srcObject = null;
      const lv = layer.querySelector('.call-local');
      if (lv) lv.srcObject = null;
      if (!text) return closeLayer();
      renderEnded(me, text);
      closeTimer = setTimeout(closeLayer, ms);
    }
    async function keepAwake(on) {
      try {
        if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
        else if (!on && wakeLock) {
          await wakeLock.release();
          wakeLock = null;
        }
      } catch {
        wakeLock = null;
      }
    }

    /* ---------------- Giao diện ---------------- */
    function openLayer() {
      if (!layer) {
        layer = h('div', { class: 'call-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cuộc gọi' });
        const remote = h('video', { class: 'call-remote is-off' });
        remote.autoplay = true;
        remote.playsInline = true;
        const local = h('video', { class: 'call-local', hidden: true });
        local.autoplay = true;
        local.playsInline = true;
        local.muted = true;
        layer.append(remote, h('div', { class: 'call-peer' }), local, h('div', { class: 'call-actions' }));
        document.body.append(layer);
      }
      layer.hidden = false;
      document.documentElement.classList.add('in-call');
    }
    function closeLayer() {
      clearTimeout(closeTimer);
      if (cur || !layer) return;
      layer.hidden = true;
      layer.className = 'call-layer';
      document.documentElement.classList.remove('in-call');
    }

    function statusText(me) {
      const kind = me.video ? 'video' : 'thoại';
      if (me.reconnecting) return 'Đang kết nối lại…';
      switch (me.phase) {
        case 'preparing': return me.video ? 'Đang mở máy ảnh…' : 'Đang mở micro…';
        case 'ringing': return 'Đang đổ chuông…';
        case 'incoming': return `Cuộc gọi ${kind} đến`;
        case 'connecting': return 'Đang kết nối…';
        case 'active': return clock((Date.now() - (me.connectedAt || Date.now())) / 1000);
        default: return '';
      }
    }

    function callBtn(name, label, onclick, cls = '', pressed) {
      return h('button', {
        class: `call-btn ${cls}`.trim(), type: 'button', 'aria-label': label,
        ...(pressed === undefined ? {} : { 'aria-pressed': pressed ? 'true' : 'false' }),
        onclick,
      }, h('span', { class: 'call-btn-ic' }, icon(name)), h('span', { class: 'call-btn-label', text: label }));
    }

    function render() {
      const me = cur;
      if (!me || !layer) return;
      const remote = layer.querySelector('.call-remote');
      const local = layer.querySelector('.call-local');
      const showRemote = me.video && me.phase === 'active' && me.remoteVideo && me.remoteCam;
      const showLocal = me.video && me.camOn && Boolean(me.local && me.local.getVideoTracks().length);
      remote.classList.toggle('is-off', !showRemote);
      if (me.remote && remote.srcObject !== me.remote) {
        remote.srcObject = me.remote;
        remote.play().catch(() => {});
      }
      local.hidden = !showLocal;
      if (showLocal && local.srcObject !== me.local) local.srcObject = me.local;
      local.classList.toggle('is-back', me.facing === 'environment');
      layer.className = `call-layer phase-${me.phase}${showRemote ? ' has-video' : ''}${me.video ? ' is-video' : ''}`;

      const peerBox = layer.querySelector('.call-peer');
      const status = h('p', { class: 'call-status', 'aria-live': 'polite', text: statusText(me) });
      peerBox.replaceChildren(...[
        h('div', { class: `call-avatar${me.phase === 'ringing' || me.phase === 'incoming' ? ' is-ringing' : ''}` }, avatarEl(me.peer, 'avatar-call', { dot: false })),
        h('p', { class: 'call-name', text: me.peer.displayName }),
        status,
        me.remoteMuted && me.phase === 'active' ? h('p', { class: 'call-note' }, icon('mic-off'), h('span', { text: `${me.peer.displayName} đang tắt micro` })) : null,
        me.video && me.phase === 'active' && !me.remoteCam ? h('p', { class: 'call-note' }, icon('video-off'), h('span', { text: 'Máy ảnh bên kia đang tắt' })) : null,
      ].filter(Boolean));
      clearInterval(me.tick);
      if (me.phase === 'active') me.tick = setInterval(() => { if (cur === me) status.textContent = statusText(me); }, 1000);

      const actions = layer.querySelector('.call-actions');
      if (me.phase === 'incoming') {
        actions.replaceChildren(
          callBtn('phone-off', 'Từ chối', () => hangup(), 'is-end'),
          callBtn(me.video ? 'video' : 'phone', 'Trả lời', accept, 'is-accept')
        );
        return;
      }
      const hasCam = Boolean(me.local && me.local.getVideoTracks().length);
      actions.replaceChildren(...[
        callBtn(me.muted ? 'mic-off' : 'mic', me.muted ? 'Bật micro' : 'Tắt micro', toggleMic, '', me.muted),
        me.video && hasCam ? callBtn(me.camOn ? 'video' : 'video-off', me.camOn ? 'Tắt máy ảnh' : 'Bật máy ảnh', toggleCam, '', !me.camOn) : null,
        me.video && hasCam && me.cams > 1 ? callBtn('flip-cam', 'Đổi máy ảnh', flipCam) : null,
        callBtn('phone-off', 'Kết thúc', () => hangup(), 'is-end'),
      ].filter(Boolean));
    }

    function renderEnded(me, text) {
      if (!layer) return;
      layer.className = 'call-layer phase-ended';
      layer.querySelector('.call-remote').classList.add('is-off');
      layer.querySelector('.call-local').hidden = true;
      layer.querySelector('.call-peer').replaceChildren(
        h('div', { class: 'call-avatar' }, avatarEl(me.peer, 'avatar-call', { dot: false })),
        h('p', { class: 'call-name', text: me.peer.displayName }),
        h('p', { class: 'call-status', role: 'status', text: me.connectedAt ? `${text} · ${clock((Date.now() - me.connectedAt) / 1000)}` : text })
      );
      layer.querySelector('.call-actions').replaceChildren();
    }

    function toggleMic() {
      const me = cur;
      if (!me) return;
      me.muted = !me.muted;
      if (me.local) me.local.getAudioTracks().forEach((t) => { t.enabled = !me.muted; });
      sendMedia();
      render();
    }
    function toggleCam() {
      const me = cur;
      if (!me || !me.local) return;
      me.camOn = !me.camOn;
      me.local.getVideoTracks().forEach((t) => { t.enabled = me.camOn; });
      sendMedia();
      render();
    }
    async function flipCam() {
      const me = cur;
      if (!me || !me.local) return;
      const facing = me.facing === 'user' ? 'environment' : 'user';
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } });
        const track = s.getVideoTracks()[0];
        if (cur !== me) return track.stop();
        const old = me.local.getVideoTracks()[0];
        const sender = me.pc && me.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
        if (sender) await sender.replaceTrack(track);
        if (old) {
          me.local.removeTrack(old);
          old.stop();
        }
        track.enabled = me.camOn;
        me.local.addTrack(track);
        me.facing = facing;
        const lv = layer.querySelector('.call-local');
        lv.srcObject = null;
        render();
      } catch {
        toast('Không đổi được máy ảnh.');
      }
    }

    function onMedia({ callId, muted, camera }) {
      const me = cur;
      if (!me || !me.call || me.call.id !== callId) return;
      me.remoteMuted = Boolean(muted);
      me.remoteCam = Boolean(camera);
      render();
    }

    /* ---------------- Kết nối Socket.IO ---------------- */
    function bind(s) {
      socket = s;
      s.on('call:incoming', onIncoming);
      s.on('call:accepted', onAccepted);
      s.on('call:signal', onSignal);
      s.on('call:media', onMedia);
      s.on('call:ended', onEnded);
    }
    // Nối lại máy chủ giữa cuộc gọi (mạng chập chờn, máy chủ khởi động lại)
    async function onReconnect() {
      const me = cur;
      if (!me || !me.call) return;
      const res = await emit('call:rejoin', { callId: me.call.id });
      if (cur !== me) return;
      if (res.error) return finish(me, 'Cuộc gọi đã kết thúc');
      me.call = { ...me.call, ...res.call };
      if (me.role === 'caller' && res.call.state === 'active' && !me.offered) onAccepted({ callId: me.call.id });
    }
    function reset() {
      if (cur) hangup(null);
      socket = null;
    }
    window.addEventListener('pagehide', () => {
      if (cur && cur.call && socket) socket.emit(cur.phase === 'incoming' ? 'call:decline' : 'call:end', { callId: cur.call.id });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && cur && cur.phase === 'incoming') hangup();
    });

    return {
      supported,
      bind,
      start,
      onReconnect,
      reset,
      busy: () => Boolean(cur),
      // cho kiểm thử tự động
      _state: () => (cur ? { phase: cur.phase, role: cur.role, callId: cur.call && cur.call.id, connected: Boolean(cur.connectedAt) } : null),
    };
  }

  window.ThinkCalls = { create, supported, clock };
})();
