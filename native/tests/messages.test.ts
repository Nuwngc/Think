import { describe, expect, it } from "vitest";

import { lastServerId, mergeLatestPage, mergeMessages, quoteOf, receiveMessage, toggleReaction } from "../src/messages";
import type { ChatItem, Message, PendingMessage } from "../src/types";

const msg = (id: number, extra: Partial<Message> = {}): Message => ({
  id,
  conversationId: 1,
  senderId: 2,
  kind: "text",
  text: `m${id}`,
  image: null,
  deleted: false,
  createdAt: id * 1000,
  replyTo: null,
  reactions: [],
  ...extra,
});
const pending = (clientId: string): PendingMessage => ({
  id: null,
  clientId,
  conversationId: 1,
  senderId: 1,
  kind: "text",
  text: "đang gửi",
  image: null,
  deleted: false,
  createdAt: Date.now(),
  replyTo: null,
  reactions: [],
  status: "sending",
});
const ids = (list: ChatItem[]) => list.map((m) => m.id ?? `c:${(m as PendingMessage).clientId}`);

describe("messages", () => {
  it("gộp theo mã, tin đang gửi ở cuối, bản mới thay bản cũ", () => {
    const list: ChatItem[] = [msg(1), msg(3), pending("a")];
    const out = mergeMessages(list, [msg(2), msg(3, { text: "sửa" })]);
    expect(ids(out)).toEqual([1, 2, 3, "c:a"]);
    expect(out[2].text).toBe("sửa");
  });

  it("tin mình gửi quay về thay bản tạm", () => {
    const res = receiveMessage([msg(1), pending("a")], msg(2, { clientId: "a", senderId: 1 }));
    expect(ids(res.list)).toEqual([1, 2]);
    expect(res.isNew).toBe(false);
    const again = receiveMessage(res.list, msg(2, { clientId: "a", senderId: 1 }));
    expect(ids(again.list)).toEqual([1, 2]);
    expect(receiveMessage([msg(1)], msg(4)).isNew).toBe(true);
  });

  it("trang mới nhất: nối liền thì gộp, hở thì bỏ bản lưu cũ", () => {
    const saved: ChatItem[] = [msg(10), msg(11), msg(12), pending("p")];
    expect(ids(mergeLatestPage(saved, [msg(12), msg(13)], true))).toEqual([10, 11, 12, 13, "c:p"]);
    expect(ids(mergeLatestPage(saved, [msg(50), msg(51)], true))).toEqual([50, 51, "c:p"]);
    expect(ids(mergeLatestPage(saved, [msg(50), msg(51)], false))).toEqual([10, 11, 12, 50, 51, "c:p"]);
    expect(lastServerId(saved)).toBe(12);
  });

  it("bấm lại cảm xúc cũ thì gỡ, chọn cái khác thì đổi", () => {
    const list = [{ userId: 1, emoji: "👍" }, { userId: 2, emoji: "❤️" }];
    expect(toggleReaction(list, 1, "👍")).toEqual([{ userId: 2, emoji: "❤️" }]);
    expect(toggleReaction(list, 1, "😆")).toEqual([{ userId: 2, emoji: "❤️" }, { userId: 1, emoji: "😆" }]);
    expect(toggleReaction(list, 3, "👍")).toHaveLength(3);
  });

  it("trích dẫn ngắn gọn", () => {
    const q = quoteOf(msg(7, { text: "dòng 1\n\n  dòng 2" }));
    expect(q).toEqual({ id: 7, senderId: 2, deleted: false, missing: false, text: "dòng 1 dòng 2", image: false, audio: false });
    // Trả lời tin nhắn thoại
    const v = quoteOf(msg(8, { kind: "voice", text: null, audio: { url: "/uploads/audio/a.m4a", ms: 3000, wave: "abc" } }));
    expect([v.audio, v.image, v.text]).toEqual([true, false, null]);
  });
});
