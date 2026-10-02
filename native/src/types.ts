// Dữ liệu máy chủ Think trả về (xem server.js: publicUser, serializeMessage, serializeConv; src/social.js: bài đăng)
import type { ChessGame } from "./chess/types";

export type User = {
  id: number;
  username: string;
  displayName: string;
  avatar: string | null;
  /** Ảnh bìa trang cá nhân (máy chủ cũ chưa có) */
  cover?: string | null;
  /** Lời giới thiệu ngắn */
  bio?: string;
  joinedAt?: number | null;
  role: "admin" | "member";
  disabled: boolean;
  online: boolean;
  lastSeen: number | null;
};

export type Me = User & { mustChangePassword: boolean };

export type AdminUser = User & { mustChangePassword: boolean; createdAt: number };

export type Reaction = { userId: number; emoji: string };

export type ReplyRef = {
  id: number;
  senderId: number | null;
  deleted: boolean;
  missing: boolean;
  text: string | null;
  image: boolean;
  /** Tin được trả lời là tin nhắn thoại */
  audio?: boolean;
};

/** Tin nhắn thoại: file ghi âm, độ dài (ms), dạng sóng (src/voice/core.ts) */
export type VoiceAudio = { url: string; ms: number; wave: string };

/** Bình chọn trong cuộc trò chuyện (tin loại "poll", câu hỏi nằm ở text) */
export type Poll = {
  multi: boolean;
  closed: boolean;
  options: { text: string; votes: number[] }[];
};

export type Message = {
  id: number;
  conversationId: number;
  senderId: number;
  kind: "text" | "system" | "poll" | "voice";
  text: string | null;
  image: string | null;
  deleted: boolean;
  createdAt: number;
  replyTo: ReplyRef | null;
  reactions: Reaction[];
  imagePurged?: boolean;
  /** Tin nhắn thoại (null: file đã bị dọn khỏi máy chủ) */
  audio?: VoiceAudio | null;
  audioPurged?: boolean;
  clientId?: string;
  /** Lần sửa gần nhất (đã chỉnh sửa) */
  editedAt?: number;
  /** Chuyển tiếp từ cuộc trò chuyện khác */
  forwarded?: boolean;
  /** Những người được @nhắc tên */
  mentions?: number[];
  poll?: Poll | null;
};

/** Tin nhắn được ghim trong cuộc trò chuyện */
export type Pin = { message: Message; pinnedBy: number | null; pinnedAt: number };

/** Tin đang gửi (chưa có mã từ máy chủ) hoặc gửi lỗi. */
export type PendingMessage = {
  id: null;
  clientId: string;
  conversationId: number;
  senderId: number;
  kind: "text" | "voice";
  text: string | null;
  image: null;
  deleted: false;
  createdAt: number;
  replyTo: ReplyRef | null;
  reactions: Reaction[];
  mentions?: number[];
  /** Tin nhắn thoại đang gửi: url = file ghi âm trên máy */
  audio?: VoiceAudio;
  /** Đã tải file ghi âm lên (gửi lại thì khỏi tải lần nữa) */
  uploadedAudio?: string;
  localUri?: string;
  mime?: string;
  width?: number;
  height?: number;
  status: "sending" | "failed";
  error?: string;
};

export type ChatItem = Message | PendingMessage;

export type ConversationType = "general" | "dm" | "group";

export type Conversation = {
  id: number;
  type: ConversationType;
  name: string | null;
  memberCount: number;
  memberIds: number[] | null;
  createdBy: number | null;
  peerId: number | null;
  peerLastReadId: number | null;
  lastReadId: number;
  unread: number;
  createdAt: number;
  lastMessage: Message | null;
  /** Ai đã đọc tới tin nào (chỉ có sau khi mở cuộc trò chuyện) */
  reads?: Record<number, number>;
  /** Chủ đề (màu bong bóng chat) và biểu tượng gửi nhanh, chung cả cuộc trò chuyện (máy chủ cũ chưa có) */
  theme?: string;
  emoji?: string;
  /** Riêng mình: tắt thông báo tới lúc nào (-1 = mãi mãi, 0 = đang bật), ghim lên đầu danh sách */
  mutedUntil?: number;
  pinnedAt?: number | null;
};

export type StorageUsage = {
  total: number;
  limit: number;
  limitSource: string;
  percent: number;
  db: { bytes: number; messages: number };
  images: { count: number; bytes: number };
  avatars: { count: number; bytes: number };
  cloud: boolean;
};

export type StorageSettings = { autoClean: boolean; cleanAt: number; cleanTo: number; limitMb: number | null };

export type CleanupResult = {
  kind: "images" | "messages";
  olderThanDays: number;
  count: number;
  bytes: number;
  dryRun: boolean;
};

export type StoragePayload = {
  usage: StorageUsage;
  settings: StorageSettings;
  lastClean: (CleanupResult & { at: number; auto: boolean; images: number; messages: number }) | null;
};

/* ---------------- Trang cá nhân, bảng tin ---------------- */

export type Post = {
  id: number;
  userId: number;
  text: string;
  image: string | null;
  /** Ván cờ được chia sẻ kèm bài */
  game: ChessGame | null;
  createdAt: number;
  likes: number;
  liked: boolean;
  comments: number;
};

export type PostComment = { id: number; postId: number; userId: number; text: string; createdAt: number };

export type ProfileStats = {
  posts: number;
  likes: number;
  chess: { rating: number; games: number; wins: number } | null;
  blocks?: { best: number; games: number } | null;
  caro?: { rating: number; games: number; wins: number } | null;
};

/** Báo lỗi app (Quản trị → Báo lỗi app) */
export type ErrorReport = {
  id: number;
  kind: string;
  fatal: boolean;
  message: string;
  stack: string | null;
  platform: string;
  appVersion: string | null;
  osVersion: string | null;
  device: string | null;
  where: string | null;
  userIds: number[];
  count: number;
  firstAt: number;
  lastAt: number;
};
