/* eslint-disable import/first -- vi.mock phải đứng trước import */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ created: [] as string[], played: [] as string[], removed: [] as string[] }));
vi.mock("expo-audio", () => ({
  setAudioModeAsync: vi.fn(() => Promise.resolve()),
  createAudioPlayer: (src: string) => {
    log.created.push(src);
    return { volume: 1, seekTo: () => Promise.resolve(), play: () => log.played.push(src), remove: () => log.removed.push(src) };
  },
}));
vi.mock("../src/farm/soundFiles", () => ({
  FARM_SOURCES: Object.fromEntries(
    ["plant", "harvest", "coin", "order", "craft", "collect", "levelup", "bug", "steal", "dog", "build", "gift", "error"].map((k) => [k, `f:${k}`]),
  ),
}));

import { playFarm, preloadFarmSounds, releaseFarmSounds, setFarmSound } from "../src/farm/sound";

describe("âm thanh Nông trại", () => {
  beforeEach(() => {
    releaseFarmSounds();
    log.created.length = 0;
    log.played.length = 0;
    log.removed.length = 0;
    setFarmSound(true);
  });

  it("mọi tiếng khai báo đều có file trong app", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "src/farm/soundFiles.ts"), "utf8");
    const files = [...src.matchAll(/require\("\.\.\/\.\.\/(assets\/sounds\/farm\/[\w-]+\.wav)"\)/g)].map((m) => m[1]);
    expect(files).toHaveLength(13);
    for (const f of files) expect(existsSync(join(root, f))).toBe(true);
  });

  it("chỉ tạo trình phát cho tiếng cần dùng, trả lại hết khi rời nông trại", async () => {
    preloadFarmSounds();
    expect(log.created).toEqual(["f:plant", "f:harvest", "f:coin"]); // không tạo sẵn cả 13 tiếng
    playFarm("harvest");
    playFarm("harvest");
    playFarm("levelup");
    await Promise.resolve();
    expect(log.created).toEqual(["f:plant", "f:harvest", "f:coin", "f:levelup"]);
    expect(log.played).toEqual(["f:harvest", "f:harvest", "f:levelup"]);
    releaseFarmSounds();
    expect(log.removed.sort()).toEqual(["f:coin", "f:harvest", "f:levelup", "f:plant"]);
  });

  it("tắt âm thanh thì không phát, kể cả tiếng đang chờ", async () => {
    vi.useFakeTimers();
    playFarm("coin", 1, 200);
    setFarmSound(false);
    await vi.advanceTimersByTimeAsync(300);
    playFarm("plant");
    await Promise.resolve();
    expect(log.played).toEqual([]);
    vi.useRealTimers();
  });
});
