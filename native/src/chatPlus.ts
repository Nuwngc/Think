import type { Conversation } from "./types";

// Các hàm thuần cho tính năng chat 2.1.0 (dễ kiểm thử, không phụ thuộc React Native).

const lastActivity = (c: Pick<Conversation, "lastMessage" | "createdAt">) => c.lastMessage?.createdAt || c.createdAt || 0;

/** Cuộc trò chuyện đã ghim lên đầu (mới ghim trước), sau đó theo tin mới nhất */
export const byPinnedThenActivity = (
  a: Pick<Conversation, "pinnedAt" | "lastMessage" | "createdAt">,
  b: Pick<Conversation, "pinnedAt" | "lastMessage" | "createdAt">,
) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) || (b.pinnedAt || 0) - (a.pinnedAt || 0) || lastActivity(b) - lastActivity(a);

/** Chữ đang gõ sau dấu @ ở cuối ô nhập (null nếu không đang nhắc tên ai) */
export function mentionToken(draft: string) {
  const m = /(?:^|\s)@([^\s@]{0,24})$/.exec(draft);
  return m ? m[1] : null;
}

/** Thay chữ @đang-gõ ở cuối ô nhập bằng @Tên đầy đủ */
export function applyMention(draft: string, name: string) {
  return draft.replace(/@([^\s@]{0,24})$/, `@${name} `);
}

/** Những người được chọn từ danh sách gợi ý mà tên vẫn còn trong tin nhắn */
export function mentionIds(picks: Record<string, number>, text: string) {
  return [...new Set(Object.entries(picks).filter(([name]) => text.includes(`@${name}`)).map(([, id]) => id))];
}

export type MentionPart = { text: string; mention: boolean; me: boolean };

/** Tách nội dung tin nhắn thành các đoạn thường và đoạn @Tên để tô màu */
export function mentionParts(text: string, mentions: number[] | undefined, nameOf: (id: number) => string, meId: number): MentionPart[] {
  if (!mentions?.length) return [{ text, mention: false, me: false }];
  const list = [...new Set(mentions)].map((id) => ({ id, name: nameOf(id) })).sort((a, b) => b.name.length - a.name.length);
  const out: MentionPart[] = [];
  let rest = text;
  while (rest) {
    let best: { at: number; id: number; name: string } | null = null;
    for (const x of list) {
      const at = rest.indexOf(`@${x.name}`);
      if (at >= 0 && (!best || at < best.at)) best = { at, ...x };
    }
    if (!best) {
      out.push({ text: rest, mention: false, me: false });
      break;
    }
    if (best.at > 0) out.push({ text: rest.slice(0, best.at), mention: false, me: false });
    out.push({ text: `@${best.name}`, mention: true, me: best.id === meId });
    rest = rest.slice(best.at + best.name.length + 1);
  }
  return out;
}

/** Phần trăm phiếu cho từng lựa chọn (làm tròn, tổng theo số người đã bầu) */
export function pollPercents(options: { votes: number[] }[]) {
  const voters = new Set(options.flatMap((o) => o.votes)).size;
  return { voters, percents: options.map((o) => (voters ? Math.round((o.votes.length / voters) * 100) : 0)) };
}
