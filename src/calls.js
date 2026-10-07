'use strict';
// Gọi thoại / gọi video bằng WebRTC, cho cả web và app: gọi 1-1 (2.10.0) và gọi nhóm (2.11.0).
// Máy chủ chỉ "chuyển lời" qua Socket.IO (mời gọi, nhận / từ chối, trao đổi thông tin kết nối SDP / ICE);
// tiếng và hình đi thẳng giữa các máy, hoặc qua máy chủ TURN khi mạng không nối thẳng được (src/turn.js).
//
// GỌI 1-1 (cuộc trò chuyện riêng). Sự kiện máy người dùng gửi (đều có ack):
//   call:start { conversationId, video } · call:accept { callId } · call:decline { callId } · call:end { callId }
//   call:signal { callId, data } · call:media { callId, muted, camera } · call:rejoin { callId }
// Máy chủ gửi: call:incoming (call) · call:accepted { callId } · call:signal { callId, data } · call:media {...}
//   call:ended { callId, reason, duration } (reason: ended | declined | missed | canceled | busy | elsewhere | dropped)
// Tin hệ thống: { event: 'call', video, status: 'ended' | 'missed' | 'declined', duration, to } (người gửi = người gọi).
//
// GỌI NHÓM (nhóm riêng và phòng chung, tối đa 8 người, mỗi người nối thẳng với từng người khác — "mesh"):
//   gcall:start { conversationId, video } (đang có cuộc gọi thì vào luôn) · gcall:join { callId, camera }
//   gcall:decline { callId } · gcall:leave { callId } · gcall:signal { callId, to, data } · gcall:media { callId, muted, camera }
//   gcall:rejoin { callId }
// Máy chủ gửi: gcall:ring (đổ chuông) · gcall:ring-stop { callId, reason } · gcall:joined { callId, user }
//   gcall:left { callId, userId } · gcall:signal { callId, from, data } · gcall:media { callId, userId, muted, camera }
//   gcall:update { callId, ringing } · gcall:ended { callId, reason, duration } · gcall:state { conversationId, call | null }
// Người vào sau gửi lời mời kết nối (offer) cho từng người đang ở trong cuộc gọi; người đang ở trong trả lời (answer).
// Tin hệ thống: { event: 'gcall', video, status: 'ended' | 'missed', duration, count } (người gửi = người bắt đầu).
//
// Cả hai loại: call:report { callId, peerId, ok, path, local, remote } — máy báo đã nối được chưa và đi đường nào
// (thẳng / qua TURN), admin xem trong Quản trị → AI, gọi để biết vì sao cuộc gọi không nối được.
const crypto = require('node:crypto');
const { get, all } = require('./db');
const turn = require('./turn');

const RING_MS = 45_000; // đổ chuông tối đa 45 giây
const RESUME_MS = 30_000; // mất kết nối với máy chủ giữa cuộc gọi: đợi nối lại 30 giây
const ALONE_MS = 60_000; // gọi nhóm chỉ còn một người: tự kết thúc sau 1 phút
const MAX_GROUP = 8;
const MAX_SIGNAL = 64_000;
const MAX_SIGNALS = 400; // mỗi người mỗi cuộc gọi (gọi nhóm: nhân với số người)
const MAX_REPORTS = 40;
const CANDIDATE_TYPES = ['host', 'srflx', 'prflx', 'relay'];

class CallError extends Error {}

function setupCalls(ctx) {
  const { app, io, requireAuth, requireReady, requireAdmin, membership, systemMessage, emitMessage, memberIds, isActive, notify, isBot } = ctx;
  const ringMs = ctx.ringMs || RING_MS;
  const resumeMs = ctx.resumeMs || RESUME_MS;
  const aloneMs = ctx.aloneMs || ALONE_MS;
  const calls = new Map(); // callId -> cuộc gọi 1-1
  const groups = new Map(); // callId -> cuộc gọi nhóm
  const groupOfConv = new Map(); // convId -> callId
  const byUser = new Map(); // userId -> callId (đang ở trong cuộc gọi nào, 1-1 hay nhóm)
  const reports = []; // báo cáo kết nối gần đây (cho admin)

  const newId = () => crypto.randomBytes(9).toString('base64url');
  const userRow = (uid) => get('SELECT id, display_name, avatar, disabled FROM users WHERE id = ?', uid);
  const userInfo = (uid) => {
    const u = userRow(uid);
    return { id: uid, displayName: u?.display_name || 'Người dùng', avatar: u?.avatar || null };
  };
  const other = (call, uid) => (uid === call.callerId ? call.calleeId : call.callerId);
  const socketOf = (call, uid) => (uid === call.callerId ? call.callerSocket : call.calleeSocket);
  const durationOf = (call) => (call.answeredAt ? Math.max(0, Math.round((Date.now() - call.answeredAt) / 1000)) : 0);

  const handle = (fn) => async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      reply((await fn(data)) || { ok: true });
    } catch (err) {
      if (!(err instanceof CallError)) console.warn('[calls]', err);
      reply({ error: err instanceof CallError ? err.message : 'Có lỗi khi gọi, thử lại sau.' });
    }
  };
  const validSignal = (raw) => raw && typeof raw === 'object' && JSON.stringify(raw).length <= MAX_SIGNAL;

  /* ================================ Gọi 1-1 ================================ */

  function payload(call) {
    return {
      id: call.id,
      kind: 'direct',
      conversationId: call.convId,
      video: call.video,
      state: call.state,
      callerId: call.callerId,
      calleeId: call.calleeId,
      caller: userInfo(call.callerId),
      callee: userInfo(call.calleeId),
      createdAt: call.createdAt,
      answeredAt: call.answeredAt || null,
      iceServers: call.iceServers,
    };
  }

  function end(call, reason) {
    if (!calls.has(call.id)) return;
    calls.delete(call.id);
    for (const uid of [call.callerId, call.calleeId]) if (byUser.get(uid) === call.id) byUser.delete(uid);
    clearTimeout(call.ringTimer);
    for (const t of Object.values(call.dropTimers)) clearTimeout(t);
    const duration = durationOf(call);
    for (const uid of [call.callerId, call.calleeId]) io.to(`user:${uid}`).emit('call:ended', { callId: call.id, conversationId: call.convId, reason, duration });

    const status = call.answeredAt ? 'ended' : reason === 'declined' ? 'declined' : 'missed';
    try {
      const id = systemMessage(call.convId, call.callerId, { event: 'call', video: call.video, status, duration, to: call.calleeId });
      emitMessage(id, memberIds(call.convId));
    } catch (err) {
      console.warn('[calls]', err.message);
    }
    if (status === 'missed') {
      const caller = userRow(call.callerId);
      notify(call.calleeId, {
        type: 'call_missed',
        conversationId: call.convId,
        title: caller.display_name,
        body: call.video ? '📹 Cuộc gọi video nhỡ' : '📞 Cuộc gọi thoại nhỡ',
        icon: caller.avatar || '/icons/icon-192.png',
        tag: `call-${call.convId}`, // thay cho thông báo "đang gọi"
        url: `/#/c/${call.convId}`,
      }).catch((err) => console.warn('[push]', err.message));
    }
  }

  function partyCall(socket, data) {
    const call = calls.get(String(data?.callId || ''));
    const uid = socket.data.userId;
    if (!call || (uid !== call.callerId && uid !== call.calleeId)) throw new CallError('Cuộc gọi đã kết thúc.');
    return { call, uid };
  }

  /* ================================ Gọi nhóm ================================ */

  // Thành viên nhận cuộc gọi nhóm: còn hoạt động, không phải Think AI
  const groupMembers = (convId) =>
    all("SELECT u.id FROM members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND u.disabled = 0 AND u.role <> 'bot'", convId).map(
      (r) => r.id
    );

  function convInfo(convId) {
    const c = get('SELECT id, type, name, avatar FROM conversations WHERE id = ?', convId);
    return { title: c?.type === 'general' ? c?.name || 'Cả nhóm' : c?.name || 'Nhóm', avatar: c?.avatar || null, type: c?.type || 'group' };
  }

  function summary(g) {
    return {
      id: g.id,
      conversationId: g.convId,
      video: g.video,
      startedBy: g.startedBy,
      participants: [...g.participants.keys()],
      ringing: [...g.ringing.keys()],
      createdAt: g.createdAt,
      startedAt: g.startedAt || null,
    };
  }

  function gPayload(g) {
    const conv = convInfo(g.convId);
    return {
      ...summary(g),
      kind: 'group',
      title: conv.title,
      avatar: conv.avatar,
      starter: userInfo(g.startedBy),
      people: [...g.participants].map(([id, p]) => ({ ...userInfo(id), muted: p.muted, camera: p.camera, joinedAt: p.joinedAt })),
      iceServers: g.iceServers,
    };
  }

  const toParticipants = (g, ev, data, exceptUid) => {
    for (const [uid, p] of g.participants) if (uid !== exceptUid && p.socket) io.to(p.socket).emit(ev, data);
  };
  // Cả nhóm biết đang có cuộc gọi (thanh "Tham gia" trên đầu khung chat)
  const broadcastState = (convId, g) => {
    const data = { conversationId: convId, call: g ? summary(g) : null };
    for (const uid of memberIds(convId)) io.to(`user:${uid}`).emit('gcall:state', data);
  };

  function stopRing(g, uid, reason) {
    const t = g.ringing.get(uid);
    if (t === undefined) return false;
    clearTimeout(t);
    g.ringing.delete(uid);
    io.to(`user:${uid}`).emit('gcall:ring-stop', { callId: g.id, conversationId: g.convId, reason });
    return true;
  }

  function checkAlone(g) {
    clearTimeout(g.aloneTimer);
    g.aloneTimer = null;
    if (g.participants.size !== 1 || g.ringing.size) return;
    // Chưa ai vào mà hết người đổ chuông: kết thúc như cuộc gọi nhỡ. Mọi người đã rời, còn một người: đợi 1 phút.
    const nobody = g.everJoined.size === 1;
    g.aloneTimer = setTimeout(() => endGroup(g, nobody ? 'missed' : 'ended'), nobody ? 1500 : aloneMs);
  }

  function endGroup(g, reason) {
    if (!groups.has(g.id)) return;
    groups.delete(g.id);
    if (groupOfConv.get(g.convId) === g.id) groupOfConv.delete(g.convId);
    clearTimeout(g.aloneTimer);
    for (const uid of [...g.ringing.keys()]) stopRing(g, uid, 'ended');
    const duration = g.startedAt ? Math.max(0, Math.round((Date.now() - g.startedAt) / 1000)) : 0;
    for (const [uid, p] of g.participants) {
      clearTimeout(p.dropTimer);
      if (byUser.get(uid) === g.id) byUser.delete(uid);
      io.to(`user:${uid}`).emit('gcall:ended', { callId: g.id, conversationId: g.convId, reason, duration });
    }
    g.participants.clear();
    broadcastState(g.convId, null);
    try {
      const status = g.everJoined.size > 1 ? 'ended' : 'missed';
      const id = systemMessage(g.convId, g.startedBy, { event: 'gcall', video: g.video, status, duration, count: g.everJoined.size });
      emitMessage(id, memberIds(g.convId));
    } catch (err) {
      console.warn('[calls]', err.message);
    }
  }

  function removeParticipant(g, uid, reason) {
    const p = g.participants.get(uid);
    if (!p) return;
    clearTimeout(p.dropTimer);
    g.participants.delete(uid);
    if (byUser.get(uid) === g.id) byUser.delete(uid);
    if (reason === 'dropped') io.to(`user:${uid}`).emit('gcall:ended', { callId: g.id, conversationId: g.convId, reason: 'dropped', duration: 0 });
    toParticipants(g, 'gcall:left', { callId: g.id, userId: uid });
    if (!g.participants.size) return endGroup(g, 'ended');
    broadcastState(g.convId, g);
    checkAlone(g);
  }

  function addParticipant(g, uid, socketId, camera) {
    g.participants.set(uid, { socket: socketId, joinedAt: Date.now(), muted: false, camera: Boolean(camera), dropTimer: null });
    g.everJoined.add(uid);
    g.signals[uid] = g.signals[uid] || 0;
    byUser.set(uid, g.id);
    if (!g.startedAt && g.participants.size >= 2) g.startedAt = Date.now();
  }

  function groupFor(socket, data) {
    const g = groups.get(String(data?.callId || ''));
    const uid = socket.data.userId;
    if (!g || !membership(g.convId, uid)) throw new CallError('Cuộc gọi nhóm đã kết thúc.');
    return { g, uid };
  }

  function joinGroup(g, uid, socket, camera) {
    const mine = g.participants.get(uid);
    if (mine) {
      // Đã ở trong cuộc gọi: máy này vào lại (vd mở lại app)
      if (mine.socket && mine.socket !== socket.id && io.sockets.sockets.get(mine.socket)) throw new CallError('Bạn đang ở trong cuộc gọi này trên máy khác.');
      mine.socket = socket.id;
      clearTimeout(mine.dropTimer);
      return { call: gPayload(g) };
    }
    if (byUser.has(uid)) throw new CallError('Bạn đang trong một cuộc gọi khác.');
    if (g.participants.size >= MAX_GROUP) throw new CallError(`Cuộc gọi nhóm đã đủ ${MAX_GROUP} người.`);
    if (g.ringing.has(uid)) {
      clearTimeout(g.ringing.get(uid));
      g.ringing.delete(uid);
      io.to(`user:${uid}`).except(socket.id).emit('gcall:ring-stop', { callId: g.id, conversationId: g.convId, reason: 'elsewhere' });
    }
    addParticipant(g, uid, socket.id, camera);
    toParticipants(g, 'gcall:joined', { callId: g.id, user: { ...userInfo(uid), muted: false, camera: Boolean(camera) } }, uid);
    broadcastState(g.convId, g);
    checkAlone(g);
    return { call: gPayload(g) };
  }

  /* ================================ Kết nối Socket.IO ================================ */

  /** Gắn các sự kiện gọi điện cho một kết nối Socket.IO (server.js gọi khi có kết nối mới) */
  function attach(socket) {
    const uid = socket.data.userId;

    /* ---------- 1-1 ---------- */
    socket.on('call:start', handle(async (data) => {
      const convId = Number(data?.conversationId);
      const conv = Number.isInteger(convId) ? get('SELECT id, type FROM conversations WHERE id = ?', convId) : null;
      if (!conv || !membership(convId, uid)) throw new CallError('Không tìm thấy cuộc trò chuyện.');
      if (conv.type !== 'dm') throw new CallError('Gọi nhóm dùng nút gọi trong nhóm.');
      const peerId = memberIds(convId).find((m) => m !== uid);
      const peer = peerId ? userRow(peerId) : null;
      if (!peer || peer.disabled) throw new CallError('Tài khoản này không nhận cuộc gọi.');
      if (isBot(peerId)) throw new CallError('Think AI chưa nghe điện thoại được 😅 Nhắn tin cho mình nhé!');
      if (byUser.has(uid)) {
        const mine = calls.get(byUser.get(uid));
        // Cuộc gọi cũ của chính mình còn treo (vd máy cũ mất mạng): kết thúc nó trước
        if (mine && (mine.state === 'ringing' || !socketOf(mine, uid))) end(mine, mine.answeredAt ? 'dropped' : 'canceled');
        else throw new CallError('Bạn đang trong một cuộc gọi khác.');
      }
      if (byUser.has(peerId)) throw new CallError(`${peer.display_name} đang bận trong cuộc gọi khác.`);
      const call = {
        id: newId(),
        convId,
        callerId: uid,
        calleeId: peerId,
        video: Boolean(data?.video),
        state: 'ringing',
        createdAt: Date.now(),
        answeredAt: 0,
        callerSocket: socket.id,
        calleeSocket: null,
        signals: { [uid]: 0, [peerId]: 0 },
        dropTimers: {},
        iceServers: await turn.iceServers(),
      };
      calls.set(call.id, call);
      byUser.set(uid, call.id);
      byUser.set(peerId, call.id);
      call.ringTimer = setTimeout(() => end(call, 'missed'), ringMs);
      const info = payload(call);
      io.to(`user:${peerId}`).emit('call:incoming', info);
      if (!isActive(peerId)) {
        const caller = userRow(uid);
        notify(peerId, {
          type: 'call',
          conversationId: convId,
          callId: call.id,
          title: caller.display_name,
          body: call.video ? '📹 Đang gọi video cho bạn… Bấm để trả lời' : '📞 Đang gọi thoại cho bạn… Bấm để trả lời',
          icon: caller.avatar || '/icons/icon-192.png',
          tag: `call-${convId}`,
          url: `/#/c/${convId}`,
          ttl: Math.round(ringMs / 1000),
        }).catch((err) => console.warn('[push]', err.message));
      }
      return { call: info };
    }));

    socket.on('call:accept', handle(async (data) => {
      const { call } = partyCall(socket, data);
      if (uid !== call.calleeId) throw new CallError('Không trả lời được cuộc gọi này.');
      if (call.state !== 'ringing') throw new CallError(call.calleeSocket === socket.id ? 'Đã trả lời rồi.' : 'Cuộc gọi đã được trả lời trên máy khác.');
      call.state = 'active';
      call.answeredAt = Date.now();
      call.calleeSocket = socket.id;
      clearTimeout(call.ringTimer);
      if (call.callerSocket) io.to(call.callerSocket).emit('call:accepted', { callId: call.id, answeredAt: call.answeredAt });
      // Các máy khác của người nghe thôi đổ chuông
      io.to(`user:${uid}`).except(socket.id).emit('call:ended', { callId: call.id, conversationId: call.convId, reason: 'elsewhere', duration: 0 });
      return { call: payload(call) };
    }));

    socket.on('call:decline', handle(async (data) => {
      const { call } = partyCall(socket, data);
      if (call.state === 'ringing' && uid === call.calleeId) end(call, data?.busy ? 'busy' : 'declined');
      else end(call, call.answeredAt ? 'ended' : 'canceled');
    }));

    socket.on('call:end', handle(async (data) => {
      const { call } = partyCall(socket, data);
      end(call, call.answeredAt ? 'ended' : uid === call.callerId ? 'canceled' : 'declined');
    }));

    socket.on('call:signal', handle(async (data) => {
      const { call } = partyCall(socket, data);
      if (socketOf(call, uid) !== socket.id) throw new CallError('Cuộc gọi đang ở máy khác.');
      const raw = data?.data;
      if (!validSignal(raw)) throw new CallError('Dữ liệu cuộc gọi không hợp lệ.');
      if (++call.signals[uid] > MAX_SIGNALS) throw new CallError('Quá nhiều dữ liệu cuộc gọi.');
      const target = socketOf(call, other(call, uid));
      if (target) io.to(target).emit('call:signal', { callId: call.id, data: raw });
    }));

    // Bật / tắt micro, camera: báo cho người bên kia (hiện ảnh đại diện khi tắt camera)
    socket.on('call:media', handle(async (data) => {
      const { call } = partyCall(socket, data);
      const target = socketOf(call, other(call, uid));
      if (target) io.to(target).emit('call:media', { callId: call.id, userId: uid, muted: Boolean(data?.muted), camera: Boolean(data?.camera) });
    }));

    // Mất kết nối với máy chủ rồi nối lại giữa cuộc gọi
    socket.on('call:rejoin', handle(async (data) => {
      const { call } = partyCall(socket, data);
      const current = socketOf(call, uid);
      if (current && current !== socket.id && io.sockets.sockets.get(current)) throw new CallError('Cuộc gọi đang ở máy khác.');
      if (uid === call.callerId) call.callerSocket = socket.id;
      else if (call.state === 'active') call.calleeSocket = socket.id;
      clearTimeout(call.dropTimers[uid]);
      delete call.dropTimers[uid];
      return { call: payload(call) };
    }));

    /* ---------- Gọi nhóm ---------- */
    socket.on('gcall:start', handle(async (data) => {
      const convId = Number(data?.conversationId);
      const conv = Number.isInteger(convId) ? get('SELECT id, type FROM conversations WHERE id = ?', convId) : null;
      if (!conv || !membership(convId, uid)) throw new CallError('Không tìm thấy cuộc trò chuyện.');
      if (conv.type === 'dm') throw new CallError('Chat riêng dùng cuộc gọi 1-1.');
      const video = Boolean(data?.video);
      const running = groups.get(groupOfConv.get(convId));
      if (running) return { ...joinGroup(running, uid, socket, video), joined: true }; // đang có cuộc gọi: vào luôn
      if (byUser.has(uid)) throw new CallError('Bạn đang trong một cuộc gọi khác.');
      const g = {
        id: newId(),
        convId,
        video,
        startedBy: uid,
        createdAt: Date.now(),
        startedAt: 0,
        participants: new Map(),
        ringing: new Map(),
        everJoined: new Set(),
        signals: {},
        aloneTimer: null,
        iceServers: await turn.iceServers(),
      };
      // Hai người cùng bấm gọi một lúc: người sau vào cuộc gọi của người trước
      const raced = groups.get(groupOfConv.get(convId));
      if (raced) return { ...joinGroup(raced, uid, socket, video), joined: true };
      groups.set(g.id, g);
      groupOfConv.set(convId, g.id);
      addParticipant(g, uid, socket.id, video);
      const starter = userRow(uid);
      const conv2 = convInfo(convId);
      const info = gPayload(g);
      for (const m of groupMembers(convId)) {
        if (m === uid || byUser.has(m)) continue; // đang bận cuộc gọi khác thì không đổ chuông
        g.ringing.set(m, setTimeout(() => {
          stopRing(g, m, 'timeout');
          toParticipants(g, 'gcall:update', { callId: g.id, ringing: [...g.ringing.keys()] });
          checkAlone(g);
        }, ringMs));
        io.to(`user:${m}`).emit('gcall:ring', { ...info, ringing: [...g.ringing.keys()] });
        if (!isActive(m)) {
          notify(m, {
            type: 'call',
            conversationId: convId,
            callId: g.id,
            title: conv2.title,
            body: `${g.video ? '📹' : '📞'} ${starter.display_name} đang gọi nhóm${g.video ? ' video' : ''}… Bấm để tham gia`,
            icon: conv2.avatar || starter.avatar || '/icons/icon-192.png',
            tag: `call-${convId}`,
            url: `/#/c/${convId}`,
            ttl: Math.round(ringMs / 1000),
          }).catch((err) => console.warn('[push]', err.message));
        }
      }
      broadcastState(convId, g);
      checkAlone(g);
      return { call: gPayload(g) };
    }));

    socket.on('gcall:join', handle(async (data) => {
      const { g } = groupFor(socket, data);
      return joinGroup(g, uid, socket, data?.camera === undefined ? g.video : data.camera);
    }));

    socket.on('gcall:decline', handle(async (data) => {
      const { g } = groupFor(socket, data);
      if (stopRing(g, uid, 'declined')) {
        toParticipants(g, 'gcall:update', { callId: g.id, ringing: [...g.ringing.keys()] });
        checkAlone(g);
      }
    }));

    socket.on('gcall:leave', handle(async (data) => {
      const { g } = groupFor(socket, data);
      const p = g.participants.get(uid);
      if (p && (!p.socket || p.socket === socket.id)) removeParticipant(g, uid, 'left');
    }));

    socket.on('gcall:signal', handle(async (data) => {
      const { g } = groupFor(socket, data);
      const p = g.participants.get(uid);
      if (!p || p.socket !== socket.id) throw new CallError('Bạn không ở trong cuộc gọi này.');
      const target = g.participants.get(Number(data?.to));
      if (!target) throw new CallError('Người này đã rời cuộc gọi.');
      if (!validSignal(data?.data)) throw new CallError('Dữ liệu cuộc gọi không hợp lệ.');
      if (++g.signals[uid] > MAX_SIGNALS * MAX_GROUP) throw new CallError('Quá nhiều dữ liệu cuộc gọi.');
      if (target.socket) io.to(target.socket).emit('gcall:signal', { callId: g.id, from: uid, data: data.data });
    }));

    socket.on('gcall:media', handle(async (data) => {
      const { g } = groupFor(socket, data);
      const p = g.participants.get(uid);
      if (!p) throw new CallError('Bạn không ở trong cuộc gọi này.');
      p.muted = Boolean(data?.muted);
      p.camera = Boolean(data?.camera);
      toParticipants(g, 'gcall:media', { callId: g.id, userId: uid, muted: p.muted, camera: p.camera }, uid);
    }));

    socket.on('gcall:rejoin', handle(async (data) => {
      const { g } = groupFor(socket, data);
      if (!g.participants.has(uid)) throw new CallError('Bạn đã rời cuộc gọi này.');
      return joinGroup(g, uid, socket, g.participants.get(uid).camera);
    }));

    /* ---------- Báo cáo kết nối (cho admin) ---------- */
    socket.on('call:report', handle(async (data) => {
      const callId = String(data?.callId || '');
      const direct = calls.get(callId);
      const g = groups.get(callId);
      if (!direct && !g) return { ok: true }; // cuộc gọi đã xong: bỏ qua
      if (direct && uid !== direct.callerId && uid !== direct.calleeId) return { ok: true };
      if (g && !g.participants.has(uid)) return { ok: true };
      const types = (list) => (Array.isArray(list) ? [...new Set(list.filter((t) => CANDIDATE_TYPES.includes(t)))] : []);
      reports.unshift({
        at: Date.now(),
        kind: g ? 'group' : 'direct',
        video: Boolean((g || direct).video),
        from: uid,
        to: Number(data?.peerId) || (direct ? other(direct, uid) : null),
        ok: Boolean(data?.ok),
        path: ['direct', 'relay'].includes(data?.path) ? data.path : null,
        local: types(data?.local),
        remote: types(data?.remote),
        platform: data?.platform === 'app' ? 'app' : 'web',
      });
      reports.length = Math.min(reports.length, MAX_REPORTS);
      return { ok: true };
    }));

    socket.on('disconnect', () => {
      const id = byUser.get(uid);
      const call = calls.get(id);
      if (call && socketOf(call, uid) === socket.id) {
        if (uid === call.callerId) call.callerSocket = null;
        else call.calleeSocket = null;
        call.dropTimers[uid] = setTimeout(() => end(call, call.answeredAt ? 'dropped' : 'canceled'), resumeMs);
      }
      const g = groups.get(id);
      const p = g?.participants.get(uid);
      if (g && p && p.socket === socket.id) {
        p.socket = null;
        p.dropTimer = setTimeout(() => removeParticipant(g, uid, 'dropped'), resumeMs);
      }
    });

    // Vừa mở app / web khi đang có người gọi đến: hiện màn hình cuộc gọi đến
    const waiting = calls.get(byUser.get(uid));
    if (waiting && waiting.state === 'ringing' && uid === waiting.calleeId) socket.emit('call:incoming', payload(waiting));
    // Cuộc gọi nhóm đang diễn ra trong các nhóm của mình (thanh "Tham gia"), nhóm đang gọi mình
    for (const g of groups.values()) {
      if (!membership(g.convId, uid)) continue;
      socket.emit('gcall:state', { conversationId: g.convId, call: summary(g) });
      if (g.ringing.has(uid)) socket.emit('gcall:ring', gPayload(g));
    }
  }

  /* ================================ API ================================ */

  // Cuộc gọi hiện tại của mình (app mở từ thông báo, kiểm tra tự động)
  app.get('/api/calls/current', requireAuth, requireReady, (req, res) => {
    const id = byUser.get(req.user.id);
    const call = calls.get(id);
    const g = groups.get(id);
    res.json({ call: call ? payload(call) : null, group: g ? gPayload(g) : null });
  });
  // Các cuộc gọi nhóm đang diễn ra trong nhóm của mình
  app.get('/api/calls/groups', requireAuth, requireReady, (req, res) => {
    res.json({ calls: [...groups.values()].filter((g) => membership(g.convId, req.user.id)).map(summary) });
  });
  app.get('/api/calls/ice', requireAuth, requireReady, async (req, res) => {
    res.json({ iceServers: await turn.iceServers() });
  });

  const adminChain = [requireAuth, requireReady, requireAdmin];
  async function adminPayload() {
    const { sources } = await turn.iceConfig();
    const name = (id) => (id ? userRow(id)?.display_name || 'Người dùng' : '');
    return {
      ...turn.adminView(),
      sources,
      recent: reports.map((r) => ({ ...r, fromName: name(r.from), toName: name(r.to) })),
    };
  }
  app.get('/api/admin/calls', ...adminChain, async (req, res) => res.json({ calls: await adminPayload() }));
  app.put('/api/admin/calls', ...adminChain, async (req, res) => {
    try {
      turn.saveSettings(req.body || {});
    } catch (err) {
      if (err instanceof turn.TurnError) return res.status(400).json({ error: err.message });
      throw err;
    }
    res.json({ calls: await adminPayload() });
  });

  return { attach, active: () => calls.size, groups: () => groups.size, _calls: calls, _groups: groups };
}

module.exports = { setupCalls, iceServers: turn.iceServers, RING_MS, RESUME_MS, ALONE_MS, MAX_GROUP };
