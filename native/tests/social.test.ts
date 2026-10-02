/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  posts: vi.fn(),
  post: vi.fn(),
  profile: vi.fn(),
  createPost: vi.fn(),
  deletePost: vi.fn(),
  likePost: vi.fn(),
  postLikes: vi.fn(),
  comments: vi.fn(),
  addComment: vi.fn(),
  deleteComment: vi.fn(),
  uploadImage: vi.fn(),
}));

vi.mock("../src/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { api, ApiError };
});
vi.mock("react-native", () => ({ useColorScheme: () => "light" }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(() => Promise.resolve("dark")), setItem: vi.fn(() => Promise.resolve()) },
}));

import { ApiError } from "../src/api";
import { describeGame } from "../src/chess/format";
import type { ChessGame } from "../src/chess/types";
import { chessShareOf, chessShareText, joinedText, messageSummary, timeAgo } from "../src/format";
import {
  addComment,
  bindSocial,
  canDeleteComment,
  createPost,
  loadPosts,
  loadProfile,
  onSocialEvent,
  openUser,
  resetSocial,
  toggleLike,
  useSocial,
} from "../src/social/store";
import { loadThemeMode, resolveScheme, setThemeMode, useThemeMode } from "../src/theme";
import type { Post } from "../src/types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function game(over: Partial<ChessGame> = {}): ChessGame {
  return {
    id: 7,
    status: "finished",
    rated: true,
    whiteId: 1,
    blackId: 2,
    bot: null,
    botColor: null,
    challengerId: 1,
    opponentId: 2,
    colorPref: "white",
    base: 300000,
    inc: 3000,
    moves: ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"],
    fen: START,
    turn: "b",
    clocks: null,
    serverNow: Date.now(),
    firstMoveDeadline: null,
    drawOffer: null,
    result: "1-0",
    reason: "checkmate",
    ratings: { w: 1200, b: 1200 },
    deltas: { w: 20, b: -20 },
    live: { w: 1220, b: 1180 },
    createdAt: 1,
    startedAt: 1,
    endedAt: 2,
    expiresAt: null,
    ...over,
  };
}

const post = (over: Partial<Post> = {}): Post => ({
  id: 1,
  userId: 2,
  text: "Chào cả nhà",
  image: null,
  game: null,
  createdAt: Date.now(),
  likes: 0,
  liked: false,
  comments: 0,
  ...over,
});

const names = (id: number | null | undefined) => ({ 1: "An", 2: "Bình" })[id as 1 | 2] || "Người dùng";

describe("chia sẻ ván cờ vào cuộc trò chuyện", () => {
  it("mô tả ván giống bản web", () => {
    expect(describeGame(game(), names)).toEqual({ title: "An (Trắng) vs Bình (Đen)", sub: "An thắng do chiếu hết · 5+3 · 7 nước" });
    expect(describeGame(game({ result: "1/2-1/2", reason: "agreement" }), names).sub).toBe("Hòa (hai bên đồng ý hòa) · 5+3 · 7 nước");
    expect(describeGame(game({ status: "active", result: null }), names).sub.startsWith("Đang chơi")).toBe(true);
    expect(describeGame(game({ status: "aborted", result: null }), names).sub.startsWith("Ván bị hủy")).toBe(true);
    const bot = game({ blackId: null, bot: { id: "garbo", name: "Garbo", elo: 1500 } as any, botColor: "b", result: "0-1" });
    expect(describeGame(bot, names).title).toBe("An (Trắng) vs Garbo (Đen)");
    expect(describeGame(bot, names).sub.startsWith("Garbo thắng")).toBe(true);
  });

  it("tạo tin và đọc lại được (cả tin do bản web gửi)", () => {
    const d = describeGame(game(), names);
    const text = chessShareText({ ...d, id: 7 }, "https://thinkchat.id.vn/");
    expect(text).toBe("♟ An (Trắng) vs Bình (Đen)\nAn thắng do chiếu hết · 5+3 · 7 nước\nhttps://thinkchat.id.vn/#/chess/g/7");
    expect(chessShareOf(text)).toEqual({ ...d, id: 7 });
    expect(chessShareOf("♟ A vs B\nhttp://localhost:3000/#/chess/g/12")).toEqual({ title: "A vs B", sub: "", id: 12 });
    expect(chessShareOf("♟ chỉ là tin nhắn thường")).toBeNull();
    expect(chessShareOf("xem ván này https://x.vn/#/chess/g/3")).toBeNull();
    expect(chessShareOf(null)).toBeNull();
  });

  it("danh sách chat chỉ hiện dòng đầu", () => {
    const m = { kind: "text", deleted: false, image: null, text: "♟ A vs B\nA thắng\nhttps://x.vn/#/chess/g/3" } as any;
    expect(messageSummary(m, { meId: 1, nameOf: names })).toBe("♟ A vs B");
  });
});

describe("thời gian trên bảng tin", () => {
  it("ghi thời gian tương đối", () => {
    const now = new Date(2026, 8, 20, 12, 0).getTime();
    expect(timeAgo(now - 20_000, now)).toBe("Vừa xong");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 phút trước");
    expect(timeAgo(now - 3 * 3600_000, now)).toBe("3 giờ trước");
    expect(timeAgo(now - 2 * 86400_000, now)).toBe("2 ngày trước");
    expect(timeAgo(new Date(2026, 7, 1).getTime(), now)).toBe("01/08");
    expect(joinedText(new Date(2026, 8, 3).getTime())).toBe("Tham gia tháng 9/2026");
    expect(joinedText(null)).toBe("");
  });
});

describe("nền sáng / tối", () => {
  it("theo máy hoặc tự chọn", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });
  it("đọc lựa chọn đã lưu, nhưng không đè lựa chọn vừa bấm", async () => {
    await loadThemeMode();
    expect(useThemeMode.getState()).toEqual({ mode: "dark", loaded: true });
    setThemeMode("light");
    expect(useThemeMode.getState().mode).toBe("light");
  });
});

describe("bảng tin", () => {
  const toast = vi.fn();
  const showMe = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    resetSocial();
    bindSocial({ meId: () => 1, isAdmin: () => false, toast, showMe });
  });

  it("thành tựu mới: báo một câu cho chủ trang, người khác thì không", async () => {
    const ach = (isNew: boolean, name = "Kỳ thủ") => ({
      id: name,
      icon: "♟️",
      name,
      tier: 1,
      tierName: "Đồng",
      value: 1,
      goals: [1, 10, 50],
      next: 10,
      text: "Thắng 10 ván cờ vua",
      done: "Thắng 1 ván cờ vua",
      progress: 0.1,
      isNew,
    });
    api.profile.mockResolvedValueOnce({ stats: { posts: 0, likes: 0, chess: null, achievements: { list: [ach(true)], earned: 1, total: 36 } } });
    await loadProfile(1);
    expect(toast).toHaveBeenCalledWith("🏆 Thành tựu mới: Kỳ thủ (Đồng)");
    expect(useSocial.getState().profiles[1].achievements?.earned).toBe(1);
    api.profile.mockResolvedValueOnce({
      stats: { posts: 0, likes: 0, chess: null, achievements: { list: [ach(true), ach(true, "Nhà nông")], earned: 2, total: 36 } },
    });
    await loadProfile(1);
    expect(toast).toHaveBeenLastCalledWith("🏆 2 thành tựu mới — xem ở trang cá nhân");
    toast.mockClear();
    api.profile.mockResolvedValueOnce({ stats: { posts: 0, likes: 0, chess: null, achievements: { list: [ach(true)], earned: 1, total: 36 } } });
    await loadProfile(2); // trang người khác
    expect(toast).not.toHaveBeenCalled();
  });

  it("tải trang đầu rồi trang cũ hơn", async () => {
    api.posts.mockResolvedValueOnce({ posts: [post({ id: 5 }), post({ id: 4 })], hasMore: true });
    await loadPosts("feed");
    expect(api.posts).toHaveBeenLastCalledWith(null, undefined);
    api.posts.mockResolvedValueOnce({ posts: [post({ id: 4 }), post({ id: 2 })], hasMore: false });
    await loadPosts("feed", true);
    expect(api.posts).toHaveBeenLastCalledWith(null, 4);
    expect(useSocial.getState().lists.feed).toMatchObject({ ids: [5, 4, 2], hasMore: false, loaded: true, loading: false });
    await loadPosts("feed", true); // hết bài: không tải nữa
    expect(api.posts).toHaveBeenCalledTimes(2);
  });

  it("bài mới (realtime hoặc tự đăng) lên đầu, không bị trùng", async () => {
    api.posts.mockResolvedValue({ posts: [post({ id: 3 })], hasMore: false });
    await loadPosts("feed");
    await loadPosts("u:1");
    useSocial.setState({ profiles: { 1: { posts: 1, likes: 0, chess: null } } });
    api.createPost.mockResolvedValueOnce({ post: post({ id: 9, userId: 1, text: "Mới" }) });
    await createPost({ text: "  Mới ", image: null, game: null });
    expect(api.createPost).toHaveBeenCalledWith({ text: "Mới", image: undefined, gameId: undefined });
    onSocialEvent("post:new", { post: post({ id: 9, userId: 1 }) }); // sự kiện đến sau: bỏ qua
    const st = useSocial.getState();
    expect(st.lists.feed.ids).toEqual([9, 3]);
    expect(st.lists["u:1"].ids).toEqual([9, 3]);
    expect(st.profiles[1].posts).toBe(2);
    onSocialEvent("post:new", { post: post({ id: 10, userId: 2, liked: true }) });
    expect(useSocial.getState().lists.feed.ids).toEqual([10, 9, 3]);
    expect(useSocial.getState().lists["u:1"].ids).toEqual([9, 3]);
    expect(useSocial.getState().posts[10].liked).toBe(false);
  });

  it("đăng ảnh: tải ảnh lên trước, kèm ván cờ", async () => {
    api.uploadImage.mockResolvedValueOnce({ url: "/uploads/a_800x600.jpg" });
    api.createPost.mockResolvedValueOnce({ post: post({ id: 11, userId: 1 }) });
    await createPost({ text: "", image: { uri: "file://a.jpg", width: 800, height: 600, mime: "image/jpeg" }, game: game() });
    expect(api.uploadImage).toHaveBeenCalledWith("file://a.jpg", "image/jpeg", 800, 600);
    expect(api.createPost).toHaveBeenCalledWith({ text: "", image: "/uploads/a_800x600.jpg", gameId: 7 });
  });

  it("thả tim hiện ngay, lỗi thì trả lại", async () => {
    useSocial.setState({ posts: { 1: post({ likes: 2 }) } });
    let resolve!: (v: unknown) => void;
    api.likePost.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p = toggleLike(1);
    expect(useSocial.getState().posts[1]).toMatchObject({ liked: true, likes: 3 });
    resolve({ liked: true, likes: 5 });
    await p;
    expect(useSocial.getState().posts[1]).toMatchObject({ liked: true, likes: 5 });
    api.likePost.mockRejectedValueOnce(new ApiError("Mất mạng", 0));
    await toggleLike(1);
    expect(useSocial.getState().posts[1]).toMatchObject({ liked: true, likes: 5 });
    expect(toast).toHaveBeenCalledWith("Mất mạng");
  });

  it("tim của người khác không đổi trạng thái tim của mình", () => {
    useSocial.setState({ posts: { 1: post({ likes: 1, liked: true }) } });
    onSocialEvent("post:likes", { postId: 1, likes: 2, userId: 3, liked: true });
    expect(useSocial.getState().posts[1]).toMatchObject({ liked: true, likes: 2 });
    onSocialEvent("post:likes", { postId: 1, likes: 1, userId: 1, liked: false });
    expect(useSocial.getState().posts[1]).toMatchObject({ liked: false, likes: 1 });
  });

  it("bình luận: tự gửi và nhận realtime không bị trùng", async () => {
    useSocial.setState({ posts: { 1: post() }, comments: { 1: [] } });
    const mine = { id: 21, postId: 1, userId: 1, text: "Hay", createdAt: 1 };
    api.addComment.mockResolvedValueOnce({ comment: mine, comments: 1 });
    await addComment(1, " Hay ");
    expect(api.addComment).toHaveBeenCalledWith(1, "Hay");
    onSocialEvent("post:comment", { postId: 1, comments: 1, comment: mine });
    onSocialEvent("post:comment", { postId: 1, comments: 2, comment: { ...mine, id: 22, userId: 2 } });
    expect(useSocial.getState().comments[1]?.map((c) => c.id)).toEqual([21, 22]);
    expect(useSocial.getState().posts[1].comments).toBe(2);
    onSocialEvent("post:comment-deleted", { postId: 1, commentId: 21, comments: 1 });
    expect(useSocial.getState().comments[1]?.map((c) => c.id)).toEqual([22]);
  });

  it("ai được xóa bình luận", () => {
    const c = { id: 1, postId: 1, userId: 3, text: "x", createdAt: 1 };
    expect(canDeleteComment(c, post({ userId: 2 }))).toBe(false);
    expect(canDeleteComment(c, post({ userId: 1 }))).toBe(true); // chủ bài
    expect(canDeleteComment({ ...c, userId: 1 }, post({ userId: 2 }))).toBe(true); // người viết
  });

  it("bài bị xóa: bỏ khỏi danh sách và đóng bảng bình luận", async () => {
    api.posts.mockResolvedValue({ posts: [post({ id: 1 }), post({ id: 2 })], hasMore: false });
    await loadPosts("feed");
    useSocial.setState({ sheet: { kind: "comments", postId: 1 } });
    onSocialEvent("post:deleted", { postId: 1 });
    expect(useSocial.getState().lists.feed.ids).toEqual([2]);
    expect(useSocial.getState().posts[1]).toBeUndefined();
    expect(useSocial.getState().sheet).toBeNull();
  });

  it("mở trang của chính mình là về tab Cá nhân", () => {
    openUser(2);
    expect(useSocial.getState().viewUser).toBe(2);
    openUser(1);
    expect(useSocial.getState().viewUser).toBeNull();
    expect(showMe).toHaveBeenCalled();
  });
});
