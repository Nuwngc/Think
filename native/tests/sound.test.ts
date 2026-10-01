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

vi.mock("../src/caro/soundFiles", () => ({
  CARO_SOURCES: { "place-x": "c:place-x", "place-o": "c:place-o", turn: "c:turn", threat: "c:threat", invalid: "c:invalid", start: "c:start", win: "c:win", lose: "c:lose", draw: "c:draw" },
}));

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { playCaro, setCaroSound } from "../src/caro/sound";
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

describe("âm thanh cờ caro", () => {
  it("mọi tiếng khai báo đều có file trong app", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "src/caro/soundFiles.ts"), "utf8");
    const files = [...src.matchAll(/require\("\.\.\/\.\.\/(assets\/sounds\/caro\/[\w-]+\.wav)"\)/g)].map((m) => m[1]);
    expect(files).toHaveLength(9);
    for (const f of files) expect(existsSync(join(root, f))).toBe(true);
  });

  it("tắt âm thanh thì không phát, kể cả tiếng đang chờ phát", async () => {
    vi.useFakeTimers();
    const before = played.length;
    setCaroSound(true);
    playCaro("place-x");
    await Promise.resolve();
    expect(played.slice(before)).toEqual(["c:place-x"]);
    playCaro("threat", 0.8, 150); // phát sau tiếng đặt quân
    setCaroSound(false);
    await vi.advanceTimersByTimeAsync(300);
    playCaro("win");
    await Promise.resolve();
    expect(played.slice(before)).toEqual(["c:place-x"]);
    setCaroSound(true);
    playCaro("turn", 0.6, 170);
    await vi.advanceTimersByTimeAsync(200);
    expect(played.slice(before)).toEqual(["c:place-x", "c:turn"]);
    vi.useRealTimers();
  });
});
