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

let holders = 0;
/**
 * Mở một màn có tiếng Xếp Khối: tạo sẵn trình phát. Trả về hàm gọi khi rời màn — màn cuối cùng rời thì trả lại
 * các luồng âm thanh cho máy (Android chỉ cho mỗi app một số luồng; giữ hết tiếng của mọi game thì tiếng sau không phát được).
 */
export function holdBlockSounds() {
  holders++;
  preloadBlockSounds();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders = Math.max(0, holders - 1);
    if (!holders) releaseBlockSounds();
  };
}

export function releaseBlockSounds() {
  for (const name of Object.keys(players) as BlockSound[]) {
    for (const p of players[name] || []) {
      try {
        p.remove();
      } catch {
        /* đã trả rồi */
      }
    }
    delete players[name];
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
