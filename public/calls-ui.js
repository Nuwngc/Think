/* Gọi thoại / gọi video cho bản web: gọi 1-1 (2.10.0) và gọi nhóm (2.11.0). Máy chủ: src/calls.js (chỉ chuyển lời mời
   và thông tin kết nối), máy chủ TURN: src/turn.js. Tiếng và hình đi thẳng giữa các máy bằng WebRTC; gọi nhóm thì mỗi người
   nối thẳng với từng người khác (người vào sau gửi lời mời kết nối cho từng người đang ở trong cuộc gọi).
   App Think Beta làm y như vậy: native/src/calls/engine.ts. */
(function () {
  'use strict';

  const supported = () => Boolean(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const CONNECT_MS = 30000; // 30 giây chưa nối được tiếng / hình với một người thì thôi
  const LOST_MS = 20000; // mất kết nối giữa chừng quá 20 giây thì thôi

  const clock = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  };
  // Loại đường kết nối của một ICE candidate: host (cùng mạng), srflx / prflx (qua NAT), relay (qua máy chủ TURN)
  const typeOf = (c) => {
    const m = / typ (host|srflx|prflx|relay)\b/.exec(String((c && c.candidate) || c || ''));
    return m ? m[1] : null;
  };
  // Vì sao không nối được (hiện cho người dùng)
  const failText = (p) =>
    p && p.localTypes.has('relay')
      ? 'Không nối được dù đã thử qua máy chủ chuyển tiếp (TURN). Thử lại, hoặc đổi mạng (wifi ↔ 4G).'
      : 'Không nối được: mạng đang chặn kết nối thẳng và máy chủ chuyển tiếp (TURN) không dùng được. Admin vào Quản trị → AI, gọi để cài TURN.';

  function create(ctx) {
    const { h, icon, toast, state, avatarEl, userOf, convAvatarEl, onGroupsChanged } = ctx;
    let socket = null;
    let cur = null; // cuộc gọi đang diễn ra trên máy này
    let layer = null;
    let closeTimer = null;
    let tone = null;
    let wakeLock = null;
    const groupCalls = new Map(); // convId -> cuộc gọi nhóm đang diễn ra (cho thanh "Tham gia")

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
    const signalTo = (me, p, data) => {
      if (!me.callId) return;
      if (me.kind === 'group') emit('gcall:signal', { callId: me.callId, to: p.id, data });
      else emit('call:signal', { callId: me.callId, data });
    };
    const sendMedia = (me) => {
      if (!me || !me.callId) return;
      emit(me.kind === 'group' ? 'gcall:media' : 'call:media', { callId: me.callId, muted: me.muted, camera: me.camOn });
    };

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
      // Gọi nhóm nhiều người: hình nhỏ hơn cho nhẹ mạng (mỗi người gửi hình cho từng người khác)
      const cam = me.kind === 'group' ? { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 20 } } : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } };
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

    /* ---------------- Từng người trong cuộc gọi (mỗi người một kết nối WebRTC) ---------------- */
    function addPeer(me, user) {
      const old = me.peers.get(user.id);
      if (old) return old;
      const p = {
        id: user.id,
        user: { id: user.id, displayName: user.displayName, avatar: user.avatar || null },
        pc: null,
        pendingIce: [],
        remote: null,
        remoteVideo: false,
        muted: Boolean(user.muted),
        camera: user.camera === undefined ? me.video : Boolean(user.camera),
        connectedAt: 0,
        reconnecting: false,
        failed: false,
        offerer: false,
        restarted: false,
        tracksAdded: false,
        localTypes: new Set(),
        remoteTypes: new Set(),
        reported: false,
        connectTimer: null,
        lostTimer: null,
        el: null,
      };
      me.peers.set(user.id, p);
      return p;
    }
    function closePeer(me, p) {
      clearTimeout(p.connectTimer);
      clearTimeout(p.lostTimer);
      if (p.pc) {
        p.pc.onicecandidate = null;
        p.pc.ontrack = null;
        p.pc.onconnectionstatechange = null;
        try {
          p.pc.close();
        } catch {
          /* bỏ qua */
        }
      }
      p.pc = null;
      if (p.el) p.el.remove();
      me.peers.delete(p.id);
    }
    function ensurePc(me, p) {
      if (p.pc) return p.pc;
      const pc = new RTCPeerConnection({ iceServers: (me.call && me.call.iceServers) || [] });
      p.pc = pc;
      pc.onicecandidate = (e) => {
        if (!e.candidate || cur !== me || me.peers.get(p.id) !== p) return;
        const t = typeOf(e.candidate);
        if (t) p.localTypes.add(t);
        signalTo(me, p, { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
      };
      pc.ontrack = (e) => {
        if (cur !== me) return;
        const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
        p.remote = stream;
        if (e.track.kind === 'video') p.remoteVideo = true;
        render();
      };
      pc.onconnectionstatechange = () => onPeerState(me, p, pc.connectionState);
      pc.oniceconnectionstatechange = () => {
        // Safari cũ không có connectionState
        if (pc.connectionState === undefined) onPeerState(me, p, pc.iceConnectionState === 'completed' ? 'connected' : pc.iceConnectionState);
      };
      return pc;
    }
    function addLocalTracks(me, p) {
      if (p.tracksAdded || !me.local) return;
      me.local.getTracks().forEach((t) => p.pc.addTrack(t, me.local));
      p.tracksAdded = true;
    }
    async function sendOffer(me, p, restart) {
      ensurePc(me, p);
      addLocalTracks(me, p);
      p.offerer = true;
      const offer = await p.pc.createOffer(restart ? { iceRestart: true } : undefined);
      await p.pc.setLocalDescription(offer);
      signalTo(me, p, { sdp: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } });
    }
    function watchPeer(me, p) {
      clearTimeout(p.connectTimer);
      p.connectTimer = setTimeout(() => {
        if (cur !== me || p.connectedAt || me.peers.get(p.id) !== p) return;
        report(me, p, false);
        if (me.kind === 'direct') return hangup(failText(p));
        p.failed = true; // gọi nhóm: chỉ người này không nối được, cuộc gọi vẫn tiếp tục
        render();
      }, CONNECT_MS);
    }
    async function pathOf(pc) {
      try {
        const stats = await pc.getStats();
        const byId = new Map();
        stats.forEach((r) => byId.set(r.id, r));
        let pair = null;
        stats.forEach((r) => {
          if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId) || pair;
        });
        if (!pair) {
          stats.forEach((r) => {
            if (!pair && r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r;
          });
        }
        if (!pair) return null;
        const l = byId.get(pair.localCandidateId);
        const rm = byId.get(pair.remoteCandidateId);
        return (l && l.candidateType === 'relay') || (rm && rm.candidateType === 'relay') ? 'relay' : 'direct';
      } catch {
        return null;
      }
    }
    // Báo máy chủ đã nối được chưa, đi đường nào (admin xem trong Quản trị → AI, gọi)
    async function report(me, p, ok) {
      if (p.reported || !me.callId) return;
      p.reported = true;
      const path = ok && p.pc ? await pathOf(p.pc) : null;
      p.path = path;
      emit('call:report', { callId: me.callId, peerId: p.id, ok, path, local: [...p.localTypes], remote: [...p.remoteTypes], platform: 'web' });
    }
    function onPeerState(me, p, st) {
      if (cur !== me || me.peers.get(p.id) !== p) return;
      if (st === 'connected') {
        clearTimeout(p.lostTimer);
        clearTimeout(p.connectTimer);
        p.lostTimer = null;
        p.reconnecting = false;
        p.failed = false;
        if (!p.connectedAt) {
          p.connectedAt = Date.now();
          report(me, p, true);
        }
        if (!me.connectedAt) me.connectedAt = Date.now();
        if (me.phase === 'connecting') me.phase = 'active';
        render();
      } else if (st === 'disconnected' || st === 'failed') {
        p.reconnecting = true;
        render();
        if (st === 'failed' && p.offerer && !p.restarted) {
          p.restarted = true; // thử nối lại một lần (vd đổi wifi sang 4G)
          sendOffer(me, p, true).catch(() => {});
        }
        if (!p.lostTimer) {
          p.lostTimer = setTimeout(() => {
            if (cur !== me || me.peers.get(p.id) !== p) return;
            if (!p.connectedAt) report(me, p, false);
            if (me.kind === 'direct') hangup(p.connectedAt ? 'Mất kết nối cuộc gọi.' : failText(p));
            else {
              p.failed = true;
              render();
            }
          }, LOST_MS);
        }
      }
    }
    async function handleSignal(me, p, data) {
      try {
        if (data.sdp) {
          // Hai bên cùng gửi lời mời (hiếm, vd vừa nối lại máy chủ): bỏ kết nối dở dang, nhận lời mời của bên kia
          if (data.sdp.type === 'offer' && p.pc && p.pc.signalingState !== 'stable' && p.pc.signalingState !== 'have-remote-offer') {
            const keep = { ...p };
            closePeer(me, p);
            p = addPeer(me, keep.user);
            p.muted = keep.muted;
            p.camera = keep.camera;
          }
          if (!p.pc && !p.connectedAt) watchPeer(me, p);
          const pc = ensurePc(me, p);
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            addLocalTracks(me, p);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signalTo(me, p, { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
            if (!p.connectedAt) watchPeer(me, p);
          }
          for (const c of p.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        } else if (data.candidate) {
          const t = typeOf(data.candidate);
          if (t) p.remoteTypes.add(t);
          if (!p.pc || !p.pc.remoteDescription) p.pendingIce.push(data.candidate);
          else await p.pc.addIceCandidate(data.candidate).catch(() => {});
        }
      } catch (err) {
        console.warn('[call]', err);
        if (cur !== me) return;
        if (me.kind === 'direct') hangup('Không kết nối được cuộc gọi.');
        else {
          p.failed = true;
          render();
        }
      }
    }

    /* ---------------- Gọi 1-1 ---------------- */
    async function startDirect(conv, video) {
      const peer = userOf(conv.peerId);
      if (!peer) return toast('Không tìm thấy người này.');
      if (peer.bot) return toast('Think AI chưa nghe điện thoại được 😅');
      const me = newCall({ kind: 'direct', role: 'caller', phase: 'preparing', video, convId: conv.id, peerUser: peer });
      if (!(await getMedia(me, video))) return finish(me);
      if (cur !== me) return;
      render();
      const res = await emit('call:start', { conversationId: conv.id, video });
      if (cur !== me) {
        if (res.call) emit('call:end', { callId: res.call.id });
        return;
      }
      if (res.error) {
        toast(res.error);
        return finish(me);
      }
      me.call = res.call;
      me.callId = res.call.id;
      me.phase = 'ringing';
      startTone('out');
      render();
    }

    function onIncoming(call) {
      if (!call || !call.id) return;
      if (cur) {
        if (cur.callId === call.id) return;
        emit('call:decline', { callId: call.id, busy: true }); // đang gọi trên máy này
        return;
      }
      const peer = userOf(call.callerId) || call.caller;
      const me = newCall({ kind: 'direct', role: 'callee', phase: 'incoming', video: call.video, convId: call.conversationId, peerUser: peer, call });
      ringIn(me, peer.displayName, call.video ? '📹 Đang gọi video cho bạn…' : '📞 Đang gọi thoại cho bạn…', peer.avatar);
    }

    async function onAccepted({ callId }) {
      const me = cur;
      if (!me || me.kind !== 'direct' || me.callId !== callId || me.role !== 'caller') return;
      const p = [...me.peers.values()][0];
      if (!p || p.offerer) return;
      stopTone();
      me.phase = 'connecting';
      render();
      watchPeer(me, p);
      try {
        await sendOffer(me, p);
        sendMedia(me);
      } catch (err) {
        console.warn('[call]', err);
        if (cur === me) hangup('Không kết nối được cuộc gọi.');
      }
    }

    function onDirectSignal({ callId, data }) {
      const me = cur;
      if (!me || me.kind !== 'direct' || me.callId !== callId || !data) return;
      const p = [...me.peers.values()][0];
      if (p) handleSignal(me, p, data);
    }

    function onDirectMedia({ callId, muted, camera }) {
      const me = cur;
      if (!me || me.kind !== 'direct' || me.callId !== callId) return;
      const p = [...me.peers.values()][0];
      if (!p) return;
      p.muted = Boolean(muted);
      p.camera = Boolean(camera);
      render();
    }

    /* ---------------- Gọi nhóm ---------------- */
    // Bấm gọi trong nhóm: nhóm đang có cuộc gọi thì máy chủ cho vào luôn
    async function startGroup(conv, video) {
      const me = newCall({ kind: 'group', role: 'caller', phase: 'preparing', video, convId: conv.id });
      if (!(await getMedia(me, video))) return finish(me);
      if (cur !== me) return;
      render();
      const res = await emit('gcall:start', { conversationId: conv.id, video });
      if (cur !== me) {
        if (res.call) emit('gcall:leave', { callId: res.call.id });
        return;
      }
      if (res.error) {
        toast(res.error);
        return finish(me);
      }
      enterGroup(me, res.call);
    }

    async function joinGroup(convId, video) {
      if (cur) return toast('Bạn đang trong một cuộc gọi.');
      if (!supported()) return toast('Trình duyệt này chưa gọi được. Hãy dùng Chrome, Edge, Safari hoặc Firefox bản mới.');
      const info = groupCalls.get(convId);
      if (!info) return toast('Cuộc gọi nhóm đã kết thúc.');
      const v = video === undefined ? info.video : Boolean(video);
      const me = newCall({ kind: 'group', role: 'callee', phase: 'preparing', video: v, convId });
      me.callId = info.id;
      if (!(await getMedia(me, v))) return finish(me);
      if (cur !== me) return;
      render();
      const res = await emit('gcall:join', { callId: info.id, camera: me.camOn });
      if (cur !== me) {
        if (!res.error) emit('gcall:leave', { callId: info.id });
        return;
      }
      if (res.error) {
        toast(res.error);
        if (/kết thúc/.test(res.error)) onGroupState({ conversationId: convId, call: null });
        return finish(me);
      }
      enterGroup(me, res.call);
    }

    // Vào cuộc gọi nhóm: người vào sau gửi lời mời kết nối cho từng người đang ở trong cuộc gọi
    function enterGroup(me, call) {
      stopTone();
      me.call = call;
      me.callId = call.id;
      me.title = call.title;
      me.phase = 'active';
      me.ringing = call.ringing || [];
      me.joinedAt = Date.now();
      const myId = state.me && state.me.id;
      for (const person of call.people || []) {
        if (person.id === myId) continue;
        const p = addPeer(me, person);
        watchPeer(me, p);
        sendOffer(me, p).catch((err) => {
          console.warn('[call]', err);
          p.failed = true;
          render();
        });
      }
      sendMedia(me);
      render();
      if (onGroupsChanged) onGroupsChanged(me.convId); // ẩn thanh "Tham gia"
    }

    function onGroupRing(call) {
      if (!call || !call.id) return;
      groupCalls.set(call.conversationId, call);
      if (cur) return; // đang gọi thì máy chủ đã không đổ chuông
      const me = newCall({ kind: 'group', role: 'callee', phase: 'incoming', video: call.video, convId: call.conversationId, call });
      me.callId = call.id;
      me.title = call.title;
      const who = call.starter ? call.starter.displayName : 'Ai đó';
      ringIn(me, call.title, `${call.video ? '📹' : '📞'} ${who} đang gọi nhóm${call.video ? ' video' : ''}…`, call.avatar);
    }

    function onGroupRingStop({ callId }) {
      const me = cur;
      if (me && me.kind === 'group' && me.phase === 'incoming' && me.callId === callId) finish(me, null);
    }

    function onGroupJoined({ callId, user }) {
      const me = cur;
      if (!me || me.kind !== 'group' || me.callId !== callId || me.phase !== 'active') return;
      me.ringing = me.ringing.filter((id) => id !== user.id);
      const p = addPeer(me, user); // người mới sẽ gửi lời mời kết nối
      watchPeer(me, p);
      render();
    }

    function onGroupLeft({ callId, userId }) {
      const me = cur;
      if (!me || me.kind !== 'group' || me.callId !== callId) return;
      const p = me.peers.get(userId);
      if (p) closePeer(me, p);
      render();
    }

    function onGroupSignal({ callId, from, data }) {
      const me = cur;
      if (!me || me.kind !== 'group' || me.callId !== callId || me.phase !== 'active' || !data) return;
      const p = me.peers.get(from) || addPeer(me, userOf(from) || { id: from, displayName: 'Người dùng', avatar: null });
      handleSignal(me, p, data);
    }

    function onGroupMedia({ callId, userId, muted, camera }) {
      const me = cur;
      if (!me || me.kind !== 'group' || me.callId !== callId) return;
      const p = me.peers.get(userId);
      if (!p) return;
      p.muted = Boolean(muted);
      p.camera = Boolean(camera);
      render();
    }

    function onGroupUpdate({ callId, ringing }) {
      const me = cur;
      if (!me || me.kind !== 'group' || me.callId !== callId) return;
      me.ringing = ringing || [];
      render();
    }

    function onGroupEnded({ callId, reason }) {
      const me = cur;
      if (!me || me.kind !== 'group' || me.callId !== callId) return;
      finish(me, reason === 'dropped' ? 'Mất kết nối cuộc gọi' : me.phase === 'incoming' ? null : 'Cuộc gọi nhóm đã kết thúc', 1600);
    }

    function onGroupState({ conversationId, call }) {
      if (call) groupCalls.set(conversationId, call);
      else groupCalls.delete(conversationId);
      if (onGroupsChanged) onGroupsChanged(conversationId);
    }

    /* ---------------- Chung: nghe máy, gác máy ---------------- */
    function ringIn(me, title, body, iconUrl) {
      startTone('in');
      render();
      const accept = layer.querySelector('.is-accept');
      if (accept) accept.focus({ preventScroll: true });
      if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
        navigator.serviceWorker.ready
          .then((reg) => reg.showNotification(title, {
            body,
            tag: `call-${me.convId}`,
            icon: iconUrl || '/icons/icon-192.png',
            data: { url: `/#/c/${me.convId}` },
            requireInteraction: true,
          }))
          .catch(() => {});
      }
    }

    async function accept() {
      const me = cur;
      if (!me || me.phase !== 'incoming') return;
      stopTone();
      if (me.kind === 'group') {
        // Tham gia cuộc gọi nhóm đang đổ chuông
        cur = null;
        me.done = true;
        return joinGroup(me.convId, me.video);
      }
      me.phase = 'connecting';
      render();
      if (!(await getMedia(me, me.video))) {
        if (cur === me) {
          emit('call:decline', { callId: me.callId });
          finish(me);
        }
        return;
      }
      if (cur !== me) return;
      const res = await emit('call:accept', { callId: me.callId });
      if (cur !== me) return;
      if (res.error) {
        toast(res.error);
        return finish(me);
      }
      me.call = res.call;
      const p = [...me.peers.values()][0];
      ensurePc(me, p);
      watchPeer(me, p);
      sendMedia(me);
      render();
    }

    const ENDED = {
      ended: () => 'Cuộc gọi đã kết thúc',
      declined: (me) => (me.role === 'caller' ? `${me.title} đã từ chối cuộc gọi` : 'Đã từ chối'),
      missed: (me) => (me.role === 'caller' ? 'Không có ai trả lời' : 'Cuộc gọi nhỡ'),
      canceled: (me) => (me.role === 'caller' ? 'Đã hủy cuộc gọi' : 'Cuộc gọi nhỡ'),
      busy: (me) => `${me.title} đang bận`,
      elsewhere: () => 'Đã trả lời trên máy khác',
      dropped: () => 'Mất kết nối cuộc gọi',
    };
    function onEnded({ callId, reason }) {
      const me = cur;
      if (!me || me.kind !== 'direct' || me.callId !== callId) return;
      finish(me, (ENDED[reason] || ENDED.ended)(me), reason === 'elsewhere' ? 400 : 1600);
    }

    /** Mình gác máy / từ chối / rời cuộc gọi nhóm */
    function hangup(text) {
      const me = cur;
      if (!me) return;
      if (me.callId) {
        if (me.kind === 'group') emit(me.phase === 'incoming' ? 'gcall:decline' : 'gcall:leave', { callId: me.callId });
        else emit(me.phase === 'incoming' ? 'call:decline' : 'call:end', { callId: me.callId });
      }
      const fallback = me.phase === 'incoming' ? null : me.kind === 'group' ? 'Bạn đã rời cuộc gọi' : 'Cuộc gọi đã kết thúc';
      finish(me, typeof text === 'string' ? text : fallback, typeof text === 'string' && text.length > 40 ? 4000 : 1400);
    }

    /* ---------------- Trạng thái ---------------- */
    function newCall(fields) {
      clearTimeout(closeTimer);
      const { peerUser, ...rest } = fields;
      cur = {
        call: null,
        callId: (fields.call && fields.call.id) || null,
        peers: new Map(),
        ringing: [],
        local: null,
        muted: false,
        camOn: Boolean(fields.video),
        facing: 'user',
        cams: 0,
        connectedAt: 0,
        joinedAt: 0,
        title: peerUser ? peerUser.displayName : (state.convs.get(fields.convId) || {}).name || 'Nhóm',
        ...rest,
      };
      if (peerUser) addPeer(cur, peerUser);
      openLayer();
      keepAwake(true);
      return cur;
    }
    function finish(me, text, ms = 1400) {
      if (!me || me.done) return;
      me.done = true;
      stopTone();
      for (const p of [...me.peers.values()]) {
        const keep = p.el;
        p.el = null; // giữ khung cho màn "đã kết thúc"
        closePeer(me, p);
        if (keep) keep.remove();
        me.peers.set(p.id, p); // vẫn còn tên / ảnh để vẽ màn kết thúc
      }
      if (me.local) me.local.getTracks().forEach((t) => t.stop());
      if (cur === me) cur = null;
      keepAwake(false);
      if (me.kind === 'group' && onGroupsChanged) onGroupsChanged(me.convId); // hiện lại thanh "Tham gia" nếu nhóm vẫn đang gọi
      if (!layer) return;
      const v = layer.querySelector('.call-remote');
      if (v) v.srcObject = null;
      const lv = layer.querySelector('.call-local');
      if (lv) lv.srcObject = null;
      layer.querySelector('.call-grid').replaceChildren();
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
        layer.append(remote, h('div', { class: 'call-peer' }), h('div', { class: 'call-grid' }), local, h('div', { class: 'call-actions' }));
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
      layer.querySelector('.call-grid').replaceChildren();
      document.documentElement.classList.remove('in-call');
    }

    function statusText(me) {
      const kind = me.video ? 'video' : 'thoại';
      if (me.kind === 'group') {
        if (me.phase === 'preparing') return me.video ? 'Đang mở máy ảnh…' : 'Đang mở micro…';
        if (me.phase === 'incoming') return `Cuộc gọi nhóm${me.video ? ' video' : ''} đến`;
        if (!me.peers.size) return me.ringing.length ? `Đang gọi ${me.ringing.length} người…` : 'Chỉ còn bạn trong cuộc gọi';
        return me.connectedAt ? `${clock((Date.now() - me.connectedAt) / 1000)} · ${me.peers.size + 1} người` : 'Đang kết nối…';
      }
      const p = [...me.peers.values()][0];
      if (p && p.reconnecting) return 'Đang kết nối lại…';
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

    const groupAvatar = (me, cls) => {
      const conv = state.convs.get(me.convId);
      if (conv && convAvatarEl) return convAvatarEl(conv, cls, { dot: false });
      return avatarEl({ id: me.convId, displayName: me.title, avatar: (me.call && me.call.avatar) || null }, cls, { dot: false });
    };

    function controls(me) {
      if (me.phase === 'incoming') {
        return [
          callBtn('phone-off', 'Từ chối', () => hangup(), 'is-end'),
          callBtn(me.video ? 'video' : 'phone', me.kind === 'group' ? 'Tham gia' : 'Trả lời', accept, 'is-accept'),
        ];
      }
      const hasCam = Boolean(me.local && me.local.getVideoTracks().length);
      return [
        callBtn(me.muted ? 'mic-off' : 'mic', me.muted ? 'Bật micro' : 'Tắt micro', toggleMic, '', me.muted),
        me.video && hasCam ? callBtn(me.camOn ? 'video' : 'video-off', me.camOn ? 'Tắt máy ảnh' : 'Bật máy ảnh', toggleCam, '', !me.camOn) : null,
        me.video && hasCam && me.cams > 1 ? callBtn('flip-cam', 'Đổi máy ảnh', flipCam) : null,
        callBtn('phone-off', me.kind === 'group' ? 'Rời' : 'Kết thúc', () => hangup(), 'is-end'),
      ].filter(Boolean);
    }

    function render() {
      const me = cur;
      if (!me || !layer) return;
      clearInterval(me.tick);
      if (me.phase === 'active' || (me.kind === 'group' && me.phase !== 'incoming')) {
        me.tick = setInterval(() => {
          if (cur !== me) return;
          const st = layer.querySelector('.call-status');
          if (st) st.textContent = statusText(me);
        }, 1000);
      }
      if (me.kind === 'group' && me.phase !== 'incoming') renderGroup(me);
      else renderDirect(me);
      layer.querySelector('.call-actions').replaceChildren(...controls(me));
    }

    // Gọi 1-1 (và màn cuộc gọi nhóm đến): người bên kia ở giữa, hình bên kia phủ cả màn hình
    function renderDirect(me) {
      const p = [...me.peers.values()][0];
      const remote = layer.querySelector('.call-remote');
      const local = layer.querySelector('.call-local');
      const showRemote = Boolean(p && me.video && me.phase === 'active' && p.remoteVideo && p.camera);
      const showLocal = me.video && me.camOn && Boolean(me.local && me.local.getVideoTracks().length);
      remote.classList.toggle('is-off', !showRemote);
      if (p && p.remote && remote.srcObject !== p.remote) {
        remote.srcObject = p.remote;
        remote.play().catch(() => {});
      }
      local.hidden = !showLocal;
      if (showLocal && local.srcObject !== me.local) local.srcObject = me.local;
      local.classList.toggle('is-back', me.facing === 'environment');
      layer.querySelector('.call-grid').replaceChildren();
      layer.className = `call-layer phase-${me.phase}${showRemote ? ' has-video' : ''}${me.video ? ' is-video' : ''}`;

      const ringing = me.phase === 'ringing' || me.phase === 'incoming';
      const av = me.kind === 'group' ? groupAvatar(me, 'avatar-call') : avatarEl(p ? p.user : null, 'avatar-call', { dot: false });
      layer.querySelector('.call-peer').replaceChildren(...[
        h('div', { class: `call-avatar${ringing ? ' is-ringing' : ''}` }, av),
        h('p', { class: 'call-name', text: me.title }),
        h('p', { class: 'call-status', 'aria-live': 'polite', text: statusText(me) }),
        me.kind === 'group' && me.call && me.call.starter ? h('p', { class: 'call-note', text: `${me.call.starter.displayName} đang gọi nhóm${me.video ? ' video' : ''}` }) : null,
        p && p.muted && me.phase === 'active' ? h('p', { class: 'call-note' }, icon('mic-off'), h('span', { text: `${p.user.displayName} đang tắt micro` })) : null,
        p && me.video && me.phase === 'active' && !p.camera ? h('p', { class: 'call-note' }, icon('video-off'), h('span', { text: 'Máy ảnh bên kia đang tắt' })) : null,
      ].filter(Boolean));
    }

    // Gọi nhóm: lưới ô, mỗi người một ô (hình hoặc ảnh đại diện), ô của mình ở cuối
    function renderGroup(me) {
      layer.querySelector('.call-remote').classList.add('is-off');
      layer.querySelector('.call-local').hidden = true;
      layer.className = `call-layer is-group phase-${me.phase}${me.video ? ' is-video' : ''}`;
      const ringNames = me.ringing.map((id) => (userOf(id) || {}).displayName).filter(Boolean);
      layer.querySelector('.call-peer').replaceChildren(...[
        h('p', { class: 'call-name', text: me.title }),
        h('p', { class: 'call-status', 'aria-live': 'polite', text: statusText(me) }),
        ringNames.length && me.phase === 'active'
          ? h('p', { class: 'call-ringing', text: `Đang gọi: ${ringNames.slice(0, 3).join(', ')}${ringNames.length > 3 ? ` và ${ringNames.length - 3} người` : ''}` })
          : null,
      ].filter(Boolean));
      const grid = layer.querySelector('.call-grid');
      const tiles = [...me.peers.values()].map((p) => peerTile(me, p));
      tiles.push(selfTile(me));
      const n = tiles.length;
      const landscape = window.innerWidth > window.innerHeight * 1.1;
      const cols = landscape ? Math.ceil(Math.sqrt(n)) : n <= 2 ? 1 : 2;
      grid.style.setProperty('--cols', String(cols));
      grid.style.setProperty('--rows', String(Math.ceil(n / cols)));
      // Giữ nguyên các ô cũ (đang phát hình / tiếng), chỉ thêm / bớt
      tiles.forEach((el, i) => {
        if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
      });
      while (grid.children.length > n) grid.lastChild.remove();
    }

    function tileShell(cls) {
      const video = h('video', { class: 'call-tile-video' });
      video.autoplay = true;
      video.playsInline = true;
      const el = h('div', { class: `call-tile ${cls}` }, video, h('div', { class: 'call-tile-face' }), h('div', { class: 'call-tile-foot' }));
      return { el, video };
    }
    function paintTile(el, { user, showVideo, muted, note, face }) {
      el.classList.toggle('has-video', showVideo);
      el.querySelector('.call-tile-face').replaceChildren(face || avatarEl(user, 'avatar-tile', { dot: false }));
      el.querySelector('.call-tile-foot').replaceChildren(...[
        muted ? h('span', { class: 'call-tile-mute', 'aria-label': 'Đang tắt micro' }, icon('mic-off')) : null,
        h('span', { class: 'call-tile-name', text: user.displayName }),
        note ? h('span', { class: 'call-tile-note', text: note }) : null,
      ].filter(Boolean));
    }
    function peerTile(me, p) {
      if (!p.el) {
        const { el, video } = tileShell('is-peer');
        p.el = el;
        p.video = video;
      }
      if (p.remote && p.video.srcObject !== p.remote) p.video.srcObject = p.remote; // phát cả tiếng của người này
      if (p.remote && p.video.paused) p.video.play().catch(() => {});
      const note = p.failed ? 'Không nối được' : p.reconnecting ? 'Đang nối lại…' : !p.connectedAt ? 'Đang kết nối…' : '';
      paintTile(p.el, { user: p.user, showVideo: Boolean(me.video && p.remoteVideo && p.camera && p.connectedAt), muted: p.muted, note });
      p.el.title = p.failed ? failText(p) : '';
      return p.el;
    }
    let selfEl = null;
    function selfTile(me) {
      if (!selfEl) {
        const shell = tileShell('is-self');
        selfEl = shell.el;
        shell.video.muted = true;
      }
      const video = selfEl.querySelector('video');
      const showVideo = Boolean(me.video && me.camOn && me.local && me.local.getVideoTracks().length);
      if (showVideo && video.srcObject !== me.local) video.srcObject = me.local;
      if (!showVideo) video.srcObject = null;
      selfEl.classList.toggle('is-back', me.facing === 'environment');
      paintTile(selfEl, { user: { ...(state.me || {}), displayName: 'Bạn' }, showVideo, muted: me.muted, face: avatarEl(state.me, 'avatar-tile', { dot: false }) });
      return selfEl;
    }

    function renderEnded(me, text) {
      if (!layer) return;
      layer.className = 'call-layer phase-ended';
      layer.querySelector('.call-remote').classList.add('is-off');
      layer.querySelector('.call-local').hidden = true;
      const p = [...me.peers.values()][0];
      const av = me.kind === 'group' ? groupAvatar(me, 'avatar-call') : avatarEl(p ? p.user : null, 'avatar-call', { dot: false });
      layer.querySelector('.call-peer').replaceChildren(
        h('div', { class: 'call-avatar' }, av),
        h('p', { class: 'call-name', text: me.title }),
        h('p', { class: 'call-status', role: 'status', text: me.connectedAt && text.length < 40 ? `${text} · ${clock((Date.now() - me.connectedAt) / 1000)}` : text })
      );
      layer.querySelector('.call-actions').replaceChildren();
    }

    function toggleMic() {
      const me = cur;
      if (!me) return;
      me.muted = !me.muted;
      if (me.local) me.local.getAudioTracks().forEach((t) => { t.enabled = !me.muted; });
      sendMedia(me);
      render();
    }
    function toggleCam() {
      const me = cur;
      if (!me || !me.local) return;
      me.camOn = !me.camOn;
      me.local.getVideoTracks().forEach((t) => { t.enabled = me.camOn; });
      sendMedia(me);
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
        for (const p of me.peers.values()) {
          const sender = p.pc && p.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
          if (sender) await sender.replaceTrack(track);
        }
        if (old) {
          me.local.removeTrack(old);
          old.stop();
        }
        track.enabled = me.camOn;
        me.local.addTrack(track);
        me.facing = facing;
        layer.querySelector('.call-local').srcObject = null;
        if (selfEl) selfEl.querySelector('video').srcObject = null;
        render();
      } catch {
        toast('Không đổi được máy ảnh.');
      }
    }

    /* ---------------- Kết nối Socket.IO ---------------- */
    function bind(s) {
      socket = s;
      s.on('call:incoming', onIncoming);
      s.on('call:accepted', onAccepted);
      s.on('call:signal', onDirectSignal);
      s.on('call:media', onDirectMedia);
      s.on('call:ended', onEnded);
      s.on('gcall:ring', onGroupRing);
      s.on('gcall:ring-stop', onGroupRingStop);
      s.on('gcall:joined', onGroupJoined);
      s.on('gcall:left', onGroupLeft);
      s.on('gcall:signal', onGroupSignal);
      s.on('gcall:media', onGroupMedia);
      s.on('gcall:update', onGroupUpdate);
      s.on('gcall:ended', onGroupEnded);
      s.on('gcall:state', onGroupState);
    }
    // Nối lại máy chủ giữa cuộc gọi (mạng chập chờn, máy chủ khởi động lại)
    async function onReconnect() {
      const me = cur;
      if (!me || !me.callId || me.phase === 'incoming' || me.phase === 'preparing') return;
      if (me.kind === 'group') {
        const res = await emit('gcall:rejoin', { callId: me.callId });
        if (cur !== me) return;
        if (res.error) return finish(me, 'Cuộc gọi nhóm đã kết thúc');
        // Ai vào trong lúc mình mất kết nối: mình gửi lời mời kết nối; ai đã rời: bỏ
        const ids = new Set((res.call.people || []).map((x) => x.id));
        for (const p of [...me.peers.values()]) if (!ids.has(p.id)) closePeer(me, p);
        for (const person of res.call.people || []) {
          if (state.me && person.id === state.me.id) continue;
          if (!me.peers.has(person.id)) {
            const p = addPeer(me, person);
            watchPeer(me, p);
            sendOffer(me, p).catch(() => {});
          }
        }
        me.ringing = res.call.ringing || [];
        return render();
      }
      const res = await emit('call:rejoin', { callId: me.callId });
      if (cur !== me) return;
      if (res.error) return finish(me, 'Cuộc gọi đã kết thúc');
      me.call = { ...me.call, ...res.call };
      if (me.role === 'caller' && res.call.state === 'active') onAccepted({ callId: me.callId });
    }
    function reset() {
      if (cur) hangup(null);
      socket = null;
      groupCalls.clear();
    }
    window.addEventListener('pagehide', () => {
      if (!cur || !cur.callId || !socket) return;
      if (cur.kind === 'group') socket.emit(cur.phase === 'incoming' ? 'gcall:decline' : 'gcall:leave', { callId: cur.callId });
      else socket.emit(cur.phase === 'incoming' ? 'call:decline' : 'call:end', { callId: cur.callId });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && cur && cur.phase === 'incoming') hangup();
    });

    /** Gọi trong cuộc trò chuyện đang mở: chat riêng = gọi 1-1, nhóm / phòng chung = gọi nhóm (đang gọi thì vào) */
    async function start(convId, video) {
      if (cur) return toast('Bạn đang trong một cuộc gọi.');
      if (!supported()) return toast('Trình duyệt này chưa gọi được. Hãy dùng Chrome, Edge, Safari hoặc Firefox bản mới.');
      if (!window.isSecureContext) return toast('Cần mở Think bằng https:// để gọi được.');
      const conv = state.convs.get(convId);
      if (!conv) return toast('Không tìm thấy cuộc trò chuyện.');
      if (conv.type === 'dm') return startDirect(conv, video);
      return startGroup(conv, video);
    }

    return {
      supported,
      bind,
      start,
      joinGroup,
      onReconnect,
      reset,
      busy: () => Boolean(cur),
      /** Cuộc gọi nhóm đang diễn ra trong cuộc trò chuyện (null nếu không có) */
      groupIn: (convId) => groupCalls.get(convId) || null,
      /** Mình đang ở trong cuộc gọi của cuộc trò chuyện này */
      inCallOf: (convId) => Boolean(cur && cur.convId === convId && cur.phase !== 'incoming'),
      // cho kiểm thử tự động
      _state: () => (cur ? { kind: cur.kind, phase: cur.phase, callId: cur.callId, peers: [...cur.peers.values()].map((p) => ({ id: p.id, connected: Boolean(p.connectedAt), path: p.path || null })) } : null),
    };
  }

  window.ThinkCalls = { create, supported, clock };
})();
