import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors, type Colors } from "../theme";
import { Icon, useStyles } from "../ui";
import { hideTranslation, LANG_NAMES, useAiHelp } from "./help";

/** Bản dịch của Think AI dưới bong bóng tin nhắn (giống .msg-trans của bản web) */
export function TranslationBox({ messageId }: { messageId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const t = useAiHelp((st) => st.trans[messageId]);
  if (!t) return null;
  const hide = (
    <Pressable onPress={() => hideTranslation(messageId)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Ẩn bản dịch">
      <Text style={[s.hide, t.error && { color: c.danger }]}>Ẩn</Text>
    </Pressable>
  );
  if (t.busy) {
    return (
      <View style={s.box} accessibilityLiveRegion="polite">
        <Text style={s.label}>Đang dịch…</Text>
      </View>
    );
  }
  if (t.error) {
    return (
      <View style={[s.box, { borderLeftColor: c.danger, backgroundColor: c.dangerWash }]} accessibilityLiveRegion="polite">
        <View style={s.row}>
          <Text style={[s.label, { color: c.danger, fontWeight: "400", flex: 1 }]}>{t.error}</Text>
          {hide}
        </View>
      </View>
    );
  }
  return (
    <View style={s.box}>
      <View style={s.row}>
        <Icon name="auto-awesome" size={13} color={c.turmericInk} />
        <Text style={[s.label, { flex: 1 }]}>Bản dịch {LANG_NAMES[t.to || ""] || ""}</Text>
        {hide}
      </View>
      <Text style={s.text} selectable>
        {t.text}
      </Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    box: {
      marginTop: 3,
      maxWidth: "100%",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
      borderLeftWidth: 3,
      borderLeftColor: c.turmeric,
      backgroundColor: c.turmericWash,
      gap: 2,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 5 },
    label: { fontSize: 11.5, fontWeight: "700", color: c.turmericInk },
    hide: { fontSize: 11.5, fontWeight: "700", color: c.turmericInk, textDecorationLine: "underline", paddingLeft: 8 },
    text: { color: c.text, fontSize: 14, lineHeight: 19 },
  });
