import * as Application from "expo-application";
import { AppState, Platform } from "react-native";
import { io, type Socket } from "socket.io-client";
import { create } from "zustand";

import { api, ApiError, setAuthHandlers } from "./api";
import { clearSnapshot, loadSnapshot, saveSnapshot } from "./cache";
import { bindBlocks, onScoreEvent, resetBlocksBoard, sync as syncBlocks } from "./blocks/store";
import {
  bindCaro,
  closeBot as closeCaroBot,
  closeGame as closeCaroGame,
  loadCaro,
  onCaroEvent,
  openBot as openCaroBot,
  openGame as openCaroGame,
  resetCaro,
  useCaro,
} from "./caro/store";
import { bindChess, closeGame, closeTournament, loadChess, onAnalysisEvent, onChessEvent, onChessRefresh, onTournamentEvent, openGame, openTournament, resetChess, useChess } from "./chess/store";
import { bindFarm, loadFarm, onFarmEvent, openVisit as openFarmVisit, resetFarm, setTab as setFarmTab, useFarm } from "./farm/store";
import { bindStreaks, loadStreaks, markPlayed, onStreakEvent, resetStreaks } from "./streaks/store";
import type { GameId as PuzzleGame } from "./puzzles/core";
import {
  bindPuzzles,
  closeRoute as closePuzzles,
  closePlay as closePuzzlePlay,
  loadPuzzles,
  onPuzzleDaily,
  openRoute as openPuzzleRoute,
  resetPuzzles,
  usePuzzles,
} from "./puzzles/store";
import { API_URL } from "./config";
import { convTitle, previewText, type Names } from "./format";
import type { PreparedImage } from "./images";
import { bindSocial, closeUser, onSocialEvent, refreshSocial, resetSocial } from "./social/store";
import { bindStories, loadStories, onStoryEvent, resetStories } from "./stories/store";
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
import { mentionIds } from "./chatPlus";
import { emojiOf, isMuted } from "./chatThemes";
import { afterBackground, isGated as gatedNow, leaveUnlocked as leaveUntil } from "./chatLock";
import { bindCallSocket, callHooks, callReconnected, inCall, resetCalls } from "./calls/engine";
import type { ChatItem, Conversation, Me, Message, PendingMessage, Pin, Reaction, User } from "./types";

/* =========================================================
   Trạng thái của app
   ========================================================= */

export type Phase = "boot" | "login" | "force" | "ready";
export type Tab = "chats" | "games" | "me" | "admin";
/** Trong tab Trò chơi: trang chọn game, Cờ vua, Cờ caro, đang chơi Xếp Khối, Nông trại, hay câu đố (quiz hôm nay / thử thách nhanh) */
export type GamesView = "hub" | "chess" | "blocks" | "caro" | "farm" | "puzzle";
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

/** chessGameId / caroGameId: chạm để mở ván đó (0 = mở mục Cờ vua / Cờ caro); chessTournamentId: mở giải đấu */
export type Toast = { id: number; text: string; title?: string; convId?: number; senderId?: number; chessGameId?: number; chessTournamentId?: number; caroGameId?: number };

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
  /** Tin của mình đang sửa (theo cuộc trò chuyện) */
  editing: Record<number, Message | undefined>;
  /** Tin đã ghim (theo cuộc trò chuyện), mới ghim nhất trước */
  pins: Record<number, Pin[]>;
  /** Người được chọn từ gợi ý @nhắc tên trong bản nháp: tên hiển thị -> id */
  mentionPicks: Record<number, Record<string, number>>;
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
  /** Tăng khi có báo lỗi app mới (chỉ admin nhận) */
  errorsVersion: number;
  /** Cuộc trò chuyện đã khóa mà mình vừa mở khóa: mã -> mở tới lúc nào (Infinity: đang xem) */
  unlocked: Record<number, number>;
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
  editing: {},
  pins: {},
  mentionPicks: {},
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
  errorsVersion: 0,
  unlocked: {},
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

/** Số tin chưa đọc trên tab Tin nhắn / biểu tượng app (không tính cuộc trò chuyện đang tắt thông báo) */
export const unreadTotal = (convs: Record<number, Conversation>) =>
  Object.values(convs).reduce((sum, c) => sum + (isMuted(c) ? 0 : c.unread || 0), 0);

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

// Màn hình cuộc gọi báo lỗi bằng thông báo nhỏ; cần biết mình là ai và tên / ảnh của người trong cuộc gọi nhóm
callHooks.toast = (text) => showToast(text);
callHooks.meId = () => get().me?.id ?? null;
callHooks.userOf = (id) => {
  const u = get().users[id];
  return u ? { id: u.id, displayName: u.displayName, avatar: u.avatar } : null;
};

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
  loadCaro();
  syncBlocks(); // gửi điểm Xếp Khối chơi lúc mất mạng
  loadStreaks(); // chuỗi hằng ngày (gửi luôn ngày chơi lúc mất mạng)
  loadPuzzles(); // câu đố: sao, quiz hôm nay (gửi luôn kết quả giải lúc mất mạng)
  loadStories(); // tin 24 giờ
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
  resetCalls();
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
  resetCaro();
  resetFarm();
  resetStreaks();
  resetPuzzles();
  resetSocial();
  resetStories();
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
    if (useCaro.getState().loaded) loadCaro();
    if (useFarm.getState().farm) loadFarm();
    loadStreaks();
    loadPuzzles();
    refreshSocial();
    loadStories();
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
  // Đang trong một ván cờ / caro thì giữ tab Trò chơi: đóng chat là quay lại ván
  const keepGame =
    (inChess() && useChess.getState().openId != null) ||
    (inCaro() && (useCaro.getState().openId != null || useCaro.getState().botOpen)) ||
    (get().tab === "games" && (get().gamesView === "farm" || get().gamesView === "puzzle"));
  const prev = get().currentId;
  if (prev != null && prev !== id) leaveUnlocked(prev);
  set({ currentId: id, atBottom: true, tab: keepGame ? "games" : "chats" });
  hideToastFor(id);
  if (isGated(get().convs[id])) {
    // Đã khóa: hỏi mật khẩu trước (ChatScreen hiện màn khóa), chưa tải tin nhắn
    reportVisibility();
    return;
  }
  if (get().convs[id]?.locked) set((st) => ({ unlocked: { ...st.unlocked, [id]: Infinity } }));
  dismissConversation(id);
  loadPins(id);
  const box = get().msgs[id];
  if (!box || !box.loaded || box.stale) await loadMessages(id);
  else markRead(id);
  reportVisibility();
}

export function closeConversation() {
  leaveUnlocked(get().currentId);
  set({ currentId: null });
}

/* =========================================================
   Khóa cuộc trò chuyện bằng mật khẩu (2.9.0, máy chủ: src/chat-lock.js)
   Mở khóa xong thì xem được tới khi rời cuộc trò chuyện hoặc để app chạy nền quá RELOCK_MS.
   ========================================================= */

/** Cuộc trò chuyện đã khóa và chưa mở khóa: không hiện tin nhắn */
export function isGated(c: Pick<Conversation, "id" | "locked"> | undefined, unlocked: Record<number, number> = get().unlocked) {
  return gatedNow(c, unlocked);
}

/** Rời một cuộc trò chuyện đã mở khóa: còn xem lại được trong RELOCK_MS */
function leaveUnlocked(id: number | null) {
  const next = leaveUntil(get().unlocked, id);
  if (next !== get().unlocked) set({ unlocked: next });
}

/** Nhập mật khẩu để xem; quên mật khẩu thì bỏ khóa bằng mật khẩu đăng nhập (forgot) */
export async function unlockConversation(id: number, password: string, forgot = false) {
  if (forgot) {
    const { conversation } = await api.removeChatLock(id, { accountPassword: password });
    keepConv(conversation);
  } else {
    await api.unlockChat(id, password);
  }
  set((st) => ({ unlocked: { ...st.unlocked, [id]: Infinity } }));
  if (get().currentId === id) {
    dismissConversation(id);
    loadPins(id);
    const box = get().msgs[id];
    if (!box || !box.loaded || box.stale) await loadMessages(id);
    else markRead(id);
  }
}

/** Nút ổ khóa trên đầu khung chat: khóa lại ngay */
export function lockConversationNow(id: number) {
  set((st) => {
    const unlocked = { ...st.unlocked };
    delete unlocked[id];
    return { unlocked };
  });
}

/** Đặt khóa / đổi mật khẩu (current: mật khẩu cũ khi đổi). Đang ở trong cuộc trò chuyện thì vẫn xem tiếp. */
export async function setChatLock(id: number, password: string, current?: string) {
  const { conversation } = await api.setChatLock(id, password, current);
  keepConv(conversation);
  if (get().currentId === id) set((st) => ({ unlocked: { ...st.unlocked, [id]: Infinity } }));
}

export async function removeChatLock(id: number, body: { password: string } | { accountPassword: string }) {
  const { conversation } = await api.removeChatLock(id, body);
  keepConv(conversation);
}

/** Đổi / xóa ảnh nhóm */
export async function setGroupAvatar(id: number, img: { uri: string; mime: string } | null) {
  const { conversation } = img ? await api.uploadGroupAvatar(id, img.uri, img.mime) : await api.removeGroupAvatar(id);
  keepConv(conversation);
}

function keepConv(conversation: Conversation) {
  set((st) => ({ convs: { ...st.convs, [conversation.id]: { ...conversation, reads: st.convs[conversation.id]?.reads } } }));
}

const inChess = () => get().tab === "games" && get().gamesView === "chess";
const inCaro = () => get().tab === "games" && get().gamesView === "caro";

/** Rời mục Cờ vua: đóng ván đang mở (để thông báo về ván đó không bị nuốt mất) */
function leaveChessView() {
  if (useChess.getState().openId != null) closeGame();
  if (useChess.getState().localOpen) useChess.setState({ localOpen: false });
  if (useChess.getState().analysis || useChess.getState().statsFor != null) useChess.setState({ analysis: null, statsFor: null });
  if (useChess.getState().tournamentOpen != null) closeTournament();
}

/** Rời mục Cờ caro: đóng ván đang mở, dừng máy (ván với máy vẫn lưu, mở lại chơi tiếp) */
function leaveCaroView() {
  if (useCaro.getState().openId != null) closeCaroGame();
  if (useCaro.getState().botOpen) closeCaroBot();
}

export function setTab(tab: Tab) {
  // Bấm lại tab Trò chơi khi đang ở trong một game: về trang chọn game
  const gamesView = tab === "games" && get().tab === "games" ? "hub" : get().gamesView === "blocks" || get().gamesView === "farm" ? "hub" : get().gamesView;
  if (!(tab === "games" && gamesView === "chess")) leaveChessView();
  // Đổi tab khi đang trong ván caro: đóng ván (quay lại tab Trò chơi thì ở trang Cờ caro)
  leaveCaroView();
  set({ tab, currentId: null, settingsOpen: false, gamesView });
  closeUser();
  if (tab === "games" && !useChess.getState().loading) loadChess();
  if (tab === "games" && !useCaro.getState().loading) loadCaro();
  if (tab === "games") syncBlocks();
}

/** Trang chọn game (trong tab Trò chơi) */
export function showGamesHub() {
  leaveChessView();
  leaveCaroView();
  set({ tab: "games", gamesView: "hub", currentId: null });
}

/** Mở game Xếp Khối */
export function openBlocks() {
  leaveChessView();
  leaveCaroView();
  set({ tab: "games", gamesView: "blocks", currentId: null });
  closeUser();
}

/** Mở game Nông trại; có userId thì ghé luôn vườn của người đó; tab = mục muốn mở (vd Bạn bè) */
export function openFarm(userId?: number | null, tab?: "field" | "friends") {
  leaveChessView();
  leaveCaroView();
  set({ tab: "games", gamesView: "farm", currentId: null });
  closeUser();
  if (tab) setFarmTab(tab);
  openFarmVisit(userId ?? null);
}

/**
 * Mở câu đố của một game: "daily" = quiz hôm nay, "map" = bản đồ màn Thử thách nhanh.
 * Nút Quay lại (puzzleBack) về đúng chỗ vừa mở: câu đố → bản đồ màn → trang chọn game / trang của game đó.
 */
export function openPuzzles(game: PuzzleGame, what: "daily" | "map") {
  const s = get();
  const from = s.tab === "games" && s.gamesView !== "puzzle" ? s.gamesView : (usePuzzles.getState().route?.from ?? "hub");
  leaveChessView();
  leaveCaroView();
  set({ tab: "games", gamesView: "puzzle", currentId: null });
  closeUser();
  openPuzzleRoute(game, what, from);
}

/** Quay lại một bậc trong phần câu đố */
export function puzzleBack() {
  const r = usePuzzles.getState().route;
  if (r?.play && r.map) {
    closePuzzlePlay();
    return;
  }
  leavePuzzles();
}

/** Rời hẳn phần câu đố, về chỗ đã mở nó */
export function leavePuzzles() {
  const from = closePuzzles()?.from ?? "hub";
  if (get().tab !== "games" || get().gamesView !== "puzzle") return;
  if (from === "chess") openChess();
  else if (from === "caro") openCaro();
  else if (from === "blocks") openBlocks();
  else showGamesHub();
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

/** Mở mục Cờ vua; có gameId thì mở luôn ván đó, có tournamentId thì mở trang giải đấu */
export function openChess(gameId?: number | null, tournamentId?: number | null) {
  const s = get();
  chessReturn = gameId && !inChess() ? { gameId, tab: s.tab, currentId: s.currentId } : null;
  leaveCaroView();
  set({ tab: "games", gamesView: "chess", currentId: null });
  if (get().toast?.chessGameId != null || get().toast?.chessTournamentId != null) hideToast();
  if (gameId) openGame(gameId);
  else {
    closeGame();
    if (tournamentId) openTournament(tournamentId);
    else closeTournament();
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

/** Mở ván caro từ chỗ khác (thông báo, tin nhắn…): bấm Quay lại thì về đúng chỗ đó */
let caroReturn: { gameId: number; tab: Tab; currentId: number | null } | null = null;

/** Mở mục Cờ caro; có gameId thì mở luôn ván đó, bot = mở ván chơi với máy */
export function openCaro(gameId?: number | null, bot?: boolean) {
  const s = get();
  caroReturn = gameId && !inCaro() ? { gameId, tab: s.tab, currentId: s.currentId } : null;
  leaveChessView();
  set({ tab: "games", gamesView: "caro", currentId: null });
  closeUser();
  if (get().toast?.caroGameId != null) hideToast();
  if (gameId) openCaroGame(gameId);
  else if (bot) openCaroBot();
  else {
    if (useCaro.getState().openId != null) closeCaroGame();
    closeCaroBot();
    loadCaro();
  }
}

/** Nút Quay lại trong ván caro với bạn bè */
export function leaveCaroGame() {
  const back = caroReturn;
  const leaving = useCaro.getState().openId;
  closeCaroGame(); // xóa luôn caroReturn (qua bindCaro.closed)
  if (!back || back.gameId !== leaving || !inCaro()) return;
  set({ tab: back.tab, currentId: back.currentId != null && get().convs[back.currentId] ? back.currentId : null });
}

/** Nút Quay lại trong ván với máy: về trang Cờ caro (ván vẫn lưu) */
export function leaveCaroBot() {
  closeCaroBot();
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
  if (!c || !s.appActive || s.offline || isGated(c, s.unlocked)) return;
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

export function sendText(convId: number, raw: string, { quick = false }: { quick?: boolean } = {}) {
  const me = get().me;
  if (get().editing[convId]) {
    saveEdit(convId, raw);
    return false;
  }
  const typed = raw.trim();
  // Ô nhập trống mà bấm nút gửi: gửi biểu tượng cảm xúc nhanh của cuộc trò chuyện
  const text = typed || (quick ? emojiOf(get().convs[convId]) : "");
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
  const mentions = typed ? mentionsIn(convId, text) : [];
  if (mentions.length) m.mentions = mentions;
  if (typed) setDraft(convId, "");
  set((st) => ({ mentionPicks: { ...st.mentionPicks, [convId]: {} } }));
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

/** Tin nhắn thoại vừa ghi xong (uri = file ghi âm trên máy) */
export async function sendVoice(convId: number, rec: { uri: string; ms: number; wave: string; mime?: string }) {
  const me = get().me;
  if (!me) return;
  const m: PendingMessage = {
    id: null,
    clientId: newClientId(),
    conversationId: convId,
    senderId: me.id,
    kind: "voice",
    text: null,
    image: null,
    deleted: false,
    createdAt: Date.now(),
    replyTo: takeReply(convId),
    reactions: [],
    audio: { url: rec.uri, ms: rec.ms, wave: rec.wave },
    mime: rec.mime || "audio/mp4",
    status: "sending",
  };
  addLocal(m);
  await deliver(m);
}

async function deliver(m: PendingMessage) {
  patchPending(m.conversationId, m.clientId, { status: "sending", error: undefined });
  try {
    if (m.kind === "voice" && m.audio) {
      let url = m.uploadedAudio;
      if (!url) {
        url = (await api.uploadAudio(m.audio.url, m.mime || "audio/mp4")).url;
        patchPending(m.conversationId, m.clientId, { uploadedAudio: url });
      }
      const { message } = await api.send(m.conversationId, {
        audio: url,
        audioMs: m.audio.ms,
        audioWave: m.audio.wave,
        replyTo: m.replyTo?.id || undefined,
        clientId: m.clientId,
      });
      receive(message);
      return;
    }
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
      mentions: m.mentions,
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
  // Gửi lại tin thoại: tải lại file ghi âm (bản tải lên cũ có thể đã hết hạn trên máy chủ)
  if (m.uploadedAudio) patchPending(convId, clientId, { uploadedAudio: undefined });
  deliver({ ...m, uploadedAudio: undefined });
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
  onPins({ conversationId: m.conversationId, removed: m.id });
}

/* =========================================================
   Chat 2.1.0: sửa tin, ghim tin, chuyển tiếp, bình chọn, @nhắc tên,
   chủ đề + biểu tượng gửi nhanh, tắt thông báo / ghim cuộc trò chuyện
   ========================================================= */

/** Thay một tin đã có (sửa, bình chọn…) ở mọi chỗ đang giữ nó */
export function onMessageUpdated({ message }: { message: Message }) {
  if (!message) return;
  patchBox(message.conversationId, (b) => ({
    list: b.list.map((m) => (!isPending(m) && m.id === message.id ? { ...m, ...message } : m)),
  }));
  patchConv(message.conversationId, (c) => (c.lastMessage && c.lastMessage.id === message.id ? { lastMessage: { ...c.lastMessage, ...message } } : {}));
  const pins = get().pins[message.conversationId];
  if (pins?.some((p) => p.message.id === message.id)) {
    set((st) => ({
      pins: { ...st.pins, [message.conversationId]: pins.map((p) => (p.message.id === message.id ? { ...p, message: { ...p.message, ...message } } : p)) },
    }));
  }
}

/** Bản nháp trước khi bấm Sửa (sửa xong / hủy thì trả lại) */
const draftsBeforeEdit = new Map<number, string>();

export function startEdit(convId: number, m: Message) {
  if (!get().editing[convId]) draftsBeforeEdit.set(convId, get().drafts[convId] || "");
  setDraft(convId, m.text || "");
  const picks: Record<string, number> = {};
  for (const uid of m.mentions || []) picks[namesOf(get()).nameOf(uid)] = uid;
  set((st) => ({
    editing: { ...st.editing, [convId]: m },
    replying: { ...st.replying, [convId]: undefined },
    mentionPicks: { ...st.mentionPicks, [convId]: picks },
  }));
}

export function cancelEdit(convId: number) {
  if (!get().editing[convId]) return;
  setDraft(convId, draftsBeforeEdit.get(convId) ?? "");
  draftsBeforeEdit.delete(convId);
  set((st) => ({ editing: { ...st.editing, [convId]: undefined }, mentionPicks: { ...st.mentionPicks, [convId]: {} } }));
}

async function saveEdit(convId: number, raw: string) {
  const m = get().editing[convId];
  if (!m) return;
  const text = raw.trim();
  if (!text && !m.image) {
    showToast("Tin nhắn không được để trống. Muốn xóa thì chọn Thu hồi.");
    return;
  }
  const mentions = mentionsIn(convId, text);
  cancelEdit(convId);
  if (text === (m.text || "").trim()) return;
  const before = { text: m.text, editedAt: m.editedAt, mentions: m.mentions };
  onMessageUpdated({ message: { ...m, text, editedAt: Date.now(), mentions } });
  try {
    onMessageUpdated(await api.editMessage(m.id, text, mentions));
  } catch (err) {
    onMessageUpdated({ message: { ...m, ...before } });
    showToast(err instanceof Error ? err.message : "Chưa sửa được tin nhắn.");
  }
}

/** Ghi nhớ người được chọn từ gợi ý @nhắc tên */
export function pickMention(convId: number, name: string, userId: number) {
  set((st) => ({ mentionPicks: { ...st.mentionPicks, [convId]: { ...(st.mentionPicks[convId] || {}), [name]: userId } } }));
}

/** Ai được nhắc tên trong tin sắp gửi: người đã chọn từ gợi ý mà "@Tên" vẫn còn trong chữ */
export function mentionsIn(convId: number, text: string) {
  return mentionIds(get().mentionPicks[convId] || {}, text);
}

export async function loadPins(convId: number) {
  if (get().offline) return;
  try {
    const { pins } = await api.pins(convId);
    set((st) => ({ pins: { ...st.pins, [convId]: pins } }));
  } catch {
    /* không có thanh ghim */
  }
}

export function onPins({ conversationId, pins, removed }: { conversationId: number; pins?: Pin[]; removed?: number }) {
  if (Array.isArray(pins)) set((st) => ({ pins: { ...st.pins, [conversationId]: pins } }));
  else if (removed) {
    const list = get().pins[conversationId];
    if (list) set((st) => ({ pins: { ...st.pins, [conversationId]: list.filter((p) => p.message.id !== removed) } }));
  }
}

export const isPinnedMsg = (st: Pick<State, "pins">, m: ChatItem) =>
  !isPending(m) && (st.pins[m.conversationId] || []).some((p) => p.message.id === m.id);

export async function pinMessage(m: Message, pinned: boolean) {
  try {
    const { pins } = await api.pin(m.id, pinned);
    onPins({ conversationId: m.conversationId, pins });
    showToast(pinned ? "Đã ghim tin nhắn." : "Đã bỏ ghim.");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Chưa ghim được.");
  }
}

export async function forwardMessage(m: Message, convIds: number[]) {
  const { messages } = await api.forward(m.id, convIds);
  for (const msg of messages) receive(msg);
  return messages.length;
}

export async function createPoll(convId: number, question: string, options: string[], multi: boolean) {
  const { message } = await api.createPoll(convId, { question, options, multi });
  receive(message);
  set({ atBottom: true });
}

export async function votePoll(m: Message, option: number) {
  const meId = get().me?.id;
  const p = m.poll;
  if (!p || p.closed || meId == null) return;
  const mine = p.options.map((o, k) => (o.votes.includes(meId) ? k : -1)).filter((k) => k >= 0);
  const next = p.multi ? (mine.includes(option) ? mine.filter((k) => k !== option) : [...mine, option]) : mine.length === 1 && mine[0] === option ? [] : [option];
  const optimistic = {
    ...p,
    options: p.options.map((o, k) => ({ ...o, votes: [...o.votes.filter((u) => u !== meId), ...(next.includes(k) ? [meId] : [])] })),
  };
  onMessageUpdated({ message: { ...m, poll: optimistic } });
  try {
    onMessageUpdated(await api.vote(m.id, next));
  } catch (err) {
    onMessageUpdated({ message: { ...m, poll: p } });
    showToast(err instanceof Error ? err.message : "Chưa bình chọn được.");
  }
}

export async function closePoll(m: Message) {
  try {
    onMessageUpdated(await api.closePoll(m.id));
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Chưa kết thúc được bình chọn.");
  }
}

function onAppearance({ conversationId, theme, emoji }: { conversationId: number; theme: string; emoji: string }) {
  patchConv(conversationId, () => ({ theme, emoji }));
}

function onConvPrefs({ conversationId, mutedUntil, pinnedAt }: { conversationId: number; mutedUntil: number; pinnedAt: number | null }) {
  patchConv(conversationId, () => ({ mutedUntil, pinnedAt }));
}

export async function setAppearance(convId: number, body: { theme?: string; emoji?: string }) {
  try {
    const { conversation } = await api.appearance(convId, body);
    onAppearance({ conversationId: convId, theme: conversation.theme || "default", emoji: emojiOf(conversation) });
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Chưa đổi được.");
  }
}

export async function setConvPrefs(convId: number, body: { mutedUntil?: number; pinned?: boolean }) {
  try {
    const { conversation } = await api.convPrefs(convId, body);
    onConvPrefs({ conversationId: convId, mutedUntil: conversation.mutedUntil ?? 0, pinnedAt: conversation.pinnedAt ?? null });
    if (body.mutedUntil !== undefined) showToast(body.mutedUntil ? "Đã tắt thông báo của cuộc trò chuyện này." : "Đã bật lại thông báo.");
    if (body.pinned !== undefined) showToast(body.pinned ? "Đã ghim lên đầu danh sách." : "Đã bỏ ghim.");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Chưa đổi được.");
  }
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
  bindCallSocket(s); // gọi thoại / gọi video (src/calls/engine.ts)

  s.on("connect", () => {
    set({ connection: "online" });
    reportVisibility();
    // Mỗi lần nối lại: tải lại để không sót tin lúc mất kết nối (trừ khi đang tải lần đầu)
    if (!loadingAll) resync();
    callReconnected(); // đang gọi thì báo máy chủ mình đã nối lại
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
  s.on("message:updated", onMessageUpdated);
  s.on("conversation:pins", onPins);
  s.on("conversation:appearance", onAppearance);
  s.on("conversation:prefs", onConvPrefs);
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
  s.on("admin:errors", () => set((st) => ({ errorsVersion: st.errorsVersion + 1 })));
  s.on("chess:game", (data) => onChessEvent("chess:game", data));
  s.on("chess:challenge", (data) => onChessEvent("chess:challenge", data));
  s.on("chess:analysis", onAnalysisEvent);
  s.on("chess:tournament", onTournamentEvent);
  s.on("chess:refresh", onChessRefresh);
  s.on("games:score", onScoreEvent);
  s.on("caro:game", (data) => onCaroEvent("caro:game", data));
  s.on("caro:challenge", (data) => onCaroEvent("caro:challenge", data));
  s.on("farm:event", onFarmEvent);
  s.on("streak:update", onStreakEvent);
  s.on("puzzle:daily", onPuzzleDaily);
  for (const name of ["post:new", "post:likes", "post:comment", "post:comment-deleted", "post:deleted"]) {
    s.on(name, (data) => onSocialEvent(name, data));
  }
  for (const name of ["story:new", "story:deleted", "story:viewed"]) {
    s.on(name, (data) => onStoryEvent(name, data));
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
  const here = s.currentId === msg.conversationId && s.appActive && !isGated(s.convs[msg.conversationId], s.unlocked);
  if (here && s.atBottom) {
    markRead(msg.conversationId);
    return;
  }
  if (!fresh) patchConv(msg.conversationId, (c) => ({ unread: (c.unread || 0) + 1 }));
  try {
    hooks.onIncoming(msg); // bong bóng chat
  } catch {
    /* bong bóng lỗi không làm hỏng tin nhắn */
  }
  const quiet = isMuted(get().convs[msg.conversationId]) && !(msg.mentions || []).includes(s.me?.id ?? -1);
  if (!here && s.appActive && !quiet) {
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

let hiddenAt = 0;

function onAppState(st: string) {
  const active = st === "active";
  if (active === get().appActive) return;
  set({ appActive: active });
  // Chạy nền lâu: khóa lại các cuộc trò chuyện đã mở khóa
  if (!active) hiddenAt = Date.now();
  else set({ unlocked: afterBackground(get().unlocked, hiddenAt) });
  reportVisibility();
  if (backgroundTimer) clearTimeout(backgroundTimer);
  backgroundTimer = null;
  if (!active) {
    // Ở nền lâu: ngắt realtime cho đỡ tốn pin (tin mới sẽ đến bằng thông báo đẩy).
    // Đang bật bong bóng chat thì giữ kết nối để tin mới hiện bong bóng ngay.
    backgroundTimer = setTimeout(() => {
      backgroundTimer = null;
      // Đang gọi thì giữ kết nối (chuyển sang app khác vẫn nói chuyện được)
      if (!get().appActive && socket?.connected && !hooks.keepAlive() && !inCall()) socket.disconnect();
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

/* ---------- Bong bóng chat (src/bubbles.ts gắn vào đây, tránh import vòng) ---------- */

type BackgroundHooks = { keepAlive: () => boolean; onIncoming: (msg: Message) => void };
let hooks: BackgroundHooks = { keepAlive: () => false, onIncoming: () => undefined };

export function setBackgroundHooks(h: BackgroundHooks) {
  hooks = h;
}

/** Nối lại realtime nếu đang ngắt (vd vừa bật bong bóng chat khi app ở nền lâu) */
export function ensureConnected() {
  if (socket && !socket.connected && get().phase === "ready") socket.connect();
}

export const lifecycleStarted = () => started;

/** Màn hình đang xem (để khung chat nổi trả lại như cũ khi thu nhỏ) */
export function viewState() {
  const s = get();
  return { currentId: s.currentId, tab: s.tab };
}

export function restoreView(v: { currentId: number | null; tab: Tab }) {
  set({ currentId: v.currentId, tab: v.tab });
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
    if (extra?.chessTournamentId && useChess.getState().tournamentOpen === extra.chessTournamentId && useChess.getState().openId == null && inChess() && get().currentId == null) return;
    showToast(text, extra || {}, 4500);
  },
  onTab: () => inChess() && get().currentId == null && get().appActive,
  showChess: () => openChess(),
});

bindCaro({
  closed: () => {
    caroReturn = null;
  },
  meId: () => (get().phase === "ready" ? (get().me?.id ?? 0) : 0),
  nameOf: (id) => namesOf(get()).nameOf(id),
  toast: (text, extra) => {
    // Đang xem đúng ván đó thì thôi
    if (extra?.caroGameId && useCaro.getState().openId === extra.caroGameId && inCaro() && get().currentId == null) return;
    showToast(text, extra || {}, 4500);
  },
  onCaro: () => inCaro() && get().currentId == null && get().appActive,
  played: () => markPlayed("caro"),
});

bindFarm({
  meId: () => (get().phase === "ready" ? (get().me?.id ?? 0) : 0),
  nameOf: (id) => namesOf(get()).nameOf(id),
  toast: (text) => showToast(text, {}, 4500),
  onFarm: () => get().tab === "games" && get().gamesView === "farm" && get().currentId == null && get().appActive,
});

bindBlocks({
  meId: () => (get().phase === "ready" ? (get().me?.id ?? null) : null),
  online: () => !get().offline,
  toast: (text) => showToast(text),
  played: () => markPlayed("blocks"),
});

bindStreaks({
  meId: () => (get().phase === "ready" ? (get().me?.id ?? 0) : 0),
  toast: (text) => showToast(text, {}, 4000),
  online: () => !get().offline,
});

bindPuzzles({
  meId: () => (get().phase === "ready" ? (get().me?.id ?? 0) : 0),
  online: () => !get().offline,
  toast: (text) => showToast(text),
  played: (game) => markPlayed(game),
});

bindStories({
  meId: () => get().me?.id ?? 0,
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
