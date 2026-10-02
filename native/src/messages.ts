// Xử lý danh sách tin nhắn (thuần dữ liệu, có kiểm thử trong tests/)
import type { ChatItem, Message, PendingMessage, Reaction, ReplyRef } from "./types";

export const isPending = (m: ChatItem): m is PendingMessage => m.id === null;

/** Gộp tin từ máy chủ vào danh sách: theo mã tăng dần, tin đang gửi luôn ở cuối, tin trùng mã thì lấy bản mới. */
export function mergeMessages(list: ChatItem[], incoming: Message[]): ChatItem[] {
  const byId = new Map<number, Message>();
  for (const m of list) if (!isPending(m)) byId.set(m.id, m);
  const doneClientIds = new Set<string>();
  for (const m of incoming) {
    byId.set(m.id, m);
    if (m.clientId) doneClientIds.add(m.clientId);
  }
  const pending = list.filter((m): m is PendingMessage => isPending(m) && !doneClientIds.has(m.clientId));
  const sorted: ChatItem[] = [...byId.values()].sort((a, b) => a.id - b.id);
  return sorted.concat(pending);
}

/**
 * Trang tin mới nhất vừa tải về. Nếu có khoảng trống giữa bản lưu trên máy và trang mới
 * (vắng mặt lâu, có quá nhiều tin mới) thì bỏ bản cũ để không bị hụt tin ở giữa.
 */
export function mergeLatestPage(list: ChatItem[], page: Message[], pageHasMore: boolean): ChatItem[] {
  const saved = list.filter((m): m is Message => !isPending(m));
  if (!page.length || !saved.length || !pageHasMore) return mergeMessages(list, page);
  const newestSaved = saved[saved.length - 1].id;
  const overlaps = page[0].id <= newestSaved;
  if (overlaps) return mergeMessages(list, page);
  return mergeMessages(list.filter(isPending), page);
}

/** Tin mình vừa gửi quay về từ máy chủ: thay bản tạm có cùng clientId. */
export function receiveMessage(list: ChatItem[], msg: Message): { list: ChatItem[]; isNew: boolean } {
  if (list.some((m) => m.id === msg.id)) return { list: mergeMessages(list, [msg]), isNew: false };
  const hadPending = Boolean(msg.clientId && list.some((m) => isPending(m) && m.clientId === msg.clientId));
  return { list: mergeMessages(list, [msg]), isNew: !hadPending };
}

/** Bấm lại đúng cảm xúc cũ thì gỡ, chọn cảm xúc khác thì đổi (giống máy chủ) */
export function toggleReaction(list: Reaction[], userId: number, emoji: string): Reaction[] {
  const current = list.find((r) => r.userId === userId);
  const others = list.filter((r) => r.userId !== userId);
  if (current && current.emoji === emoji) return others;
  return [...others, { userId, emoji }];
}

/** Trích dẫn ngắn của tin được trả lời */
export function quoteOf(m: ChatItem): ReplyRef {
  return {
    id: m.id ?? 0,
    senderId: m.senderId,
    deleted: false,
    missing: false,
    text: m.text ? String(m.text).replace(/\s+/g, " ").trim().slice(0, 140) : null,
    image: m.kind !== "voice" && Boolean(m.image || (isPending(m) && m.localUri)),
    audio: m.kind === "voice",
  };
}

export const newClientId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Mã tin cuối cùng đã có trên máy chủ */
export function lastServerId(list: ChatItem[]) {
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!isPending(m)) return m.id;
  }
  return 0;
}
