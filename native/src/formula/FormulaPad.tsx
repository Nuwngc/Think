import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { useColors, type Colors } from "../theme";
import { IconButton, useStyles } from "../ui";
import { has, PAD } from "./core";
import { Fx } from "./FormulaText";

const GAP = 5;

/**
 * Bàn phím ký hiệu toán, hóa (2.16.0) ngay trên ô nhập tin — giống .fx-pad của bản web.
 * Bấm phím: chèn vào chỗ con trỏ (ChatScreen tính bằng insert() trong core.ts); bàn phím điện thoại vẫn mở.
 */
export function FormulaPad({ value, onKey, onClose }: { value: string; onKey: (ins: string) => void; onClose: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState("math");
  const group = PAD.find((g) => g.id === tab) || PAD[0];
  const inner = Math.min(width, 640) - 16;
  const cols = Math.max(6, Math.floor((inner + GAP) / (44 + GAP)));
  const keyW = Math.floor((inner - (cols - 1) * GAP) / cols);
  const formula = has(value);
  const shown = value.length > 120 ? `${value.slice(0, 119)}…` : value;
  return (
    <View style={[s.pad, { borderTopColor: c.line }]} accessibilityLabel="Ký hiệu toán, hóa">
      <View style={s.head}>
        <View style={s.tabs} accessibilityRole="tablist">
          {PAD.map((g) => {
            const on = g.id === tab;
            return (
              <Pressable
                key={g.id}
                onPress={() => setTab(g.id)}
                style={[s.tab, on && { backgroundColor: c.jadeWash }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.tabText, { color: on ? c.accent : c.text2 }]}>{g.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <IconButton name="close" label="Đóng bàn phím ký hiệu" size={20} onPress={onClose} />
      </View>
      <Text style={s.preview} numberOfLines={1}>
        <Text style={s.previewLabel}>{formula ? "Xem trước  " : "Mẹo  "}</Text>
        {formula ? <Fx text={shown} size={14} color={c.text} /> : "Gõ x^2 → x², H_2O → H₂O, x^{n+1} → xⁿ⁺¹"}
      </Text>
      <ScrollView style={s.scroll} keyboardShouldPersistTaps="always" contentContainerStyle={s.keys} nestedScrollEnabled>
        {group.keys.map(([label, ins, name, markup]) => (
          <Pressable
            key={`${group.id}-${label}`}
            onPress={() => onKey(ins || label)}
            style={({ pressed }) => [
              s.key,
              { width: keyW, backgroundColor: markup ? c.jadeWash : c.field },
              pressed && { transform: [{ scale: 0.94 }], opacity: 0.8 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={name || label}
          >
            <Text style={[s.keyText, { color: markup ? c.accent : c.text }, markup && { fontWeight: "700", fontSize: 16 }]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    pad: { backgroundColor: c.surface, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingTop: 4 },
    head: { flexDirection: "row", alignItems: "center", gap: 6 },
    tabs: { flex: 1, flexDirection: "row", gap: 4 },
    tab: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999 },
    tabText: { fontSize: 13.5, fontWeight: "700" },
    preview: { color: c.text, fontSize: 14, paddingHorizontal: 4, paddingBottom: 6, minHeight: 24 },
    previewLabel: { color: c.muted, fontSize: 12, fontWeight: "700" },
    scroll: { maxHeight: 142 },
    keys: { flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingBottom: 6 },
    key: { height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    keyText: { fontSize: 18, fontFamily: Platform.OS === "ios" ? undefined : "serif" },
  });
