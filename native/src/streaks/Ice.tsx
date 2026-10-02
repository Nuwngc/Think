import { memo } from "react";
import Svg, { G, Path } from "react-native-svg";

import { useColors } from "../theme";

// Bông tuyết của "đóng băng chuỗi" (giống bản web: public/streaks.js). Vẽ bằng nét: máy Android cũ không có emoji 🧊.

const ARM = "M12 2.5v19M9.2 4.6 12 7.2l2.8-2.6M9.2 19.4 12 16.8l2.8 2.6";

export const Ice = memo(function Ice({ size = 16, on = true }: { size?: number; on?: boolean }) {
  const c = useColors();
  const dark = c.scheme === "dark";
  const stroke = on ? (dark ? "#6CC0FF" : "#2286CC") : dark ? "#4E6576" : "#9DB5C6";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <G fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {[0, 60, 120].map((deg) => (
          <Path key={deg} d={ARM} transform={`rotate(${deg} 12 12)`} />
        ))}
      </G>
    </Svg>
  );
});

/** Màu nền ô / nhãn của đóng băng chuỗi */
export const iceWash = (dark: boolean) => (dark ? "#16344A" : "#DDF1FF");
