import { StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { bgColors } from "./bgs";

/** Nền chuyển màu của tin chữ (phủ kín khung cha) */
export function StoryGradient({ bg, id }: { bg: string | null | undefined; id: string }) {
  const [a, b] = bgColors(bg);
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor={a} />
          <Stop offset="1" stopColor={b} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
