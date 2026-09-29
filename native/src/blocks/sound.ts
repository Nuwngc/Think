import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { BLOCK_SOURCES, type BlockSound } from "./soundFiles";

// Âm thanh game Xếp Khối. Tiếng hay phát liên tục (đặt khối, ăn hàng) có 2 trình phát để phát chồng lên nhau được.

const POOL: Partial<Record<BlockSound, number>> = { place: 3, pick: 2, clear1: 2, invalid: 2 };
const players: Partial<Record<BlockSound, AudioPlayer[]>> = {};
const next: Partial<Record<BlockSound, number>> = {};
let modeSet = false;
let enabled = true;

export function setBlockSound(on: boolean) {
  enabled = on;
}

function pool(name: BlockSound) {
  let list = players[name];
  if (!list) {
    list = [];
    for (let i = 0; i < (POOL[name] || 1); i++) list.push(createAudioPlayer(BLOCK_SOURCES[name]));
    players[name] = list;
  }
  return list;
}

/** Tạo sẵn trình phát khi mở game, để tiếng đầu tiên không bị trễ */
export function preloadBlockSounds() {
  try {
    if (!modeSet) {
      modeSet = true;
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false }).catch(() => undefined);
    }
    for (const name of Object.keys(BLOCK_SOURCES) as BlockSound[]) pool(name);
  } catch {
    /* máy không phát được âm thanh */
  }
}

export function playBlock(name: BlockSound, volume = 1) {
  if (!enabled) return;
  try {
    const list = pool(name);
    const k = (next[name] || 0) % list.length;
    next[name] = k + 1;
    const p = list[k];
    p.volume = volume;
    p.seekTo(0)
      .then(() => p.play())
      .catch(() => p.play());
  } catch {
    /* bỏ qua */
  }
}
