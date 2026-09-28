import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Conversation, Me, Message, User } from "./types";

// Bản lưu trên máy: mở app là thấy ngay tin nhắn cũ, kể cả khi máy chủ đang ngủ hoặc mất mạng.
const KEY = "think.cache.v1";
const MAX_CONVS = 40;
const MAX_MSGS = 60;

export type Snapshot = {
  me: Me;
  users: Record<number, User>;
  convs: Record<number, Conversation>;
  msgs: Record<number, Message[]>;
  savedAt: number;
};

export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    return snap && snap.me && snap.convs ? snap : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(data: Omit<Snapshot, "savedAt">) {
  const convs = Object.values(data.convs)
    .sort((a, b) => (b.lastMessage?.createdAt || b.createdAt) - (a.lastMessage?.createdAt || a.createdAt))
    .slice(0, MAX_CONVS);
  const keep = new Set(convs.map((c) => c.id));
  const msgs: Record<number, Message[]> = {};
  for (const [id, list] of Object.entries(data.msgs)) {
    if (keep.has(Number(id)) && list.length) msgs[Number(id)] = list.slice(-MAX_MSGS);
  }
  const snap: Snapshot = {
    me: data.me,
    users: data.users,
    convs: Object.fromEntries(convs.map((c) => [c.id, { ...c, reads: undefined }])),
    msgs,
    savedAt: Date.now(),
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    /* bộ nhớ máy đầy: bỏ qua */
  }
}

export async function clearSnapshot() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* bỏ qua */
  }
}
