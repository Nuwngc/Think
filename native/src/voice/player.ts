import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, type AudioPlayer, type AudioSource, type AudioStatus } from "expo-audio";
import { create } from "zustand";

import { fileUrl } from "../api";
import { currentToken } from "../session";

// Nghe tin nhắn thoại: một trình phát dùng chung cho cả app (mỗi lúc chỉ phát một tin, đỡ tốn luồng âm thanh
// của máy — xem lỗi AudioFlinger ở bản 0.4). Phát xong tự chuyển sang tin thoại kế tiếp (onEnded).

const RATES = [1, 1.5, 2];
const KEY_RATE = "think.voice.rate";

type State = {
  /** Tin đang phát / tạm dừng (url file ghi âm) */
  key: string | null;
  playing: boolean;
  /** Giây */
  position: number;
  duration: number;
  rate: number;
};

export const useVoice = create<State>(() => ({ key: null, playing: false, position: 0, duration: 0, rate: 1 }));
const set = useVoice.setState;
const get = useVoice.getState;

AsyncStorage.getItem(KEY_RATE)
  .then((v) => {
    if (RATES.includes(Number(v))) set({ rate: Number(v) });
  })
  .catch(() => undefined);

let player: AudioPlayer | null = null;
let sub: { remove: () => void } | null = null;
let onEnded: (() => void) | null = null;
let fallbackMs = 0;

/** File trên máy chủ cần mã phiên; file vừa ghi trên máy thì mở thẳng */
export function voiceSource(url: string): AudioSource {
  if (!url.startsWith("/uploads/")) return { uri: url };
  const token = currentToken();
  return { uri: fileUrl(url), headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

function onStatus(s: AudioStatus) {
  if (!get().key) return;
  if (s.didJustFinish) {
    const next = onEnded;
    onEnded = null;
    set({ key: null, playing: false, position: 0 });
    try {
      player?.pause();
    } catch {
      /* đã dừng */
    }
    next?.();
    return;
  }
  set({ playing: s.playing, position: s.currentTime || 0, duration: s.duration > 0 ? s.duration : fallbackMs / 1000 });
}

function ensure() {
  if (!player) {
    player = createAudioPlayer(null, { updateInterval: 100 });
    sub = player.addListener("playbackStatusUpdate", onStatus);
  }
  return player;
}

/**
 * Phát / tạm dừng tin `key`. at = vị trí 0–1 muốn tua tới (chạm vào dạng sóng).
 * next = gọi khi phát hết (phát tiếp tin thoại kế tiếp).
 */
export function toggleVoice(key: string, url: string, ms: number, opts: { at?: number; next?: () => void } = {}) {
  try {
    const st = get();
    const p = ensure();
    if (st.key === key) {
      if (opts.at != null) {
        const total = st.duration || ms / 1000;
        p.seekTo(opts.at * total).catch(() => undefined);
        if (!st.playing) p.play();
        return;
      }
      if (st.playing) p.pause();
      else p.play();
      return;
    }
    fallbackMs = ms;
    onEnded = opts.next || null;
    p.replace(voiceSource(url));
    p.setPlaybackRate(st.rate);
    set({ key, playing: true, position: 0, duration: ms / 1000 });
    if (opts.at != null && ms) p.seekTo((opts.at * ms) / 1000).catch(() => undefined);
    p.play();
  } catch {
    set({ key: null, playing: false, position: 0 });
  }
}

/** Đổi tốc độ 1× → 1,5× → 2× (nhớ cho lần sau) */
export function cycleRate() {
  const rate = RATES[(RATES.indexOf(get().rate) + 1) % RATES.length];
  set({ rate });
  AsyncStorage.setItem(KEY_RATE, String(rate)).catch(() => undefined);
  try {
    player?.setPlaybackRate(rate);
  } catch {
    /* chưa phát */
  }
}

/** Dừng hẳn (rời khung chat, bắt đầu ghi âm) */
export function stopVoice() {
  onEnded = null;
  try {
    player?.pause();
  } catch {
    /* đã dừng */
  }
  if (get().key) set({ key: null, playing: false, position: 0 });
}

/** Trả lại trình phát cho máy (rời khung chat) */
export function releaseVoice() {
  stopVoice();
  try {
    sub?.remove();
    player?.remove();
  } catch {
    /* đã trả */
  }
  sub = null;
  player = null;
}

export const rateLabel = (rate: number) => `${String(rate).replace(".", ",")}×`;
