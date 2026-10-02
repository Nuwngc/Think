import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { usePrefs } from "./prefs";
import { SOURCES, type SoundName } from "./soundFiles";

// Âm thanh cờ vua kiểu các trang cờ lớn: tiếng quân gỗ giòn, nước mình và nước đối thủ khác tiếng
// (tự tổng hợp bằng scripts/chess-sounds.py, dùng chung với bản web)

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

let holders = 0;
/** Mở một màn có tiếng cờ vua: tạo sẵn trình phát. Trả về hàm gọi khi rời màn (màn cuối cùng rời thì trả lại luồng âm thanh) */
export function holdSounds() {
  holders++;
  preloadSounds();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders = Math.max(0, holders - 1);
    if (!holders) releaseSounds();
  };
}

export function releaseSounds() {
  for (const name of Object.keys(players) as SoundName[]) {
    try {
      players[name]?.remove();
    } catch {
      /* đã trả rồi */
    }
    delete players[name];
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

/** Tiếng hợp với nước đi (theo ký hiệu: + / # = chiếu, = phong cấp, x = ăn quân, O-O = nhập thành). byMe: nước của mình */
export function soundForSan(san: string | undefined, byMe = true): SoundName {
  if (!san) return byMe ? "move" : "move-opp";
  if (/[+#]/.test(san)) return "check";
  if (san.includes("=")) return "promote";
  if (san.includes("x")) return "capture";
  if (san.startsWith("O-O")) return "castle";
  return byMe ? "move" : "move-opp";
}
