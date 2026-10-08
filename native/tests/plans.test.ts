/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Kèo và hẹn giờ gửi tin (2.16.0): chữ giờ hẹn giống bản web (public/plans-core.js); store gọi đúng API
const api = vi.hoisted(() => ({
  rsvp: vi.fn(),
  cancelEvent: vi.fn(),
  createEvent: vi.fn(),
  scheduled: vi.fn(),
  schedule: vi.fn(),
  cancelScheduled: vi.fn(),
  sendScheduled: vi.fn(),
}));
vi.mock("../src/api", () => ({ api }));

import * as P from "../src/plans/core";
import { bindPlans, cancelScheduled, onScheduledEvent, resetPlans, rsvp, scheduledIn, scheduleMessage, sendScheduledNow, usePlans } from "../src/plans/store";
import type { Message } from "../src/types";

const require = createRequire(import.meta.url);
const web = require("../../public/plans-core.js");

describe("chữ giờ hẹn: bản app giống bản web", () => {
  const now = new Date(2026, 9, 8, 10, 52).getTime(); // thứ Năm 8/10/2026 10:52
  it("whenText, untilText, dateBlock, phase, presets", () => {
    const times = [
      now + 60_000,
      now + 25 * 60_000,
      now + 80 * 60_000,
      now + 5 * 3600_000,
      now + 30 * 3600_000,
      now + 9 * 86400_000,
      now - 86400_000,
      new Date(2027, 0, 3, 9).getTime(),
    ];
    for (const t of times) {
      expect(P.whenText(t, now)).toBe(web.whenText(t, now));
      expect(P.untilText(t, now)).toBe(web.untilText(t, now));
      expect(P.dateBlock(t)).toEqual(web.dateBlock(t));
      expect(P.eventPhase({ startsAt: t, canceled: false }, now)).toBe(web.eventPhase({ startsAt: t, canceled: false }, now));
    }
    for (const n of [now, new Date(2026, 9, 10, 21, 0).getTime(), new Date(2026, 9, 11, 8, 0).getTime(), new Date(2026, 9, 8, 19, 55).getTime()]) {
      expect(P.eventPresets(n)).toEqual(web.eventPresets(n));
      expect(P.schedulePresets(n)).toEqual(web.schedulePresets(n));
    }
    for (const names of [[], ["An"], ["An", "Bình"], ["An", "Bình", "Chi"], ["An", "Bình", "Chi", "Dũng", "Em"]])
      expect(P.peopleText(names)).toBe(web.peopleText(names));
  });

  it("ví dụ cụ thể", () => {
    expect(P.whenText(new Date(2026, 9, 9, 19).getTime(), now)).toBe("19:00 ngày mai");
    expect(P.whenText(new Date(2026, 9, 10, 19).getTime(), now)).toBe("19:00 thứ Bảy 10/10");
    expect(P.untilText(now + 80 * 60_000, now)).toBe("còn 1 giờ 20 phút");
    expect(P.dateBlock(new Date(2026, 9, 10, 19).getTime())).toEqual({ wd: "T7", day: "10", month: "Th10" });
    expect(P.eventPhase({ startsAt: now + 30 * 60_000, canceled: false }, now)).toBe("soon");
    expect(P.eventPhase({ startsAt: now + 30 * 60_000, canceled: true }, now)).toBe("canceled");
    expect(P.eventPresets(now).map((p) => p.label)).toEqual(["Tối nay 20:00", "Tối mai 19:00", "Thứ Bảy 19:00", "Chủ nhật 9:00"]);
    // Thứ Bảy 21:00: "Thứ Bảy 19:00" là thứ Bảy tuần sau
    const sat = new Date(2026, 9, 10, 21).getTime();
    expect(P.eventPresets(sat).find((p) => p.label === "Thứ Bảy 19:00")?.at).toBe(new Date(2026, 9, 17, 19).getTime());
    // 19:55 thì "Tối nay 20:00" đã quá gần
    expect(P.schedulePresets(new Date(2026, 9, 8, 19, 55).getTime()).map((p) => p.label)).toEqual(["Sau 1 tiếng", "Sáng mai 8:00"]);
    expect(P.peopleText(["Bạn", "Bình", "Chi", "Dũng"])).toBe("Bạn, Bình và 2 người khác");
  });
});

describe("store kèo, hẹn giờ", () => {
  const updated: Message[] = [];
  const received: Message[] = [];
  const toasts: string[] = [];
  beforeEach(() => {
    resetPlans();
    vi.clearAllMocks();
    updated.length = 0;
    received.length = 0;
    toasts.length = 0;
    bindPlans({ meId: () => 7, current: () => undefined, receive: (m) => received.push(m), updated: (m) => updated.push(m), toast: (t) => toasts.push(t) });
  });

  const keo = (): Message =>
    ({
      id: 50,
      conversationId: 3,
      senderId: 2,
      kind: "event",
      text: "Đi ăn lẩu",
      event: { place: "", startsAt: Date.now() + 86400_000, canceled: false, yes: [2], maybe: [], no: [7] },
    }) as unknown as Message;

  it("Đi / Có thể / Không đi: hiện ngay, lỗi thì trả lại", async () => {
    const m = keo();
    api.rsvp.mockResolvedValueOnce({ message: { ...m, event: { ...m.event!, yes: [2, 7], no: [] } } });
    await rsvp(m, "yes");
    expect(updated[0].event).toMatchObject({ yes: [2, 7], no: [] }); // lạc quan
    expect(api.rsvp).toHaveBeenCalledWith(50, "yes");
    api.rsvp.mockRejectedValueOnce(new Error("Kèo đã diễn ra rồi."));
    await rsvp(m, "maybe");
    expect(updated.at(-1)!.event).toEqual(m.event);
    expect(toasts).toEqual(["Kèo đã diễn ra rồi."]);
  });

  it("danh sách hẹn giờ: hẹn, hủy, gửi ngay", async () => {
    const a = { id: 1, conversationId: 3, text: "A", sendAt: 1, createdAt: 0, mentions: [] };
    const b = { id: 2, conversationId: 4, text: "B", sendAt: 2, createdAt: 0, mentions: [] };
    onScheduledEvent({ scheduled: [a, b] });
    expect(scheduledIn(usePlans.getState().scheduled, 3)).toEqual([a]);
    api.schedule.mockResolvedValueOnce({ scheduled: [a, b, { ...a, id: 3 }], item: null });
    await scheduleMessage(3, "C", 99, [5]);
    expect(api.schedule).toHaveBeenCalledWith(3, { text: "C", sendAt: 99, mentions: [5] });
    expect(usePlans.getState().scheduled).toHaveLength(3);
    api.cancelScheduled.mockResolvedValueOnce({ scheduled: [b] });
    await cancelScheduled(1);
    expect(usePlans.getState().scheduled).toEqual([b]);
    const sent = { id: 90, conversationId: 4, text: "B" } as unknown as Message;
    api.sendScheduled.mockResolvedValueOnce({ scheduled: [], message: sent });
    await sendScheduledNow(2);
    expect(received).toEqual([sent]);
    expect(usePlans.getState().scheduled).toEqual([]);
    expect(toasts).toEqual(["Đã hủy tin hẹn giờ.", "Đã gửi."]);
  });
});
