'use strict';
// Gọi thoại / gọi video 1-1 (2.10.0) bằng WebRTC, cho cả web và app.
// Máy chủ chỉ "chuyển lời" giữa hai máy qua Socket.IO (mời gọi, nhận / từ chối, trao đổi thông tin kết nối SDP / ICE);
// tiếng và hình đi thẳng giữa hai máy, hoặc qua máy chủ TURN khi hai mạng không nối thẳng được (4G, mạng công ty...).
// Ghi lại trong cuộc trò chuyện: tin hệ thống { event: 'call', video, status: 'ended' | 'missed' | 'declined', duration, to } (người gửi = người gọi, to = người nghe).
//
// Sự kiện máy người dùng gửi (đều có ack):  call:start { conversationId, video } · call:accept { callId } · call:decline { callId }
//   call:end { callId } · call:signal { callId, data } · call:media { callId, muted, camera } · call:rejoin { callId }
// Máy chủ gửi:  call:incoming (call) · call:accepted { callId } · call:signal { callId, data } · call:media {...}
//   call:ended { callId, reason, duration } (reason: ended | declined | missed | canceled | busy | elsewhere | dropped)
const crypto = require('node:crypto');
const { get, getSetting, setSetting } = require('./db');

const RING_MS = 45_000; // đổ chuông tối đa 45 giây
const RESUME_MS = 30_000; // mất kết nối với máy chủ giữa cuộc gọi: đợi nối lại 30 giây
const MAX_SIGNAL = 64_000;
const MAX_SIGNALS = 400; // mỗi người mỗi cuộc gọi
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

class CallError extends Error {}

/* ---------------- Máy chủ TURN ---------------- */

function turnSettings() {
  const s = getSetting('calls', null);
  return { turnUrls: '', turnUsername: '', turnCredential: '', ...(s && typeof s === 'object' ? s : {}) };
}

const splitUrls = (v) => String(v || '').split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^turns?:[^\s]+$/i.test(u)).slice(0, 8);

let cfCache = null; // { at, servers }
async function cloudflareTurn() {
  const id = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return [];
  if (cfCache && Date.now() - cfCache.at < 6 * 3600_000) return cfCache.servers;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    const servers = list.filter((s) => s && s.urls);
    cfCache = { at: Date.now(), servers };
    return servers;
  } catch (err) {
    console.warn('[calls] Không lấy được TURN của Cloudflare:', err.message);
    return cfCache?.servers || [];
  }
}

/** Danh sách máy chủ STUN / TURN gửi cho máy người dùng */
async function iceServers() {
  const out = [...STUN];
  const s = turnSettings();
  const urls = splitUrls(s.turnUrls || process.env.TURN_URLS);
  if (urls.length) {
    out.push({
      urls,
      username: s.turnUrls ? s.turnUsername : process.env.TURN_USERNAME || '',
      credential: s.turnUrls ? s.turnCredential : process.env.TURN_CREDENTIAL || '',
    });
  }
  out.push(...(await cloudflareTurn()));
  return out;
}

function adminView() {
  const s = turnSettings();
  return {
    turnUrls: s.turnUrls || '',
    turnUsername: s.turnUsername || '',
    hasCredential: Boolean(s.turnCredential),
    envTurn: splitUrls(process.env.TURN_URLS).length > 0,
    cloudflare: Boolean(process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN),
  };
}

function saveTurn(body = {}) {
  const s = turnSettings();
  if (body.turnUrls !== undefined) {
    const raw = String(body.turnUrls || '').trim();
    const urls = splitUrls(raw);
    if (raw && !urls.length) throw new CallError('Địa chỉ TURN phải bắt đầu bằng turn: hoặc turns: (vd turn:turn.example.com:3478).');
    s.turnUrls = urls.join(', ');
  }
  if (body.turnUsername !== undefined) s.turnUsername = String(body.turnUsername || '').trim().slice(0, 200);
  if (body.turnCredential !== undefined && body.turnCredential !== null) s.turnCredential = String(body.turnCredential).trim().slice(0, 300);
  if (!s.turnUrls) {
    s.turnUsername = '';
    s.turnCredential = '';
  }
  setSetting('calls', s);
  return adminView();
}

/* ---------------- Cuộc gọi ---------------- */

function setupCalls(ctx) {
  const { app, io, requireAuth, requireReady, requireAdmin, membership, systemMessage, emitMessage, memberIds, isActive, notify, isBot } = ctx;
  const ringMs = ctx.ringMs || RING_MS;
  const resumeMs = ctx.resumeMs || RESUME_MS;
  const calls = new Map(); // callId -> call
  const byUser = new Map(); // userId -> callId

  const userRow = (uid) => get('SELECT id, display_name, avatar, disabled FROM users WHERE id = ?', uid);
  const other = (call, uid) => (uid === call.callerId ? call.calleeId : call.callerId);
  const socketOf = (call, uid) => (uid === call.callerId ? call.callerSocket : call.calleeSocket);
  const durationOf = (call) => (call.answeredAt ? Math.max(0, Math.round((Date.now() - call.answeredAt) / 1000)) : 0);

  function payload(call) {
    const caller = userRow(call.callerId);
    const callee = userRow(call.calleeId);
    return {
      id: call.id,
      conversationId: call.convId,
      video: call.video,
      state: call.state,
      callerId: call.callerId,
      calleeId: call.calleeId,
      caller: { id: caller.id, displayName: caller.display_name, avatar: caller.avatar || null },
      callee: { id: callee.id, displayName: callee.display_name, avatar: callee.avatar || null },
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

  const handle = (fn) => async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      reply((await fn(data)) || { ok: true });
    } catch (err) {
      if (!(err instanceof CallError)) console.warn('[calls]', err);
      reply({ error: err instanceof CallError ? err.message : 'Có lỗi khi gọi, thử lại sau.' });
    }
  };

  /** Gắn các sự kiện gọi điện cho một kết nối Socket.IO (server.js gọi khi có kết nối mới) */
  function attach(socket) {
    const uid = socket.data.userId;

    socket.on('call:start', handle(async (data) => {
      const convId = Number(data?.conversationId);
      const conv = Number.isInteger(convId) ? get('SELECT id, type FROM conversations WHERE id = ?', convId) : null;
      if (!conv || !membership(convId, uid)) throw new CallError('Không tìm thấy cuộc trò chuyện.');
      if (conv.type !== 'dm') throw new CallError('Hiện chỉ gọi được trong cuộc trò chuyện riêng.');
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
        id: crypto.randomBytes(9).toString('base64url'),
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
        iceServers: await iceServers(),
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
      if (!raw || typeof raw !== 'object' || JSON.stringify(raw).length > MAX_SIGNAL) throw new CallError('Dữ liệu cuộc gọi không hợp lệ.');
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

    socket.on('disconnect', () => {
      const call = calls.get(byUser.get(uid));
      if (!call || socketOf(call, uid) !== socket.id) return;
      if (uid === call.callerId) call.callerSocket = null;
      else call.calleeSocket = null;
      call.dropTimers[uid] = setTimeout(() => end(call, call.answeredAt ? 'dropped' : 'canceled'), resumeMs);
    });

    // Vừa mở app / web khi đang có người gọi đến: hiện màn hình cuộc gọi đến
    const waiting = calls.get(byUser.get(uid));
    if (waiting && waiting.state === 'ringing' && uid === waiting.calleeId) socket.emit('call:incoming', payload(waiting));
  }

  // Cuộc gọi hiện tại của mình (app mở từ thông báo, kiểm tra tự động)
  app.get('/api/calls/current', requireAuth, requireReady, (req, res) => {
    const call = calls.get(byUser.get(req.user.id));
    res.json({ call: call ? payload(call) : null });
  });
  app.get('/api/calls/ice', requireAuth, requireReady, async (req, res) => {
    res.json({ iceServers: await iceServers() });
  });

  const adminChain = [requireAuth, requireReady, requireAdmin];
  app.get('/api/admin/calls', ...adminChain, (req, res) => res.json({ calls: adminView() }));
  app.put('/api/admin/calls', ...adminChain, (req, res) => {
    try {
      res.json({ calls: saveTurn(req.body || {}) });
    } catch (err) {
      if (err instanceof CallError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  return { attach, active: () => calls.size, _calls: calls };
}

module.exports = { setupCalls, iceServers, RING_MS, RESUME_MS };
