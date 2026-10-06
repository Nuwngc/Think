import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { Platform, Vibration } from "react-native";

// Chuông khi có người gọi đến (kèm rung) và tiếng "tút" khi đang gọi đi.
// Một trình phát riêng cho cuộc gọi, dùng lại mãi (không tạo mới mỗi lần — Android có hạn số luồng âm thanh).

const SOURCES = {
  ring: require("../../assets/sounds/call/call_ring.wav"),
  ringback: require("../../assets/sounds/call/call_ringback.wav"),
};

let player: AudioPlayer | null = null;
let playing: keyof typeof SOURCES | null = null;

export function startTone(kind: keyof typeof SOURCES) {
  if (playing === kind) return;
  stopTone();
  playing = kind;
  try {
    if (!player) player = createAudioPlayer(SOURCES[kind]);
    else player.replace(SOURCES[kind]);
    player.loop = true;
    player.volume = kind === "ring" ? 1 : 0.6;
    player.seekTo(0).catch(() => undefined);
    player.play();
  } catch {
    /* không phát được thì thôi, vẫn còn rung và màn hình */
  }
  if (kind === "ring" && Platform.OS !== "web") Vibration.vibrate([0, 700, 900], true);
}

export function stopTone() {
  if (!playing) return;
  playing = null;
  try {
    player?.pause();
  } catch {
    /* đã dừng */
  }
  if (Platform.OS !== "web") Vibration.cancel();
}
