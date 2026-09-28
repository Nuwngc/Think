import { useColorScheme } from "react-native";

// Màu của Think: ngọc bích (jade) + nghệ (turmeric), giống bản web (public/app.css)
const light = {
  scheme: "light" as "light" | "dark",
  /** Nền nút, bong bóng tin của mình */
  jade: "#0E7C66",
  /** Chữ / biểu tượng màu nhấn */
  accent: "#0E7C66",
  jadeWash: "#DCEFE9",
  turmeric: "#F2B01E",
  turmericWash: "#FDF1D2",
  bg: "#EEF2EF",
  surface: "#FFFFFF",
  field: "#F1F4F2",
  line: "#DDE4E0",
  text: "#14201C",
  text2: "#3E4C47",
  muted: "#62716B",
  mineText: "#FFFFFF",
  theirs: "#FFFFFF",
  theirsText: "#14201C",
  quoteMine: "rgba(255,255,255,0.18)",
  quoteTheirs: "#EEF2EF",
  danger: "#B3372A",
  dangerWash: "#FBE9E6",
  online: "#2DBE7E",
  overlay: "rgba(10,20,16,0.45)",
  toast: "#14201C",
  toastText: "#FFFFFF",
  onJade: "#FFFFFF",
  meterGood: "#0E7C66",
  meterWarn: "#D99A0B",
  meterCrit: "#B3372A",
};

export type Colors = typeof light;

const dark: Colors = {
  scheme: "dark",
  jade: "#0E7C66",
  accent: "#4CC9AA",
  jadeWash: "#16342C",
  turmeric: "#F2C04E",
  turmericWash: "#3A2F12",
  bg: "#0F1714",
  surface: "#16211D",
  field: "#1E2B26",
  line: "#26352F",
  text: "#E3EBE7",
  text2: "#BFCBC6",
  muted: "#93A39C",
  mineText: "#FFFFFF",
  theirs: "#1F2C27",
  theirsText: "#E3EBE7",
  quoteMine: "rgba(255,255,255,0.16)",
  quoteTheirs: "#16211D",
  danger: "#F0826F",
  dangerWash: "#3A1F1A",
  online: "#46C996",
  overlay: "rgba(0,0,0,0.6)",
  toast: "#E3EBE7",
  toastText: "#14201C",
  onJade: "#FFFFFF",
  meterGood: "#1E9E7C",
  meterWarn: "#BD8B11",
  meterCrit: "#C2443A",
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export const radius = { sm: 10, md: 14, lg: 20, xl: 26 };
