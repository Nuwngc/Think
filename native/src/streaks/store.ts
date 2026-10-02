import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { api, ApiError } from "../api";
import { addPending, cheerText, dayKey, pendingByGame, removeSent, type PendingDay } from "./logic";
import type { StreakEvent, StreakSummary } from "./types";

// Chuỗi hằng ngày của mọi game trong app (máy chủ: src/streaks.js).
// - Game chạy trên máy chủ (Nông trại, Cờ vua, cờ caro với bạn) được máy chủ tự ghi.
// - Game chạy trên máy (Xếp Khối, cờ caro với máy) gọi markPlayed("<mã game>"): ngày chơi lưu trên máy,
//   có mạng thì gửi lên — chơi lúc mất mạng vẫn được tính.
// Realtime "streak:update" và thông báo nhỏ nối ở src/store.ts qua bindStreaks().

const KEY = "think.streak.days";

type Sheet = { kind: "detail"; game: string | null } | { kind: "milestone"; event: StreakEvent } | null;

type State = {
  data: StreakSummary | null;
  loading: boolean;
  sheet: Sheet;
};

export const useStreaks = create<State>(() => ({ data: null, loading: false, sheet: null }));

const get = useStreaks.getState;
const set = useStreaks.setState;

type Bridge = {
  /** Người đang đăng nhập (0 = chưa) */
  meId: () => number;
  toast: (text: string) => void;
  online: () => boolean;
};
let bridge: Bridge = { meId: () => 0, toast: () => undefined, online: () => true };

export function bindStreaks(b: Bridge) {
  bridge = b;
}

/* ---------------- Hàng chờ ngày chơi (game chạy trên máy) ---------------- */

let pending: PendingDay[] | null = null;
let pendingLoad: Promise<PendingDay[]> | null = null;

function readPending() {
  if (pending) return Promise.resolve(pending);
  if (!pendingLoad) {
    pendingLoad = AsyncStorage.getItem(KEY)
      .then((raw) => {
        try {
          const v = raw ? JSON.parse(raw) : [];
          return Array.isArray(v) ? (v as PendingDay[]) : [];
        } catch {
          return [];
        }
      })
      .catch(() => [] as PendingDay[])
      .then((v) => {
        pending = pending ?? v;
        return pending;
      });
  }
  return pendingLoad;
}

function writePending(list: PendingDay[]) {
  pending = list;
  AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => undefined);
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let gen = 0;
/** Ngày chơi đã gửi xong lần mở app này ("uid|game|day"): khỏi gửi lại sau mỗi nước đi */
const sent = new Set<string>();

/** Hôm nay có chơi `game` (game chạy trên máy). Gọi mỗi nước đi cũng được: mỗi ngày chỉ ghi và gửi một lần. */
export function markPlayed(game: string) {
  const uid = bridge.meId() || null;
  const day = dayKey();
  if (uid) {
    const d = get().data;
    const g = d?.games.find((x) => x.id === game);
    if (sent.has(`${uid}|${game}|${day}`) || (d?.today === day && g?.today)) return; // máy chủ đã ghi hôm nay
  }
  readPending().then(() => {
    const list = pending || []; // bản mới nhất (nhiều lần gọi liền nhau không ghi đè nhau)
    const next = addPending(list, game, day, uid);
    if (next !== list) {
      writePending(next);
      flushSoon();
    }
  });
}

function flushSoon() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushStreaks();
  }, 1500);
}

let flushing: Promise<void> | null = null;

/** Gửi các ngày đã chơi lên máy chủ */
export function flushStreaks() {
  if (flushing) return flushing;
  const uid = bridge.meId();
  if (!uid || !bridge.online()) return Promise.resolve();
  const g0 = gen;
  const p: Promise<void> = (async () => {
    const list = await readPending();
    const groups = pendingByGame(list, uid);
    for (const [game, days] of Object.entries(groups)) {
      if (g0 !== gen || bridge.meId() !== uid) break; // vừa đăng xuất / đổi người: để dành cho đúng người
      try {
        const data = await api.streaksPlayed(game, days);
        for (const d of days) sent.add(`${uid}|${game}|${d}`);
        if (data && g0 === gen) set({ data });
      } catch (err) {
        // Mất mạng, máy chủ lỗi, hết phiên, phải đổi mật khẩu: để lần sau gửi lại; bị từ chối hẳn (400) thì bỏ
        if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500 || [401, 403, 429].includes(err.status)) continue;
      }
      writePending(removeSent(pending || [], game, days, uid));
    }
  })().finally(() => {
    if (flushing === p) flushing = null;
  });
  flushing = p;
  return p;
}

/* ---------------- Tải, sự kiện realtime ---------------- */

export async function loadStreaks() {
  if (!bridge.meId() || get().loading) return;
  const g0 = gen;
  set({ loading: true });
  try {
    const data = await api.streaks();
    if (g0 === gen) set({ data });
  } catch {
    /* lần sau tải lại */
  } finally {
    if (g0 === gen) set({ loading: false });
  }
  await flushStreaks();
}

export function onStreakEvent(evt: StreakEvent) {
  if (!evt || !evt.summary) return;
  set({ data: evt.summary });
  if (!evt.isToday) return;
  if (evt.milestone || evt.overallMilestone) set({ sheet: { kind: "milestone", event: evt } });
  else bridge.toast(cheerText(evt.name, evt.current));
}

export function openStreaks(game: string | null = null) {
  set({ sheet: { kind: "detail", game } });
  if (!get().data) loadStreaks();
}

export function closeStreaks() {
  set({ sheet: null });
}

export async function setRemind(on: boolean) {
  const prev = get().data;
  if (prev) set({ data: { ...prev, remind: on } });
  try {
    set({ data: await api.streaksPrefs(on) });
  } catch (err) {
    if (prev) set({ data: prev });
    bridge.toast(err instanceof Error ? err.message : "Chưa lưu được.");
  }
}

/** Đăng xuất: quên chuỗi của người cũ (ngày chơi chưa gửi vẫn giữ trên máy theo người) */
export function resetStreaks() {
  gen++;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = null;
  sent.clear();
  set({ data: null, loading: false, sheet: null });
}

export const streakOf = (s: Pick<State, "data">, game: string) => s.data?.games.find((g) => g.id === game) ?? null;
