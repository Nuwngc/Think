/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { describe, expect, it, vi } from "vitest";

const played = vi.hoisted(() => [] as string[]);
vi.mock("expo-audio", () => ({
  setAudioModeAsync: vi.fn(() => Promise.resolve()),
  createAudioPlayer: (src: string) => ({ seekTo: () => Promise.resolve(), play: () => played.push(src) }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(), setItem: vi.fn(() => Promise.resolve()) } }));
vi.mock("../src/chess/soundFiles", () => ({
  SOURCES: {
    move: "move",
    "move-opp": "move-opp",
    capture: "capture",
    castle: "castle",
    check: "check",
    promote: "promote",
    start: "start",
    end: "end",
    illegal: "illegal",
    lowtime: "lowtime",
  },
}));

import { setPref } from "../src/chess/prefs";
import { playSound, soundForSan } from "../src/chess/sound";

describe("âm thanh cờ vua", () => {
  it("chọn tiếng theo nước đi", () => {
    expect(soundForSan("e4")).toBe("move");
    expect(soundForSan("Nxe5")).toBe("capture");
    expect(soundForSan("Qxf7#")).toBe("check");
    expect(soundForSan("Bb5+")).toBe("check");
    expect(soundForSan("O-O-O")).toBe("castle");
    expect(soundForSan("e8=Q")).toBe("promote");
    expect(soundForSan("exd8=Q+")).toBe("check");
    // Nước của đối thủ nghe khác nước của mình
    expect(soundForSan("e5", false)).toBe("move-opp");
    expect(soundForSan("Nxe5", false)).toBe("capture");
  });

  it("tắt âm thanh thì không phát", async () => {
    playSound("move");
    await Promise.resolve();
    expect(played.length).toBe(1);
    setPref("sound", false);
    playSound("capture");
    await Promise.resolve();
    expect(played.length).toBe(1);
  });
});
