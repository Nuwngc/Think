import { create } from "zustand";

import { api } from "../api";
import type { EventInfo, Message, RsvpStatus, Scheduled } from "../types";

// Kèo và hẹn giờ gửi tin (2.16.0). Giống bản web public/plans-ui.js; máy chủ src/events.js, src/scheduled.js.
// Kết nối realtime nằm ở src/store.ts: sự kiện scheduled:changed chuyển sang onScheduledEvent(),
// tin kèo cập nhật qua message:updated như tin nhắn thường.

type State = {
  /** Tin hẹn giờ đang chờ của mình (mọi cuộc trò chuyện), giờ gửi sớm trước */
  scheduled: Scheduled[];
  loaded: boolean;
  /** Đổi mỗi phút để thẻ kèo / thanh hẹn giờ cập nhật "còn … phút" */
  tick: number;
};

const initial = (): State => ({ scheduled: [], loaded: false, tick: 0 });
export const usePlans = create<State>(initial);
const set = usePlans.setState;

type Bridge = {
  meId: () => number;
  /** Bản mới nhất của tin trong khung chat (có thể đã đổi qua realtime) */
  current: (convId: number, id: number) => Message | undefined;
  receive: (m: Message) => void;
  updated: (m: Message) => void;
  toast: (text: string) => void;
};
let bridge: Bridge = { meId: () => 0, current: () => undefined, receive: () => undefined, updated: () => undefined, toast: () => undefined };
export function bindPlans(b: Bridge) {
  bridge = b;
}

let ticker: ReturnType<typeof setInterval> | null = null;
function startTicker() {
  if (!ticker) ticker = setInterval(() => set((st) => ({ tick: st.tick + 1 })), 60_000);
}

export function resetPlans() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  set(initial());
}

const errText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/* ---------------- Hẹn giờ gửi tin ---------------- */

export function onScheduledEvent(data: { scheduled?: Scheduled[] }) {
  set({ scheduled: Array.isArray(data?.scheduled) ? data.scheduled : [], loaded: true });
  startTicker();
}

export async function loadScheduled() {
  try {
    onScheduledEvent(await api.scheduled());
  } catch {
    /* thử lại khi nối lại máy chủ */
  }
}

export const scheduledIn = (list: Scheduled[], convId: number) => list.filter((s) => s.conversationId === convId);

/** Hẹn giờ gửi (lỗi thì ném ra để bảng hiện) */
export async function scheduleMessage(convId: number, text: string, sendAt: number, mentions: number[]) {
  const { scheduled } = await api.schedule(convId, { text, sendAt, mentions });
  onScheduledEvent({ scheduled });
}

export async function cancelScheduled(id: number) {
  try {
    onScheduledEvent(await api.cancelScheduled(id));
    bridge.toast("Đã hủy tin hẹn giờ.");
  } catch (err) {
    bridge.toast(errText(err, "Chưa hủy được."));
  }
}

export async function sendScheduledNow(id: number) {
  try {
    const { scheduled, message } = await api.sendScheduled(id);
    if (message) bridge.receive(message);
    onScheduledEvent({ scheduled });
    bridge.toast("Đã gửi.");
  } catch (err) {
    bridge.toast(errText(err, "Chưa gửi được."));
    loadScheduled();
  }
}

/* ---------------- Kèo ---------------- */

/** Tạo kèo (lỗi thì ném ra để bảng hiện) */
export async function createEvent(convId: number, body: { title: string; place: string; startsAt: number }) {
  const { message } = await api.createEvent(convId, body);
  bridge.receive(message);
}

/** Lựa chọn của mình trong kèo (null = bỏ chọn) */
export function withMine(ev: EventInfo, meId: number, status: RsvpStatus | null): EventInfo {
  const next = { ...ev, yes: ev.yes.filter((u) => u !== meId), maybe: ev.maybe.filter((u) => u !== meId), no: ev.no.filter((u) => u !== meId) };
  if (status) next[status] = [...next[status], meId];
  return next;
}

/** Đi / Có thể / Không đi (null = bỏ chọn): hiện ngay, lỗi thì trả lại lựa chọn cũ */
export async function rsvp(m: Message, status: RsvpStatus | null) {
  const ev = m.event;
  const meId = bridge.meId();
  if (!ev || !meId) return;
  const prev = (["yes", "maybe", "no"] as const).find((k) => ev[k].includes(meId)) ?? null;
  bridge.updated({ ...m, event: withMine(ev, meId, status) });
  try {
    bridge.updated((await api.rsvp(m.id, status)).message);
  } catch (err) {
    // Trả lại lựa chọn cũ của mình, giữ thay đổi của người khác vừa nhận qua realtime
    const cur = bridge.current(m.conversationId, m.id) || m;
    bridge.updated({ ...cur, event: withMine(cur.event || ev, meId, prev) });
    bridge.toast(errText(err, "Chưa chọn được."));
  }
}

export async function cancelEvent(m: Message) {
  try {
    bridge.updated((await api.cancelEvent(m.id)).message);
    bridge.toast("Đã hủy kèo.");
  } catch (err) {
    bridge.toast(errText(err, "Chưa hủy được kèo."));
  }
}
