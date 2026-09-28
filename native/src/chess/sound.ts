import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { usePrefs } from "./prefs";
import { SOURCES, type SoundName } from "./soundFiles";

// Âm thanh cờ vua (tự tổng hợp bằng scripts/chess-sounds.py, dùng chung với bản web)

export type { SoundName };

const players: Partial<Record<SoundName, AudioPlayer>> = {};
let modeSet = false;

function playerOf(name: SoundName) {
  let p = players[name];
  if (!p) {
    p = createAudioPlayer(SOURCES[name]);
    players[name] = p;
  }
  return p;
}

/** Tạo sẵn các trình phát khi mở màn hình cờ, để tiếng đầu tiên không bị trễ */
export function preloadSounds() {
  try {
    if (!modeSet) {
      modeSet = true;
      // Tiếng ngắn: phát chung với nhạc của app khác, không giành quyền phát
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false }).catch(() => undefined);
    }
    for (const name of Object.keys(SOURCES) as SoundName[]) playerOf(name);
  } catch {
    /* máy không phát được âm thanh */
  }
}

export function playSound(name: SoundName) {
  if (!usePrefs.getState().sound) return;
  try {
    const p = playerOf(name);
    p.seekTo(0)
      .then(() => p.play())
      .catch(() => p.play());
  } catch {
    /* bỏ qua */
  }
}

/** Tiếng hợp với nước đi (theo ký hiệu: x = ăn quân, + / # = chiếu, O-O = nhập thành) */
export function soundForSan(san: string | undefined): SoundName {
  if (!san) return "move";
  if (/[+#]/.test(san)) return "check";
  if (san.includes("x")) return "capture";
  if (san.startsWith("O-O")) return "castle";
  return "move";
}
