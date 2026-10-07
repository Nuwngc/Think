/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Tin 24 giờ (2.13.0): thứ tự hàng vòng tròn, xem / chuyển tin, sự kiện realtime — giống public/stories-ui.js
const api = vi.hoisted(() => ({
  stories: vi.fn(),
  createStory: vi.fn(),
  deleteStory: vi.fn(),
  viewStory: vi.fn(() => Promise.resolve({ ok: true })),
  replyStory: vi.fn(() => Promise.resolve({})),
  uploadImage: vi.fn(),
}));
vi.mock("../src/api", () => ({ api }));

import { previewText } from "../src/format";
import { STORY_BGS, storyAgo, textMs } from "../src/stories/bgs";
import {
  bindStories,
  closeStories,
  deleteStory,
  loadStories,
  nextStory,
  onStoryEvent,
  openStories,
  postStory,
  prevStory,
  reactStory,
  resetStories,
  storyGroups,
  useStories,
} from "../src/stories/store";
import type { Message, Story } from "../src/types";

const NOW = Date.now();
const st = (id: number, userId: number, extra: Partial<Story> = {}): Story => ({
  id,
  userId,
  kind: "text",
  image: null,
  text: `tin ${id}`,
  bg: "jade",
  createdAt: NOW - 3600_000 + id * 1000,
  expiresAt: NOW + 3600_000,
  seen: false,
  ...extra,
});

beforeEach(() => {
  resetStories();
  bindStories({ meId: () => 1 });
  vi.clearAllMocks();
});

describe("thứ tự hàng vòng tròn", () => {
  it("tin của mình trước, người có tin chưa xem (mới nhất trước), rồi người đã xem hết; bỏ tin hết hạn", () => {
    const map: Record<number, Story> = {};
    for (const s of [st(1, 2, { seen: true }), st(2, 3), st(3, 1, { seen: true }), st(4, 4), st(5, 5, { expiresAt: NOW - 1 }), st(6, 2, { seen: true })])
      map[s.id] = s;
    const g = storyGroups(map, 1, NOW);
    expect(g.map((x) => x.userId)).toEqual([1, 4, 3, 2]);
    expect(g[3].stories.map((s) => s.id)).toEqual([1, 6]);
    expect(g[3].unseen).toBe(false);
  });
});

describe("xem tin", () => {
  beforeEach(async () => {
    api.stories.mockResolvedValueOnce({
      stories: [st(1, 2, { seen: true }), st(2, 2), st(3, 3, { createdAt: NOW - 7200_000 }), st(4, 1, { seen: true })],
      serverTime: NOW,
    });
    await loadStories();
  });

  it("mở ở tin chưa xem đầu tiên, đi tiếp sang người sau, hết thì đóng", () => {
    expect(openStories(2)).toBe(true);
    expect(useStories.getState().viewer).toEqual({ queue: [2, 3], gi: 0, si: 1 });
    nextStory();
    expect(useStories.getState().viewer).toEqual({ queue: [2, 3], gi: 1, si: 0 });
    prevStory();
    expect(useStories.getState().viewer).toEqual({ queue: [2, 3], gi: 0, si: 0 });
    nextStory();
    nextStory();
    nextStory();
    expect(useStories.getState().viewer).toBeNull();
  });

  it("tin của mình xem riêng; mở đúng một tin từ tin nhắn trả lời", () => {
    openStories(1);
    expect(useStories.getState().viewer?.queue).toEqual([1]);
    openStories(3, 3);
    expect(useStories.getState().viewer).toEqual({ queue: [2, 3], gi: 1, si: 0 });
    expect(openStories(9)).toBe(false);
    closeStories();
    expect(useStories.getState().viewer).toBeNull();
  });

  it("thả cảm xúc, xóa tin đang xem", async () => {
    await reactStory(useStories.getState().stories[2], "❤️");
    expect(api.replyStory).toHaveBeenCalledWith(2, { emoji: "❤️" });
    expect(useStories.getState().stories[2].myReaction).toBe("❤️");
    openStories(1);
    api.deleteStory.mockResolvedValueOnce({ ok: true });
    await deleteStory(4);
    expect(useStories.getState().stories[4]).toBeUndefined();
    expect(useStories.getState().viewer).toBeNull(); // hết tin của mình thì đóng
  });

  it("sự kiện realtime: tin mới, đã xem, bị xóa", () => {
    onStoryEvent("story:new", { story: st(7, 3) });
    onStoryEvent("story:new", { story: st(8, 1) }); // tin mình đăng ở máy khác
    expect(useStories.getState().stories[7].seen).toBe(false);
    expect(useStories.getState().stories[8]).toMatchObject({ seen: true, views: 0 });
    onStoryEvent("story:viewed", { storyId: 8, views: 2, reaction: { userId: 3, emoji: "😂" } });
    expect(useStories.getState().stories[8]).toMatchObject({ views: 2, reactions: 1 });
    openStories(3, 7);
    onStoryEvent("story:deleted", { storyId: 7, userId: 3 });
    expect(useStories.getState().stories[7]).toBeUndefined();
    // Người 3 vừa có tin mới nên đứng trước; xóa tin đang xem thì về tin còn lại của người đó
    expect(useStories.getState().viewer).toEqual({ queue: [3, 2], gi: 0, si: 0 });
  });
});

describe("đăng tin, chữ", () => {
  it("tin ảnh: tải ảnh lên trước rồi đăng kèm chú thích", async () => {
    api.uploadImage.mockResolvedValueOnce({ url: "/uploads/img/x.jpg" });
    api.createStory.mockResolvedValueOnce({ story: st(10, 1, { kind: "image", image: "/uploads/img/x.jpg", seen: true }) });
    await postStory({ text: "Đi biển", image: { uri: "file://a.jpg", width: 900, height: 1600, mime: "image/jpeg" } });
    expect(api.createStory).toHaveBeenCalledWith({ image: "/uploads/img/x.jpg", text: "Đi biển" });
    expect(useStories.getState().stories[10].kind).toBe("image");
  });

  it("thời gian, màu, chữ xem trước khi thả cảm xúc", () => {
    expect(textMs("ngắn")).toBe(5000);
    expect(textMs("a".repeat(250))).toBe(10000);
    expect(Object.keys(STORY_BGS)).toEqual(["jade", "sunset", "berry", "ocean", "grape", "night"]); // giống src/stories.js
    expect(storyAgo(NOW - 30_000, NOW)).toBe("Vừa xong");
    expect(storyAgo(NOW - 5 * 60_000, NOW)).toBe("5 phút");
    expect(storyAgo(NOW - 3 * 3600_000, NOW)).toBe("3 giờ");
    const names = { meId: 1, nameOf: (id: number | null | undefined) => (id === 2 ? "Bình" : "An") };
    const m = (senderId: number, ownerId: number) =>
      ({
        id: 1,
        conversationId: 5,
        senderId,
        kind: "text",
        text: "❤️",
        image: null,
        deleted: false,
        createdAt: 1,
        replyTo: null,
        reactions: [],
        story: { id: 3, ownerId, kind: "text", image: null, text: "x", bg: "jade", reaction: true, alive: true },
      }) as Message;
    expect(previewText(m(2, 1), { type: "dm" }, names)).toBe("Đã bày tỏ cảm xúc ❤️ về tin của bạn");
    expect(previewText(m(1, 2), { type: "dm" }, names)).toBe("Bạn đã bày tỏ cảm xúc ❤️ về tin của Bình");
  });
});
