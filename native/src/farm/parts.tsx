import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useColors, type Colors } from "../theme";
import { useStyles } from "../ui";
import { Emo } from "./Emo";
import type { Point } from "./store";

// Màu và các mảnh giao diện dùng chung của Nông trại (giống public/farm.css)

export function farmPalette(c: Colors) {
  const dark = c.scheme === "dark";
  return dark
    ? {
        grass: "#2E4A2A",
        grass2: "#284225",
        grassInk: "#BFE3A3",
        soil: "#5C3D29",
        soil2: "#4E3322",
        soilWet: "#3B271A",
        soilLine: "rgba(0,0,0,0.3)",
        kraft: "#3A3226",
        kraftLine: "#4E4332",
        kraftInk: "#EAD9B8",
        ripe: "#F2C04E",
        goldInk: "#F2C04E",
        onGold: "#3B2A00",
        pin: "#F0826F",
      }
    : {
        grass: "#A9D47C",
        grass2: "#94C566",
        grassInk: "#2F5A1F",
        soil: "#8B5B3A",
        soil2: "#7A4E31",
        soilWet: "#5F3D27",
        soilLine: "rgba(0,0,0,0.16)",
        kraft: "#F5E6C8",
        kraftLine: "#E0C99C",
        kraftInk: "#5A3E1F",
        ripe: "#FFD34E",
        goldInk: "#7A5600",
        onGold: "#3B2A00",
        pin: "#B3372A",
      };
}

export type FarmPalette = ReturnType<typeof farmPalette>;

export function useFarmColors() {
  const c = useColors();
  const f = useMemo(() => farmPalette(c), [c]);
  return { c, f };
}

/** Người dùng có bật "giảm chuyển động" không */
export function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(Boolean(v)))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduce(Boolean(v)));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Chỗ bấm trên màn hình (để chữ "+xu" bay lên từ đó) */
export const pointOf = (e: GestureResponderEvent): Point => ({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });

type Kind = "primary" | "soft" | "gold" | "ghost";

/** Nút của Nông trại (xanh ngọc / vàng nghệ / nhạt) */
export function FButton({
  title,
  emoji,
  onPress,
  kind = "primary",
  small,
  disabled,
  busy,
  label,
  style,
  grow,
}: {
  title?: string;
  emoji?: string;
  onPress?: (e: GestureResponderEvent) => void;
  kind?: Kind;
  small?: boolean;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
  grow?: boolean;
}) {
  const { c, f } = useFarmColors();
  const bg = kind === "primary" ? c.jade : kind === "soft" ? c.jadeWash : kind === "gold" ? c.turmeric : c.field;
  const fg = kind === "primary" ? c.onJade : kind === "soft" ? c.accent : kind === "gold" ? f.onGold : c.text2;
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label || title}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      hitSlop={small ? 4 : 0}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        grow && { flex: 1 },
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        pressed && !off && { transform: [{ scale: 0.97 }] },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : emoji ? <Emo ch={emoji} size={small ? 16 : 19} /> : null}
      {title ? (
        <Text style={[styles.btnText, small && styles.btnTextSmall, { color: fg }]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Nhãn nhỏ bo tròn */
export function Chip({ text, emoji, hot, style }: { text: string; emoji?: string; hot?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c, f } = useFarmColors();
  return (
    <View style={[styles.chip, { backgroundColor: hot ? c.turmericWash : c.field }, style]}>
      {emoji ? <Emo ch={emoji} size={15} /> : null}
      <Text style={[styles.chipText, { color: hot ? f.goldInk : c.text2 }]}>{text}</Text>
    </View>
  );
}

export function Note({ children, onGrass }: { children: ReactNode; onGrass?: boolean }) {
  const { c, f } = useFarmColors();
  return <Text style={[styles.note, { color: onGrass ? f.grassInk : c.muted }]}>{children}</Text>;
}

export function H2({ emoji, children, right }: { emoji?: string; children: ReactNode; right?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.h2Row}>
      {emoji ? <Emo ch={emoji} size={22} /> : null}
      <Text style={[styles.h2, { color: c.text }]} accessibilityRole="header">
        {children}
      </Text>
      {right ? <View style={{ marginLeft: "auto" }}>{right}</View> : null}
    </View>
  );
}

/** Thanh đo (kho, kinh nghiệm, tiến độ) */
export function Meter({
  value,
  color,
  track,
  height = 8,
  style,
}: {
  value: number;
  color: string;
  track: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const p = Math.max(0, Math.min(1, value));
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: track, overflow: "hidden" }, style]}>
      <View style={{ width: `${p * 100}%`, height: "100%", borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

/** Thẻ nền trắng (kho, bảng xếp hạng…) */
export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles(makePanel);
  return <View style={[s.panel, style]}>{children}</View>;
}

const makePanel = (c: Colors) =>
  StyleSheet.create({
    panel: { backgroundColor: c.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, overflow: "hidden" },
  });

const styles = StyleSheet.create({
  btn: { minHeight: 42, paddingHorizontal: 14, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  btnSmall: { minHeight: 34, paddingHorizontal: 10, borderRadius: 10, gap: 5 },
  btnText: { fontSize: 14.5, fontWeight: "800" },
  btnTextSmall: { fontSize: 13 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 5, paddingRight: 8, paddingVertical: 2, borderRadius: 999, alignSelf: "flex-start" },
  chipText: { fontSize: 12, fontWeight: "700" },
  note: { fontSize: 13.5, lineHeight: 20 },
  h2Row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  h2: { fontSize: 17, fontWeight: "800" },
});
