import { describe, expect, it } from "vitest";

import { callInfoOf, systemText } from "../src/format";
import type { Message } from "../src/types";

// Nhật ký cuộc gọi trong cuộc trò chuyện (máy chủ: src/calls.js) — chữ giống bản web (callText trong public/app.js)
const names = { meId: 1, nameOf: (id: number | null | undefined) => (({ 1: "An", 2: "Bình" }) as Record<number, string>)[id ?? 0] || "Người dùng" };
const call = (data: object, senderId = 1) => ({ id: 9, conversationId: 5, senderId, kind: "system", text: JSON.stringify({ event: "call", ...data }), createdAt: 1 }) as Message;

describe("nhật ký cuộc gọi", () => {
  it("cuộc gọi đã nghe: hiện thời lượng", () => {
    expect(systemText(call({ video: false, status: "ended", duration: 151, to: 2 }), names)).toBe("📞 Cuộc gọi thoại · 2:31");
    expect(systemText(call({ video: true, status: "ended", duration: 3725, to: 2 }), names)).toBe("📹 Cuộc gọi video · 1:02:05");
  });

  it("từ chối, nhỡ: chữ khác nhau cho người gọi và người nghe", () => {
    expect(systemText(call({ video: false, status: "declined", to: 2 }), names)).toBe("📞 Bình đã từ chối cuộc gọi thoại");
    expect(systemText(call({ video: false, status: "declined", to: 1 }, 2), names)).toBe("📞 Bạn đã từ chối cuộc gọi thoại");
    expect(systemText(call({ video: true, status: "missed", to: 2 }), names)).toBe("📹 Cuộc gọi video không được trả lời");
    expect(systemText(call({ video: true, status: "missed", to: 1 }, 2), names)).toBe("📹 Bạn đã lỡ cuộc gọi video từ Bình");
  });

  it("gọi nhóm: thời lượng, số người; không ai tham gia / lỡ cuộc gọi", () => {
    const g = (data: object, senderId = 1) => ({ ...call({}, senderId), text: JSON.stringify({ event: "gcall", ...data }) }) as Message;
    expect(systemText(g({ video: false, status: "ended", duration: 754, count: 4 }), names)).toBe("📞 Cuộc gọi nhóm · 12:34 · 4 người");
    expect(systemText(g({ video: true, status: "missed", count: 1 }), names)).toBe("📹 Cuộc gọi video nhóm không có ai tham gia");
    expect(systemText(g({ video: false, status: "missed", count: 1 }, 2), names)).toBe("📞 Bạn đã lỡ cuộc gọi nhóm của Bình");
    expect(callInfoOf(g({ video: true, status: "ended" }))).toEqual({ video: true });
  });

  it("nhận ra tin nhật ký cuộc gọi để hiện nút Gọi lại", () => {
    expect(callInfoOf(call({ video: true, status: "missed" }))).toEqual({ video: true });
    expect(callInfoOf(call({ status: "ended" }))).toEqual({ video: false });
    expect(callInfoOf({ kind: "system", text: JSON.stringify({ event: "rename", name: "call" }) })).toBeNull();
    expect(callInfoOf({ kind: "text", text: '{"event":"call"}' })).toBeNull();
    expect(callInfoOf({ kind: "system", text: "hỏng" })).toBeNull();
  });
});
