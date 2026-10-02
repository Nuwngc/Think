import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import * as V from "../src/voice/core";

const require = createRequire(import.meta.url);
const web = require("../../public/voice-core.js");

describe("tin nhắn thoại: phần dùng chung", () => {
  it("bản app và bản web cho cùng kết quả", () => {
    const samples = [[], [0, 0, 0], [1, 1], Array.from({ length: 123 }, (_, i) => (i % 10) / 9), Array.from({ length: 1500 }, (_, i) => Math.abs(Math.sin(i / 7)))];
    for (const s of samples) expect(V.encodeWave(s)).toBe(web.encodeWave(s));
    for (const w of ["", "0v", "abc", "XYZ", "0".repeat(40), "v".repeat(64), "a".repeat(65)]) expect(V.decodeWave(w)).toEqual(web.decodeWave(w));
    for (const db of [0, -10, -25, -50, -160, NaN]) expect(V.levelFromDb(db)).toBe(web.levelFromDb(db));
    for (const ms of [0, 499, 500, 7400, 65000, 125000]) expect(V.clock(ms)).toBe(web.clock(ms));
    expect([V.BARS, V.MAX_MS, V.MIN_MS]).toEqual([web.BARS, web.MAX_MS, web.MIN_MS]);
  });

  it("chữ thay cho tin thoại", () => {
    expect(V.voiceLabel(12400)).toBe("🎤 Tin nhắn thoại (0:12)");
    expect(V.voiceLabel(0)).toBe("🎤 Tin nhắn thoại");
  });
});
