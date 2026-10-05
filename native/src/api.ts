import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import type { BlocksBoard, PendingScore } from "./blocks/types";
import type { CaroGame, CaroOptions, CaroRating } from "./caro/types";
import type { ChessAnalysis, ChessBot, ChessGame, ChessPhrase, ChessRating, ChessStats, EvalResult } from "./chess/types";
import type { ActResult, Catalog, Farm, FriendSummary, Leaderboard, Market, PublicFarm } from "./farm/types";
import type { GameSummary, PuzzleSummary } from "./puzzles/types";
import type { StreakSummary } from "./streaks/types";
import { API_URL } from "./config";
import { getToken } from "./session";
import type {
  AdminUser,
  Conversation,
  ErrorReport,
  Me,
  Message,
  Pin,
  Post,
  PostComment,
  ProfileStats,
  Reaction,
  StoragePayload,
  StorageSettings,
  User,
} from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;
  /** Dữ liệu máy chủ gửi kèm lỗi (vd trạng thái ván cờ mới nhất) */
  data?: any;
  constructor(message: string, status: number, code?: string, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Options = { method?: Method; body?: unknown; timeout?: number; auth?: boolean; token?: string | null };

let onUnauthorized: ((message: string) => void) | null = null;
let onMustChange: (() => void) | null = null;

/** Cửa hàng dữ liệu đăng ký để biết khi phiên hết hạn (401) hoặc cần đổi mật khẩu. */
export function setAuthHandlers(handlers: { unauthorized: (message: string) => void; mustChange: () => void }) {
  onUnauthorized = handlers.unauthorized;
  onMustChange = handlers.mustChange;
}

const OFFLINE = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

function handleError(status: number, data: { error?: string; code?: string } | null, auth: boolean) {
  const err = new ApiError(data?.error || `Có lỗi xảy ra (mã ${status}).`, status, data?.code, data);
  if (auth && status === 401) onUnauthorized?.(err.message);
  else if (err.code === "must_change_password") onMustChange?.();
  return err;
}

export async function request<T>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, timeout = 30000, auth = true } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = !auth ? null : options.token !== undefined ? options.token : await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(OFFLINE, 0);
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* không phải JSON */
  }
  if (!res.ok) throw handleError(res.status, data, auth && Boolean(token) && options.token === undefined);
  return data as T;
}

/** Gửi nguyên nội dung file ảnh (máy chủ tự nhận dạng JPG/PNG/WEBP/GIF). */
async function uploadRaw<T>(path: string, fileUri: string, mime: string): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": mime };
  if (token) headers.Authorization = `Bearer ${token}`;
  let status: number;
  let text: string;
  try {
    if (Platform.OS === "web") {
      const blob = await (await fetch(fileUri)).blob();
      const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: blob });
      status = res.status;
      text = await res.text();
    } else {
      const res = await FileSystem.uploadAsync(`${API_URL}${path}`, fileUri, {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers,
      });
      status = res.status;
      text = res.body;
    }
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* không phải JSON */
  }
  if (status < 200 || status >= 300) throw handleError(status, data, Boolean(token));
  return data as T;
}

/* ---------------- Đăng nhập & tài khoản ---------------- */

export const api = {
  config: () => request<{ appName: string; appPush?: boolean }>("/api/config", { auth: false, timeout: 75000 }),

  login: (username: string, password: string, device: string) =>
    request<{ user: Me; token: string }>("/api/login", {
      method: "POST",
      body: { username, password, client: "app", device },
      auth: false,
      timeout: 75000, // máy chủ miễn phí có thể đang ngủ, cần gần 1 phút để thức dậy
    }),

  /** Báo máy chủ hủy phiên (mã phiên truyền vào vì trên máy đã xóa trước cho nhanh) */
  logout: (token: string) => request<{ ok: true }>("/api/logout", { method: "POST", body: {}, token, timeout: 10000 }),

  me: () => request<{ user: Me | null }>("/api/me", { timeout: 75000 }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ user: Me }>("/api/me/password", { method: "POST", body: { currentPassword, newPassword } }),

  updateName: (displayName: string) => request<{ user: Me }>("/api/me", { method: "PATCH", body: { displayName } }),

  /** Đổi tên và/hoặc lời giới thiệu (gửi trường nào đổi trường đó) */
  updateProfile: (body: { displayName?: string; bio?: string }) => request<{ user: Me }>("/api/me", { method: "PATCH", body }),

  uploadCover: (fileUri: string, mime: string) => uploadRaw<{ user: Me }>("/api/me/cover", fileUri, mime),

  removeCover: () => request<{ user: Me }>("/api/me/cover", { method: "DELETE" }),

  uploadAvatar: (fileUri: string, mime: string) => uploadRaw<{ user: Me }>("/api/me/avatar", fileUri, mime),

  removeAvatar: () => request<{ user: Me }>("/api/me/avatar", { method: "DELETE" }),

  /* ---------------- Chat ---------------- */

  users: () => request<{ users: User[] }>("/api/users"),

  conversations: () => request<{ conversations: Conversation[] }>("/api/conversations"),

  conversation: (id: number) => request<{ conversation: Conversation }>(`/api/conversations/${id}`),

  openDm: (userId: number) =>
    request<{ conversation: Conversation }>("/api/conversations/dm", { method: "POST", body: { userId } }),

  messages: (id: number, before?: number, limit = 40) =>
    request<{ messages: Message[]; hasMore: boolean; reads: { userId: number; lastReadId: number }[] }>(
      `/api/conversations/${id}/messages?limit=${limit}${before ? `&before=${before}` : ""}`,
    ),

  sync: (id: number, after: number, since: number) =>
    request<{ messages: Message[]; changed: Message[]; nextAfter: number; nextSince: number; more: boolean }>(
      `/api/conversations/${id}/sync?after=${after}&since=${since}`,
    ),

  uploadImage: (fileUri: string, mime: string, width: number, height: number) =>
    uploadRaw<{ url: string }>(`/api/upload?w=${Math.round(width)}&h=${Math.round(height)}`, fileUri, mime),

  /** File ghi âm của tin nhắn thoại (M4A từ máy ghi của app) */
  uploadAudio: (fileUri: string, mime: string) => uploadRaw<{ url: string }>("/api/upload/audio", fileUri, mime),

  send: (
    conversationId: number,
    body: { text?: string; image?: string; audio?: string; audioMs?: number; audioWave?: string; replyTo?: number; clientId?: string; mentions?: number[] },
  ) =>
    request<{ message: Message }>(`/api/conversations/${conversationId}/messages`, { method: "POST", body }),

  read: (conversationId: number, messageId?: number) =>
    request<{ ok: true; unreadTotal: number }>(`/api/conversations/${conversationId}/read`, {
      method: "POST",
      body: messageId ? { messageId } : {},
    }),

  recall: (messageId: number) => request<{ ok: true }>(`/api/messages/${messageId}`, { method: "DELETE" }),

  /* 2.1.0: sửa, ghim, tìm, chuyển tiếp, tắt thông báo, chủ đề, bình chọn, ảnh đã gửi */
  editMessage: (messageId: number, text: string, mentions: number[]) =>
    request<{ message: Message }>(`/api/messages/${messageId}`, { method: "PATCH", body: { text, mentions } }),
  pins: (convId: number) => request<{ pins: Pin[] }>(`/api/conversations/${convId}/pins`),
  pin: (messageId: number, pinned: boolean) => request<{ pins: Pin[] }>(`/api/messages/${messageId}/pin`, { method: "POST", body: { pinned } }),
  search: (convId: number, q: string) =>
    request<{ results: Message[]; hasMore: boolean }>(`/api/conversations/${convId}/search?q=${encodeURIComponent(q)}`),
  forward: (messageId: number, conversationIds: number[]) =>
    request<{ messages: Message[] }>(`/api/messages/${messageId}/forward`, { method: "POST", body: { conversationIds } }),
  convPrefs: (convId: number, body: { mutedUntil?: number; pinned?: boolean }) =>
    request<{ conversation: Conversation }>(`/api/conversations/${convId}/prefs`, { method: "PATCH", body }),
  appearance: (convId: number, body: { theme?: string; emoji?: string }) =>
    request<{ conversation: Conversation }>(`/api/conversations/${convId}/appearance`, { method: "PATCH", body }),
  createPoll: (convId: number, body: { question: string; options: string[]; multi: boolean }) =>
    request<{ message: Message }>(`/api/conversations/${convId}/polls`, { method: "POST", body }),
  vote: (messageId: number, options: number[]) => request<{ message: Message }>(`/api/messages/${messageId}/vote`, { method: "POST", body: { options } }),
  closePoll: (messageId: number) => request<{ message: Message }>(`/api/messages/${messageId}/poll/close`, { method: "POST", body: {} }),
  media: (convId: number, before?: number) =>
    request<{ images: { id: number; senderId: number; image: string; createdAt: number }[]; hasMore: boolean }>(
      `/api/conversations/${convId}/media${before ? `?before=${before}` : ""}`,
    ),
  adminErrors: () => request<{ errors: ErrorReport[]; total: number; times: number }>("/api/admin/errors"),
  deleteError: (id: number) => request<{ ok: true }>(`/api/admin/errors/${id}`, { method: "DELETE" }),
  clearErrors: () => request<{ ok: true }>("/api/admin/errors", { method: "DELETE" }),

  react: (messageId: number, emoji: string) =>
    request<{ conversationId: number; messageId: number; reactions: Reaction[] }>(`/api/messages/${messageId}/reactions`, {
      method: "POST",
      body: { emoji },
    }),

  /* ---------------- Nhóm ---------------- */

  createGroup: (name: string, memberIds: number[]) =>
    request<{ conversation: Conversation }>("/api/groups", { method: "POST", body: { name, memberIds } }),

  renameGroup: (id: number, name: string) =>
    request<{ conversation: Conversation }>(`/api/groups/${id}`, { method: "PATCH", body: { name } }),

  addMembers: (id: number, userIds: number[]) =>
    request<{ conversation: Conversation }>(`/api/groups/${id}/members`, { method: "POST", body: { userIds } }),

  removeMember: (id: number, userId: number) =>
    request<{ ok: true }>(`/api/groups/${id}/members/${userId}`, { method: "DELETE" }),

  /* ---------------- Thông báo đẩy ---------------- */

  registerPush: (token: string, platform: string) =>
    request<{ ok: true; enabled: boolean }>("/api/app/push", { method: "POST", body: { token, platform } }),

  removePush: (pushToken: string, session?: string) =>
    request<{ ok: true }>("/api/app/push/remove", {
      method: "POST",
      body: { token: pushToken },
      ...(session ? { token: session, timeout: 10000 } : {}),
    }),

  testPush: () => request<{ ok: true; sent: number }>("/api/push/test", { method: "POST", body: {} }),

  /* ---------------- Cờ vua ---------------- */

  chess: () =>
    request<{
      rating: ChessRating;
      bots: ChessBot[];
      /** Nhóm máy theo sức cờ (bản máy chủ cũ không có) */
      botTiers?: { id: string; name: string }[];
      /** Máy tự chọn sức: khoảng ELO */
      customElo?: { min: number; max: number; step: number };
      /** Các máy đã thắng không cần trợ giúp */
      beaten?: string[];
      /** Cờ theo ngày: số ngày mỗi nước máy chủ nhận */
      dailyDays?: number[];
      /** Câu nói nhanh trong ván với bạn */
      phrases?: ChessPhrase[];
      baseMinutes: number[];
      challenges: ChessGame[];
      active: ChessGame[];
      recent: ChessGame[];
    }>("/api/chess"),

  chessLeaderboard: () => request<{ players: ChessRating[]; me: ChessRating }>("/api/chess/leaderboard"),

  chessGame: (id: number) => request<{ game: ChessGame }>(`/api/chess/games/${id}`),

  chessChallenge: (body: { opponentId: number; base: number; inc: number; days?: number; color: string; rated: boolean }) =>
    request<{ game: ChessGame }>("/api/chess/challenges", { method: "POST", body }),

  chessAnswer: (id: number, action: "accept" | "decline" | "cancel") =>
    request<{ game: ChessGame }>(`/api/chess/challenges/${id}/${action}`, { method: "POST", body: {} }),

  chessBot: (body: { bot: string; base: number; inc: number; color: string }) =>
    request<{ game: ChessGame }>("/api/chess/bot", { method: "POST", body }),

  chessMove: (id: number, move: string, ply: number) =>
    request<{ game: ChessGame; san: string }>(`/api/chess/games/${id}/move`, { method: "POST", body: { move, ply } }),

  chessResign: (id: number) => request<{ game: ChessGame }>(`/api/chess/games/${id}/resign`, { method: "POST", body: {} }),

  chessAbort: (id: number) => request<{ game: ChessGame }>(`/api/chess/games/${id}/abort`, { method: "POST", body: {} }),

  chessDraw: (id: number, action: "offer" | "accept" | "decline") =>
    request<{ game: ChessGame }>(`/api/chess/games/${id}/draw`, { method: "POST", body: { action } }),

  /** Bàn phân tích: Stockfish chấm thế cờ (dãy nước từ đầu ván) */
  chessEval: (moves: string[]) =>
    request<{ eval: EvalResult; opening: { eco: string; name: string } | null; turn: "w" | "b"; cached?: boolean }>("/api/chess/eval", {
      method: "POST",
      body: { moves, lines: 3 },
    }),

  /** Thống kê cờ vua của một người ("me" = mình) */
  chessStats: (userId: number | "me") => request<{ stats: ChessStats }>(`/api/chess/stats/${userId}`),

  /** Câu nói nhanh trong ván với bạn */
  chessSay: (id: number, phrase: string) => request<{ game: ChessGame }>(`/api/chess/games/${id}/say`, { method: "POST", body: { phrase } }),

  /** Ván với máy: gợi ý nước đi (Stockfish) */
  chessHint: (id: number) => request<{ move: string; game: ChessGame }>(`/api/chess/games/${id}/hint`, { method: "POST", body: {} }),

  /** Ván với máy: đi lại nước vừa đi */
  chessTakeback: (id: number) => request<{ game: ChessGame }>(`/api/chess/games/${id}/takeback`, { method: "POST", body: {} }),

  chessRematch: (id: number) => request<{ game: ChessGame }>(`/api/chess/games/${id}/rematch`, { method: "POST", body: {} }),

  chessHistory: (before?: number, beforeId?: number) =>
    request<{ games: ChessGame[]; hasMore: boolean }>(
      `/api/chess/history?limit=30${before ? `&before=${before}` : ""}${beforeId ? `&beforeId=${beforeId}` : ""}`,
    ),

  chessAnalysis: (id: number) => request<{ analysis: ChessAnalysis }>(`/api/chess/games/${id}/analysis`),

  chessAnalyze: (id: number) => request<{ analysis: ChessAnalysis }>(`/api/chess/games/${id}/analysis`, { method: "POST", body: {} }),

  /* ---------------- Cờ caro (chơi với bạn bè; chơi với máy thì chạy hẳn trên điện thoại) ---------------- */

  caro: () => request<{ games: CaroGame[]; me: CaroRating; leaderboard: CaroRating[]; options: CaroOptions }>("/api/caro"),

  caroGame: (id: number) => request<{ game: CaroGame }>(`/api/caro/games/${id}`),

  caroChallenge: (body: { opponentId: number; turnSeconds: number; rule: string; side: string; rated: boolean }) =>
    request<{ game: CaroGame }>("/api/caro/challenges", { method: "POST", body }),

  caroAnswer: (id: number, action: "accept" | "decline" | "cancel") =>
    request<{ game: CaroGame }>(`/api/caro/challenges/${id}/${action}`, { method: "POST", body: {} }),

  /** Gửi lại cùng nước (cùng ply) cũng được: máy chủ trả ván hiện tại */
  caroMove: (id: number, index: number, ply: number) =>
    request<{ game: CaroGame }>(`/api/caro/games/${id}/move`, { method: "POST", body: { index, ply }, timeout: 15000 }),

  /** Đầu hàng (trước khi đủ 2 nước thì là hủy ván, không tính điểm) */
  caroResign: (id: number) => request<{ game: CaroGame }>(`/api/caro/games/${id}/resign`, { method: "POST", body: {} }),

  /** Đấu lại: gửi lời thách đấu mới, đổi bên */
  caroRematch: (id: number) => request<{ game: CaroGame }>(`/api/caro/games/${id}/rematch`, { method: "POST", body: {} }),

  /* ---------------- Chuỗi hằng ngày của mọi game (src/streaks.js) ---------------- */

  streaks: () => request<StreakSummary>("/api/streaks"),

  /** Game chạy trên máy (Xếp Khối, cờ caro với máy): gửi các ngày đã chơi */
  streaksPlayed: (game: string, days: string[], plays?: { day: string; t?: number }[]) =>
    request<StreakSummary>("/api/streaks/played", { method: "POST", body: { game, days, plays, now: Date.now() } }),

  streaksPrefs: (remind: boolean) => request<StreakSummary>("/api/streaks/prefs", { method: "POST", body: { remind } }),

  /* ---------------- Câu đố: Quiz hằng ngày + Thử thách nhanh (src/puzzles.js) ---------------- */

  puzzles: () => request<PuzzleSummary>("/api/puzzles"),
  /** Bộ câu đố mới hơn bản trong app (máy chủ đã thêm màn) */
  puzzleData: (game: string) => request<unknown>(`/puzzles/${game}.json`),

  /** Giải xong màn `level` (tính từ 1). 400 = lời giải sai (bỏ), 409 = màn chưa mở (giữ, gửi sau) */
  puzzleLevel: (game: string, body: { level: number; moves: unknown[]; mistakes: number; hints: number; ms: number; playedAt: number }) =>
    request<{ game: string; summary: GameSummary }>(`/api/puzzles/${game}/level`, { method: "POST", body: { ...body, now: Date.now() } }),

  /** Giải xong quiz của ngày `day` (hôm nay, hoặc hôm qua nếu giải lúc mất mạng). 400 / 409 = bỏ */
  puzzleDaily: (game: string, body: { day: string; id: string; moves: unknown[]; mistakes: number; hints: number; ms: number; playedAt: number }) =>
    request<{ game: string; first: boolean; summary: GameSummary }>(`/api/puzzles/${game}/daily`, { method: "POST", body: { ...body, now: Date.now() } }),

  /* ---------------- Nông trại (máy chủ giữ luật: src/farm.js) ---------------- */

  /** cv = phiên bản danh mục đang có (khác thì máy chủ gửi kèm danh mục mới); peek = chưa có nông trại thì đừng tạo */
  farm: (cv: string, peek = false) =>
    request<{ now: number; catalogVersion: string; farm: Farm | null; market?: Market; catalog?: Catalog }>(
      `/api/farm?cv=${encodeURIComponent(cv)}${peek ? "&peek=1" : ""}`,
    ),

  farmAct: (body: Record<string, unknown>) => request<{ now: number; result: ActResult; farm: Farm }>("/api/farm/act", { method: "POST", body }),

  farmFriends: () => request<{ now: number; friends: FriendSummary[] }>("/api/farm/friends"),

  farmLeaderboard: () => request<Leaderboard & { now: number }>("/api/farm/leaderboard"),

  farmOf: (userId: number) => request<{ now: number; userId: number; farm: PublicFarm }>(`/api/farm/u/${userId}`),

  /** Ghé vườn bạn: bắt sâu giúp (help) hoặc hái trộm (steal) */
  farmVisitAct: (userId: number, action: "help" | "steal", plot: number) =>
    request<{ now: number; result: ActResult; farm: PublicFarm; me: Farm }>(`/api/farm/u/${userId}/act`, { method: "POST", body: { action, plot } }),

  /* ---------------- Trang cá nhân, bảng tin ---------------- */

  profile: (userId: number) => request<{ stats: ProfileStats }>(`/api/users/${userId}/profile`),

  /* ----- Trò chơi: bảng xếp hạng Xếp Khối ----- */
  blocks: () => request<BlocksBoard>("/api/games/blocks"),

  blocksSubmit: (scores: Omit<PendingScore, "uid">[]) =>
    request<BlocksBoard & { accepted: string[]; rejected: { id: string; error: string }[]; newBest: boolean }>("/api/games/blocks/scores", {
      method: "POST",
      body: { scores, now: Date.now() }, // now: máy chủ đổi giờ điện thoại sang giờ máy chủ
    }),

  /** Bảng tin (userId = null) hoặc bài của một người; before = mã bài cũ nhất đã có */
  posts: (userId: number | null, before?: number) =>
    request<{ posts: Post[]; hasMore: boolean }>(
      `${userId == null ? "/api/posts" : `/api/users/${userId}/posts`}?limit=20${before ? `&before=${before}` : ""}`,
    ),

  post: (id: number) => request<{ post: Post }>(`/api/posts/${id}`),

  createPost: (body: { text: string; image?: string; gameId?: number }) => request<{ post: Post }>("/api/posts", { method: "POST", body }),

  deletePost: (id: number) => request<{ ok: true }>(`/api/posts/${id}`, { method: "DELETE" }),

  likePost: (id: number, liked: boolean) =>
    request<{ liked: boolean; likes: number }>(`/api/posts/${id}/like`, { method: "POST", body: { liked } }),

  postLikes: (id: number) => request<{ userIds: number[] }>(`/api/posts/${id}/likes`),

  comments: (postId: number) => request<{ comments: PostComment[] }>(`/api/posts/${postId}/comments`),

  addComment: (postId: number, text: string) =>
    request<{ comment: PostComment; comments: number }>(`/api/posts/${postId}/comments`, { method: "POST", body: { text } }),

  deleteComment: (id: number) => request<{ ok: true; comments: number }>(`/api/comments/${id}`, { method: "DELETE" }),

  /* ---------------- Quản trị ---------------- */

  adminUsers: () => request<{ users: AdminUser[] }>("/api/admin/users"),

  createUser: (body: { username: string; displayName: string; password?: string; role: "admin" | "member" }) =>
    request<{ user: AdminUser; password: string }>("/api/admin/users", { method: "POST", body }),

  resetPassword: (id: number) =>
    request<{ user: AdminUser; password: string }>(`/api/admin/users/${id}/reset-password`, { method: "POST", body: {} }),

  setDisabled: (id: number, disabled: boolean) =>
    request<{ user: AdminUser }>(`/api/admin/users/${id}/disabled`, { method: "POST", body: { disabled } }),

  setRole: (id: number, role: "admin" | "member") =>
    request<{ user: AdminUser }>(`/api/admin/users/${id}/role`, { method: "POST", body: { role } }),

  storage: () => request<StoragePayload>("/api/admin/storage"),

  saveStorageSettings: (settings: Partial<StorageSettings>) =>
    request<StoragePayload>("/api/admin/storage/settings", { method: "PATCH", body: settings }),

  cleanup: (kind: "images" | "messages", olderThanDays: number, dryRun: boolean) =>
    request<StoragePayload & { result: { count: number; bytes: number; dryRun: boolean } }>("/api/admin/storage/cleanup", {
      method: "POST",
      body: { kind, olderThanDays, dryRun },
    }),
};

/** Địa chỉ đầy đủ của ảnh trên máy chủ (/uploads/...). */
export const fileUrl = (path: string) => (/^https?:/i.test(path) ? path : `${API_URL}${path}`);
