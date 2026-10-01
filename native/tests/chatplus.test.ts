import { describe, expect, it } from "vitest";

import { applyMention, byPinnedThenActivity, mentionIds, mentionParts, mentionToken, pollPercents } from "../src/chatPlus";
import { DEFAULT_EMOJI, emojiOf, isMuted, THEMES, themeOf } from "../src/chatThemes";
import { messageSummary, previewText, systemText } from "../src/format";
import type { Conversation, Message } from "../src/types";

const names = { meId: 1, nameOf: (id: number | null | undefined) => ({ 1: "Bình", 2: "Minh", 3: "Lan Anh", 4: "Lan" } as Record<number, string>)[id ?? 0] || "Người dùng" };

const conv = (id: number, patch: Partial<Conversation> = {}) =>
  ({ id, type: "group", name: `Nhóm ${id}`, createdAt: id * 10, unread: 0, lastMessage: null, ...patch }) as unknown as Conversation;

const msg = (patch: Partial<Message>) => ({ id: 1, conversationId: 1, senderId: 2, kind: "text", text: "", createdAt: 1, ...patch }) as Message;

describe("chủ đề & biểu tượng nhanh", () => {
  it("chủ đề lạ hoặc trống dùng chủ đề Think", () => {
    expect(themeOf(null).id).toBe("default");
    expect(themeOf({ theme: "khong-co" }).id).toBe("default");
    expect(themeOf({ theme: "ocean" }).name).toBe("Đại dương");
  });

  it("mã chủ đề khớp với bản web", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["default", "ocean", "sunset", "grape", "forest", "candy", "night", "fire", "gold", "mono", "love", "mint"]);
    for (const t of THEMES) {
      expect(t.a).toMatch(/^#[0-9A-F]{6}$/i);
      expect(t.b).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("biểu tượng gửi nhanh mặc định là 👍", () => {
    expect(emojiOf(undefined)).toBe(DEFAULT_EMOJI);
    expect(emojiOf({ emoji: "🔥" })).toBe("🔥");
  });
});

describe("tắt thông báo", () => {
  const now = 1_000_000;
  it("tắt có hạn, vĩnh viễn, hết hạn", () => {
    expect(isMuted({ mutedUntil: now + 1 }, now)).toBe(true);
    expect(isMuted({ mutedUntil: -1 }, now)).toBe(true);
    expect(isMuted({ mutedUntil: now - 1 }, now)).toBe(false);
    expect(isMuted({ mutedUntil: 0 }, now)).toBe(false);
    expect(isMuted({}, now)).toBe(false);
    expect(isMuted(null, now)).toBe(false);
  });
});

describe("ghim cuộc trò chuyện", () => {
  it("ghim lên đầu (mới ghim trước), còn lại theo tin mới nhất", () => {
    const list = [
      conv(1, { lastMessage: msg({ createdAt: 500 }) }),
      conv(2, { pinnedAt: 100, lastMessage: msg({ createdAt: 10 }) }),
      conv(3, { lastMessage: msg({ createdAt: 900 }) }),
      conv(4, { pinnedAt: 300 }),
      conv(5),
    ].sort(byPinnedThenActivity);
    expect(list.map((c) => c.id)).toEqual([4, 2, 3, 1, 5]);
  });
});

describe("nhắc tên @", () => {
  it("nhận ra chữ đang gõ sau @ ở cuối ô nhập", () => {
    expect(mentionToken("@")).toBe("");
    expect(mentionToken("chào @Mi")).toBe("Mi");
    expect(mentionToken("email@abc")).toBeNull();
    expect(mentionToken("chào @Minh xong")).toBeNull();
    expect(mentionToken("không có gì")).toBeNull();
  });

  it("chọn người thay chữ đang gõ bằng tên đầy đủ", () => {
    expect(applyMention("chào @mi", "Minh")).toBe("chào @Minh ");
    expect(applyMention("@", "Lan Anh")).toBe("@Lan Anh ");
  });

  it("chỉ gửi người còn tên trong tin, không trùng", () => {
    const picks = { Minh: 2, "Lan Anh": 3, Lan: 4 };
    expect(mentionIds(picks, "@Minh ơi @Minh").sort()).toEqual([2]);
    expect(mentionIds(picks, "@Lan Anh đâu").sort()).toEqual([3, 4]);
    expect(mentionIds(picks, "không nhắc ai")).toEqual([]);
  });

  it("tô màu đúng đoạn @Tên, ưu tiên tên dài hơn", () => {
    const parts = mentionParts("Ê @Lan Anh và @Bình ơi", [4, 3, 1], names.nameOf, 1);
    expect(parts).toEqual([
      { text: "Ê ", mention: false, me: false },
      { text: "@Lan Anh", mention: true, me: false },
      { text: " và ", mention: false, me: false },
      { text: "@Bình", mention: true, me: true },
      { text: " ơi", mention: false, me: false },
    ]);
    expect(mentionParts("Không ai", undefined, names.nameOf, 1)).toEqual([{ text: "Không ai", mention: false, me: false }]);
  });
});

describe("bình chọn", () => {
  it("phần trăm theo số người đã bầu", () => {
    expect(pollPercents([{ votes: [1, 2] }, { votes: [2] }, { votes: [] }])).toEqual({ voters: 2, percents: [100, 50, 0] });
    expect(pollPercents([{ votes: [] }, { votes: [] }])).toEqual({ voters: 0, percents: [0, 0] });
  });

  it("xem trước tin bình chọn trong danh sách", () => {
    const m = msg({ kind: "poll" as Message["kind"], text: "Đi đâu\nchơi?", senderId: 2 });
    expect(messageSummary(m, names)).toBe("📊 Đi đâu chơi?");
    expect(previewText(m, { type: "group" }, names)).toBe("Minh: 📊 Đi đâu chơi?");
  });
});

describe("tin hệ thống mới", () => {
  it("ghim tin, đổi chủ đề, đổi biểu tượng", () => {
    expect(systemText({ senderId: 2, text: JSON.stringify({ event: "pin", text: "Hẹn 7h" }) }, names)).toBe("Minh đã ghim một tin nhắn: “Hẹn 7h”");
    expect(systemText({ senderId: 1, text: JSON.stringify({ event: "pin", image: true }) }, names)).toBe("Bạn đã ghim một tin nhắn (ảnh)");
    expect(systemText({ senderId: 2, text: JSON.stringify({ event: "theme", theme: "ocean", name: "Đại dương" }) }, names)).toBe(
      "Minh đã đổi chủ đề thành Đại dương",
    );
    expect(systemText({ senderId: 1, text: JSON.stringify({ event: "emoji", emoji: "🔥" }) }, names)).toBe("Bạn đã đổi biểu tượng cảm xúc nhanh thành 🔥");
    expect(systemText({ senderId: 1, text: JSON.stringify({ event: "la" }) }, names)).toBe("Cuộc trò chuyện vừa được cập nhật");
  });
});
