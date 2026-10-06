import * as Notifications from "expo-notifications";
import { PermissionsAndroid, Platform } from "react-native";
import type { Socket } from "socket.io-client";
import { create } from "zustand";

import { ThinkNative } from "../native";
import { createPeer, getUserMedia, rtcAvailable, switchCamera, toCandidate, toSession } from "./rtc";
import { startTone, stopTone } from "./sound";
import type { CallInfo, CallPeer, CallPhase, Peer, SessionDesc, Stream } from "./types";

// Gọi thoại / gọi video 1-1 (2.10.0) cho app. Máy chủ: src/calls.js (chỉ chuyển lời mời và thông tin kết nối),
// bản web: public/calls-ui.js (cùng cách làm). Tiếng và hình đi thẳng giữa hai máy bằng WebRTC.
// Phần này không phụ thuộc store.ts: store.ts gọi bindCallSocket() khi nối máy chủ.

const CONNECT_MS = 30000; // trả lời rồi mà 30 giây chưa nối được thì dừng
const LOST_MS = 20000; // mất kết nối giữa chừng quá 20 giây thì dừng

/** Những gì màn hình cuộc gọi cần vẽ */
export type CallView = {
  phase: CallPhase;
  role: "caller" | "callee";
  video: boolean;
  convId: number;
  callId: string | null;
  peer: CallPeer;
  muted: boolean;
  camOn: boolean;
  speaker: boolean;
  facing: "user" | "environment";
  remoteMuted: boolean;
  remoteCam: boolean;
  remoteVideo: boolean;
  reconnecting: boolean;
  connectedAt: number | null;
  endedText: string | null;
  local: Stream | null;
  remote: Stream | null;
};

export const useCall = create<{ view: CallView | null }>(() => ({ view: null }));

/** store.ts đặt: hiện thông báo nhỏ */
export const callHooks: { toast: (text: string) => void } = { toast: () => undefined };

type Cur = CallView & {
  call: CallInfo | null;
  pc: Peer | null;
  pendingIce: object[];
  tracksAdded: boolean;
  offered: boolean;
  restarted: boolean;
  done: boolean;
  connectTimer?: ReturnType<typeof setTimeout>;
  lostTimer?: ReturnType<typeof setTimeout>;
};

let socket: Socket | null = null;
let cur: Cur | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
/** Cuộc gọi `me` vẫn là cuộc gọi đang diễn ra (không bị gác máy trong lúc chờ) */
const alive = (me: Cur) => cur === me;

const VIEW_KEYS: (keyof CallView)[] = [
  "phase",
  "role",
  "video",
  "convId",
  "callId",
  "peer",
  "muted",
  "camOn",
  "speaker",
  "facing",
  "remoteMuted",
  "remoteCam",
  "remoteVideo",
  "reconnecting",
  "connectedAt",
  "endedText",
  "local",
  "remote",
];

function publish() {
  if (!cur) return;
  const view = {} as Record<string, unknown>;
  for (const k of VIEW_KEYS) view[k] = cur[k];
  useCall.setState({ view: view as CallView });
}

function emit<T = { error?: string }>(ev: string, data: object): Promise<T & { error?: string }> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ error: "Chưa kết nối được máy chủ. Thử lại sau giây lát." } as T & { error?: string });
      return;
    }
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ error: "Máy chủ không trả lời. Thử lại sau." } as T & { error?: string });
    }, 12000);
    socket.emit(ev, data, (res: T) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve((res || {}) as T & { error?: string });
    });
  });
}
const signal = (me: Cur, data: object) => me.call && emit("call:signal", { callId: me.call.id, data });
const sendMedia = (me: Cur) => me.call && emit("call:media", { callId: me.call.id, muted: me.muted, camera: me.camOn });

/* ---------------- Âm thanh của máy (Android: CallAudio.kt) ---------------- */
function audioOn(me: Cur) {
  try {
    ThinkNative?.callAudioStart?.(me.speaker);
    ThinkNative?.callProximity?.(!me.video && !me.speaker);
    ThinkNative?.callServiceStart?.(me.peer.displayName, me.video);
  } catch {
    /* máy không hỗ trợ */
  }
}
function audioOff() {
  try {
    ThinkNative?.callServiceStop?.();
    ThinkNative?.callAudioStop?.();
  } catch {
    /* bỏ qua */
  }
}

// Bấm "Kết thúc" trong thông báo "Đang trong cuộc gọi" (hoặc vuốt tắt app)
try {
  ThinkNative?.addListener("onCallAction", (e) => {
    if (e?.type === "hangup") hangup();
  });
} catch {
  /* bản app cũ chưa có sự kiện này */
}

/* ---------------- Micro, máy ảnh ---------------- */
async function askPermissions(video: boolean) {
  if (Platform.OS !== "android") return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
  const res = await PermissionsAndroid.requestMultiple(wanted);
  if (res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) return false;
  return true;
}

async function getMedia(me: Cur): Promise<boolean> {
  const fail = (text: string) => {
    callHooks.toast(text);
    return false;
  };
  try {
    if (!(await askPermissions(me.video))) return fail("Bạn chưa cho Think dùng micro. Bật trong Cài đặt → Ứng dụng → Think Beta → Quyền.");
  } catch {
    /* hỏi quyền lỗi: vẫn thử mở micro */
  }
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  let stream: Stream | null = null;
  try {
    stream = await getUserMedia({ audio, video: me.video ? { facingMode: "user", width: 640, height: 480, frameRate: 24 } : false });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (!me.video || name === "NotAllowedError") return fail("Không mở được micro / máy ảnh. Kiểm tra quyền của Think Beta trong Cài đặt.");
    try {
      stream = await getUserMedia({ audio, video: false }); // không mở được máy ảnh: gọi bằng tiếng
      me.camOn = false;
      callHooks.toast("Không mở được máy ảnh, cuộc gọi chỉ có tiếng.");
    } catch {
      return fail("Không mở được micro.");
    }
  }
  if (!alive(me)) {
    stream.getTracks().forEach((t) => t.stop()); // đã gác máy trong lúc chờ
    return false;
  }
  me.local = stream;
  if (me.video && !stream.getVideoTracks().length) me.camOn = false;
  return true;
}

/* ---------------- Kết nối WebRTC ---------------- */
function ensurePc(me: Cur): Peer {
  if (me.pc) return me.pc;
  const pc = createPeer(me.call?.iceServers || []);
  me.pc = pc;
  pc.addEventListener("icecandidate", (e) => {
    if (!alive(me) || !e.candidate) return;
    const c = e.candidate as { toJSON?: () => object };
    signal(me, { candidate: typeof c.toJSON === "function" ? c.toJSON() : c });
  });
  pc.addEventListener("track", (e) => {
    if (!alive(me)) return;
    const stream = e.streams && e.streams[0];
    if (stream) me.remote = stream;
    if (e.track?.kind === "video") me.remoteVideo = true;
    publish();
  });
  pc.addEventListener("connectionstatechange", () => onConnState(me, pc.connectionState));
  pc.addEventListener("iceconnectionstatechange", () => {
    if (pc.connectionState === undefined) onConnState(me, pc.iceConnectionState === "completed" ? "connected" : pc.iceConnectionState || "");
  });
  return pc;
}

function addLocalTracks(me: Cur, pc: Peer) {
  if (me.tracksAdded || !me.local) return;
  for (const t of me.local.getTracks()) pc.addTrack(t, me.local);
  me.tracksAdded = true;
}

const plainDesc = (d: SessionDesc | null) => (d ? { type: d.type, sdp: d.sdp } : null);

async function sendOffer(me: Cur, restart = false) {
  const pc = ensurePc(me);
  addLocalTracks(me, pc);
  const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined);
  await pc.setLocalDescription(offer);
  me.offered = true;
  signal(me, { sdp: plainDesc(pc.localDescription) || plainDesc(offer) });
}

function onConnState(me: Cur, st: string) {
  if (!alive(me)) return;
  if (st === "connected") {
    if (me.lostTimer) clearTimeout(me.lostTimer);
    if (me.connectTimer) clearTimeout(me.connectTimer);
    me.lostTimer = undefined;
    if (!me.connectedAt) me.connectedAt = Date.now();
    me.phase = "active";
    me.reconnecting = false;
    publish();
  } else if (st === "disconnected" || st === "failed") {
    me.reconnecting = true;
    publish();
    if (st === "failed" && me.role === "caller" && !me.restarted) {
      me.restarted = true; // thử nối lại một lần (vd đổi wifi sang 4G)
      sendOffer(me, true).catch(() => undefined);
    }
    if (!me.lostTimer) me.lostTimer = setTimeout(() => alive(me) && hangup("Mất kết nối cuộc gọi."), LOST_MS);
  }
}

async function onSignal({ callId, data }: { callId: string; data: { sdp?: SessionDesc; candidate?: object } }) {
  const me = cur;
  if (!me || !me.call || me.call.id !== callId || !data) return;
  try {
    if (data.sdp) {
      const pc = ensurePc(me);
      await pc.setRemoteDescription(toSession(data.sdp));
      if (data.sdp.type === "offer") {
        addLocalTracks(me, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal(me, { sdp: plainDesc(pc.localDescription) || plainDesc(answer) });
      }
      for (const c of me.pendingIce.splice(0)) await pc.addIceCandidate(toCandidate(c)).catch(() => undefined);
    } else if (data.candidate) {
      if (!me.pc || !me.pc.remoteDescription) me.pendingIce.push(data.candidate);
      else await me.pc.addIceCandidate(toCandidate(data.candidate)).catch(() => undefined);
    }
  } catch (err) {
    console.warn("[call]", err);
    if (alive(me)) hangup("Không kết nối được cuộc gọi.");
  }
}

function watchConnect(me: Cur) {
  if (me.connectTimer) clearTimeout(me.connectTimer);
  me.connectTimer = setTimeout(() => {
    if (alive(me) && !me.connectedAt) hangup("Không nối được tiếng. Mạng hai bên có thể đang chặn cuộc gọi (admin có thể cài máy chủ TURN trong Quản trị).");
  }, CONNECT_MS);
}

/* ---------------- Gọi đi, nghe máy, gác máy ---------------- */
function newCall(fields: Pick<Cur, "role" | "phase" | "video" | "convId" | "peer"> & { call?: CallInfo | null }): Cur {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  cur = {
    call: null,
    callId: fields.call?.id || null,
    pc: null,
    pendingIce: [],
    tracksAdded: false,
    offered: false,
    restarted: false,
    done: false,
    muted: false,
    camOn: fields.video,
    speaker: fields.video, // gọi video: loa ngoài; gọi thoại: áp tai
    facing: "user",
    remoteMuted: false,
    remoteCam: fields.video,
    remoteVideo: false,
    reconnecting: false,
    connectedAt: null,
    endedText: null,
    local: null,
    remote: null,
    ...fields,
  } as Cur;
  publish();
  return cur;
}

/** Gọi cho người trong cuộc trò chuyện riêng */
export async function startCall(convId: number, peer: CallPeer, video: boolean) {
  if (cur) return callHooks.toast("Bạn đang trong một cuộc gọi.");
  if (!rtcAvailable) return callHooks.toast("Máy này chưa gọi được.");
  const me = newCall({ role: "caller", phase: "preparing", video, convId, peer });
  if (!(await getMedia(me))) return finish(me, null);
  if (!alive(me)) return;
  audioOn(me);
  publish();
  const res = await emit<{ call?: CallInfo }>("call:start", { conversationId: convId, video });
  if (!alive(me)) {
    if (res.call) emit("call:end", { callId: res.call.id });
    return;
  }
  if (res.error || !res.call) {
    callHooks.toast(res.error || "Chưa gọi được, thử lại sau.");
    return finish(me, null);
  }
  me.call = res.call;
  me.callId = res.call.id;
  me.phase = "ringing";
  startTone("ringback");
  publish();
}

function onIncoming(call: CallInfo) {
  if (!call?.id) return;
  if (cur) {
    if (cur.call?.id === call.id) return;
    emit("call:decline", { callId: call.id, busy: true }); // đang gọi trên máy này
    return;
  }
  newCall({ role: "callee", phase: "incoming", video: call.video, convId: call.conversationId, peer: call.caller, call });
  startTone("ring");
  publish();
  if (Platform.OS !== "web") Notifications.dismissNotificationAsync(`call-${call.conversationId}`).catch(() => undefined);
}

/** Nghe máy */
export async function acceptCall() {
  const me = cur;
  if (!me || me.phase !== "incoming" || !me.call) return;
  stopTone();
  me.phase = "connecting";
  publish();
  if (!(await getMedia(me))) {
    if (alive(me)) {
      emit("call:decline", { callId: me.call.id });
      finish(me, null);
    }
    return;
  }
  if (!alive(me)) return;
  const res = await emit<{ call?: CallInfo }>("call:accept", { callId: me.call.id });
  if (!alive(me)) return;
  if (res.error || !res.call) {
    callHooks.toast(res.error || "Không trả lời được cuộc gọi.");
    return finish(me, null);
  }
  me.call = res.call;
  audioOn(me);
  ensurePc(me);
  watchConnect(me);
  sendMedia(me);
  publish();
}

async function onAccepted({ callId }: { callId: string }) {
  const me = cur;
  if (!me || !me.call || me.call.id !== callId || me.role !== "caller" || me.offered) return;
  stopTone();
  me.phase = "connecting";
  publish();
  watchConnect(me);
  try {
    await sendOffer(me);
    sendMedia(me);
  } catch (err) {
    console.warn("[call]", err);
    if (alive(me)) hangup("Không kết nối được cuộc gọi.");
  }
}

const ENDED: Record<string, (me: Cur) => string> = {
  ended: () => "Cuộc gọi đã kết thúc",
  declined: (me) => (me.role === "caller" ? `${me.peer.displayName} đã từ chối cuộc gọi` : "Đã từ chối"),
  missed: (me) => (me.role === "caller" ? "Không có ai trả lời" : "Cuộc gọi nhỡ"),
  canceled: (me) => (me.role === "caller" ? "Đã hủy cuộc gọi" : "Cuộc gọi nhỡ"),
  busy: (me) => `${me.peer.displayName} đang bận`,
  elsewhere: () => "Đã trả lời trên máy khác",
  dropped: () => "Mất kết nối cuộc gọi",
};

function onEnded({ callId, reason }: { callId: string; reason: string }) {
  const me = cur;
  if (!me || !me.call || me.call.id !== callId) return;
  finish(me, (ENDED[reason] || ENDED.ended)(me), reason === "elsewhere" ? 400 : 1600);
}

/** Gác máy / từ chối */
export function hangup(text?: string | null) {
  const me = cur;
  if (!me) return;
  if (me.call) emit(me.phase === "incoming" ? "call:decline" : "call:end", { callId: me.call.id });
  finish(me, text !== undefined ? text : me.phase === "incoming" ? null : "Cuộc gọi đã kết thúc", 1400);
}

function finish(me: Cur, text: string | null, ms = 1400) {
  if (me.done) return;
  me.done = true;
  stopTone();
  if (me.connectTimer) clearTimeout(me.connectTimer);
  if (me.lostTimer) clearTimeout(me.lostTimer);
  try {
    me.pc?.close();
  } catch {
    /* bỏ qua */
  }
  me.local?.getTracks().forEach((t) => t.stop());
  audioOff();
  if (alive(me)) cur = null;
  if (!text) {
    useCall.setState({ view: null });
    return;
  }
  const { view } = useCall.getState();
  useCall.setState({
    view: view ? { ...view, phase: "ended", endedText: text, local: null, remote: null, remoteVideo: false } : null,
  });
  closeTimer = setTimeout(() => {
    if (!cur) useCall.setState({ view: null });
  }, ms);
}

/* ---------------- Nút trong cuộc gọi ---------------- */
export function toggleMute() {
  const me = cur;
  if (!me) return;
  me.muted = !me.muted;
  me.local?.getAudioTracks().forEach((t) => {
    t.enabled = !me.muted;
  });
  sendMedia(me);
  publish();
}

export function toggleCamera() {
  const me = cur;
  if (!me || !me.local?.getVideoTracks().length) return;
  me.camOn = !me.camOn;
  me.local.getVideoTracks().forEach((t) => {
    t.enabled = me.camOn;
  });
  sendMedia(me);
  publish();
}

export async function flipCamera() {
  const me = cur;
  const track = me?.local?.getVideoTracks()[0];
  if (!me || !track) return;
  try {
    await switchCamera(track);
    me.facing = me.facing === "user" ? "environment" : "user";
    publish();
  } catch {
    callHooks.toast("Không đổi được máy ảnh.");
  }
}

export function toggleSpeaker() {
  const me = cur;
  if (!me) return;
  me.speaker = !me.speaker;
  try {
    ThinkNative?.callSpeaker?.(me.speaker);
    ThinkNative?.callProximity?.(!me.video && !me.speaker);
  } catch {
    /* bỏ qua */
  }
  publish();
}

function onMedia({ callId, muted, camera }: { callId: string; muted: boolean; camera: boolean }) {
  const me = cur;
  if (!me || !me.call || me.call.id !== callId) return;
  me.remoteMuted = Boolean(muted);
  me.remoteCam = Boolean(camera);
  publish();
}

/* ---------------- Kết nối Socket.IO (store.ts gọi) ---------------- */
export function bindCallSocket(s: Socket) {
  socket = s;
  s.on("call:incoming", onIncoming);
  s.on("call:accepted", onAccepted);
  s.on("call:signal", onSignal);
  s.on("call:media", onMedia);
  s.on("call:ended", onEnded);
}

/** Nối lại máy chủ giữa cuộc gọi */
export async function callReconnected() {
  const me = cur;
  if (!me || !me.call) return;
  const res = await emit<{ call?: CallInfo }>("call:rejoin", { callId: me.call.id });
  if (!alive(me)) return;
  if (res.error || !res.call) return finish(me, "Cuộc gọi đã kết thúc");
  me.call = { ...me.call, ...res.call };
  if (me.role === "caller" && res.call.state === "active" && !me.offered) onAccepted({ callId: me.call.id });
}

/** Đăng xuất / đổi tài khoản */
export function resetCalls() {
  if (cur) hangup(null);
  socket = null;
  useCall.setState({ view: null });
}

export const inCall = () => Boolean(cur);
