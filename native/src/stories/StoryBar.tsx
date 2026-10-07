import { memo, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { useShallow } from "zustand/react/shallow";

import { useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Icon, useStyles } from "../ui";
import { openComposer, openStories, storyGroups, useStories } from "./store";

// Hàng vòng tròn tin 24 giờ trên đầu danh sách chat (giống #story-bar của bản web).
// Viền xanh ngọc → vàng nghệ = có tin chưa xem; xám = đã xem hết; xanh = tin của mình.

const AV = 54;
const RING = 2.5;
const GAP = 2.5;
const OUTER = AV + (RING + GAP) * 2;

type RingKind = "new" | "seen" | "mine" | "add";

const Ring = memo(function Ring({ kind }: { kind: RingKind }) {
  const c = useColors();
  if (kind === "add") return null;
  const r = OUTER / 2 - RING / 2;
  return (
    <Svg width={OUTER} height={OUTER} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="storyRing" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={c.jade} />
          <Stop offset="1" stopColor={c.turmeric} />
        </LinearGradient>
      </Defs>
      <Circle
        cx={OUTER / 2}
        cy={OUTER / 2}
        r={r}
        fill="none"
        strokeWidth={RING}
        stroke={kind === "new" ? "url(#storyRing)" : kind === "mine" ? c.jade : c.line}
      />
    </Svg>
  );
});

function Item({ label, name, kind, user, onPress, plus }: { label: string; name: string; kind: RingKind; user: any; onPress: () => void; plus?: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.item, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={s.ringBox}>
        <Ring kind={kind} />
        <Avatar user={user} size={AV} dot={false} />
        {plus ? (
          <View style={[s.plus, { backgroundColor: c.jade, borderColor: c.bg }]}>
            <Icon name="add" size={15} color="#fff" />
          </View>
        ) : null}
      </View>
      <Text style={s.name} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

export function StoryBar() {
  const s = useStyles(makeStyles);
  const { me, users } = useStore(useShallow((st) => ({ me: st.me, users: st.users })));
  const { stories, tick } = useStories(useShallow((st) => ({ stories: st.stories, tick: st.tick })));
  const meId = me?.id ?? 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => storyGroups(stories, meId), [stories, meId, tick]);
  if (!me) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} accessibilityLabel="Tin 24 giờ">
      <Item label="Thêm tin 24 giờ" name="Thêm tin" kind="add" user={me} plus onPress={openComposer} />
      {groups.map((g) => {
        const own = g.userId === meId;
        const u = own ? me : users[g.userId];
        const display = u?.displayName || "Ai đó";
        return (
          <Item
            key={g.userId}
            user={u}
            name={own ? "Tin của bạn" : display}
            kind={own ? "mine" : g.unseen ? "new" : "seen"}
            label={`${own ? "Xem tin của bạn" : `Xem tin của ${display}`}, ${g.stories.length} tin${!own && g.unseen ? ", có tin chưa xem" : ""}`}
            onPress={() => openStories(g.userId)}
          />
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { paddingHorizontal: 10, paddingTop: 2, paddingBottom: 8, gap: 2 },
    item: { width: 74, alignItems: "center", gap: 5, paddingVertical: 4, borderRadius: 14 },
    ringBox: { width: OUTER, height: OUTER, alignItems: "center", justifyContent: "center" },
    plus: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2.5,
      alignItems: "center",
      justifyContent: "center",
    },
    name: { maxWidth: 70, fontSize: 12, color: c.text2 },
  });
