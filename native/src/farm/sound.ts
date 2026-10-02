import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { FARM_SOURCES, type FarmSound } from "./soundFiles";

// Âm thanh Nông trại. Tiếng hay lặp nhanh (gieo, thu hoạch, xu) có 2 trình phát để phát chồng lên nhau được.

export type { FarmSound };

const POOL: Partial<Record<FarmSound, number>> = { plant: 2, harvest: 2, coin: 2, bug: 2 };
const players: Partial<Record<FarmSound, AudioPlayer[]>> = {};
const next: Partial<Record<FarmSound, number>> = {};
const timers = new Set<ReturnType<typeof setTimeout>>();
let modeSet = false;
let enabled = true;

export function setFarmSound(on: boolean) {
  enabled = on;
  if (!on) {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }
}

function pool(name: FarmSound) {
  let list = players[name];
  if (!list) {
    list = [];
    for (let i = 0; i < (POOL[name] || 1); i++) list.push(createAudioPlayer(FARM_SOURCES[name]));
    players[name] = list;
  }
  return list;
}

/** Tạo sẵn trình phát khi mở nông trại, để tiếng đầu tiên không bị trễ */
export function preloadFarmSounds() {
  if (!enabled) return;
  try {
    if (!modeSet) {
      modeSet = true;
      // Tiếng ngắn: phát chung với nhạc của app khác, không giành quyền phát
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false }).catch(() => undefined);
    }
    for (const name of Object.keys(FARM_SOURCES) as FarmSound[]) pool(name);
  } catch {
    /* máy không phát được âm thanh */
  }
}

function playNow(name: FarmSound, volume: number) {
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

/** Phát một tiếng; delay (ms) để hai tiếng liền nhau không đè lên nhau */
export function playFarm(name: FarmSound, volume = 1, delay = 0) {
  if (!enabled) return;
  if (!delay) {
    playNow(name, volume);
    return;
  }
  const t = setTimeout(() => {
    timers.delete(t);
    if (enabled) playNow(name, volume);
  }, delay);
  timers.add(t);
}
