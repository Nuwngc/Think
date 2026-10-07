/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Think AI giúp đọc chat (2.14.0): gợi ý tóm tắt, tóm tắt, dịch — giống aiSum / translations trong public/app.js
const api = vi.hoisted(() => ({ aiSummary: vi.fn(), aiTranslate: vi.fn() }));
vi.mock("../src/api", () => ({ api }));

import { closeSummary, hideTranslation, offerSummary, resetAiHelp, runSummary, SUMMARY_UNREAD, translate, useAiHelp } from "../src/ai/help";
import type { Conversation } from "../src/types";

const conv = (id: number, unread: number, lastReadId = 40) => ({ id, unread, lastReadId }) as Conversation;

beforeEach(() => {
  resetAiHelp();
  vi.clearAllMocks();
});

describe("gợi ý tóm tắt", () => {
  it("từ 10 tin chưa đọc mới gợi ý, nhớ tin cuối đã đọc lúc mở", () => {
    expect(SUMMARY_UNREAD).toBe(10);
    offerSummary(conv(1, 9));
    expect(useAiHelp.getState().offer).toBeNull();
    offerSummary(conv(2, 23, 57));
    expect(useAiHelp.getState().offer).toEqual({ convId: 2, afterId: 57, count: 23 });
    // Mở lại cùng cuộc trò chuyện (đã đánh dấu đọc, unread = 0): giữ gợi ý
    offerSummary(conv(2, 0, 80));
    expect(useAiHelp.getState().offer?.count).toBe(23);
  });

  it("tóm tắt tin chưa đọc, lỗi thì hiện câu báo", async () => {
    offerSummary(conv(2, 23, 57));
    api.aiSummary.mockResolvedValueOnce({ summary: "• Đi ăn lẩu 8h", count: 23, from: new Date(2026, 9, 7, 17, 5).getTime(), to: 0, unread: true });
    const p = runSummary(2, useAiHelp.getState().offer);
    expect(useAiHelp.getState().card).toMatchObject({ convId: 2, busy: true, meta: "23 tin chưa đọc" });
    expect(useAiHelp.getState().offer).toBeNull();
    await p;
    expect(api.aiSummary).toHaveBeenCalledWith({ conversationId: 2, afterId: 57 });
    expect(useAiHelp.getState().card).toMatchObject({ busy: false, text: "• Đi ăn lẩu 8h", meta: "23 tin chưa đọc · từ 17:05" });
    closeSummary();
    api.aiSummary.mockRejectedValueOnce(new Error("Think AI đang tạm nghỉ."));
    await runSummary(2, null);
    expect(api.aiSummary).toHaveBeenLastCalledWith({ conversationId: 2 });
    expect(useAiHelp.getState().card).toMatchObject({ busy: false, error: "Think AI đang tạm nghỉ.", meta: "các tin gần đây" });
  });
});

describe("dịch tin nhắn", () => {
  it("đang dịch → bản dịch; lỗi; ẩn", async () => {
    api.aiTranslate.mockResolvedValueOnce({ text: "Hot pot at 8", to: "en" });
    const p = translate(5);
    expect(useAiHelp.getState().trans[5]).toEqual({ busy: true });
    await p;
    expect(useAiHelp.getState().trans[5]).toEqual({ text: "Hot pot at 8", to: "en" });
    api.aiTranslate.mockRejectedValueOnce(new Error("Hôm nay bạn đã hỏi đủ 40 câu rồi."));
    await translate(6);
    expect(useAiHelp.getState().trans[6]).toEqual({ error: "Hôm nay bạn đã hỏi đủ 40 câu rồi." });
    hideTranslation(5);
    expect(useAiHelp.getState().trans[5]).toBeUndefined();
  });
});
