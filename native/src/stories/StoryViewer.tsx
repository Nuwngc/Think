import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, BackHandler, Easing, FlatList, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";

import { api } from "../api";
import { showToast, useStore } from "../store";
import { useColors } from "../theme";
import type { Story, StoryViewer as Viewer } from "../types";
import { Avatar, confirm, Icon } from "../ui";
import { IMAGE_MS, STORY_REACTIONS, storyAgo, textMs } from "./bgs";
import { StoryGradient } from "./Gradient";
import { storyImage } from "./image";
import { closeStories, deleteStory, markSeen, nextStory, prevStory, reactStory, replyStory, storyGroups, useStories } from "./store";

// Xem tin 24 giờ toàn màn hình (giống bản web public/stories-ui.js): thanh tiến độ tự chạy,
// chạm bên trái / phải để lùi / tới, giữ để dừng; thả cảm xúc, trả lời; tin của mình: ai đã xem, xóa.
// Đặt ở gốc app (App.tsx), phủ lên mọi màn hình khi đang xem.

const INK = "#FFFFFF";
const REASON = { hold: 1, type: 2, sheet: 4, load: 8, hidden: 16 } as const;
type Reason = keyof typeof REASON;

export function StoryViewer() {
  const viewer = useStories((st) => st.viewer);
  if (!viewer) return null;
  return <ViewerBody />;
}

function ViewerBody() {
  const insets = useSafeAreaInsets();
  const { me, users } = useStore(useShallow((st) => ({ me: st.me, users: st.users })));
  const { viewer, stories } = useStories(useShallow((st) => ({ viewer: st.viewer!, stories: st.stories })));
  const meId = me?.id ?? 0;
  const groups = useMemo(() => storyGroups(stories, meId), [stories, meId]);
  const list = groups.find((g) => g.userId === viewer.queue[viewer.gi])?.stories || [];
  const story: Story | undefined = list[Math.min(viewer.si, list.length - 1)];
  const own = story?.userId === meId;
  const user = story ? (own ? me : users[story.userId]) : null;
  const name = own ? "Tin của bạn" : user?.displayName || "Ai đó";

  // ----- Thanh tiến độ: Animated chạy trên luồng giao diện (native driver), dừng / chạy tiếp được -----
  const progress = useRef(new Animated.Value(0)).current;
  const paused = useRef(0);
  const done = useRef(0); // phần đã chạy (0..1) lúc dừng
  const [isPaused, setIsPaused] = useState(false);
  const duration = story ? (story.kind === "image" ? IMAGE_MS : textMs(story.text)) : IMAGE_MS;
  const storyId = story?.id;

  const run = useCallback(() => {
    if (paused.current || storyId == null) return;
    Animated.timing(progress, { toValue: 1, duration: Math.max(50, duration * (1 - done.current)), easing: Easing.linear, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished && useStories.getState().viewer && !paused.current) nextStory();
      },
    );
  }, [progress, duration, storyId]);

  const pause = useCallback(
    (r: Reason) => {
      const was = paused.current;
      paused.current |= REASON[r];
      setIsPaused(true);
      if (!was) progress.stopAnimation((v) => (done.current = v));
    },
    [progress],
  );
  const resume = useCallback(
    (r: Reason) => {
      if (!(paused.current & REASON[r])) return;
      paused.current &= ~REASON[r];
      if (!paused.current) {
        setIsPaused(false);
        run();
      }
    },
    [run],
  );

  // Đổi tin: chạy lại từ đầu, đánh dấu đã xem; ảnh chưa tải xong thì đợi
  useEffect(() => {
    if (!story) return;
    progress.stopAnimation();
    progress.setValue(0);
    done.current = 0;
    paused.current &= ~(REASON.hold | REASON.load);
    if (story.kind === "image") paused.current |= REASON.load;
    setIsPaused(Boolean(paused.current));
    markSeen(story);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, viewer.gi, viewer.si, viewer]);

  useEffect(() => () => progress.stopAnimation(), [progress]);

  // Hết tin của mọi người (hoặc tin vừa bị xóa) thì đóng
  useEffect(() => {
    if (!story) closeStories();
  }, [story]);

  // App chạy nền: dừng
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => (st === "active" ? resume("hidden") : pause("hidden")));
    return () => sub.remove();
  }, [pause, resume]);

  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (sheet) {
        setSheet(false);
        resume("sheet");
      } else closeStories();
      return true;
    });
    return () => sub.remove();
  }, [sheet, resume]);

  const width = useRef(1);
  const held = useRef(false);
  const onLayout = (e: LayoutChangeEvent) => (width.current = e.nativeEvent.layout.width || 1);

  if (!story || !user) return null;

  const remove = async () => {
    pause("sheet");
    if (!(await confirm("Xóa tin này?", "Mọi người sẽ không xem được nữa.", "Xóa"))) {
      resume("sheet");
      return;
    }
    try {
      await deleteStory(story.id);
      showToast("Đã xóa tin.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa xóa được.");
    } finally {
      resume("sheet");
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior="padding" style={[s.root, { paddingBottom: insets.bottom }]}>
        <View style={s.stage} onLayout={onLayout}>
          {story.kind === "image" && story.image ? (
            <>
              <Image
                source={storyImage(story.image)}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                onLoad={() => resume("load")}
                onError={() => resume("load")}
                accessibilityLabel={story.text || `Ảnh trong tin của ${own ? "bạn" : user.displayName}`}
              />
              {story.text ? (
                <View style={s.captionBox}>
                  <Text style={s.caption}>{story.text}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <StoryGradient bg={story.bg} id="storyViewBg" />
              <Text style={[s.bigText, story.text.length > 120 && { fontSize: 21, lineHeight: 28 }]}>{story.text}</Text>
            </>
          )}
          {/* Chạm trái: tin trước; chạm phải: tin sau; giữ: dừng */}
          <Pressable
            style={StyleSheet.absoluteFill}
            delayLongPress={220}
            onLongPress={() => {
              held.current = true;
              pause("hold");
            }}
            onPressOut={() => {
              if (held.current) {
                held.current = false;
                resume("hold");
              }
            }}
            onPress={(e) => {
              if (e.nativeEvent.locationX < width.current * 0.3) prevStory();
              else nextStory();
            }}
            accessibilityRole="button"
            accessibilityLabel="Tin tiếp theo"
            accessibilityHint="Chạm bên trái để xem tin trước, giữ để dừng"
          />
          <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <View style={s.segs}>
              {list.map((x, i) => (
                <View key={x.id} style={s.seg}>
                  {i < viewer.si ? (
                    <View style={[s.fill, { width: "100%" }]} />
                  ) : i === viewer.si ? (
                    <Animated.View style={[s.fill, s.fillAnim, { transform: [{ scaleX: progress }] }]} />
                  ) : null}
                </View>
              ))}
            </View>
            <View style={s.head}>
              <Avatar user={user} size={32} dot={false} />
              <Text style={s.name} numberOfLines={1}>
                {name}
              </Text>
              <Text style={s.ago}>{storyAgo(story.createdAt)}</Text>
              <View style={{ flex: 1 }} />
              {isPaused ? <Icon name="pause" size={18} color={INK} /> : null}
              {own ? (
                <Pressable onPress={remove} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Xóa tin này" hitSlop={6}>
                  <Icon name="delete-outline" size={24} color={INK} />
                </Pressable>
              ) : null}
              <Pressable onPress={closeStories} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Đóng" hitSlop={6}>
                <Icon name="close" size={26} color={INK} />
              </Pressable>
            </View>
          </View>
        </View>

        {own ? (
          <View style={s.bottom}>
            <Pressable
              onPress={() => {
                pause("sheet");
                setSheet(true);
              }}
              style={s.viewersBtn}
              accessibilityRole="button"
            >
              <Icon name="visibility" size={20} color={INK} />
              <Text style={s.viewersText}>
                {story.views ? `${story.views} người đã xem` : "Chưa có ai xem"}
                {story.reactions ? ` · ${story.reactions} cảm xúc` : ""}
              </Text>
            </Pressable>
          </View>
        ) : (
          <ReplyBar story={story} name={user.displayName} onFocus={() => pause("type")} onBlur={() => resume("type")} />
        )}
      </KeyboardAvoidingView>
      {sheet ? (
        <ViewersSheet
          storyId={story.id}
          onClose={() => {
            setSheet(false);
            resume("sheet");
          }}
        />
      ) : null}
    </View>
  );
}

function ReplyBar({ story, name, onFocus, onBlur }: { story: Story; name: string; onFocus: () => void; onBlur: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<TextInput>(null);
  useEffect(() => setText(""), [story.id]);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await replyStory(story, t);
      setText("");
      input.current?.blur();
      showToast(`Đã gửi cho ${name}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa gửi được.");
    } finally {
      setBusy(false);
    }
  };
  const react = async (emoji: string) => {
    try {
      await reactStory(story, emoji);
      showToast(`Đã gửi ${emoji} cho ${name}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa gửi được.");
    }
  };
  return (
    <View style={s.bottom}>
      <View style={s.reacts} accessibilityRole="toolbar" accessibilityLabel="Thả cảm xúc">
        {STORY_REACTIONS.map((e) => (
          <Pressable
            key={e}
            onPress={() => react(e)}
            style={({ pressed }) => [s.react, story.myReaction === e && s.reactOn, pressed && { transform: [{ scale: 1.2 }] }]}
            accessibilityRole="button"
            accessibilityLabel={`Thả ${e}`}
            accessibilityState={{ selected: story.myReaction === e }}
          >
            <Text style={s.reactText}>{e}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.replyRow}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={`Trả lời ${name}…`}
          placeholderTextColor="rgba(255,255,255,0.7)"
          style={s.replyInput}
          maxLength={1000}
          returnKeyType="send"
          onSubmitEditing={send}
          accessibilityLabel={`Trả lời tin của ${name}`}
        />
        <Pressable
          onPress={send}
          disabled={!text.trim() || busy}
          style={[s.iconBtn, { opacity: text.trim() ? 1 : 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel="Gửi trả lời"
        >
          <Icon name="send" size={24} color={INK} />
        </Pressable>
      </View>
    </View>
  );
}

function ViewersSheet({ storyId, onClose }: { storyId: number; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const users = useStore((st) => st.users);
  const [list, setList] = useState<Viewer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .storyViewers(storyId)
      .then((r) => setList(r.viewers))
      .catch((err) => setError(err instanceof Error ? err.message : "Không tải được."));
  }, [storyId]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.35)" }]} onPress={onClose} accessibilityLabel="Đóng danh sách" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 8, backgroundColor: c.surface }]} accessibilityViewIsModal>
        <View style={s.sheetHead}>
          <Text style={[s.sheetTitle, { color: c.text }]}>Người đã xem</Text>
          <Pressable onPress={onClose} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Đóng danh sách" hitSlop={6}>
            <Icon name="close" size={24} color={c.text} />
          </Pressable>
        </View>
        {list == null ? (
          <Text style={[s.sheetHint, { color: c.muted }]}>{error || "Đang tải…"}</Text>
        ) : !list.length ? (
          <Text style={[s.sheetHint, { color: c.muted }]}>Chưa có ai xem tin này.</Text>
        ) : (
          <FlatList
            data={list}
            keyExtractor={(x) => String(x.userId)}
            renderItem={({ item }) => {
              const u = users[item.userId];
              const ago = storyAgo(item.viewedAt).toLowerCase();
              return (
                <View style={s.viewerRow}>
                  <Avatar user={u} size={36} dot={false} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.viewerName, { color: c.text }]} numberOfLines={1}>
                      {u?.displayName || "Ai đó"}
                    </Text>
                    <Text style={[s.viewerAgo, { color: c.muted }]}>Đã xem {ago === "vừa xong" ? ago : `${ago} trước`}</Text>
                  </View>
                  {item.reaction ? (
                    <Text style={{ fontSize: 22 }} accessibilityLabel={`Đã thả ${item.reaction}`}>
                      {item.reaction}
                    </Text>
                  ) : null}
                </View>
              );
            }}
          />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  bigText: { color: INK, fontSize: 28, lineHeight: 36, fontWeight: "800", textAlign: "center", paddingHorizontal: 26 },
  captionBox: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  caption: { color: INK, fontSize: 15, lineHeight: 21, textAlign: "center" },
  top: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: 10, paddingBottom: 16, backgroundColor: "rgba(0,0,0,0.25)" },
  segs: { flexDirection: "row", gap: 3 },
  seg: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)", overflow: "hidden" },
  fill: { height: "100%", backgroundColor: INK },
  fillAnim: { width: "100%", transformOrigin: "left" },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  name: { color: INK, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  ago: { color: "rgba(255,255,255,0.8)", fontSize: 13 },
  iconBtn: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21 },
  bottom: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 8 },
  reacts: { flexDirection: "row", justifyContent: "space-between" },
  react: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  reactOn: { backgroundColor: "rgba(255,255,255,0.2)" },
  reactText: { fontSize: 27 },
  replyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  replyInput: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.55)",
    paddingHorizontal: 18,
    color: INK,
    fontSize: 15,
  },
  viewersBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  viewersText: { color: INK, fontSize: 15, fontWeight: "700" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "62%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, paddingRight: 6, paddingTop: 8 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: "#14201C" },
  sheetHint: { color: "#62716B", paddingHorizontal: 18, paddingVertical: 16 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 8 },
  viewerName: { fontSize: 15, fontWeight: "700", color: "#14201C" },
  viewerAgo: { fontSize: 12.5, color: "#62716B" },
});
