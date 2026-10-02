import { create } from "zustand";

import { api, ApiError } from "../api";
import type { ChessGame } from "../chess/types";
import type { PreparedImage } from "../images";
import type { Post, PostComment, ProfileStats } from "../types";

// Trang cá nhân và bảng tin (giống bản web: public/social-ui.js). Kết nối realtime nằm ở src/store.ts,
// chuyển sự kiện post:* sang onSocialEvent(). Các bảng (viết bài, bình luận…) hiện ở SocialHost.

export type ListKey = "feed" | `u:${number}`;

export type PostList = { ids: number[]; hasMore: boolean; loading: boolean; loaded: boolean; error: string | null };

export type SocialSheet =
  | { kind: "composer"; game: ChessGame | null; pickImage?: boolean }
  | { kind: "comments"; postId: number }
  | { kind: "likers"; postId: number }
  | { kind: "share"; game: ChessGame };

type State = {
  posts: Record<number, Post>;
  lists: Record<string, PostList>;
  profiles: Record<number, ProfileStats>;
  comments: Record<number, PostComment[] | undefined>;
  likers: Record<number, number[] | undefined>;
  /** Trang cá nhân của người khác đang mở (toàn màn hình) */
  viewUser: number | null;
  sheet: SocialSheet | null;
  /** Ảnh bài đăng đang xem lớn */
  viewer: string | null;
  /** Tab trên trang cá nhân của mình: Bảng tin / Bài của tôi */
  seg: "feed" | "mine";
};

const initial = (): State => ({
  posts: {},
  lists: {},
  profiles: {},
  comments: {},
  likers: {},
  viewUser: null,
  sheet: null,
  viewer: null,
  seg: "feed",
});

export const useSocial = create<State>(initial);

const get = useSocial.getState;
const set = useSocial.setState;

type Bridge = {
  meId: () => number;
  isAdmin: () => boolean;
  toast: (text: string) => void;
  /** Mở tab Cá nhân của mình */
  showMe: () => void;
};

let bridge: Bridge = { meId: () => 0, isAdmin: () => false, toast: () => undefined, showMe: () => undefined };

export function bindSocial(b: Bridge) {
  bridge = b;
}

export function resetSocial() {
  set(initial());
}

const emptyList = (): PostList => ({ ids: [], hasMore: false, loading: false, loaded: false, error: null });

export const listKey = (userId: number | null): ListKey => (userId == null ? "feed" : `u:${userId}`);

const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function patchList(key: string, fn: (l: PostList) => Partial<PostList>) {
  set((s) => {
    const l = s.lists[key] || emptyList();
    return { lists: { ...s.lists, [key]: { ...l, ...fn(l) } } };
  });
}

function putPosts(list: Post[]) {
  if (!list.length) return;
  set((s) => {
    const posts = { ...s.posts };
    for (const p of list) posts[p.id] = p;
    return { posts };
  });
}

function patchPost(id: number, patch: Partial<Post>) {
  set((s) => (s.posts[id] ? { posts: { ...s.posts, [id]: { ...s.posts[id], ...patch } } } : {}));
}

/* ---------------- Tải bài ---------------- */

/** Tải trang đầu (hoặc trang cũ hơn nếu more) của bảng tin / bài của một người */
export async function loadPosts(key: ListKey, more = false) {
  const l = get().lists[key] || emptyList();
  if (l.loading || (more && (!l.hasMore || !l.loaded))) return;
  patchList(key, () => ({ loading: true, error: null }));
  try {
    const userId = key === "feed" ? null : Number(key.slice(2));
    const before = more ? l.ids[l.ids.length - 1] : undefined;
    const data = await api.posts(userId, before);
    putPosts(data.posts);
    const fresh = data.posts.map((p) => p.id);
    patchList(key, (cur) => ({
      ids: more ? [...cur.ids, ...fresh.filter((id) => !cur.ids.includes(id))] : fresh,
      hasMore: data.hasMore,
      loaded: true,
    }));
  } catch (err) {
    patchList(key, () => ({ error: errText(err, "Không tải được bài đăng."), loaded: true }));
  } finally {
    patchList(key, () => ({ loading: false }));
  }
}

export async function loadProfile(userId: number) {
  try {
    const { stats } = await api.profile(userId);
    set((s) => ({ profiles: { ...s.profiles, [userId]: stats } }));
    // Thành tựu vừa đạt (chỉ chủ trang thấy, mỗi huy hiệu một lần)
    const fresh = userId === bridge.meId() ? (stats.achievements?.list || []).filter((a) => a.isNew) : [];
    if (fresh.length) {
      bridge.toast(fresh.length === 1 ? `🏆 Thành tựu mới: ${fresh[0].name} (${fresh[0].tierName})` : `🏆 ${fresh.length} thành tựu mới — xem ở trang cá nhân`);
    }
  } catch {
    /* thiếu số liệu thì thôi */
  }
}

/** Tải lại những gì đang xem (sau khi nối lại mạng) */
export function refreshSocial() {
  const s = get();
  for (const [key, l] of Object.entries(s.lists)) if (l.loaded) loadPosts(key as ListKey);
  for (const id of Object.keys(s.profiles)) loadProfile(Number(id));
}

/** Thêm bài mới lên đầu các danh sách đã tải */
function addPost(p: Post) {
  const known = Boolean(get().posts[p.id]);
  putPosts([p]);
  for (const key of ["feed", `u:${p.userId}`]) {
    const l = get().lists[key];
    if (l?.loaded && !l.ids.includes(p.id)) patchList(key, (cur) => ({ ids: [p.id, ...cur.ids] }));
  }
  const st = get().profiles[p.userId];
  if (st && !known) set((s) => ({ profiles: { ...s.profiles, [p.userId]: { ...st, posts: st.posts + 1 } } }));
}

function forgetPost(id: number) {
  const p = get().posts[id];
  set((s) => {
    const posts = { ...s.posts };
    delete posts[id];
    const lists: Record<string, PostList> = {};
    for (const [k, l] of Object.entries(s.lists)) lists[k] = l.ids.includes(id) ? { ...l, ids: l.ids.filter((x) => x !== id) } : l;
    const comments = { ...s.comments };
    delete comments[id];
    const open = s.sheet && (s.sheet.kind === "comments" || s.sheet.kind === "likers") && s.sheet.postId === id;
    return { posts, lists, comments, sheet: open ? null : s.sheet };
  });
  if (p && get().profiles[p.userId]) loadProfile(p.userId);
}

/* ---------------- Đăng, xóa, thả tim ---------------- */

export async function createPost({ text, image, game }: { text: string; image: PreparedImage | null; game: ChessGame | null }) {
  let url: string | undefined;
  if (image) url = (await api.uploadImage(image.uri, image.mime, image.width, image.height)).url;
  const { post } = await api.createPost({ text: text.trim(), image: url, gameId: game?.id });
  addPost(post);
  return post;
}

export async function deletePost(id: number) {
  try {
    await api.deletePost(id);
    forgetPost(id);
    bridge.toast("Đã xóa bài đăng.");
  } catch (err) {
    bridge.toast(errText(err, "Chưa xóa được bài."));
  }
}

const likeBusy = new Set<number>();

/** Thả / bỏ tim: hiện ngay, máy chủ trả lời thì cập nhật số thật */
export async function toggleLike(id: number) {
  const p = get().posts[id];
  if (!p || likeBusy.has(id)) return;
  const want = !p.liked;
  likeBusy.add(id);
  patchPost(id, { liked: want, likes: Math.max(0, p.likes + (want ? 1 : -1)) });
  try {
    const res = await api.likePost(id, want);
    patchPost(id, { liked: res.liked, likes: res.likes });
    set((s) => ({ likers: { ...s.likers, [id]: undefined } }));
  } catch (err) {
    patchPost(id, { liked: p.liked, likes: p.likes });
    if (err instanceof ApiError && err.status === 404) forgetPost(id);
    bridge.toast(errText(err, "Chưa thả tim được."));
  } finally {
    likeBusy.delete(id);
  }
}

export async function loadLikers(id: number) {
  try {
    const { userIds } = await api.postLikes(id);
    set((s) => ({ likers: { ...s.likers, [id]: userIds } }));
  } catch (err) {
    bridge.toast(errText(err, "Không tải được danh sách."));
  }
}

/* ---------------- Bình luận ---------------- */

export async function loadComments(postId: number) {
  try {
    const { comments } = await api.comments(postId);
    set((s) => ({ comments: { ...s.comments, [postId]: comments } }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      forgetPost(postId);
      bridge.toast(err.message);
      return;
    }
    set((s) => ({ comments: { ...s.comments, [postId]: s.comments[postId] || [] } }));
    bridge.toast(errText(err, "Không tải được bình luận."));
  }
}

function pushComment(c: PostComment) {
  set((s) => {
    const list = s.comments[c.postId];
    if (!list || list.some((x) => x.id === c.id)) return {};
    return { comments: { ...s.comments, [c.postId]: [...list, c] } };
  });
}

export async function addComment(postId: number, text: string) {
  const { comment, comments } = await api.addComment(postId, text.trim());
  pushComment(comment);
  patchPost(postId, { comments });
}

export async function deleteComment(c: PostComment) {
  try {
    const { comments } = await api.deleteComment(c.id);
    set((s) => ({ comments: { ...s.comments, [c.postId]: (s.comments[c.postId] || []).filter((x) => x.id !== c.id) } }));
    patchPost(c.postId, { comments });
  } catch (err) {
    bridge.toast(errText(err, "Chưa xóa được bình luận."));
  }
}

/** Được xóa bình luận: người viết, chủ bài, admin */
export function canDeleteComment(c: PostComment, post: Post | undefined) {
  const me = bridge.meId();
  return c.userId === me || post?.userId === me || bridge.isAdmin();
}

/* ---------------- Mở trang, mở bảng ---------------- */

export function openUser(userId: number) {
  if (userId === bridge.meId()) {
    set({ viewUser: null, sheet: null });
    bridge.showMe();
    return;
  }
  set({ viewUser: userId, sheet: null });
}

export function closeUser() {
  set({ viewUser: null });
}

export function setSeg(seg: "feed" | "mine") {
  set({ seg });
}

export async function openComments(postId: number) {
  set({ sheet: { kind: "comments", postId } });
  if (!get().posts[postId]) {
    try {
      const { post } = await api.post(postId);
      putPosts([post]);
    } catch (err) {
      closeSheet();
      bridge.toast(errText(err, "Bài đăng không còn nữa."));
      return;
    }
  }
  loadComments(postId);
}

export function openLikers(postId: number) {
  set({ sheet: { kind: "likers", postId } });
  loadLikers(postId);
}

export function openComposer(opts: { game?: ChessGame | null; pickImage?: boolean } = {}) {
  set({ sheet: { kind: "composer", game: opts.game || null, pickImage: opts.pickImage } });
}

/** Chia sẻ ván cờ: lên trang cá nhân hoặc gửi vào một cuộc trò chuyện */
export function shareGame(game: ChessGame) {
  set({ sheet: { kind: "share", game } });
}

export function closeSheet() {
  set({ sheet: null });
}

export function viewImage(path: string | null) {
  set({ viewer: path });
}

/* ---------------- Sự kiện realtime ---------------- */

export function onSocialEvent(name: string, data: any) {
  if (!data) return;
  const me = bridge.meId();
  if (name === "post:new") {
    const p = data.post as Post | undefined;
    if (!p || get().posts[p.id]) return;
    addPost({ ...p, liked: false });
    return;
  }
  const id = Number(data.postId);
  const p = get().posts[id];
  if (name === "post:deleted") {
    if (p) forgetPost(id);
    return;
  }
  if (name === "post:likes") {
    if (!p) return;
    patchPost(id, { likes: Number(data.likes) || 0, liked: data.userId === me ? Boolean(data.liked) : p.liked });
    set((s) => ({ likers: { ...s.likers, [id]: undefined } }));
    const sheet = get().sheet;
    if (sheet?.kind === "likers" && sheet.postId === id) loadLikers(id);
    if (get().profiles[p.userId]) loadProfile(p.userId);
    return;
  }
  if (name === "post:comment" || name === "post:comment-deleted") {
    if (p && typeof data.comments === "number") patchPost(id, { comments: data.comments });
    if (name === "post:comment" && data.comment) pushComment(data.comment as PostComment);
    if (name === "post:comment-deleted") {
      set((s) => {
        const list = s.comments[id];
        return list ? { comments: { ...s.comments, [id]: list.filter((c) => c.id !== data.commentId) } } : {};
      });
    }
  }
}
