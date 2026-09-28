import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

// Tùy chọn bàn cờ (lưu trên máy): chỉ dẫn nước đi, tô nước vừa đi, tọa độ, mũi tên gợi ý, âm thanh

export type ChessPrefs = {
  /** Chấm tròn ở các ô đi được khi chọn quân */
  hints: boolean;
  /** Tô màu ô của nước vừa đi */
  lastMove: boolean;
  /** Chữ a–h, số 1–8 ở mép bàn cờ */
  coords: boolean;
  /** Mũi tên nước tốt nhất khi xem phân tích */
  arrows: boolean;
  /** Tiếng quân cờ, tiếng bắt đầu / kết thúc ván */
  sound: boolean;
};

export const DEFAULT_PREFS: ChessPrefs = { hints: true, lastMove: true, coords: true, arrows: true, sound: true };

const KEY = "think.chessPrefs";

export const usePrefs = create<ChessPrefs>(() => ({ ...DEFAULT_PREFS }));

let loading: Promise<void> | null = null;
/** Các tùy chọn người dùng vừa đổi trong lúc đang đọc bản đã lưu (không để bản cũ ghi đè) */
const touched = new Set<keyof ChessPrefs>();

/** Đọc tùy chọn đã lưu (chỉ đọc một lần; gọi nhiều lần trả về cùng một lời hứa) */
export function loadPrefs() {
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<ChessPrefs>;
        const next: Partial<ChessPrefs> = {};
        for (const k of Object.keys(DEFAULT_PREFS) as (keyof ChessPrefs)[]) {
          if (typeof saved[k] === "boolean" && !touched.has(k)) next[k] = saved[k] as boolean;
        }
        usePrefs.setState(next);
      } catch {
        /* dùng mặc định */
      }
    })();
  }
  return loading;
}

export function setPref<K extends keyof ChessPrefs>(key: K, value: ChessPrefs[K]) {
  touched.add(key);
  usePrefs.setState({ [key]: value } as Partial<ChessPrefs>);
  // Ghi sau khi đã đọc xong bản cũ, để không làm mất các tùy chọn khác
  loadPrefs().then(() => AsyncStorage.setItem(KEY, JSON.stringify(usePrefs.getState())).catch(() => undefined));
}
