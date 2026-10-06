import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

// Tùy chọn bàn cờ (lưu trên máy): chỉ dẫn nước đi, tô nước vừa đi, tọa độ, mũi tên gợi ý, quân trượt, âm thanh

export type ChessPrefs = {
  /** Chấm tròn ở các ô đi được khi chọn quân */
  hints: boolean;
  /** Tô màu ô của nước vừa đi */
  lastMove: boolean;
  /** Chữ a–h, số 1–8 ở mép bàn cờ */
  coords: boolean;
  /** Mũi tên nước tốt nhất khi xem phân tích */
  arrows: boolean;
  /** Quân trượt từ ô đi tới ô đến (kiểu chess.com) */
  anim: boolean;
  /** Tiếng quân cờ, tiếng bắt đầu / kết thúc ván */
  sound: boolean;
  /** Bong bóng câu nói của máy và câu nói nhanh của bạn bè */
  talk: boolean;
  /** Đi trước (premove): lúc đối thủ đang nghĩ thì chọn sẵn nước, tới lượt tự đi */
  premove: boolean;
  /** Màu bàn cờ (BOARD_THEMES) */
  theme: string;
};

/** Màu bàn cờ; giống BOARD_THEMES trong public/chess-ui.js */
export const BOARD_THEMES = [
  { id: "green", name: "Xanh lá", light: "#EEEED2", dark: "#6E9C84" },
  { id: "wood", name: "Gỗ", light: "#F0D9B5", dark: "#B58863" },
  { id: "blue", name: "Xanh biển", light: "#DEE3E6", dark: "#8CA2AD" },
  { id: "purple", name: "Tím", light: "#ECE6F2", dark: "#9A82B8" },
  { id: "coral", name: "San hô", light: "#F5E6D8", dark: "#CF8467" },
  { id: "night", name: "Đêm", light: "#A3AFBA", dark: "#56657A" },
] as const;

export const themeOf = (id: string) => BOARD_THEMES.find((t) => t.id === id) || BOARD_THEMES[0];

export const DEFAULT_PREFS: ChessPrefs = {
  hints: true,
  lastMove: true,
  coords: true,
  arrows: true,
  anim: true,
  sound: true,
  talk: true,
  premove: true,
  theme: "green",
};

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
          if (k !== "theme" && typeof saved[k] === "boolean" && !touched.has(k)) (next as Record<string, boolean>)[k] = saved[k] as boolean;
        }
        if (!touched.has("theme") && BOARD_THEMES.some((t) => t.id === saved.theme)) next.theme = saved.theme;
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
