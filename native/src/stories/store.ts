import { create } from "zustand";

import { api } from "../api";
import type { PreparedImage } from "../images";
import type { Story } from "../types";

// Tin 24 giờ (2.13.0). Giống bản web public/stories-ui.js; máy chủ src/stories.js.
// Kết nối realtime nằm ở src/store.ts, chuyển sự kiện story:* sang onStoryEvent().

export type StoryGroup = { userId: number; stories: Story[]; unseen: boolean; latest: number };

/** Đang xem tin: danh sách người (theo thứ tự), người thứ gi, tin thứ si của người đó */
export type StoryViewerState = { queue: number[]; gi: number; si: number };

type State = {
  stories: Record<number, Story>;
  loaded: boolean;
  viewer: StoryViewerState | null;
  composer: boolean;
  /** Đổi mỗi phút để tin hết hạn tự biến mất */
  tick: number;
};

const initial = (): State => ({ stories: {}, loaded: false, viewer: null, composer: false, tick: 0 });

export const useStories = create<State>(initial);
const get = useStories.getState;
const set = useStories.setState;

type Bridge = { meId: () => number };
let bridge: Bridge = { meId: () => 0 };
export function bindStories(b: Bridge) {
  bridge = b;
}

let ticker: ReturnType<typeof setInterval> | null = null;

export function resetStories() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  set(initial());
}

export async function loadStories() {
  try {
    const { stories } = await api.stories();
    const map: Record<number, Story> = {};
    for (const s of stories) map[s.id] = s;
    set({ stories: map, loaded: true });
    if (!ticker) ticker = setInterval(() => set((st) => ({ tick: st.tick + 1 })), 60_000);
  } catch {
    /* thử lại khi nối lại máy chủ */
  }
}

/** Tin còn hiện, nhóm theo người: tin của mình trước, rồi người có tin chưa xem (mới nhất trước), rồi người đã xem hết */
export function storyGroups(stories: Record<number, Story>, meId: number, now = Date.now()): StoryGroup[] {
  const map = new Map<number, Story[]>();
  for (const s of Object.values(stories)) {
    if (s.expiresAt <= now) continue;
    const list = map.get(s.userId) || [];
    list.push(s);
    map.set(s.userId, list);
  }
  const list = [...map.entries()].map(([userId, items]) => {
    items.sort((a, b) => a.id - b.id);
    return { userId, stories: items, unseen: items.some((s) => !s.seen), latest: items[items.length - 1].createdAt };
  });
  const mine = list.filter((g) => g.userId === meId);
  const others = list.filter((g) => g.userId !== meId).sort((a, b) => Number(b.unseen) - Number(a.unseen) || b.latest - a.latest);
  return [...mine, ...others];
}

export const storiesOf = (userId: number) => storyGroups(get().stories, bridge.meId()).find((g) => g.userId === userId)?.stories || [];
const firstUnseen = (list: Story[], meId: number) =>
  Math.max(
    0,
    list.findIndex((s) => !s.seen && s.userId !== meId),
  );

export function onStoryEvent(name: string, data: any) {
  if (!data) return;
  if (name === "story:new" && data.story) {
    const s = data.story as Story;
    if (get().stories[s.id]) return;
    const own = s.userId === bridge.meId();
    set((st) => ({ stories: { ...st.stories, [s.id]: own ? { ...s, seen: true, views: 0, reactions: 0 } : s } }));
  } else if (name === "story:deleted") {
    removeLocal(data.storyId);
  } else if (name === "story:viewed") {
    const s = get().stories[data.storyId];
    if (!s) return;
    set((st) => ({ stories: { ...st.stories, [s.id]: { ...s, views: data.views, reactions: (s.reactions || 0) + (data.reaction ? 1 : 0) } } }));
  }
}

function removeLocal(id: number) {
  const st = get();
  if (!st.stories[id]) return;
  const stories = { ...st.stories };
  delete stories[id];
  set({ stories });
  fixViewer();
}

/* ---------------- Xem tin ---------------- */

/** Mở tin của một người (từ hàng vòng tròn) hoặc đúng một tin (từ tin nhắn trả lời). false = tin không còn. */
export function openStories(userId: number, storyId?: number) {
  const meId = bridge.meId();
  const groups = storyGroups(get().stories, meId);
  // Tin của mình xem riêng; tin người khác thì xem xong chuyển sang người tiếp theo
  const queue = userId === meId ? [meId] : groups.map((g) => g.userId).filter((id) => id !== meId);
  const gi = queue.indexOf(userId);
  if (gi < 0) return false;
  const list = groups.find((g) => g.userId === userId)?.stories || [];
  const si =
    storyId != null
      ? Math.max(
          0,
          list.findIndex((s) => s.id === storyId),
        )
      : firstUnseen(list, meId);
  set({ viewer: { queue, gi, si }, composer: false });
  return true;
}

export const closeStories = () => set({ viewer: null });

function goUser(step: number) {
  const v = get().viewer;
  if (!v) return;
  const gi = v.gi + step;
  if (gi < 0 || gi >= v.queue.length) {
    if (step > 0) closeStories();
    else set({ viewer: { ...v, si: 0 } });
    return;
  }
  set({ viewer: { ...v, gi, si: step > 0 ? firstUnseen(storiesOf(v.queue[gi]), bridge.meId()) : 0 } });
}

export function nextStory() {
  const v = get().viewer;
  if (!v) return;
  const list = storiesOf(v.queue[v.gi]);
  if (v.si + 1 < list.length) set({ viewer: { ...v, si: v.si + 1 } });
  else goUser(1);
}

export function prevStory() {
  const v = get().viewer;
  if (!v) return;
  if (v.si > 0) set({ viewer: { ...v, si: v.si - 1 } });
  else if (v.gi > 0) goUser(-1);
  else set({ viewer: { ...v } }); // tin đầu tiên: chạy lại từ đầu
}

// Tin đang xem vừa bị xóa / hết hạn: sang tin khác hoặc đóng
function fixViewer() {
  const v = get().viewer;
  if (!v) return;
  const list = storiesOf(v.queue[v.gi]);
  if (!list.length) return goUser(1);
  if (v.si >= list.length) set({ viewer: { ...v, si: list.length - 1 } });
}

/** Đánh dấu đã xem (tin của người khác, một lần) */
export function markSeen(s: Story) {
  if (s.seen || s.userId === bridge.meId()) return;
  set((st) => ({ stories: { ...st.stories, [s.id]: { ...s, seen: true } } }));
  api.viewStory(s.id).catch(() => undefined);
}

export async function reactStory(s: Story, emoji: string) {
  await api.replyStory(s.id, { emoji });
  const cur = get().stories[s.id];
  if (cur) set((st) => ({ stories: { ...st.stories, [s.id]: { ...cur, myReaction: emoji, seen: true } } }));
}

export async function replyStory(s: Story, text: string) {
  await api.replyStory(s.id, { text });
}

export async function deleteStory(id: number) {
  await api.deleteStory(id);
  removeLocal(id);
}

/* ---------------- Đăng tin ---------------- */

export const openComposer = () => set({ composer: true, viewer: null });
export const closeComposer = () => set({ composer: false });

export async function postStory(input: { text: string; bg?: string; image?: PreparedImage | null }) {
  let body: { text?: string; image?: string; bg?: string };
  if (input.image) {
    const { url } = await api.uploadImage(input.image.uri, input.image.mime, input.image.width, input.image.height);
    body = { image: url, text: input.text };
  } else body = { text: input.text, bg: input.bg };
  const { story } = await api.createStory(body);
  set((st) => ({ stories: { ...st.stories, [story.id]: story } }));
  return story;
}
