import { describe, expect, it } from "vitest";

import { afterBackground, isGated, leaveUnlocked, LOCK_MAX, LOCK_MIN, lockLengthOk, RELOCK_MS } from "../src/chatLock";
import { listPreview, LOCKED_PREVIEW, previewText, systemText } from "../src/format";
import type { Conversation, Message } from "../src/types";

const names = { meId: 1, nameOf: (id: number | null | undefined) => (({ 1: "An", 2: "Bình" }) as Record<number, string>)[id ?? 0] || "Người dùng" };
const conv = (patch: Partial<Conversation> = {}) => ({ id: 5, type: "dm", name: null, peerId: 2, locked: false, ...patch }) as unknown as Conversation;
const msg = (patch: Partial<Message> = {}) => ({ id: 1, conversationId: 5, senderId: 2, kind: "text", text: "mật mã 42", createdAt: 1, ...patch }) as Message;

describe("khóa cuộc trò chuyện", () => {
  const now = 1_000_000;
  it("chỉ chặn cuộc trò chuyện đã khóa mà chưa mở khóa", () => {
    expect(isGated(conv(), {}, now)).toBe(false);
    expect(isGated(conv({ locked: true }), {}, now)).toBe(true);
    expect(isGated(conv({ locked: true }), { 5: Infinity }, now)).toBe(false);
    expect(isGated(conv({ locked: true }), { 5: now + 10 }, now)).toBe(false); // vừa rời, chưa quá 2 phút
    expect(isGated(conv({ locked: true }), { 5: now - 1 }, now)).toBe(true); // hết hạn
    expect(isGated(undefined, {}, now)).toBe(false);
  });

  it("rời cuộc trò chuyện: còn xem lại được 2 phút; chạy nền lâu thì khóa lại hết", () => {
    const open = { 5: Infinity, 7: now + 5 };
    const left = leaveUnlocked(open, 5, now);
    expect(left[5]).toBe(now + RELOCK_MS);
    expect(left[7]).toBe(now + 5);
    expect(leaveUnlocked(open, 9, now)).toBe(open); // không đổi
    expect(leaveUnlocked(open, null, now)).toBe(open);
    expect(afterBackground(open, now - RELOCK_MS - 1, now)).toEqual({});
    expect(afterBackground(open, now - 1000, now)).toBe(open);
    expect(afterBackground(open, 0, now)).toBe(open);
  });

  it("độ dài mật khẩu khóa giống máy chủ (4–32 ký tự, tính cả chữ có dấu)", () => {
    expect([LOCK_MIN, LOCK_MAX]).toEqual([4, 32]);
    expect(lockLengthOk("123")).toBe(false);
    expect(lockLengthOk("1234")).toBe(true);
    expect(lockLengthOk("mèo🐱")).toBe(true);
    expect(lockLengthOk("x".repeat(33))).toBe(false);
  });

  it("danh sách ẩn nội dung cuộc trò chuyện đã khóa; thông báo, bong bóng chat vẫn đầy đủ", () => {
    expect(listPreview(msg(), conv(), names)).toBe("mật mã 42");
    expect(listPreview(msg(), conv({ locked: true }), names)).toBe(LOCKED_PREVIEW);
    expect(listPreview(msg({ kind: "system", text: '{"event":"rename","name":"X"}' }), conv({ locked: true, type: "group" }), names)).toBe(LOCKED_PREVIEW);
    // Thông báo nhỏ, thông báo trên máy, bong bóng chat dùng previewText: vẫn có nội dung
    expect(previewText(msg(), conv({ locked: true }), names)).toBe("mật mã 42");
  });

  it("tin hệ thống đổi / xóa ảnh nhóm", () => {
    expect(systemText({ senderId: 2, text: '{"event":"avatar"}' }, names)).toBe("Bình đã đổi ảnh nhóm");
    expect(systemText({ senderId: 1, text: '{"event":"avatar","removed":true}' }, names)).toBe("Bạn đã xóa ảnh nhóm");
  });
});
