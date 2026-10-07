import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors, type Colors } from "../theme";
import type { StoryRef } from "../types";
import { useStyles } from "../ui";
import { StoryGradient } from "./Gradient";
import { storyImage } from "./image";
import { openStories, useStories } from "./store";

/** Khung "Đã trả lời tin của bạn" trên tin nhắn trả lời / thả cảm xúc một tin 24 giờ (giống refEl của bản web) */
export function StoryRefCard({
  story: st,
  mine,
  meId,
  nameOf,
  onGone,
}: {
  story: StoryRef;
  mine: boolean;
  meId: number;
  nameOf: (id: number) => string;
  onGone?: () => void;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const local = useStories((x) => x.stories[st.id]);
  const loaded = useStories((x) => x.loaded);
  const live = loaded ? Boolean(local && local.expiresAt > Date.now()) : st.alive;
  const owner = st.ownerId === meId ? "bạn" : nameOf(st.ownerId);
  const label = st.reaction
    ? `${mine ? "Bạn đã bày tỏ" : "Đã bày tỏ"} cảm xúc về tin của ${owner}`
    : `${mine ? "Bạn đã trả lời" : "Đã trả lời"} tin của ${owner}`;
  return (
    <View style={[s.wrap, { alignItems: mine ? "flex-end" : "flex-start" }]}>
      <Text style={s.label}>{label}</Text>
      {live ? (
        <Pressable
          onPress={() => {
            if (!openStories(st.ownerId, st.id)) onGone?.();
          }}
          style={({ pressed }) => [s.thumb, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={`Xem tin của ${owner}`}
        >
          {st.kind === "image" && st.image ? (
            <Image source={storyImage(st.image)} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <>
              <StoryGradient bg={st.bg} id={`ref${st.id}`} />
              <Text style={s.thumbText} numberOfLines={6}>
                {st.text}
              </Text>
            </>
          )}
        </Pressable>
      ) : (
        <View style={[s.gone, { backgroundColor: c.field }]}>
          <Text style={s.goneText}>Tin không còn xem được</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { gap: 4, marginBottom: 2 },
    label: { fontSize: 12, color: c.muted },
    thumb: { width: 84, height: 140, borderRadius: 12, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
    thumbText: { color: "#fff", fontSize: 11, fontWeight: "700", textAlign: "center", paddingHorizontal: 8 },
    gone: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
    goneText: { fontSize: 12.5, color: c.muted },
  });
