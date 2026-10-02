import { Image } from "expo-image";
import { memo } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { ICONS } from "./icons";
import { emojiKey } from "./logic";

// Biểu tượng Twemoji vẽ sẵn thành PNG (mọi máy hiện giống nhau, kể cả Android cũ / Huawei thiếu emoji mới).
// Không có hình thì hiện emoji của máy.

export const Emo = memo(function Emo({
  ch,
  size = 24,
  style,
  label,
  dim = false,
}: {
  ch: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  label?: string;
  /** Xám, mờ (chưa mở khóa) */
  dim?: boolean;
}) {
  const src = ICONS[emojiKey(ch)];
  const a11y = label
    ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: label }
    : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center", opacity: dim ? 0.45 : 1 }, style]} {...a11y}>
      {src ? (
        <Image source={src} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory" />
      ) : (
        <Text style={{ fontSize: size * 0.82, lineHeight: size, textAlign: "center" }}>{ch}</Text>
      )}
    </View>
  );
});
