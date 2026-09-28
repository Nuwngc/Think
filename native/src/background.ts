import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { NOTIFICATION_TASK, parseResponse, runQuickAction } from "./notifications";

// Chạy khi bấm nút Trả lời / Đã đọc trong thông báo lúc app đang chạy nền hoặc đã tắt.
// Phải được khai báo ngay khi nạp app (index.ts nạp file này đầu tiên).
if (Platform.OS !== "web") {
  TaskManager.defineTask(NOTIFICATION_TASK, async ({ data, error }) => {
    if (error || !data || typeof data !== "object" || !("actionIdentifier" in data)) return;
    const action = parseResponse(data as any);
    if (action && (action.action === "reply" || action.action === "read")) await runQuickAction(action);
  });
}
