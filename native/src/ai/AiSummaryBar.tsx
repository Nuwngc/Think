import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { useColors, type Colors } from "../theme";
import { Button, Icon, IconButton, useStyles } from "../ui";
import { closeSummary, dismissOffer, runSummary, useAiHelp } from "./help";

// Gợi ý / bản tóm tắt của Think AI trên đầu khung chat (giống #ai-sum của bản web)

function Dots() {
  const c = useColors();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ flexDirection: "row", gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: c.turmeric,
            opacity: v.interpolate({ inputRange: [0, (i + 1) / 4, 1], outputRange: [0.3, 1, 0.3] }),
          }}
        />
      ))}
    </View>
  );
}

export function AiSummaryBar({ convId, enabled }: { convId: number; enabled: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { height } = useWindowDimensions();
  const { offer, card } = useAiHelp(useShallow((st) => ({ offer: st.offer, card: st.card })));
  const showCard = card && card.convId === convId;
  const showOffer = !showCard && enabled && offer && offer.convId === convId;

  if (showOffer) {
    return (
      <View style={[s.offer, { backgroundColor: c.turmericWash, borderBottomColor: c.line }]} accessibilityLiveRegion="polite">
        <View style={[s.ic, { backgroundColor: c.turmeric }]}>
          <Icon name="auto-awesome" size={17} color="#3A2A00" />
        </View>
        <Text style={s.offerText} numberOfLines={2}>
          <Text style={{ fontWeight: "800", color: c.text }}>{offer.count} tin chưa đọc</Text> — để Think AI tóm tắt giúp?
        </Text>
        <Button title="Tóm tắt" small onPress={() => runSummary(convId, offer)} />
        <IconButton name="close" label="Ẩn gợi ý tóm tắt" size={20} onPress={dismissOffer} style={{ width: 36, height: 36 }} />
      </View>
    );
  }
  if (!showCard) return null;
  return (
    <View style={[s.card, { borderBottomColor: c.line, maxHeight: height * 0.42 }]} accessibilityLiveRegion="polite">
      <View style={s.head}>
        <View style={[s.ic, { backgroundColor: c.turmeric }]}>
          <Icon name="auto-awesome" size={17} color="#3A2A00" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Tóm tắt của Think AI</Text>
          <Text style={s.meta} numberOfLines={1}>
            {card.meta}
          </Text>
        </View>
        <IconButton name="close" label="Đóng bản tóm tắt" size={20} onPress={closeSummary} style={{ width: 36, height: 36 }} />
      </View>
      <ScrollView style={{ flexGrow: 0 }} nestedScrollEnabled>
        {card.busy ? (
          <View style={s.wait}>
            <Dots />
            <Text style={s.meta}>Think AI đang đọc {card.meta}…</Text>
          </View>
        ) : card.error ? (
          <Text style={[s.body, { color: c.danger }]}>{card.error}</Text>
        ) : (
          <>
            <Text style={s.body} selectable>
              {card.text}
            </Text>
            <Pressable onPress={closeSummary} accessibilityRole="button" accessibilityLabel="Đóng bản tóm tắt">
              <Text style={s.note}>Chỉ bạn thấy bản tóm tắt này. AI có thể nhầm.</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    offer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingLeft: 14,
      paddingRight: 6,
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    ic: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
    offerText: { flex: 1, fontSize: 13.5, color: c.text2 },
    card: {
      backgroundColor: c.surface,
      paddingLeft: 14,
      paddingRight: 6,
      paddingTop: 8,
      paddingBottom: 10,
      gap: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    head: { flexDirection: "row", alignItems: "center", gap: 10 },
    title: { color: c.text, fontSize: 15, fontWeight: "800" },
    meta: { color: c.muted, fontSize: 12.5 },
    wait: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    body: { color: c.text, fontSize: 14.5, lineHeight: 21, paddingRight: 8 },
    note: { color: c.muted, fontSize: 12, marginTop: 6 },
  });
