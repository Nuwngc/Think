import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { FARM_SOURCES, type FarmSound } from "./soundFiles";

// Âm thanh Nông trại.
// Mỗi trình phát giữ một luồng âm thanh của máy, mà máy chỉ cho mỗi app một số luồng (cờ vua, cờ caro, Xếp Khối
// cũng dùng). Vì vậy: chỉ tạo trình phát cho tiếng thật sự phát, mỗi tiếng một trình phát, và trả lại hết khi rời
// nông trại.

export type { FarmSound };

/** Tiếng hay dùng nhất: tạo sẵn khi mở nông trại để lần bấm đầu không bị trễ */
const WARM: FarmSound[] = ["plant", "harvest", "coin"];
const players: Partial<Record<FarmSound, AudioPlayer>> = {};
const timers = new Set<ReturnType<typeof setTimeout>>();
let modeSet = false;
let enabled = true;

export function setFarmSound(on: boolean) {
  enabled = on;
  if (!on) {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    releaseFarmSounds();
  }
}

function player(name: FarmSound) {
  let p = players[name];
  if (!p) {
    p = createAudioPlayer(FARM_SOURCES[name]);
    players[name] = p;
  }
  return p;
}

/** Gọi khi mở nông trại */
export function preloadFarmSounds() {
  if (!enabled) return;
  try {
    if (!modeSet) {
      modeSet = true;
      // Tiếng ngắn: phát chung với nhạc của app khác, không giành quyền phát
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false }).catch(() => undefined);
    }
    for (const name of WARM) player(name);
  } catch {
    /* máy không phát được âm thanh */
  }
}

/** Gọi khi rời nông trại: trả lại các luồng âm thanh cho máy */
export function releaseFarmSounds() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  for (const name of Object.keys(players) as FarmSound[]) {
    try {
      players[name]?.remove();
    } catch {
      /* đã trả rồi */
    }
    delete players[name];
  }
}

function playNow(name: FarmSound, volume: number) {
  try {
    const p = player(name);
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
