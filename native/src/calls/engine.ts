import * as Notifications from "expo-notifications";
import { PermissionsAndroid, Platform } from "react-native";
import type { Socket } from "socket.io-client";
import { create } from "zustand";

import { ThinkNative } from "../native";
import { createPeer, getUserMedia, rtcAvailable, switchCamera, toCandidate, toSession } from "./rtc";
import { startTone, stopTone } from "./sound";
import type { CallInfo, CallPeer, CallPhase, GroupCallInfo, GroupCallSummary, Peer, SessionDesc, Stream } from "./types";

// Gọi thoại / gọi video cho app: gọi 1-1 (2.10.0) và gọi nhóm (2.11.0). Máy chủ: src/calls.js (chỉ chuyển lời mời và
// thông tin kết nối), máy chủ TURN: src/turn.js. Bản web làm y như vậy: public/calls-ui.js.
// Gọi nhóm: mỗi người nối thẳng với từng người khác; người vào sau gửi lời mời kết nối (offer) cho từng người đang ở trong.
// Phần này không phụ thuộc store.ts: store.ts gọi bindCallSocket() khi nối máy chủ và đặt callHooks.

const CONNECT_MS = 30000; // 30 giây chưa nối được tiếng / hình với một người thì thôi
const LOST_MS = 20000; // mất kết nối giữa chừng quá 20 giây thì thôi

/** Một người khác trong cuộc gọi (màn hình vẽ một ô) */
export type PeerView = {
  id: number;
  user: CallPeer;
  muted: boolean;
  camera: boolean;
  remote: Stream | null;
  remoteVideo: boolean;
  connected: boolean;
  reconnecting: boolean;
  failed: boolean;
};

/** Những gì màn hình cuộc gọi cần vẽ */
export type CallView = {
  kind: "direct" | "group";
  phase: CallPhase;
  role: "caller" | "callee";
  video: boolean;
  convId: number;
  callId: string | null;
  /** Gọi 1-1: tên người kia; gọi nhóm: tên nhóm */
  title: string;
  /** Gọi 1-1: người kia; gọi nhóm: ảnh nhóm (id = mã nhóm) */
  peer: CallPeer;
  /** Gọi nhóm: người bắt đầu cuộc gọi */
  starter: CallPeer | null;
  peers: PeerView[];
  ringing: number[];
  muted: boolean;
  camOn: boolean;
  speaker: boolean;
  facing: "user" | "environment";
  connectedAt: number | null;
  endedText: string | null;
  local: Stream | null;
};

export const useCall = create<{ view: CallView | null; groups: Record<number, GroupCallSummary> }>(() => ({ view: null, groups: {} }));

/** store.ts đặt: thông báo nhỏ, mã của mình, thông tin người dùng */
export const callHooks: { toast: (text: string) => void; meId: () => number | null; userOf: (id: number) => CallPeer | null } = {
  toast: () => undefined,
  meId: () => null,
  userOf: () => null,
};

type PeerState = {
  id: number;
  user: CallPeer;
  pc: Peer | null;
  pendingIce: object[];
  remote: Stream | null;
  remoteVideo: boolean;
  muted: boolean;
  camera: boolean;
  connectedAt: number;
  reconnecting: boolean;
  failed: boolean;
  offerer: boolean;
  restarted: boolean;
  tracksAdded: boolean;
  localTypes: Set<string>;
  remoteTypes: Set<string>;
  reported: boolean;
  connectTimer?: ReturnType<typeof setTimeout>;
  lostTimer?: ReturnType<typeof setTimeout>;
};

type Cur = {
  kind: "direct" | "group";
  role: "caller" | "callee";
  phase: CallPhase;
  video: boolean;
  convId: number;
  callId: string | null;
  call: CallInfo | GroupCallInfo | null;
  title: string;
  peer: CallPeer;
  starter: CallPeer | null;
  peers: Map<number, PeerState>;
  ringing: number[];
  local: Stream | null;
  muted: boolean;
  camOn: boolean;
  speaker: boolean;
  facing: "user" | "environment";
  connectedAt: number | null;
  endedText: string | null;
  done: boolean;
};

let socket: Socket | null = null;
let cur: Cur | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
/** Cuộc gọi `me` vẫn là cuộc gọi đang diễn ra (không bị gác máy trong lúc chờ) */
const alive = (me: Cur) => cur === me;
const firstPeer = (me: Cur) => [...me.peers.values()][0] as PeerState | undefined;

// Loại đường kết nối của một ICE candidate: host (cùng mạng), srflx / prflx (qua NAT), relay (qua máy chủ TURN)
export function candidateType(c: unknown): string | null {
  const text = typeof c === "string" ? c : String((c as { candidate?: string } | null)?.candidate || "");
  const m = / typ (host|srflx|prflx|relay)\b/.exec(text);
  return m ? m[1] : null;
}
/** Vì sao không nối được (giống bản web) */
export function failText(localTypes: Iterable<string>) {
  return new Set(localTypes).has("relay")
    ? "Không nối được dù đã thử qua máy chủ chuyển tiếp (TURN). Thử lại, hoặc đổi mạng (wifi ↔ 4G)."
    : "Không nối được: mạng đang chặn kết nối thẳng và máy chủ chuyển tiếp (TURN) không dùng được. Admin vào Quản trị → AI, gọi để cài TURN.";
}

function publish() {
  if (!cur) return;
  const me = cur;
  useCall.setState({
    view: {
      kind: me.kind,
      phase: me.phase,
      role: me.role,
      video: me.video,
      convId: me.convId,
      callId: me.callId,
      title: me.title,
      peer: me.peer,
      starter: me.starter,
      peers: [...me.peers.values()].map((p) => ({
        id: p.id,
        user: p.user,
        muted: p.muted,
        camera: p.camera,
        remote: p.remote,
        remoteVideo: p.remoteVideo,
        connected: Boolean(p.connectedAt),
        reconnecting: p.reconnecting,
        failed: p.failed,
      })),
      ringing: me.ringing,
      muted: me.muted,
      camOn: me.camOn,
      speaker: me.speaker,
      facing: me.facing,
      connectedAt: me.connectedAt,
      endedText: me.endedText,
      local: me.local,
    },
  });
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
function signalTo(me: Cur, p: PeerState, data: object) {
  if (!me.callId) return;
  if (me.kind === "group") emit("gcall:signal", { callId: me.callId, to: p.id, data });
  else emit("call:signal", { callId: me.callId, data });
}
function sendMedia(me: Cur) {
  if (!me.callId) return;
  emit(me.kind === "group" ? "gcall:media" : "call:media", { callId: me.callId, muted: me.muted, camera: me.camOn });
}

/* ---------------- Âm thanh của máy (Android: CallAudio.kt, CallService.kt) ---------------- */
function audioOn(me: Cur) {
  try {
    ThinkNative?.callAudioStart?.(me.speaker);
    ThinkNative?.callProximity?.(!me.video && !me.speaker);
    ThinkNative?.callServiceStart?.(me.title, me.video);
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
  return res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
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
  // Gọi nhóm: hình nhỏ hơn cho nhẹ mạng (mỗi người gửi hình cho từng người khác)
  const cam =
    me.kind === "group" ? { facingMode: "user", width: 480, height: 360, frameRate: 20 } : { facingMode: "user", width: 640, height: 480, frameRate: 24 };
  let stream: Stream | null = null;
  try {
    stream = await getUserMedia({ audio, video: me.video ? cam : false });
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

/* ---------------- Từng người trong cuộc gọi (mỗi người một kết nối WebRTC) ---------------- */
function addPeer(me: Cur, user: CallPeer & { muted?: boolean; camera?: boolean }): PeerState {
  const old = me.peers.get(user.id);
  if (old) return old;
  const p: PeerState = {
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
  };
  me.peers.set(user.id, p);
  return p;
}

function closePeer(me: Cur, p: PeerState, keep = false) {
  if (p.connectTimer) clearTimeout(p.connectTimer);
  if (p.lostTimer) clearTimeout(p.lostTimer);
  try {
    p.pc?.close();
  } catch {
    /* bỏ qua */
  }
  p.pc = null;
  if (!keep) me.peers.delete(p.id);
}

function ensurePc(me: Cur, p: PeerState): Peer {
  if (p.pc) return p.pc;
  const pc = createPeer(me.call?.iceServers || []);
  p.pc = pc;
  const mine = () => alive(me) && me.peers.get(p.id) === p && p.pc === pc;
  pc.addEventListener("icecandidate", (e) => {
    if (!mine() || !e.candidate) return;
    const c = e.candidate as { toJSON?: () => object };
    const t = candidateType(c);
    if (t) p.localTypes.add(t);
    signalTo(me, p, { candidate: typeof c.toJSON === "function" ? c.toJSON() : c });
  });
  pc.addEventListener("track", (e) => {
    if (!mine()) return;
    const stream = e.streams && e.streams[0];
    if (stream) p.remote = stream;
    if (e.track?.kind === "video") p.remoteVideo = true;
    publish();
  });
  pc.addEventListener("connectionstatechange", () => {
    if (mine()) onPeerState(me, p, pc.connectionState);
  });
  pc.addEventListener("iceconnectionstatechange", () => {
    if (mine() && pc.connectionState === undefined) onPeerState(me, p, pc.iceConnectionState === "completed" ? "connected" : pc.iceConnectionState || "");
  });
  return pc;
}

function addLocalTracks(me: Cur, p: PeerState) {
  if (p.tracksAdded || !me.local || !p.pc) return;
  for (const t of me.local.getTracks()) p.pc.addTrack(t, me.local);
  p.tracksAdded = true;
}

const plainDesc = (d: SessionDesc | null) => (d ? { type: d.type, sdp: d.sdp } : null);

async function sendOffer(me: Cur, p: PeerState, restart = false) {
  const pc = ensurePc(me, p);
  addLocalTracks(me, p);
  p.offerer = true;
  const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined);
  await pc.setLocalDescription(offer);
  signalTo(me, p, { sdp: plainDesc(pc.localDescription) || plainDesc(offer) });
}

function watchPeer(me: Cur, p: PeerState) {
  if (p.connectTimer) clearTimeout(p.connectTimer);
  p.connectTimer = setTimeout(() => {
    if (!alive(me) || p.connectedAt || me.peers.get(p.id) !== p) return;
    report(me, p, false);
    if (me.kind === "direct") return hangup(failText(p.localTypes));
    p.failed = true; // gọi nhóm: chỉ người này không nối được, cuộc gọi vẫn tiếp tục
    publish();
  }, CONNECT_MS);
}

async function pathOf(pc: Peer): Promise<"direct" | "relay" | null> {
  try {
    if (!pc.getStats) return null;
    const stats = await pc.getStats();
    const byId = new Map<string, Record<string, unknown>>();
    stats.forEach((r) => byId.set(String(r.id), r));
    let pair: Record<string, unknown> | undefined;
    stats.forEach((r) => {
      if (r.type === "transport" && r.selectedCandidatePairId) pair = byId.get(String(r.selectedCandidatePairId)) || pair;
    });
    if (!pair) {
      stats.forEach((r) => {
        if (!pair && r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected)) pair = r;
      });
    }
    if (!pair) return null;
    const l = byId.get(String(pair.localCandidateId));
    const rm = byId.get(String(pair.remoteCandidateId));
    return l?.candidateType === "relay" || rm?.candidateType === "relay" ? "relay" : "direct";
  } catch {
    return null;
  }
}

// Báo máy chủ đã nối được chưa, đi đường nào (admin xem trong Quản trị → AI, gọi)
async function report(me: Cur, p: PeerState, ok: boolean) {
  if (p.reported || !me.callId) return;
  p.reported = true;
  const path = ok && p.pc ? await pathOf(p.pc) : null;
  emit("call:report", {
    callId: me.callId,
    peerId: p.id,
    ok,
    path,
    local: [...p.localTypes],
    remote: [...p.remoteTypes],
    platform: Platform.OS === "web" ? "web" : "app",
  });
}

function onPeerState(me: Cur, p: PeerState, st: string) {
  if (st === "connected") {
    if (p.lostTimer) clearTimeout(p.lostTimer);
    if (p.connectTimer) clearTimeout(p.connectTimer);
    p.lostTimer = undefined;
    p.reconnecting = false;
    p.failed = false;
    if (!p.connectedAt) {
      p.connectedAt = Date.now();
      report(me, p, true);
    }
    if (!me.connectedAt) me.connectedAt = Date.now();
    if (me.phase === "connecting") me.phase = "active";
    publish();
  } else if (st === "disconnected" || st === "failed") {
    p.reconnecting = true;
    publish();
    if (st === "failed" && p.offerer && !p.restarted) {
      p.restarted = true; // thử nối lại một lần (vd đổi wifi sang 4G)
      sendOffer(me, p, true).catch(() => undefined);
    }
    if (!p.lostTimer) {
      p.lostTimer = setTimeout(() => {
        if (!alive(me) || me.peers.get(p.id) !== p) return;
        if (!p.connectedAt) report(me, p, false);
        if (me.kind === "direct") hangup(p.connectedAt ? "Mất kết nối cuộc gọi." : failText(p.localTypes));
        else {
          p.failed = true;
          publish();
        }
      }, LOST_MS);
    }
  }
}

async function handleSignal(me: Cur, p: PeerState, data: { sdp?: SessionDesc; candidate?: object }) {
  try {
    if (data.sdp) {
      // Hai bên cùng gửi lời mời (hiếm, vd vừa nối lại máy chủ): bỏ kết nối dở dang, nhận lời mời của bên kia
      if (data.sdp.type === "offer" && p.pc && p.pc.signalingState && p.pc.signalingState !== "stable" && p.pc.signalingState !== "have-remote-offer") {
        const { user, muted, camera } = p;
        closePeer(me, p);
        p = addPeer(me, { ...user, muted, camera });
      }
      if (!p.pc && !p.connectedAt) watchPeer(me, p);
      const pc = ensurePc(me, p);
      await pc.setRemoteDescription(toSession(data.sdp));
      if (data.sdp.type === "offer") {
        addLocalTracks(me, p);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signalTo(me, p, { sdp: plainDesc(pc.localDescription) || plainDesc(answer) });
      }
      for (const c of p.pendingIce.splice(0)) await pc.addIceCandidate(toCandidate(c)).catch(() => undefined);
    } else if (data.candidate) {
      const t = candidateType(data.candidate);
      if (t) p.remoteTypes.add(t);
      if (!p.pc || !p.pc.remoteDescription) p.pendingIce.push(data.candidate);
      else await p.pc.addIceCandidate(toCandidate(data.candidate)).catch(() => undefined);
    }
  } catch (err) {
    console.warn("[call]", err);
    if (!alive(me)) return;
    if (me.kind === "direct") hangup("Không kết nối được cuộc gọi.");
    else {
      p.failed = true;
      publish();
    }
  }
}

/* ---------------- Trạng thái ---------------- */
function newCall(
  fields: Pick<Cur, "kind" | "role" | "phase" | "video" | "convId" | "title" | "peer"> & { call?: CallInfo | GroupCallInfo | null; starter?: CallPeer | null },
): Cur {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  cur = {
    call: fields.call || null,
    callId: fields.call?.id || null,
    starter: fields.starter || null,
    peers: new Map(),
    ringing: [],
    local: null,
    muted: false,
    camOn: fields.video,
    speaker: fields.video || fields.kind === "group", // gọi video, gọi nhóm: loa ngoài; gọi thoại 1-1: áp tai
    facing: "user",
    connectedAt: null,
    endedText: null,
    done: false,
    ...fields,
  } as Cur;
  publish();
  return cur;
}

function finish(me: Cur, text: string | null, ms = 1400) {
  if (me.done) return;
  me.done = true;
  stopTone();
  for (const p of me.peers.values()) closePeer(me, p, true);
  me.local?.getTracks().forEach((t) => t.stop());
  audioOff();
  if (alive(me)) cur = null;
  if (!text) {
    useCall.setState({ view: null });
    return;
  }
  const { view } = useCall.getState();
  useCall.setState({
    view: view ? { ...view, phase: "ended", endedText: text, local: null, peers: view.peers.map((x) => ({ ...x, remote: null, remoteVideo: false })) } : null,
  });
  closeTimer = setTimeout(() => {
    if (!cur) useCall.setState({ view: null });
  }, ms);
}

/* ---------------- Gọi 1-1 ---------------- */
async function startDirect(convId: number, peer: CallPeer, video: boolean) {
  const me = newCall({ kind: "direct", role: "caller", phase: "preparing", video, convId, title: peer.displayName, peer });
  addPeer(me, peer);
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
    if (cur.callId === call.id) return;
    emit("call:decline", { callId: call.id, busy: true }); // đang gọi trên máy này
    return;
  }
  const me = newCall({
    kind: "direct",
    role: "callee",
    phase: "incoming",
    video: call.video,
    convId: call.conversationId,
    title: call.caller.displayName,
    peer: call.caller,
    call,
  });
  addPeer(me, call.caller);
  startTone("ring");
  publish();
  if (Platform.OS !== "web") Notifications.dismissNotificationAsync(`call-${call.conversationId}`).catch(() => undefined);
}

async function onAccepted({ callId }: { callId: string }) {
  const me = cur;
  if (!me || me.kind !== "direct" || me.callId !== callId || me.role !== "caller") return;
  const p = firstPeer(me);
  if (!p || p.offerer) return;
  stopTone();
  me.phase = "connecting";
  publish();
  watchPeer(me, p);
  try {
    await sendOffer(me, p);
    sendMedia(me);
  } catch (err) {
    console.warn("[call]", err);
    if (alive(me)) hangup("Không kết nối được cuộc gọi.");
  }
}

function onDirectSignal({ callId, data }: { callId: string; data: { sdp?: SessionDesc; candidate?: object } }) {
  const me = cur;
  if (!me || me.kind !== "direct" || me.callId !== callId || !data) return;
  const p = firstPeer(me);
  if (p) handleSignal(me, p, data);
}

function onDirectMedia({ callId, muted, camera }: { callId: string; muted: boolean; camera: boolean }) {
  const me = cur;
  if (!me || me.kind !== "direct" || me.callId !== callId) return;
  const p = firstPeer(me);
  if (!p) return;
  p.muted = Boolean(muted);
  p.camera = Boolean(camera);
  publish();
}

const ENDED: Record<string, (me: Cur) => string> = {
  ended: () => "Cuộc gọi đã kết thúc",
  declined: (me) => (me.role === "caller" ? `${me.title} đã từ chối cuộc gọi` : "Đã từ chối"),
  missed: (me) => (me.role === "caller" ? "Không có ai trả lời" : "Cuộc gọi nhỡ"),
  canceled: (me) => (me.role === "caller" ? "Đã hủy cuộc gọi" : "Cuộc gọi nhỡ"),
  busy: (me) => `${me.title} đang bận`,
  elsewhere: () => "Đã trả lời trên máy khác",
  dropped: () => "Mất kết nối cuộc gọi",
};

function onEnded({ callId, reason }: { callId: string; reason: string }) {
  const me = cur;
  if (!me || me.kind !== "direct" || me.callId !== callId) return;
  finish(me, (ENDED[reason] || ENDED.ended)(me), reason === "elsewhere" ? 400 : 1600);
}

/* ---------------- Gọi nhóm ---------------- */
const groupPeer = (convId: number, title: string, avatar: string | null): CallPeer => ({ id: convId, displayName: title, avatar });

async function startGroup(convId: number, group: { title: string; avatar: string | null }, video: boolean) {
  const me = newCall({
    kind: "group",
    role: "caller",
    phase: "preparing",
    video,
    convId,
    title: group.title,
    peer: groupPeer(convId, group.title, group.avatar),
  });
  if (!(await getMedia(me))) return finish(me, null);
  if (!alive(me)) return;
  publish();
  // Nhóm đang có cuộc gọi thì máy chủ cho vào luôn
  const res = await emit<{ call?: GroupCallInfo }>("gcall:start", { conversationId: convId, video });
  if (!alive(me)) {
    if (res.call) emit("gcall:leave", { callId: res.call.id });
    return;
  }
  if (res.error || !res.call) {
    callHooks.toast(res.error || "Chưa gọi được, thử lại sau.");
    return finish(me, null);
  }
  enterGroup(me, res.call);
}

/** Tham gia cuộc gọi nhóm đang diễn ra (thanh "Tham gia" hoặc màn cuộc gọi đến) */
export async function joinGroupCall(convId: number, group: { title: string; avatar: string | null }, video?: boolean) {
  if (cur) return callHooks.toast("Bạn đang trong một cuộc gọi.");
  if (!rtcAvailable) return callHooks.toast("Máy này chưa gọi được.");
  const info = useCall.getState().groups[convId];
  if (!info) return callHooks.toast("Cuộc gọi nhóm đã kết thúc.");
  const v = video === undefined ? info.video : video;
  const me = newCall({
    kind: "group",
    role: "callee",
    phase: "preparing",
    video: v,
    convId,
    title: group.title,
    peer: groupPeer(convId, group.title, group.avatar),
  });
  me.callId = info.id;
  if (!(await getMedia(me))) return finish(me, null);
  if (!alive(me)) return;
  publish();
  const res = await emit<{ call?: GroupCallInfo }>("gcall:join", { callId: info.id, camera: me.camOn });
  if (!alive(me)) {
    if (!res.error) emit("gcall:leave", { callId: info.id });
    return;
  }
  if (res.error || !res.call) {
    callHooks.toast(res.error || "Chưa vào được cuộc gọi.");
    if (/kết thúc/.test(res.error || "")) onGroupState({ conversationId: convId, call: null });
    return finish(me, null);
  }
  enterGroup(me, res.call);
}

// Vào cuộc gọi nhóm: người vào sau gửi lời mời kết nối cho từng người đang ở trong
function enterGroup(me: Cur, call: GroupCallInfo) {
  stopTone();
  me.call = call;
  me.callId = call.id;
  me.title = call.title;
  me.peer = groupPeer(call.conversationId, call.title, call.avatar);
  me.starter = call.starter;
  me.phase = "active";
  me.ringing = call.ringing || [];
  audioOn(me);
  const myId = callHooks.meId();
  for (const person of call.people || []) {
    if (person.id === myId) continue;
    const p = addPeer(me, person);
    watchPeer(me, p);
    sendOffer(me, p).catch((err) => {
      console.warn("[call]", err);
      p.failed = true;
      publish();
    });
  }
  sendMedia(me);
  publish();
}

function onGroupRing(call: GroupCallInfo) {
  if (!call?.id) return;
  setGroup(call.conversationId, call);
  if (cur) return; // đang gọi thì máy chủ đã không đổ chuông
  const me = newCall({
    kind: "group",
    role: "callee",
    phase: "incoming",
    video: call.video,
    convId: call.conversationId,
    title: call.title,
    peer: groupPeer(call.conversationId, call.title, call.avatar),
    starter: call.starter,
    call,
  });
  me.callId = call.id;
  startTone("ring");
  publish();
  if (Platform.OS !== "web") Notifications.dismissNotificationAsync(`call-${call.conversationId}`).catch(() => undefined);
}

function onGroupRingStop({ callId }: { callId: string }) {
  const me = cur;
  if (me && me.kind === "group" && me.phase === "incoming" && me.callId === callId) finish(me, null);
}

function onGroupJoined({ callId, user }: { callId: string; user: CallPeer & { muted: boolean; camera: boolean } }) {
  const me = cur;
  if (!me || me.kind !== "group" || me.callId !== callId || me.phase !== "active") return;
  me.ringing = me.ringing.filter((id) => id !== user.id);
  const p = addPeer(me, user); // người mới sẽ gửi lời mời kết nối
  watchPeer(me, p);
  publish();
}

function onGroupLeft({ callId, userId }: { callId: string; userId: number }) {
  const me = cur;
  if (!me || me.kind !== "group" || me.callId !== callId) return;
  const p = me.peers.get(userId);
  if (p) closePeer(me, p);
  publish();
}

function onGroupSignal({ callId, from, data }: { callId: string; from: number; data: { sdp?: SessionDesc; candidate?: object } }) {
  const me = cur;
  if (!me || me.kind !== "group" || me.callId !== callId || me.phase !== "active" || !data) return;
  const p = me.peers.get(from) || addPeer(me, callHooks.userOf(from) || { id: from, displayName: "Người dùng", avatar: null });
  handleSignal(me, p, data);
}

function onGroupMedia({ callId, userId, muted, camera }: { callId: string; userId: number; muted: boolean; camera: boolean }) {
  const me = cur;
  if (!me || me.kind !== "group" || me.callId !== callId) return;
  const p = me.peers.get(userId);
  if (!p) return;
  p.muted = Boolean(muted);
  p.camera = Boolean(camera);
  publish();
}

function onGroupUpdate({ callId, ringing }: { callId: string; ringing: number[] }) {
  const me = cur;
  if (!me || me.kind !== "group" || me.callId !== callId) return;
  me.ringing = ringing || [];
  publish();
}

function onGroupEnded({ callId, reason }: { callId: string; reason: string }) {
  const me = cur;
  if (!me || me.kind !== "group" || me.callId !== callId) return;
  finish(me, reason === "dropped" ? "Mất kết nối cuộc gọi" : me.phase === "incoming" ? null : "Cuộc gọi nhóm đã kết thúc", 1600);
}

function setGroup(convId: number, call: GroupCallSummary | null) {
  const groups = { ...useCall.getState().groups };
  if (call) {
    groups[convId] = {
      id: call.id,
      conversationId: call.conversationId,
      video: call.video,
      startedBy: call.startedBy,
      participants: call.participants,
      ringing: call.ringing,
      createdAt: call.createdAt,
      startedAt: call.startedAt,
    };
  } else delete groups[convId];
  useCall.setState({ groups });
}

function onGroupState({ conversationId, call }: { conversationId: number; call: GroupCallSummary | null }) {
  setGroup(conversationId, call);
}

/* ---------------- Chung: nghe máy, gác máy, nút trong cuộc gọi ---------------- */

/** Gọi trong một cuộc trò chuyện: chat riêng = gọi 1-1 (target là người kia), nhóm = gọi nhóm (target là tên + ảnh nhóm) */
export async function startCall(convId: number, target: CallPeer, video: boolean, kind: "direct" | "group" = "direct") {
  if (cur) return callHooks.toast("Bạn đang trong một cuộc gọi.");
  if (!rtcAvailable) return callHooks.toast("Máy này chưa gọi được.");
  if (kind === "group") return startGroup(convId, { title: target.displayName, avatar: target.avatar }, video);
  return startDirect(convId, target, video);
}

/** Nghe máy (1-1) / Tham gia (cuộc gọi nhóm đang đổ chuông) */
export async function acceptCall() {
  const me = cur;
  if (!me || me.phase !== "incoming") return;
  stopTone();
  if (me.kind === "group") {
    me.done = true;
    cur = null;
    return joinGroupCall(me.convId, { title: me.title, avatar: me.peer.avatar }, me.video);
  }
  me.phase = "connecting";
  publish();
  if (!(await getMedia(me))) {
    if (alive(me) && me.callId) {
      emit("call:decline", { callId: me.callId });
      finish(me, null);
    }
    return;
  }
  if (!alive(me) || !me.callId) return;
  const res = await emit<{ call?: CallInfo }>("call:accept", { callId: me.callId });
  if (!alive(me)) return;
  if (res.error || !res.call) {
    callHooks.toast(res.error || "Không trả lời được cuộc gọi.");
    return finish(me, null);
  }
  me.call = res.call;
  audioOn(me);
  const p = firstPeer(me);
  if (p) {
    ensurePc(me, p);
    watchPeer(me, p);
  }
  sendMedia(me);
  publish();
}

/** Gác máy / từ chối / rời cuộc gọi nhóm */
export function hangup(text?: string | null) {
  const me = cur;
  if (!me) return;
  if (me.callId) {
    if (me.kind === "group") emit(me.phase === "incoming" ? "gcall:decline" : "gcall:leave", { callId: me.callId });
    else emit(me.phase === "incoming" ? "call:decline" : "call:end", { callId: me.callId });
  }
  const fallback = me.phase === "incoming" ? null : me.kind === "group" ? "Bạn đã rời cuộc gọi" : "Cuộc gọi đã kết thúc";
  const msg = text !== undefined ? text : fallback;
  finish(me, msg, msg && msg.length > 40 ? 4000 : 1400);
}

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

/* ---------------- Kết nối Socket.IO (store.ts gọi) ---------------- */
export function bindCallSocket(s: Socket) {
  socket = s;
  s.on("call:incoming", onIncoming);
  s.on("call:accepted", onAccepted);
  s.on("call:signal", onDirectSignal);
  s.on("call:media", onDirectMedia);
  s.on("call:ended", onEnded);
  s.on("gcall:ring", onGroupRing);
  s.on("gcall:ring-stop", onGroupRingStop);
  s.on("gcall:joined", onGroupJoined);
  s.on("gcall:left", onGroupLeft);
  s.on("gcall:signal", onGroupSignal);
  s.on("gcall:media", onGroupMedia);
  s.on("gcall:update", onGroupUpdate);
  s.on("gcall:ended", onGroupEnded);
  s.on("gcall:state", onGroupState);
}

/** Nối lại máy chủ giữa cuộc gọi */
export async function callReconnected() {
  const me = cur;
  if (!me || !me.callId || me.phase === "incoming" || me.phase === "preparing") return;
  if (me.kind === "group") {
    const res = await emit<{ call?: GroupCallInfo }>("gcall:rejoin", { callId: me.callId });
    if (!alive(me)) return;
    if (res.error || !res.call) return finish(me, "Cuộc gọi nhóm đã kết thúc");
    // Ai vào trong lúc mình mất kết nối: mình gửi lời mời kết nối; ai đã rời: bỏ
    const ids = new Set(res.call.people.map((x) => x.id));
    for (const p of [...me.peers.values()]) if (!ids.has(p.id)) closePeer(me, p);
    const myId = callHooks.meId();
    for (const person of res.call.people) {
      if (person.id === myId || me.peers.has(person.id)) continue;
      const p = addPeer(me, person);
      watchPeer(me, p);
      sendOffer(me, p).catch(() => undefined);
    }
    me.ringing = res.call.ringing || [];
    return publish();
  }
  const res = await emit<{ call?: CallInfo }>("call:rejoin", { callId: me.callId });
  if (!alive(me)) return;
  if (res.error || !res.call) return finish(me, "Cuộc gọi đã kết thúc");
  me.call = { ...(me.call as CallInfo), ...res.call };
  if (me.role === "caller" && res.call.state === "active") onAccepted({ callId: me.callId });
}

/** Đăng xuất / đổi tài khoản */
export function resetCalls() {
  if (cur) hangup(null);
  socket = null;
  useCall.setState({ view: null, groups: {} });
}

/** Đang có cuộc gọi trên máy này (giữ kết nối máy chủ khi app ở nền) */
export const inCall = () => Boolean(cur && cur.phase !== "incoming");
/** Mình đang ở trong cuộc gọi của cuộc trò chuyện này */
export const inCallOf = (convId: number) => Boolean(cur && cur.convId === convId && cur.phase !== "incoming");
