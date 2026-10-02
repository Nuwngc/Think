import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { CARO_SOURCES, type CaroSound } from "./soundFiles";

// Âm thanh cờ caro. Tiếng đặt quân có 2 trình phát để phát chồng lên nhau được (hai bên đi nhanh liên tiếp).

export type { CaroSound };

const POOL: Partial<Record<CaroSound, number>> = { "place-x": 2, "place-o": 2, invalid: 2 };
const WARM: CaroSound[] = ["place-x", "place-o", "invalid"];
const players: Partial<Record<CaroSound, AudioPlayer[]>> = {};
const next: Partial<Record<CaroSound, number>> = {};
const timers = new Set<ReturnType<typeof setTimeout>>();
let modeSet = false;
let enabled = true;

export function setCaroSound(on: boolean) {
  enabled = on;
  if (!on) {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }
}

function pool(name: CaroSound) {
  let list = players[name];
  if (!list) {
    list = [];
    for (let i = 0; i < (POOL[name] || 1); i++) list.push(createAudioPlayer(CARO_SOURCES[name]));
    players[name] = list;
  }
  return list;
}

/** Tạo sẵn trình phát khi mở màn caro, để tiếng đầu tiên không bị trễ */
export function preloadCaroSounds() {
  try {
    if (!modeSet) {
      modeSet = true;
      // Tiếng ngắn: phát chung với nhạc của app khác, không giành quyền phát
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false }).catch(() => undefined);
    }
    // Chỉ tạo sẵn tiếng hay dùng; tiếng khác tạo khi cần — đỡ tốn luồng âm thanh của máy
    for (const name of WARM) pool(name);
  } catch {
    /* máy không phát được âm thanh */
  }
}

let holders = 0;
/** Mở một màn có tiếng caro: tạo sẵn trình phát. Trả về hàm gọi khi rời màn (màn cuối cùng rời thì trả lại luồng âm thanh) */
export function holdCaroSounds() {
  holders++;
  preloadCaroSounds();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders = Math.max(0, holders - 1);
    if (!holders) releaseCaroSounds();
  };
}

export function releaseCaroSounds() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  for (const name of Object.keys(players) as CaroSound[]) {
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

function playNow(name: CaroSound, volume: number) {
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

/** Phát một tiếng; delay (ms) để tiếng sau không đè lên tiếng đặt quân */
export function playCaro(name: CaroSound, volume = 1, delay = 0) {
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
