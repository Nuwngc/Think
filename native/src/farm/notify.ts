import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { CHANNEL_OTHER, pushTurnedOff } from "../notifications";

// Nhắc khi cả ruộng đã chín (thông báo hẹn giờ ngay trên máy, không cần máy chủ).
// Mỗi lần nông trại đổi thì hẹn lại; cây đã thu / chưa gieo gì / đăng xuất thì hủy.
// Các lần gọi chạy lần lượt, lần sau thay lần trước (không hẹn nhầm giờ cũ sau khi đã hủy).

const ID = "farm-ready";
/** Giờ đang hẹn (null = không hẹn, undefined = chưa biết, vd vừa mở app) */
let last: number | null | undefined;
let wanted: number | null = null;
let chain: Promise<void> = Promise.resolve();

async function apply(when: number | null) {
  if (when !== wanted || when === last) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(ID).catch(() => undefined);
    last = null;
    if (!when) return;
    if (await pushTurnedOff()) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted || when !== wanted) return; // chưa cho phép thì lần sau thử lại
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title: "Nông trại",
        body: "Cả ruộng đã chín rồi, ra thu hoạch thôi! 🌾",
        data: { type: "farm" },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(when), channelId: CHANNEL_OTHER },
    });
    last = when;
  } catch {
    last = undefined; // lần sau thử lại
  }
}

/** at: giờ trên máy lúc cả ruộng chín (null = hủy) */
export function scheduleFarmReady(at: number | null, now = Date.now()) {
  if (Platform.OS === "web") return Promise.resolve();
  // Quá gần thì thôi (đang chơi, tự thấy)
  wanted = at && at - now > 60 * 1000 ? at : null;
  const when = wanted;
  chain = chain.then(() => apply(when)).catch(() => undefined);
  return chain;
}

export function cancelFarmReady() {
  return scheduleFarmReady(null);
}
