import { describe, expect, it } from "vitest";

import {
  convTitle,
  dayLabel,
  fmtBytes,
  fold,
  imageSize,
  isEmojiOnly,
  lastSeenText,
  linkParts,
  previewText,
  reactionSummary,
  shortTime,
  systemText,
} from "../src/format";

const names = { meId: 1, nameOf: (id: number | null | undefined) => ({ 1: "Bình", 2: "Minh", 3: "Lan" } as Record<number, string>)[id ?? 0] || "Người dùng" };

describe("format", () => {
  it("bỏ dấu khi tìm kiếm", () => {
    expect(fold("  Mính Trần Đức ")).toBe("minh tran duc");
  });

  it("giờ ngắn trong danh sách", () => {
    const now = new Date(2026, 8, 28, 15, 0).getTime();
    expect(shortTime(new Date(2026, 8, 28, 9, 5).getTime(), now)).toBe("09:05");
    expect(shortTime(new Date(2026, 8, 27, 9, 5).getTime(), now)).toBe("Hôm qua");
    expect(shortTime(new Date(2026, 8, 24, 9, 5).getTime(), now)).toBe("T5");
    expect(shortTime(new Date(2026, 7, 2, 9, 5).getTime(), now)).toBe("02/08");
    expect(shortTime(new Date(2025, 7, 2, 9, 5).getTime(), now)).toBe("02/08/25");
    expect(dayLabel(new Date(2026, 8, 20).getTime(), now)).toBe("Chủ nhật, 20/9/2026");
  });

  it("lần hoạt động gần nhất", () => {
    const now = Date.now();
    expect(lastSeenText({ online: true, lastSeen: null })).toBe("Đang hoạt động");
    expect(lastSeenText({ online: false, lastSeen: now - 5 * 60000 }, now)).toBe("Hoạt động 5 phút trước");
    expect(lastSeenText({ online: false, lastSeen: now - 3 * 3600000 }, now)).toBe("Hoạt động 3 giờ trước");
  });

  it("tin hệ thống trong nhóm", () => {
    expect(systemText({ senderId: 1, text: '{"event":"create"}' }, names)).toBe("Bạn đã tạo nhóm");
    expect(systemText({ senderId: 2, text: '{"event":"add","targets":[1,3]}' }, names)).toBe("Minh đã thêm bạn và Lan vào nhóm");
    expect(systemText({ senderId: 2, text: '{"event":"rename","name":"Đà Lạt"}' }, names)).toBe("Minh đã đổi tên nhóm thành “Đà Lạt”");
  });

  it("dòng xem trước", () => {
    const base = { id: 5, conversationId: 1, kind: "text" as const, image: null, deleted: false, createdAt: 0, replyTo: null, reactions: [] };
    expect(previewText({ ...base, senderId: 1, text: "Chào" }, { type: "dm" }, names)).toBe("Bạn: Chào");
    expect(previewText({ ...base, senderId: 2, text: "Chào\n  cả nhà" }, { type: "group" }, names)).toBe("Minh: Chào cả nhà");
    expect(previewText({ ...base, senderId: 2, text: "Ok" }, { type: "dm" }, names)).toBe("Ok");
    expect(previewText({ ...base, senderId: 2, text: null, image: "/uploads/img/a.jpg" }, { type: "dm" }, names)).toBe("Đã gửi một ảnh");
    expect(previewText({ ...base, senderId: 2, text: null, deleted: true }, { type: "general" }, names)).toBe("Minh: Tin nhắn đã được thu hồi");
    expect(convTitle({ type: "dm", name: null, peerId: 3 }, names.nameOf)).toBe("Lan");
    expect(convTitle({ type: "general", name: null, peerId: null }, names.nameOf)).toBe("Cả nhóm");
  });

  it("tin chỉ có biểu tượng cảm xúc", () => {
    expect(isEmojiOnly("😆")).toBe(true);
    expect(isEmojiOnly("❤️👍")).toBe(true);
    expect(isEmojiOnly("👨‍👩‍👧")).toBe(true);
    expect(isEmojiOnly("😆😆😆😆")).toBe(false);
    expect(isEmojiOnly("ok 😆")).toBe(false);
    expect(isEmojiOnly("123")).toBe(false);
  });

  it("tách đường link", () => {
    expect(linkParts("Xem https://thinkchat.id.vn/a, nhé")).toEqual([
      { text: "Xem " },
      { text: "https://thinkchat.id.vn/a", url: "https://thinkchat.id.vn/a" },
      { text: ", nhé" },
    ]);
  });

  it("kích thước ảnh trong tên file, dung lượng, cảm xúc", () => {
    expect(imageSize("/uploads/img/abc_800x600.jpg")).toEqual({ w: 800, h: 600 });
    expect(imageSize("/uploads/img/abc.jpg")).toBeNull();
    expect(fmtBytes(1536)).toBe("2 KB");
    expect(fmtBytes(5.25 * 1024 * 1024)).toBe("5,3 MB");
    expect(reactionSummary([{ userId: 2, emoji: "👍" }, { userId: 3, emoji: "👍" }, { userId: 1, emoji: "❤️" }], 1)).toEqual({
      top: ["👍", "❤️"],
      total: 3,
      mine: "❤️",
    });
  });
});
