import { create } from "zustand";

import { api } from "../api";
import type { Conversation } from "../types";

// Think AI giúp đọc chat (2.14.0): tóm tắt tin chưa đọc, dịch tin nhắn. Giống bản web (aiSum / translations
// trong public/app.js); máy chủ src/ai.js. Kết quả chỉ hiện cho người hỏi, không gửi vào cuộc trò chuyện.

export const SUMMARY_UNREAD = 10; // từ 10 tin chưa đọc thì gợi ý tóm tắt

export type SummaryOffer = { convId: number; afterId: number; count: number };
export type SummaryCard = { convId: number; busy: boolean; text: string; error: string; meta: string };
export type Translation = { busy?: boolean; text?: string; to?: "vi" | "en"; error?: string };

type State = {
  offer: SummaryOffer | null;
  card: SummaryCard | null;
  /** messageId -> bản dịch */
  trans: Record<number, Translation>;
};

export const useAiHelp = create<State>(() => ({ offer: null, card: null, trans: {} }));
const get = useAiHelp.getState;
const set = useAiHelp.setState;

export const LANG_NAMES: Record<string, string> = { en: "tiếng Anh", vi: "tiếng Việt" };

export function resetAiHelp() {
  set({ offer: null, card: null, trans: {} });
}

/** Mở cuộc trò chuyện (trước khi đánh dấu đã đọc): nhiều tin chưa đọc thì gợi ý tóm tắt */
export function offerSummary(c: Conversation | undefined) {
  if (!c) return;
  const st = get();
  if (st.offer?.convId === c.id || st.card?.convId === c.id) return;
  set({ offer: c.unread >= SUMMARY_UNREAD ? { convId: c.id, afterId: c.lastReadId || 0, count: c.unread } : null, card: null });
}

export const dismissOffer = () => set({ offer: null });
export const closeSummary = () => set({ card: null });

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** offer = tóm tắt tin chưa đọc; null = tóm tắt 100 tin gần đây */
export async function runSummary(convId: number, offer: SummaryOffer | null) {
  if (get().card?.busy) return;
  set({ offer: null, card: { convId, busy: true, text: "", error: "", meta: offer ? `${offer.count} tin chưa đọc` : "các tin gần đây" } });
  try {
    const r = await api.aiSummary(offer ? { conversationId: convId, afterId: offer.afterId } : { conversationId: convId });
    if (get().card?.convId !== convId) return;
    set({ card: { convId, busy: false, text: r.summary, error: "", meta: `${r.count} tin ${r.unread ? "chưa đọc" : "gần đây"} · từ ${hm(r.from)}` } });
  } catch (err) {
    if (get().card?.convId !== convId) return;
    set({ card: { ...get().card!, busy: false, error: err instanceof Error ? err.message : "Chưa tóm tắt được." } });
  }
}

export async function translate(messageId: number) {
  set((st) => ({ trans: { ...st.trans, [messageId]: { busy: true } } }));
  let entry: Translation;
  try {
    const r = await api.aiTranslate(messageId);
    entry = { text: r.text, to: r.to };
  } catch (err) {
    entry = { error: err instanceof Error ? err.message : "Chưa dịch được." };
  }
  set((st) => ({ trans: { ...st.trans, [messageId]: entry } }));
}

export function hideTranslation(messageId: number) {
  set((st) => {
    const trans = { ...st.trans };
    delete trans[messageId];
    return { trans };
  });
}
