import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { create } from "zustand";

import { fileUrl } from "./api";
import { isMuted } from "./chatThemes";
import { colorOf, convTitle, initialOf, previewText } from "./format";
import { ThinkNative, type HeadInfo } from "./native";
import { CATEGORY_MESSAGE, CHANNEL_MESSAGES } from "./notifications";
import { ensureConnected, namesOf, setBackgroundHooks, unreadTotal, useStore } from "./store";
import type { Conversation, Message } from "./types";

// Bong bóng chat (giống Messenger), chỉ có trên Android:
// - Bật trong Cài đặt → cần quyền "Hiển thị trên ứng dụng khác".
// - Khi bật, app chạy nền (có thông báo "Bong bóng chat đang bật") để giữ kết nối, tin mới đến ngay,
//   kể cả máy không có dịch vụ Google (Huawei...): hiện bong bóng ảnh người nhắn + thông báo trên máy.
// - Chạm bong bóng: mở khung chat nổi (native/src/bubble/BubbleApp.tsx) ngay trên app đang dùng.

type BubbleState = {
  supported: boolean;
  /** Người dùng đã bật */
  on: boolean;
  /** Đã có quyền vẽ trên ứng dụng khác */
  canDraw: boolean;
  /** Đang chờ người dùng cấp quyền trong Cài đặt máy */
  waiting: boolean;
};

const native = Platform.OS === "android" && ThinkNative != null && typeof ThinkNative.bubblesState === "function" ? ThinkNative : null;

export const useBubbles = create<BubbleState>(() => ({ supported: false, on: false, canDraw: false, waiting: false }));

function readState() {
  if (!native) return;
  try {
    const st = native.bubblesState();
    useBubbles.setState({ supported: st.supported, on: st.on, canDraw: st.canDraw });
  } catch {
    useBubbles.setState({ supported: false });
  }
}

/** Đang bật và chạy được */
export const bubblesActive = () => {
  const b = useBubbles.getState();
  return b.supported && b.on && b.canDraw;
};

let inited = false;

/** Gọi một lần khi app khởi động */
export function initBubbles() {
  if (inited || !native) return;
  inited = true;
  readState();
  if (bubblesActive()) native.setBubbles(true);
  setBackgroundHooks({ keepAlive: bubblesActive, onIncoming });
  AppState.addEventListener("change", (st) => {
    if (st !== "active") return;
    // Quay lại từ trang cấp quyền của máy
    const waiting = useBubbles.getState().waiting;
    readState();
    if (waiting) {
      useBubbles.setState({ waiting: false });
      if (useBubbles.getState().canDraw) void setBubbles(true);
    } else if (bubblesActive()) {
      native.setBubbles(true); // dịch vụ bị máy tắt: bật lại
    }
  });
  native.addListener("onChatHead", (e) => {
    if (e.type === "disabled") readState();
  });
  // Đọc hết tin (trên máy này hay máy khác): ẩn bong bóng
  useStore.subscribe((s, prev) => {
    if (s.convs !== prev.convs && bubblesActive() && unreadTotal(s.convs) === 0 && unreadTotal(prev.convs) > 0 && !native.bubbleVisible()) native.hideHead();
  });
}

/** Bật / tắt bong bóng. Chưa có quyền thì mở trang cấp quyền của máy (trả về "permission"). */
export async function setBubbles(on: boolean): Promise<"on" | "off" | "permission" | "unsupported"> {
  if (!native) return "unsupported";
  readState();
  const b = useBubbles.getState();
  if (!b.supported) return "unsupported";
  if (!on) {
    native.setBubbles(false);
    useBubbles.setState({ on: false, waiting: false });
    return "off";
  }
  if (!b.canDraw) {
    useBubbles.setState({ waiting: true });
    native.openOverlaySettings();
    return "permission";
  }
  native.setBubbles(true);
  useBubbles.setState({ on: true, waiting: false });
  ensureConnected();
  return "on";
}

/** Thông tin để vẽ bong bóng của một cuộc trò chuyện */
export function headInfo(conv: Conversation, msg: Message | null, extra: Partial<HeadInfo> = {}): HeadInfo {
  const st = useStore.getState();
  const names = namesOf(st);
  const peer = conv.type === "dm" && conv.peerId != null ? st.users[conv.peerId] : null;
  return {
    convId: conv.id,
    title: convTitle(conv, names.nameOf),
    initial: initialOf(conv.type === "dm" ? peer?.displayName : conv.type === "group" ? conv.name : "Think"),
    color: conv.type === "dm" ? colorOf(conv.peerId) : conv.type === "group" ? colorOf(conv.id + 3) : "#0E7C66",
    avatarUrl: peer?.avatar ? fileUrl(peer.avatar) : conv.type === "group" && conv.avatar ? fileUrl(conv.avatar) : "",
    preview: msg ? `${conv.type === "dm" ? "" : `${convTitle(conv, names.nameOf)} · `}${previewText(msg, conv, names)}` : "",
    unread: unreadTotal(st.convs),
    general: conv.type === "general",
    ...extra,
  };
}

/** Nút "Thử bong bóng" trong Cài đặt: hiện bong bóng của cuộc trò chuyện mới nhất ngay bây giờ */
export function demoBubble() {
  if (!native || !bubblesActive()) return false;
  const convs = Object.values(useStore.getState().convs).sort(
    (a, b) => (b.lastMessage?.createdAt || b.createdAt) - (a.lastMessage?.createdAt || a.createdAt),
  );
  const conv = convs[0];
  if (!conv) return false;
  native.showHead(headInfo(conv, conv.lastMessage || null, { force: true }));
  return true;
}

/** Tin mới của người khác (store gọi sau khi đã cộng số chưa đọc) */
function onIncoming(msg: Message) {
  if (!native || !bubblesActive()) return;
  const st = useStore.getState();
  const conv = st.convs[msg.conversationId];
  if (!conv) return;
  const mentioned = (msg.mentions || []).includes(st.me?.id ?? -1);
  if (isMuted(conv) && !mentioned) return;
  const bubbleOpen = native.bubbleVisible();
  // Đang mở app: tin mới đã hiện trong app. Đang xem đúng cuộc trò chuyện này trong khung nổi: thôi.
  if (AppState.currentState === "active" && !bubbleOpen) return;
  if (bubbleOpen && st.currentId === conv.id) return;
  // Cuộc trò chuyện đã khóa vẫn có bong bóng đầy đủ; chạm mở khung chat nổi thì hỏi mật khẩu (ChatScreen → ChatLockGate)
  native.showHead(headInfo(conv, msg));
  // Máy không nhận được thông báo đẩy (không có dịch vụ Google, máy chủ chưa cấu hình...):
  // app đang chạy nền nhờ bong bóng nên tự hiện thông báo
  if (!bubbleOpen && (st.push === "unavailable" || st.push === "server-off" || st.push === "error")) {
    const names = namesOf(st);
    Notifications.scheduleNotificationAsync({
      identifier: `conv-${conv.id}`,
      content: {
        title: convTitle(conv, names.nameOf),
        body: previewText(msg, conv, names),
        data: { type: "message", conversationId: conv.id },
        categoryIdentifier: CATEGORY_MESSAGE,
      },
      trigger: { channelId: CHANNEL_MESSAGES },
    }).catch(() => undefined);
  }
}
