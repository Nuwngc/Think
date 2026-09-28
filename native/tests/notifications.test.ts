/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
vi.mock("expo-notifications", () => ({ DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT", setNotificationHandler: vi.fn() }));
vi.mock("../src/api", () => ({ api: {} }));
vi.mock("../src/config", () => ({ PUSH_CONFIGURED: true }));

import { parseResponse } from "../src/notifications";

describe("phản hồi thông báo", () => {
  it("đọc dữ liệu khi app đang mở (data đã là object)", () => {
    const a = parseResponse({
      actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
      notification: { date: 5, request: { identifier: "conv-12", content: { title: "Minh", data: { conversationId: 12 } } } },
    });
    expect(a).toMatchObject({ action: "open", conversationId: 12, identifier: "conv-12", title: "Minh" });
  });

  it("đọc dữ liệu trong tác vụ nền (data còn là chuỗi JSON)", () => {
    const a = parseResponse({
      actionIdentifier: "reply",
      userText: "  Ok nha  ",
      notification: { date: 9, request: { identifier: "conv-3", content: { dataString: '{"type":"message","conversationId":3}' } } },
    });
    expect(a).toMatchObject({ action: "reply", conversationId: 3, text: "Ok nha" });
    expect(a?.key).toBe("conv-3|reply|9|  Ok nha  ");
  });

  it("đọc thông báo cờ vua (không có cuộc trò chuyện, có ván cờ)", () => {
    const a = parseResponse({
      actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
      notification: { date: 4, request: { identifier: "chess-g-7", content: { dataString: '{"type":"chess","gameId":7}' } } },
    });
    expect(a).toMatchObject({ action: "open", type: "chess", gameId: 7, conversationId: null });
  });

  it("bỏ qua dữ liệu hỏng", () => {
    expect(parseResponse(null)).toBeNull();
    expect(parseResponse({ actionIdentifier: "read", notification: { request: { content: { dataString: "{hỏng" } } } })?.conversationId).toBeNull();
  });
});
