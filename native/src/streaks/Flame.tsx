import { memo } from "react";
import Svg, { Path } from "react-native-svg";

import { useColors } from "../theme";

// Ngọn lửa của chuỗi hằng ngày (giống bản web: public/streaks.js). lit = đang cháy (hôm nay đã chơi / còn chuỗi).

const OUTER = "M12.6 1.5c.5 3 2.9 4.6 4.3 6.9 1.6 2.6 1.8 5.9-.1 8.4a6.6 6.6 0 0 1-11.6-2.5c-.5-2.6.6-4.9 2.5-6.6-.1 1.8.5 3.2 1.8 4 0-4.2 1.3-7.6 3.1-10.2z";
const INNER = "M12.3 11.6c1.9 1.6 3 3.2 2.6 5.2a2.9 2.9 0 0 1-5.7.3c-.3-1.9 1-3.4 3.1-5.5z";

export const FLAME = { outer: "#FF7417", inner: "#FFCE3D", outerDark: "#FF8226", innerDark: "#FFD25A" };

export const Flame = memo(function Flame({ size = 20, lit = true }: { size?: number; lit?: boolean }) {
  const c = useColors();
  const dark = c.scheme === "dark";
  const outer = lit ? (dark ? FLAME.outerDark : FLAME.outer) : dark ? "#4B5A54" : "#C5CFCA";
  const inner = lit ? (dark ? FLAME.innerDark : FLAME.inner) : dark ? "#66766F" : "#E3E9E6";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={OUTER} fill={outer} />
      <Path d={INNER} fill={inner} />
    </Svg>
  );
});
