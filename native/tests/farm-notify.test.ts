/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const perm = vi.hoisted(() => ({ granted: true }));
const gate = vi.hoisted(() => ({ wait: null as Promise<void> | null }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  cancelScheduledNotificationAsync: vi.fn(async (id: string) => {
    calls.push(`cancel ${id}`);
  }),
  getPermissionsAsync: vi.fn(async () => {
    if (gate.wait) await gate.wait;
    return perm;
  }),
  scheduleNotificationAsync: vi.fn(async (req: { identifier: string; trigger: { date: Date; channelId: string } }) => {
    calls.push(`schedule ${req.identifier} ${req.trigger.date.getTime()} ${req.trigger.channelId}`);
  }),
}));
vi.mock("../src/notifications", () => ({ CHANNEL_OTHER: "other", pushTurnedOff: vi.fn(async () => false) }));

import { scheduleFarmReady } from "../src/farm/notify";

const NOW = 1_000_000_000;

describe("nông trại: nhắc khi cả ruộng chín", () => {
  beforeEach(() => {
    calls.length = 0;
    perm.granted = true;
    gate.wait = null;
  });

  it("hẹn giờ, không hẹn lại khi giờ không đổi, hủy khi không còn cây", async () => {
    await scheduleFarmReady(NOW + 10 * 60_000, NOW);
    expect(calls).toEqual(["cancel farm-ready", `schedule farm-ready ${NOW + 10 * 60_000} other`]);
    await scheduleFarmReady(NOW + 10 * 60_000, NOW);
    expect(calls).toHaveLength(2);
    await scheduleFarmReady(NOW + 30_000, NOW); // quá gần: thôi, hủy cái cũ
    expect(calls.slice(2)).toEqual(["cancel farm-ready"]);
    await scheduleFarmReady(null, NOW);
    expect(calls).toHaveLength(3);
  });

  it("đăng xuất trong lúc đang hẹn: không hẹn nhầm giờ cũ", async () => {
    let open: () => void = () => undefined;
    gate.wait = new Promise<void>((r) => (open = r));
    const a = scheduleFarmReady(NOW + 20 * 60_000, NOW);
    await new Promise((r) => setTimeout(r, 0)); // lần hẹn đang chờ hỏi quyền
    expect(calls).toEqual(["cancel farm-ready"]);
    const b = scheduleFarmReady(null, NOW); // đăng xuất
    open();
    await Promise.all([a, b]);
    expect(calls.filter((c) => c.startsWith("schedule"))).toEqual([]);
  });

  it("chưa cho phép thông báo thì lần sau thử lại", async () => {
    perm.granted = false;
    await scheduleFarmReady(NOW + 40 * 60_000, NOW);
    expect(calls.filter((c) => c.startsWith("schedule"))).toEqual([]);
    perm.granted = true;
    await scheduleFarmReady(NOW + 40 * 60_000, NOW);
    expect(calls.filter((c) => c.startsWith("schedule"))).toEqual([`schedule farm-ready ${NOW + 40 * 60_000} other`]);
  });
});
