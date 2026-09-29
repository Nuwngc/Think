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
};

export type Message = {
  id: number;
  conversationId: number;
  senderId: number;
  kind: "text" | "system";
  text: string | null;
  image: string | null;
  deleted: boolean;
  createdAt: number;
  replyTo: ReplyRef | null;
  reactions: Reaction[];
  imagePurged?: boolean;
  clientId?: string;
};

/** Tin đang gửi (chưa có mã từ máy chủ) hoặc gửi lỗi. */
export type PendingMessage = {
  id: null;
  clientId: string;
  conversationId: number;
  senderId: number;
  kind: "text";
  text: string | null;
  image: null;
  deleted: false;
  createdAt: number;
  replyTo: ReplyRef | null;
  reactions: Reaction[];
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
};
