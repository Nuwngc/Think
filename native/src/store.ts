import * as Application from "expo-application";
import { AppState, Platform } from "react-native";
import { io, type Socket } from "socket.io-client";
import { create } from "zustand";

import { api, ApiError, setAuthHandlers } from "./api";
import { clearSnapshot, loadSnapshot, saveSnapshot } from "./cache";
import { bindBlocks, onScoreEvent, resetBlocksBoard, sync as syncBlocks } from "./blocks/store";
import { bindChess, closeGame, loadChess, onAnalysisEvent, onChessEvent, openGame, resetChess, useChess } from "./chess/store";
import { API_URL } from "./config";
import { convTitle, previewText, type Names } from "./format";
import type { PreparedImage } from "./images";
import { bindSocial, closeUser, onSocialEvent, refreshSocial, resetSocial } from "./social/store";
import {
  isPending,
  lastServerId,
  mergeLatestPage,
  mergeMessages,
  newClientId,
  quoteOf,
  receiveMessage,
  toggleReaction,
} from "./messages";
import {
  askedOnce,
  disablePush,
  dismissConversation,
  enablePush,
  forgetPushToken,
  pushTurnedOff,
  setBadge,
  type PushState,
} from "./notifications";
import { clearToken, currentToken, getToken, setToken } from "./session";
import type { ChatItem, Conversation, Me, Message, PendingMessage, Reaction, User } from "./types";

/* =========================================================
   Trạng thái của app
   ========================================================= */

export type Phase = "boot" | "login" | "force" | "ready";
export type Tab = "chats" | "games" | "me" | "admin";
/** Trong tab Trò chơi: trang chọn game, Cờ vua, hay đang chơi Xếp Khối */
export type GamesView = "hub" | "chess" | "blocks";
export type Connection = "connecting" | "online" | "offline";

export type MsgBox = {
  list: ChatItem[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  /** Đang hiện bản lưu trên máy, cần tải lại từ máy chủ */
  stale: boolean;
};

/** chessGameId: chạm để mở ván cờ đó (0 = mở mục Cờ vua) */
export type Toast = { id: number; text: string; title?: string; convId?: number; senderId?: number; chessGameId?: number };

export type UpdateInfo = { versionCode: number; versionName: string; apk: string; notes?: string };

type State = {
  phase: Phase;
  bootError: string | null;
  me: Me | null;
  users: Record<number, User>;
  convs: Record<number, Conversation>;
  msgs: Record<number, MsgBox>;
  typing: Record<number, number[]>;
  drafts: Record<number, string>;
  replying: Record<number, ChatItem | undefined>;
  tab: Tab;
  gamesView: GamesView;
  /** Đang mở màn Cài đặt (trong tab Cá nhân) */
  settingsOpen: boolean;
  currentId: number | null;
  atBottom: boolean;
  appActive: boolean;
  connection: Connection;
  /** Đang xem bản lưu trên máy, chưa kết nối được máy chủ */
  offline: boolean;
  push: PushState | null;
  notice: string | null;
  toast: Toast | null;
  update: UpdateInfo | null;
  /** Tăng lên mỗi khi dung lượng máy chủ đổi (màn Quản trị tự tải lại) */
  storageVersion: number;
};

const initial: State = {
  phase: "boot",
  bootError: null,
  me: null,
  users: {},
  convs: {},
  msgs: {},
  typing: {},
  drafts: {},
  replying: {},
  tab: "chats",
  gamesView: "hub",
  settingsOpen: false,
  currentId: null,
  atBottom: true,
  appActive: AppState.currentState === "active" || Platform.OS === "web",
  connection: "connecting",
  offline: false,
  push: null,
  notice: null,
  toast: null,
  update: null,
  storageVersion: 0,
};

export const useStore = create<State>(() => ({ ...initial }));

const get = useStore.getState;
const set = useStore.setState;

const emptyBox = (): MsgBox => ({ list: [], loaded: false, loading: false, hasMore: false, error: null, stale: false });

function patchBox(id: number, fn: (b: MsgBox) => Partial<MsgBox>) {
  set((s) => {
    const b = s.msgs[id] || emptyBox();
    return { msgs: { ...s.msgs, [id]: { ...b, ...fn(b) } } };
  });
}

function patchConv(id: number, fn: (c: Conversation) => Partial<Conversation>) {
  set((s) => {
    const c = s.convs[id];
    if (!c) return {};
    return { convs: { ...s.convs, [id]: { ...c, ...fn(c) } } };
  });
}

export function namesOf(s: Pick<State, "me" | "users">): Names {
  return {
    meId: s.me?.id ?? 0,
    nameOf: (id) => (id != null && s.users[id]?.displayName) || "Người dùng",
  };
}

export const unreadTotal = (convs: Record<number, Conversation>) =>
  Object.values(convs).reduce((sum, c) => sum + (c.unread || 0), 0);

/* =========================================================
   Thông báo nhỏ trong app
   ========================================================= */

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;

export function showToast(text: string, extra: Omit<Toast, "id" | "text"> = {}, ms = 3600) {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: { id: ++toastSeq, text, ...extra } });
  toastTimer = setTimeout(() => set({ toast: null }), ms);
}

export function hideToast() {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: null });
}

/* =========================================================
   Lưu bản sao trên máy (chờ 1,5 giây sau lần đổi cuối)
   ========================================================= */

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = get();
    if (!s.me || s.phase !== "ready") return;
    const msgs: Record<number, Message[]> = {};
    for (const [id, b] of Object.entries(s.msgs)) {
      const list = b.list.filter((m): m is Message => !isPending(m));
      if (list.length) msgs[Number(id)] = list;
    }
    saveSnapshot({ me: s.me, users: s.users, convs: s.convs, msgs }).catch(() => undefined);
  }, 1500);
}

let lastBadge = -1;
useStore.subscribe((s, prev) => {
  if (s.convs !== prev.convs || s.msgs !== prev.msgs || s.users !== prev.users || s.me !== prev.me) saveSoon();
  if (s.convs !== prev.convs) {
    const total = unreadTotal(s.convs);
    if (total !== lastBadge) {
      lastBadge = total;
      setBadge(total);
    }
  }
});

/* =========================================================
   Khởi động, đăng nhập, đăng xuất
   ========================================================= */

let socket: Socket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let connecting = false;
/** Đang tải danh sách lần đầu (socket kết nối xong trong lúc này thì không cần tải lại) */
let loadingAll = false;

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  // Thử lại sau 6 giây (khi app đang mở)
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (get().appActive && (get().phase === "boot" || get().offline)) connectServer();
  }, 6000);
}

setAuthHandlers({
  unauthorized: (message) => {
    if (get().me) sessionEnded(message);
  },
  mustChange: () => {
    if (get().me) set({ phase: "force" });
  },
});

export async function boot() {
  const token = await getToken();
  if (!token) {
    set({ phase: "login" });
    return;
  }
  const snap = await loadSnapshot();
  if (snap?.me && !snap.me.mustChangePassword) {
    // Hiện ngay bản lưu trên máy, trong lúc chờ máy chủ
    const msgs: Record<number, MsgBox> = {};
    for (const [id, list] of Object.entries(snap.msgs || {})) {
      msgs[Number(id)] = { ...emptyBox(), list, loaded: true, hasMore: true, stale: true };
    }
    set({ phase: "ready", me: snap.me, users: snap.users || {}, convs: snap.convs || {}, msgs, offline: true });
  }
  await connectServer();
}

/** Hỏi máy chủ phiên đăng nhập còn không, rồi tải dữ liệu. Máy chủ đang ngủ thì tự thử lại. */
export async function connectServer() {
  if (connecting) return;
  connecting = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  set({ bootError: null });
  try {
    const { user } = await api.me();
    if (!user) {
      await sessionEnded("Phiên đăng nhập đã hết. Hãy đăng nhập lại.");
      return;
    }
    set({ me: user });
    if (user.mustChangePassword) {
      set({ phase: "force" });
      return;
    }
    set({ phase: "ready" });
    await enterApp();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    set({ bootError: err instanceof Error ? err.message : "Không kết nối được máy chủ." });
    scheduleRetry();
  } finally {
    connecting = false;
  }
}

/** Đã đăng nhập: nối realtime rồi tải danh sách. Không bao giờ ném lỗi (lỗi thì hiện dải báo và tự thử lại). */
async function enterApp() {
  connectSocket(); // nối trước để không sót tin gửi tới trong lúc đang tải
  loadingAll = true;
  try {
    await Promise.all([loadUsers(), loadConvs()]);
    set({ offline: false, bootError: null });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    set({ offline: true, bootError: err instanceof Error ? err.message : "Không kết nối được máy chủ." });
    scheduleRetry();
    return;
  } finally {
    loadingAll = false;
  }
  const current = get().currentId;
  if (current != null) {
    if (get().convs[current]) loadMessages(current);
    else closeConversation();
  }
  loadChess();
  syncBlocks(); // gửi điểm Xếp Khối chơi lúc mất mạng
  setupPush().catch(() => undefined);
}

export async function login(username: string, password: string) {
  const device = [Application.applicationName, Platform.OS === "android" ? "Android" : Platform.OS].filter(Boolean).join(" · ");
  const { user, token } = await api.login(username.trim().toLowerCase(), password, device);
  await setToken(token);
  set({ me: user, notice: null, bootError: null });
  if (user.mustChangePassword) {
    set({ phase: "force" });
    return;
  }
  set({ phase: "ready", tab: "chats", currentId: null });
  await enterApp();
}

/** Đặt mật khẩu mới (bắt buộc ở lần đăng nhập đầu, hoặc tự đổi trong Cá nhân) */
export async function changePassword(current: string, next: string) {
  const { user } = await api.changePassword(current, next);
  set({ me: user });
  if (get().phase === "force") {
    set({ phase: "ready", tab: "chats", currentId: null });
    await enterApp();
  }
}

function resetAll(notice: string | null) {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  for (const t of typingTimers.values()) clearTimeout(t);
  typingTimers.clear();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  resetChess();
  resetSocial();
  resetBlocksBoard();
  set({ ...initial, phase: "login", notice, appActive: get().appActive, update: get().update });
  lastBadge = 0;
  setBadge(0);
}

export async function logout() {
  // Xóa trên máy trước cho nhanh (máy chủ có thể đang ngủ), rồi mới báo máy chủ
  const token = await getToken();
  const pushToken = await forgetPushToken();
  await clearToken();
  await clearSnapshot();
  resetAll(null);
  if (token) {
    if (pushToken) await api.removePush(pushToken, token).catch(() => undefined);
    await api.logout(token).catch(() => undefined);
  }
}

export async function sessionEnded(reason: string) {
  await clearToken();
  await clearSnapshot();
  resetAll(reason);
}

/* =========================================================
   Tải dữ liệu
   ========================================================= */

async function loadUsers() {
  const { users } = await api.users();
  set({ users: Object.fromEntries(users.map((u) => [u.id, u])) });
}

async function loadConvs() {
  const { conversations } = await api.conversations();
  const prev = get().convs;
  const convs: Record<number, Conversation> = {};
  for (const c of conversations) convs[c.id] = prev[c.id]?.reads ? { ...c, reads: prev[c.id].reads } : c;
  // Cuộc trò chuyện không còn tham gia: bỏ tin nhắn đã lưu
  const msgs = { ...get().msgs };
  for (const id of Object.keys(msgs)) if (!convs[Number(id)]) delete msgs[Number(id)];
  set({ convs, msgs });
}

async function fetchConv(id: number) {
  const { conversation } = await api.conversation(id);
  const prev = get().convs[id];
  const c = prev?.reads ? { ...conversation, reads: prev.reads } : conversation;
  set((s) => ({ convs: { ...s.convs, [id]: c } }));
  return c;
}

/** Tải lại sau khi mất kết nối: không sót tin */
async function resync() {
  try {
    await Promise.all([loadUsers(), loadConvs()]);
    set((s) => {
      const msgs: Record<number, MsgBox> = {};
      for (const [id, b] of Object.entries(s.msgs)) msgs[Number(id)] = { ...b, stale: true };
      return { msgs, offline: false };
    });
    if (useChess.getState().loaded) loadChess();
    refreshSocial();
    syncBlocks();
    const current = get().currentId;
    if (current != null) {
      if (!get().convs[current]) {
        closeConversation();
        showToast("Bạn không còn ở trong cuộc trò chuyện này.");
        return;
      }
      await loadMessages(current);
    }
  } catch {
    /* thử lại ở lần kết nối sau */
  }
}

/** Cần tải lại trang mới nhất ngay sau lượt tải đang chạy */
const refreshAfter = new Set<number>();

export async function loadMessages(id: number, { older = false } = {}) {
  const box = get().msgs[id] || emptyBox();
  if (box.loading) {
    if (!older) refreshAfter.add(id);
    return;
  }
  if (older && (!box.hasMore || !box.loaded)) return;
  patchBox(id, () => ({ loading: true, error: older ? null : box.error }));
  try {
    const firstId = older ? box.list.find((m) => !isPending(m))?.id : undefined;
    const data = await api.messages(id, firstId || undefined);
    patchBox(id, (b) => {
      if (older) return { list: mergeMessages(b.list, data.messages), hasMore: data.hasMore, loaded: true, error: null };
      const list = mergeLatestPage(b.list, data.messages, data.hasMore);
      // Còn giữ tin cũ hơn trang vừa tải (bản lưu trên máy): cứ coi như còn tin cũ hơn nữa để tải tiếp
      const oldest = list.find((m) => !isPending(m))?.id ?? 0;
      const keptOlder = data.messages.length > 0 && oldest < data.messages[0].id;
      return { list, hasMore: keptOlder || data.hasMore, loaded: true, stale: false, error: null };
    });
    applyReads(id, data.reads);
    if (!older && get().currentId === id && get().atBottom) markRead(id);
  } catch (err) {
    if (!older) patchBox(id, () => ({ error: err instanceof Error ? err.message : "Không tải được tin nhắn." }));
  } finally {
    patchBox(id, () => ({ loading: false }));
    if (refreshAfter.delete(id)) loadMessages(id);
  }
}

function applyReads(convId: number, reads: { userId: number; lastReadId: number }[]) {
  if (!Array.isArray(reads)) return;
  patchConv(convId, (c) => {
    const map: Record<number, number> = {};
    for (const r of reads) map[r.userId] = r.lastReadId;
    const peer = c.type === "dm" && c.peerId != null ? map[c.peerId] : undefined;
    return { reads: map, peerLastReadId: peer != null ? Math.max(c.peerLastReadId || 0, peer) : c.peerLastReadId };
  });
}

/* =========================================================
   Mở / đóng cuộc trò chuyện, đã đọc
   ========================================================= */

export async function openConversation(id: number) {
  if (!get().convs[id]) {
    try {
      await fetchConv(id);
    } catch {
      showToast("Không mở được cuộc trò chuyện này.");
      return;
    }
  }
  // Đang trong một ván cờ thì giữ tab Trò chơi: đóng chat là quay lại ván
  const keepChess = inChess() && useChess.getState().openId != null;
  set({ currentId: id, atBottom: true, tab: keepChess ? "games" : "chats" });
  hideToastFor(id);
  dismissConversation(id);
  const box = get().msgs[id];
  if (!box || !box.loaded || box.stale) await loadMessages(id);
  else markRead(id);
  reportVisibility();
}

export function closeConversation() {
  set({ currentId: null });
}

const inChess = () => get().tab === "games" && get().gamesView === "chess";

/** Rời mục Cờ vua: đóng ván đang mở (để thông báo về ván đó không bị nuốt mất) */
function leaveChessView() {
  if (useChess.getState().openId != null) closeGame();
}

export function setTab(tab: Tab) {
  // Bấm lại tab Trò chơi khi đang ở trong một game: về trang chọn game
  const gamesView = tab === "games" && get().tab === "games" ? "hub" : get().gamesView === "blocks" ? "hub" : get().gamesView;
  if (!(tab === "games" && gamesView === "chess")) leaveChessView();
  set({ tab, currentId: null, settingsOpen: false, gamesView });
  closeUser();
  if (tab === "games" && !useChess.getState().loading) loadChess();
  if (tab === "games") syncBlocks();
}

/** Trang chọn game (trong tab Trò chơi) */
export function showGamesHub() {
  leaveChessView();
  set({ tab: "games", gamesView: "hub", currentId: null });
}

/** Mở game Xếp Khối */
export function openBlocks() {
  leaveChessView();
  set({ tab: "games", gamesView: "blocks", currentId: null });
  closeUser();
}

/** Màn Cài đặt (đổi tên, ảnh bìa, giao diện, mật khẩu…) nằm trong tab Cá nhân */
export function openSettings() {
  set({ tab: "me", currentId: null, settingsOpen: true });
  closeUser();
}

export function closeSettings() {
  set({ settingsOpen: false });
}

/** Mở ván từ chỗ khác (bảng tin, tin nhắn, thông báo…): bấm Quay lại thì về đúng chỗ đó */
let chessReturn: { gameId: number; tab: Tab; currentId: number | null } | null = null;

/** Mở mục Cờ vua; có gameId thì mở luôn ván đó */
export function openChess(gameId?: number | null) {
  const s = get();
  chessReturn = gameId && !inChess() ? { gameId, tab: s.tab, currentId: s.currentId } : null;
  set({ tab: "games", gamesView: "chess", currentId: null });
  if (get().toast?.chessGameId != null) hideToast();
  if (gameId) openGame(gameId);
  else {
    closeGame();
    loadChess();
  }
}

/** Nút Quay lại trong ván cờ */
export function leaveGame() {
  const back = chessReturn;
  const leaving = useChess.getState().openId;
  closeGame(); // xóa luôn chessReturn (qua bindChess.closed)
  if (!back || back.gameId !== leaving || !inChess()) return;
  set({ tab: back.tab, currentId: back.currentId != null && get().convs[back.currentId] ? back.currentId : null });
}

export function setAtBottom(atBottom: boolean) {
  if (get().atBottom === atBottom) return;
  set({ atBottom });
  const id = get().currentId;
  if (atBottom && id != null) markRead(id);
}

const readTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function markRead(convId: number) {
  const s = get();
  const c = s.convs[convId];
  if (!c || !s.appActive || s.offline) return;
  const lastId = c.lastMessage?.id || 0;
  if (!c.unread && (c.lastReadId || 0) >= lastId) return;
  patchConv(convId, (cc) => ({ unread: 0, lastReadId: Math.max(cc.lastReadId || 0, lastId) }));
  dismissConversation(convId);
  const t = readTimers.get(convId);
  if (t) clearTimeout(t);
  readTimers.set(
    convId,
    setTimeout(() => {
      readTimers.delete(convId);
      api.read(convId, get().convs[convId]?.lastReadId || undefined).catch(() => undefined);
    }, 250),
  );
}

function hideToastFor(convId: number) {
  if (get().toast?.convId === convId) hideToast();
}

/* =========================================================
   Gửi tin nhắn
   ========================================================= */

function patchPending(convId: number, clientId: string, patch: Partial<PendingMessage>) {
  patchBox(convId, (b) => ({
    list: b.list.map((m) => (isPending(m) && m.clientId === clientId ? { ...m, ...patch } : m)),
  }));
}

function bumpConv(convId: number, m: Message) {
  patchConv(convId, (c) => {
    const newer = !c.lastMessage || m.id >= c.lastMessage.id;
    return {
      lastMessage: newer ? m : c.lastMessage,
      lastReadId: m.senderId === get().me?.id ? Math.max(c.lastReadId || 0, m.id) : c.lastReadId,
    };
  });
}

/** Tin từ máy chủ (qua API hoặc realtime): thay bản tạm nếu có */
function receive(msg: Message) {
  let isNew = true;
  const box = get().msgs[msg.conversationId];
  if (box) {
    const res = receiveMessage(box.list, msg);
    isNew = res.isNew;
    patchBox(msg.conversationId, () => ({ list: res.list }));
  }
  bumpConv(msg.conversationId, msg);
  return isNew;
}

export function setDraft(convId: number, text: string) {
  set((s) => ({ drafts: { ...s.drafts, [convId]: text } }));
}

export function startReply(convId: number, m: ChatItem) {
  set((s) => ({ replying: { ...s.replying, [convId]: m } }));
}

export function cancelReply(convId: number) {
  set((s) => ({ replying: { ...s.replying, [convId]: undefined } }));
}

function takeReply(convId: number) {
  const target = get().replying[convId];
  if (target) cancelReply(convId);
  return target && !isPending(target) ? quoteOf(target) : null;
}

function addLocal(m: PendingMessage) {
  patchBox(m.conversationId, (b) => ({ list: [...b.list, m] }));
  set({ atBottom: true });
}

export function sendText(convId: number, raw: string) {
  const me = get().me;
  const text = raw.trim();
  if (!me || !text) return false;
  if (text.length > 4000) {
    showToast("Tin nhắn dài quá 4000 ký tự. Hãy chia nhỏ ra.");
    return false;
  }
  const m: PendingMessage = {
    id: null,
    clientId: newClientId(),
    conversationId: convId,
    senderId: me.id,
    kind: "text",
    text,
    image: null,
    deleted: false,
    createdAt: Date.now(),
    replyTo: takeReply(convId),
    reactions: [],
    status: "sending",
  };
  setDraft(convId, "");
  addLocal(m);
  deliver(m);
  return true;
}

/**
 * Gửi một tin soạn sẵn (vd chia sẻ ván cờ) vào một cuộc trò chuyện bất kỳ, không đụng tới bản nháp hay tin đang
 * trả lời của khung chat đó. Trả về true nếu đã gửi; lỗi thì đã báo và tin nằm lại trong khung chat để gửi lại.
 */
export async function sendPrepared(convId: number, text: string) {
  const me = get().me;
  if (!me || !text.trim()) return false;
  const m: PendingMessage = {
    id: null,
    clientId: newClientId(),
    conversationId: convId,
    senderId: me.id,
    kind: "text",
    text: text.trim(),
    image: null,
    deleted: false,
    createdAt: Date.now(),
    replyTo: null,
    reactions: [],
    status: "sending",
  };
  patchBox(convId, (b) => ({ list: [...b.list, m] }));
  await deliver(m);
  return !get().msgs[convId]?.list.some((x) => isPending(x) && x.clientId === m.clientId && x.status === "failed");
}

export async function sendImages(convId: number, images: PreparedImage[]) {
  const me = get().me;
  if (!me) return;
  let replyTo = takeReply(convId); // trả lời gắn vào ảnh đầu tiên
  for (const img of images.slice(0, 10)) {
    const m: PendingMessage = {
      id: null,
      clientId: newClientId(),
      conversationId: convId,
      senderId: me.id,
      kind: "text",
      text: null,
      image: null,
      deleted: false,
      createdAt: Date.now(),
      replyTo,
      reactions: [],
      localUri: img.uri,
      mime: img.mime,
      width: img.width,
      height: img.height,
      status: "sending",
    };
    replyTo = null;
    addLocal(m);
    await deliver(m);
  }
}

async function deliver(m: PendingMessage) {
  patchPending(m.conversationId, m.clientId, { status: "sending", error: undefined });
  try {
    let image: string | undefined;
    if (m.localUri) {
      const up = await api.uploadImage(m.localUri, m.mime || "image/jpeg", m.width || 0, m.height || 0);
      image = up.url;
    }
    const { message } = await api.send(m.conversationId, {
      text: m.text || "",
      image,
      replyTo: m.replyTo?.id || undefined,
      clientId: m.clientId,
    });
    receive(message);
  } catch (err) {
    const text = err instanceof Error ? err.message : "Chưa gửi được.";
    patchPending(m.conversationId, m.clientId, { status: "failed", error: text });
    if (!(err instanceof ApiError && err.status === 401)) showToast(text);
  }
}

export function retry(convId: number, clientId: string) {
  const m = get().msgs[convId]?.list.find((x) => isPending(x) && x.clientId === clientId) as PendingMessage | undefined;
  if (!m || m.status === "sending") return;
  deliver(m);
}

export function discard(convId: number, clientId: string) {
  patchBox(convId, (b) => ({ list: b.list.filter((x) => !(isPending(x) && x.clientId === clientId)) }));
}

/* =========================================================
   Cảm xúc, thu hồi
   ========================================================= */

function setReactions(convId: number, messageId: number, reactions: Reaction[]) {
  patchBox(convId, (b) => ({
    list: b.list.map((m) => (!isPending(m) && m.id === messageId ? { ...m, reactions } : m)),
  }));
}

export async function react(m: Message, emoji: string) {
  const me = get().me;
  if (!me) return;
  const before = m.reactions || [];
  setReactions(m.conversationId, m.id, toggleReaction(before, me.id, emoji));
  try {
    const res = await api.react(m.id, emoji);
    setReactions(m.conversationId, m.id, res.reactions);
  } catch (err) {
    setReactions(m.conversationId, m.id, before);
    showToast(err instanceof Error ? err.message : "Chưa bày tỏ cảm xúc được.");
  }
}

function markDeleted(convId: number, messageId: number) {
  patchBox(convId, (b) => ({
    list: b.list.map((m) =>
      !isPending(m) && m.id === messageId ? { ...m, deleted: true, text: null, image: null, reactions: [] } : m,
    ),
  }));
  patchConv(convId, (c) =>
    c.lastMessage && c.lastMessage.id === messageId ? { lastMessage: { ...c.lastMessage, deleted: true, text: null, image: null } } : {},
  );
}

export async function recall(m: Message) {
  await api.recall(m.id);
  markDeleted(m.conversationId, m.id);
}

/* =========================================================
   Chat riêng, nhóm
   ========================================================= */

export async function openDm(userId: number) {
  const { conversation } = await api.openDm(userId);
  set((s) => ({ convs: { ...s.convs, [conversation.id]: { ...s.convs[conversation.id], ...conversation } } }));
  await openConversation(conversation.id);
}

export async function createGroup(name: string, memberIds: number[]) {
  const { conversation } = await api.createGroup(name, memberIds);
  set((s) => ({ convs: { ...s.convs, [conversation.id]: conversation } }));
  await openConversation(conversation.id);
}

export async function renameGroup(id: number, name: string) {
  const { conversation } = await api.renameGroup(id, name);
  set((s) => ({ convs: { ...s.convs, [id]: { ...conversation, reads: s.convs[id]?.reads } } }));
}

export async function addMembers(id: number, userIds: number[]) {
  const { conversation } = await api.addMembers(id, userIds);
  set((s) => ({ convs: { ...s.convs, [id]: { ...conversation, reads: s.convs[id]?.reads } } }));
}

export async function removeMember(id: number, userId: number) {
  await api.removeMember(id, userId);
  if (userId === get().me?.id) forgetConversation(id);
  else await fetchConv(id).catch(() => undefined);
}

function forgetConversation(id: number) {
  set((s) => {
    const convs = { ...s.convs };
    const msgs = { ...s.msgs };
    delete convs[id];
    delete msgs[id];
    return { convs, msgs, currentId: s.currentId === id ? null : s.currentId };
  });
}

/* =========================================================
   Tài khoản của tôi
   ========================================================= */

export function applyMe(user: Me) {
  set((s) => ({ me: user, users: { ...s.users, [user.id]: { ...s.users[user.id], ...user } } }));
}

/* =========================================================
   Thông báo đẩy
   ========================================================= */

async function setupPush() {
  if (await pushTurnedOff()) {
    set({ push: "off" });
    return;
  }
  // Chỉ tự hỏi quyền (Android 13+) một lần đầu. Sau đó người dùng tự bật trong Cá nhân.
  const asked = await askedOnce();
  set({ push: await enablePush({ ask: !asked }) });
}

export async function turnPushOn() {
  const state = await enablePush({ ask: true });
  set({ push: state });
  return state;
}

export async function turnPushOff() {
  await disablePush({ remember: true });
  set({ push: "off" });
}

/* =========================================================
   Realtime (Socket.IO)
   ========================================================= */

function connectSocket() {
  if (socket) {
    if (!socket.connected) socket.connect();
    return;
  }
  const s = io(API_URL, {
    transports: ["websocket"],
    auth: (cb) => cb({ token: currentToken() }),
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
  });
  socket = s;
  set({ connection: "connecting" });

  s.on("connect", () => {
    set({ connection: "online" });
    reportVisibility();
    // Mỗi lần nối lại: tải lại để không sót tin lúc mất kết nối (trừ khi đang tải lần đầu)
    if (!loadingAll) resync();
  });
  s.on("disconnect", (reason) => set({ connection: reason === "io client disconnect" ? "connecting" : "offline" }));
  s.on("connect_error", (err: Error) => {
    if (err?.message === "unauthorized") sessionEnded("Phiên đăng nhập đã hết. Hãy đăng nhập lại.");
    else if (err?.message === "must_change_password") set({ phase: "force" });
    else set({ connection: "offline" });
  });
  s.on("message:new", onMessageNew);
  s.on("message:deleted", ({ conversationId, messageId }: { conversationId: number; messageId: number }) =>
    markDeleted(conversationId, messageId),
  );
  s.on("message:reactions", ({ conversationId, messageId, reactions }: { conversationId: number; messageId: number; reactions: Reaction[] }) =>
    setReactions(conversationId, messageId, reactions),
  );
  s.on("conversation:changed", onConvChanged);
  s.on("read", onRead);
  s.on("typing", onTyping);
  s.on("presence", ({ userId, online, lastSeen }: { userId: number; online: boolean; lastSeen?: number }) => {
    set((st) => {
      const u = st.users[userId];
      if (!u) return {};
      return { users: { ...st.users, [userId]: { ...u, online, lastSeen: lastSeen || u.lastSeen } } };
    });
  });
  s.on("user:updated", (u: User) => {
    set((st) => ({ users: { ...st.users, [u.id]: { ...st.users[u.id], ...u } } }));
    const me = get().me;
    if (me && u.id === me.id) {
      set({ me: { ...me, ...u } });
      if (u.role !== "admin" && get().tab === "admin") set({ tab: "chats" });
    }
  });
  s.on("session:ended", (data: { reason?: string }) => sessionEnded(data?.reason || "Bạn đã bị đăng xuất."));
  s.on("storage:changed", () => set((st) => ({ storageVersion: st.storageVersion + 1 })));
  s.on("chess:game", (data) => onChessEvent("chess:game", data));
  s.on("chess:challenge", (data) => onChessEvent("chess:challenge", data));
  s.on("chess:analysis", onAnalysisEvent);
  s.on("games:score", onScoreEvent);
  for (const name of ["post:new", "post:likes", "post:comment", "post:comment-deleted", "post:deleted"]) {
    s.on(name, (data) => onSocialEvent(name, data));
  }
}

export function reportVisibility() {
  if (socket?.connected) socket.emit("visibility", { visible: get().appActive });
}

export function emitTyping(convId: number) {
  if (socket?.connected) socket.emit("typing", { conversationId: convId });
}

async function onMessageNew(msg: Message) {
  let fresh = false;
  if (!get().convs[msg.conversationId]) {
    try {
      await fetchConv(msg.conversationId);
      fresh = true; // số chưa đọc lấy từ máy chủ đã tính tin này
    } catch {
      return;
    }
  }
  const s = get();
  const mine = msg.senderId === s.me?.id;
  receive(msg);
  clearTyping(msg.conversationId, msg.senderId);
  if (mine || msg.kind === "system") return;
  const here = s.currentId === msg.conversationId && s.appActive;
  if (here && s.atBottom) {
    markRead(msg.conversationId);
    return;
  }
  if (!fresh) patchConv(msg.conversationId, (c) => ({ unread: (c.unread || 0) + 1 }));
  if (!here && s.appActive) {
    const st = get();
    const c = st.convs[msg.conversationId];
    if (c) {
      const names = namesOf(st);
      showToast(previewText(msg, c, names), { title: convTitle(c, names.nameOf), convId: c.id, senderId: msg.senderId }, 4500);
    }
  }
}

function onRead({ conversationId, userId, lastReadId }: { conversationId: number; userId: number; lastReadId: number }) {
  const s = get();
  const c = s.convs[conversationId];
  if (!c) return;
  if (userId === s.me?.id) {
    // Bạn vừa đọc trên thiết bị khác
    if (lastReadId > (c.lastReadId || 0)) {
      const all = !c.lastMessage || lastReadId >= c.lastMessage.id;
      patchConv(conversationId, () => ({ lastReadId, unread: all ? 0 : c.unread }));
      if (all) dismissConversation(conversationId);
    }
    return;
  }
  patchConv(conversationId, (cc) => ({
    reads: cc.reads ? { ...cc.reads, [userId]: Math.max(cc.reads[userId] || 0, lastReadId) } : cc.reads,
    peerLastReadId: cc.type === "dm" && userId === cc.peerId ? Math.max(cc.peerLastReadId || 0, lastReadId) : cc.peerLastReadId,
  }));
}

async function onConvChanged({ conversationId, addedBy, added, removed }: { conversationId: number; addedBy?: number; added?: number[]; removed?: number[] }) {
  const me = get().me;
  if (!me) return;
  try {
    if (Array.isArray(removed) && removed.includes(me.id)) throw new ApiError("removed", 404);
    const c = await fetchConv(conversationId);
    if (Array.isArray(added) && added.includes(me.id) && addedBy !== me.id) {
      showToast(`${namesOf(get()).nameOf(addedBy)} đã thêm bạn vào nhóm “${c.name}”.`, { convId: c.id });
    }
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) return;
    const wasOpen = get().currentId === conversationId;
    forgetConversation(conversationId);
    if (wasOpen) showToast("Bạn không còn ở trong nhóm này.");
  }
}

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function onTyping({ conversationId, userId }: { conversationId: number; userId: number }) {
  if (userId === get().me?.id) return;
  const key = `${conversationId}:${userId}`;
  const t = typingTimers.get(key);
  if (t) clearTimeout(t);
  typingTimers.set(key, setTimeout(() => clearTyping(conversationId, userId), 3500));
  set((s) => {
    const list = s.typing[conversationId] || [];
    return list.includes(userId) ? {} : { typing: { ...s.typing, [conversationId]: [...list, userId] } };
  });
}

function clearTyping(convId: number, userId: number) {
  const key = `${convId}:${userId}`;
  const t = typingTimers.get(key);
  if (t) clearTimeout(t);
  typingTimers.delete(key);
  set((s) => {
    const list = s.typing[convId];
    if (!list || !list.includes(userId)) return {};
    return { typing: { ...s.typing, [convId]: list.filter((id) => id !== userId) } };
  });
}

/* =========================================================
   App vào nền / quay lại
   ========================================================= */

let started = false;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
const BACKGROUND_DISCONNECT = 45 * 1000;

function onAppState(st: string) {
  const active = st === "active";
  if (active === get().appActive) return;
  set({ appActive: active });
  reportVisibility();
  if (backgroundTimer) clearTimeout(backgroundTimer);
  backgroundTimer = null;
  if (!active) {
    // Ở nền lâu: ngắt realtime cho đỡ tốn pin (tin mới sẽ đến bằng thông báo đẩy)
    backgroundTimer = setTimeout(() => {
      backgroundTimer = null;
      if (!get().appActive && socket?.connected) socket.disconnect();
    }, BACKGROUND_DISCONNECT);
    return;
  }
  const s = get();
  if (s.phase === "boot" || (s.phase === "ready" && s.offline)) connectServer();
  if (socket && !socket.connected) socket.connect();
  if (s.currentId != null) {
    dismissConversation(s.currentId);
    if (s.atBottom) markRead(s.currentId);
  }
}

/** Gọi một lần khi app khởi động */
export function startLifecycle() {
  if (started) return;
  started = true;
  AppState.addEventListener("change", onAppState);
  // Trạng thái có thể đã đổi trước khi kịp lắng nghe (vd mở app từ thông báo)
  onAppState(AppState.currentState);
  // Báo máy chủ "đang xem app" định kỳ, để máy chủ không gửi thông báo đẩy trùng
  setInterval(() => {
    if (get().appActive) reportVisibility();
  }, 25000);
}

bindChess({
  closed: () => {
    chessReturn = null;
  },
  meId: () => get().me?.id ?? 0,
  nameOf: (id) => namesOf(get()).nameOf(id),
  toast: (text, extra) => {
    // Đang xem đúng ván đó thì thôi
    if (extra?.chessGameId && useChess.getState().openId === extra.chessGameId && inChess() && get().currentId == null) return;
    showToast(text, extra || {}, 4500);
  },
  onTab: () => inChess() && get().currentId == null && get().appActive,
  showChess: () => openChess(),
});

bindBlocks({
  meId: () => (get().phase === "ready" ? (get().me?.id ?? null) : null),
  online: () => !get().offline,
  toast: (text) => showToast(text),
});

bindSocial({
  meId: () => get().me?.id ?? 0,
  isAdmin: () => get().me?.role === "admin",
  toast: (text) => showToast(text),
  showMe: () => set({ tab: "me", currentId: null, settingsOpen: false }),
});

export const selectors = {
  box: (id: number | null) => (s: State) => (id == null ? undefined : s.msgs[id]),
};

export type { State as StoreState };
export { lastServerId };
