import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "./api";
import { PUSH_CONFIGURED } from "./config";

// Thông báo đẩy của app Think.
// Máy chủ gửi qua Firebase Cloud Messaging dạng "chỉ có data" (xem src/fcm.js ở máy chủ),
// expo-notifications tự hiện thông báo kèm nút Trả lời / Đã đọc (nhóm nút "message").

export const CHANNEL_MESSAGES = "messages";
export const CHANNEL_OTHER = "other";
export const CHANNEL_CHESS = "chess";
export const CATEGORY_MESSAGE = "message";
export const NOTIFICATION_TASK = "think-notification-action";

const TOKEN_KEY = "think.pushToken";
const PREF_KEY = "think.pushOff";
const ASKED_KEY = "think.pushAsked";

export type PushState = "on" | "off" | "denied" | "unavailable" | "server-off" | "error";

const isNative = Platform.OS === "android" || Platform.OS === "ios";

if (isNative) {
  // App đang mở: không hiện thêm thông báo (tin mới đã hiện ngay trong app)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

let setupDone: Promise<void> | null = null;

/** Tạo kênh thông báo và nút Trả lời / Đã đọc. Gọi nhiều lần cũng được. */
export function setupNotifications() {
  if (!isNative) return Promise.resolve();
  if (!setupDone) {
    setupDone = (async () => {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(CHANNEL_MESSAGES, {
          name: "Tin nhắn",
          description: "Tin nhắn mới trong các cuộc trò chuyện",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 200, 120, 200],
          lightColor: "#0E7C66",
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
          showBadge: true,
        });
        await Notifications.setNotificationChannelAsync(CHANNEL_CHESS, {
          name: "Cờ vua, cờ caro",
          description: "Lời thách đấu, đến lượt đi, kết quả ván cờ vua và cờ caro",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 120, 80, 120],
          lightColor: "#F2B01E",
          showBadge: false,
        });
        await Notifications.setNotificationChannelAsync(CHANNEL_OTHER, {
          name: "Cảm xúc và thông báo khác",
          description: "Ai đó bày tỏ cảm xúc về tin nhắn của bạn, bạn bè ghé nông trại, cả ruộng đã chín, thông báo thử",
          importance: Notifications.AndroidImportance.DEFAULT,
          showBadge: false,
        });
      }
      await Notifications.setNotificationCategoryAsync(CATEGORY_MESSAGE, [
        {
          identifier: "reply",
          buttonTitle: "Trả lời",
          textInput: { placeholder: "Nhập tin nhắn…", submitButtonTitle: "Gửi" },
          options: { opensAppToForeground: false },
        },
        { identifier: "read", buttonTitle: "Đã đọc", options: { opensAppToForeground: false } },
      ]);
      try {
        // Để bấm Trả lời / Đã đọc chạy được cả khi app đã tắt hẳn
        await Notifications.registerTaskAsync(NOTIFICATION_TASK);
      } catch {
        /* máy không hỗ trợ: nút vẫn chạy khi app đang mở */
      }
    })().catch(() => {
      setupDone = null;
    });
  }
  return setupDone;
}

export async function pushTurnedOff() {
  return (await AsyncStorage.getItem(PREF_KEY).catch(() => null)) === "1";
}

/** Đã tự hỏi quyền thông báo lần nào chưa (chỉ tự hỏi một lần, sau đó để người dùng tự bật) */
export async function askedOnce() {
  const asked = (await AsyncStorage.getItem(ASKED_KEY).catch(() => null)) === "1";
  if (!asked) await AsyncStorage.setItem(ASKED_KEY, "1").catch(() => undefined);
  return asked;
}

/** Lấy mã FCM đã đăng ký rồi quên nó đi (khi đăng xuất) */
export async function forgetPushToken() {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  return token;
}

/**
 * Bật thông báo: xin quyền (nếu `ask`), lấy mã FCM của máy và gửi lên máy chủ.
 * Không hỏi quyền khi `ask` = false (lúc tự động bật lại khi mở app).
 */
export async function enablePush({ ask }: { ask: boolean }): Promise<PushState> {
  if (!isNative || !PUSH_CONFIGURED) return "unavailable";
  try {
    await setupNotifications();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && ask && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return "denied";
    const { data } = await Notifications.getDevicePushTokenAsync();
    const token = String(data || "");
    if (!token) return "error";
    const res = await api.registerPush(token, Platform.OS);
    await AsyncStorage.multiSet([
      [TOKEN_KEY, token],
      [PREF_KEY, "0"],
    ]);
    return res.enabled ? "on" : "server-off";
  } catch {
    return "error";
  }
}

/** Tắt thông báo trên máy này (vẫn giữ đăng nhập) */
export async function disablePush({ remember }: { remember: boolean }) {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (token) await api.removePush(token).catch(() => undefined);
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  if (remember) await AsyncStorage.setItem(PREF_KEY, "1").catch(() => undefined);
}

/** Mã FCM của máy đổi (hiếm khi xảy ra): gửi lại mã mới cho máy chủ */
export function watchPushToken() {
  if (!isNative || !PUSH_CONFIGURED) return () => undefined;
  const sub = Notifications.addPushTokenListener(async ({ data }) => {
    const token = String(data || "");
    const old = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
    if (!token || !old || old === token) return;
    try {
      await api.removePush(old);
      await api.registerPush(token, Platform.OS);
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* thử lại lần sau mở app */
    }
  });
  return () => sub.remove();
}

/** Xóa thông báo của một cuộc trò chuyện khi đã mở nó ra xem */
export async function dismissConversation(convId: number) {
  if (!isNative) return;
  await Notifications.dismissNotificationAsync(`conv-${convId}`).catch(() => undefined);
}

export async function setBadge(count: number) {
  if (!isNative) return;
  await Notifications.setBadgeCountAsync(count).catch(() => undefined);
}

/* ---------------- Bấm vào thông báo / nút trong thông báo ---------------- */

type RawResponse = {
  actionIdentifier?: string;
  userText?: string;
  notification?: {
    date?: number;
    request?: { identifier?: string; content?: { data?: any; dataString?: string; title?: string } };
  };
};

export type NotificationAction = {
  action: "open" | "reply" | "read" | "other";
  /** Loại thông báo: message, reaction, chess, caro… */
  type: string;
  conversationId: number | null;
  /** Ván cờ (thông báo cờ vua, cờ caro) */
  gameId: number | null;
  /** Bài đăng (thông báo thả tim, bình luận) */
  postId: number | null;
  /** Giải đấu cờ vua (thông báo mời / bắt đầu / kết thúc giải) */
  tournamentId: number | null;
  text: string;
  identifier: string | null;
  title: string;
  /** Khóa riêng của lần bấm này, để không gửi trùng khi cả tác vụ nền lẫn app cùng nhận */
  key: string;
};

/** Đọc thông tin từ phản hồi thông báo (cả khi chạy nền, dữ liệu còn ở dạng chuỗi JSON) */
export function parseResponse(resp: RawResponse | null | undefined): NotificationAction | null {
  if (!resp || typeof resp !== "object") return null;
  const request = resp.notification?.request;
  const content = request?.content || {};
  let data: any = content.data;
  if ((!data || typeof data !== "object") && typeof content.dataString === "string") {
    try {
      data = JSON.parse(content.dataString);
    } catch {
      data = null;
    }
  }
  const convId = Number(data?.conversationId);
  const gameId = Number(data?.gameId);
  const postId = Number(data?.postId);
  const tournamentId = Number(data?.tournamentId);
  const id = resp.actionIdentifier || "";
  const action = id === "reply" ? "reply" : id === "read" ? "read" : id === Notifications.DEFAULT_ACTION_IDENTIFIER ? "open" : "other";
  return {
    action,
    type: typeof data?.type === "string" ? data.type : "message",
    conversationId: Number.isInteger(convId) && convId > 0 ? convId : null,
    gameId: Number.isInteger(gameId) && gameId > 0 ? gameId : null,
    postId: Number.isInteger(postId) && postId > 0 ? postId : null,
    tournamentId: Number.isInteger(tournamentId) && tournamentId > 0 ? tournamentId : null,
    text: String(resp.userText || "").trim(),
    identifier: request?.identifier || null,
    title: String(content.title || "Think"),
    key: [request?.identifier || "", id, resp.notification?.date || 0, String(resp.userText || "")].join("|"),
  };
}

const HANDLED_KEY = "think.handledActions";
const handled = new Set<string>();

/** Đánh dấu đã xử lý; trả về false nếu lần bấm này đã được xử lý trước đó */
async function claim(key: string) {
  if (handled.has(key)) return false;
  handled.add(key);
  let list: string[] = [];
  try {
    list = JSON.parse((await AsyncStorage.getItem(HANDLED_KEY)) || "[]");
  } catch {
    list = [];
  }
  if (list.includes(key)) return false;
  list.push(key);
  await AsyncStorage.setItem(HANDLED_KEY, JSON.stringify(list.slice(-30))).catch(() => undefined);
  return true;
}

/** Trả lời / Đã đọc ngay từ thông báo, không cần mở app */
export async function runQuickAction(a: NotificationAction): Promise<"ok" | "failed" | "skipped"> {
  if (!a.conversationId) return "skipped";
  if (!(await claim(a.key))) return "skipped";
  if (a.action === "reply") {
    if (!a.text) return "skipped";
    try {
      // clientId cố định theo lần bấm: gửi lại cũng không bị trùng tin
      await api.send(a.conversationId, { text: a.text.slice(0, 4000), clientId: `q${hash(a.key)}` });
      await api.read(a.conversationId).catch(() => undefined);
      if (a.identifier) await Notifications.dismissNotificationAsync(a.identifier).catch(() => undefined);
      return "ok";
    } catch {
      // Không gửi được (mất mạng, máy chủ đang ngủ...): báo lại để người dùng mở app gửi lại
      await Notifications.scheduleNotificationAsync({
        identifier: a.identifier || `conv-${a.conversationId}`,
        content: {
          title: a.title,
          body: `Chưa gửi được: “${a.text.slice(0, 120)}”. Mở app để gửi lại.`,
          data: { type: "message", conversationId: a.conversationId },
        },
        trigger: Platform.OS === "android" ? { channelId: CHANNEL_MESSAGES } : null,
      }).catch(() => undefined);
      return "failed";
    }
  }
  if (a.action === "read") {
    await api.read(a.conversationId).catch(() => undefined);
    if (a.identifier) await Notifications.dismissNotificationAsync(a.identifier).catch(() => undefined);
    return "ok";
  }
  return "skipped";
}

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
