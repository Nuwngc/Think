import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { pickImages, prepareImage, type PreparedImage } from "../images";
import { showToast } from "../store";
import { Button, Icon } from "../ui";
import { BG_NAMES, STORY_BGS, bgColors } from "./bgs";
import { StoryGradient } from "./Gradient";
import { closeComposer, postStory, useStories } from "./store";

// Tạo tin 24 giờ (giống bản web): chữ trên nền màu, hoặc ảnh kèm chú thích. Đặt ở gốc app (App.tsx).

const INK = "#FFFFFF";

export function StoryComposer() {
  const open = useStories((st) => st.composer);
  if (!open) return null;
  return <ComposerBody />;
}

function ComposerBody() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"text" | "photo">("text");
  const [bg, setBg] = useState("jade");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeComposer();
      return true;
    });
    return () => sub.remove();
  }, []);

  const pick = async () => {
    setPicking(true);
    try {
      const [asset] = await pickImages({ multiple: false });
      if (asset) {
        setImg(await prepareImage(asset));
        setMode("photo");
        setError(null);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa chọn được ảnh.");
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    const photo = mode === "photo" && img;
    const t = (photo ? caption : text).trim();
    if (!photo && !t) {
      setError("Viết vài chữ hoặc chọn một ảnh nhé.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await postStory(photo ? { text: t, image: img } : { text: t, bg });
      closeComposer();
      showToast("Đã đăng tin. Tin tự mất sau 24 giờ.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa đăng được tin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior="padding" style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.top}>
          <Pressable onPress={closeComposer} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Đóng" hitSlop={6}>
            <Icon name="close" size={26} color={INK} />
          </Pressable>
          <Text style={s.title}>Tin 24 giờ</Text>
          {mode === "text" ? (
            <Pressable onPress={pick} disabled={picking} style={s.tool} accessibilityRole="button" accessibilityLabel="Chọn ảnh">
              <Icon name="add-photo-alternate" size={20} color={INK} />
              <Text style={s.toolText}>{picking ? "Đang mở…" : "Ảnh"}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setMode("text")} style={s.tool} accessibilityRole="button" accessibilityLabel="Viết tin chữ">
              <Text style={[s.toolText, { fontWeight: "900" }]}>Aa</Text>
              <Text style={s.toolText}>Chữ</Text>
            </Pressable>
          )}
        </View>

        <View style={s.stage}>
          {mode === "photo" && img ? (
            <>
              <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Ảnh sẽ đăng" />
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Thêm chú thích…"
                placeholderTextColor="rgba(255,255,255,0.75)"
                maxLength={200}
                style={s.caption}
                accessibilityLabel="Chú thích ảnh"
              />
            </>
          ) : (
            <>
              <StoryGradient bg={bg} id="storyComposeBg" />
              <TextInput
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  if (error) setError(null);
                }}
                placeholder="Bạn đang nghĩ gì?"
                placeholderTextColor="rgba(255,255,255,0.72)"
                multiline
                maxLength={250}
                autoFocus
                style={s.textInput}
                accessibilityLabel="Nội dung tin"
              />
            </>
          )}
        </View>

        <View style={s.bottom}>
          {error ? <Text style={s.error}>{error}</Text> : null}
          {mode === "text" ? (
            <View style={s.swatches} accessibilityRole="radiogroup" accessibilityLabel="Màu nền">
              {Object.keys(STORY_BGS).map((k) => {
                const on = k === bg;
                return (
                  <Pressable
                    key={k}
                    onPress={() => setBg(k)}
                    style={[
                      s.swatch,
                      {
                        backgroundColor: bgColors(k)[1],
                        borderWidth: on ? 3 : 2,
                        borderColor: on ? INK : "rgba(255,255,255,0.5)",
                        transform: [{ scale: on ? 1.12 : 1 }],
                      },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={BG_NAMES[k]}
                    hitSlop={4}
                  />
                );
              })}
            </View>
          ) : null}
          <View style={s.actions}>
            <Text style={s.hint}>Cả nhóm xem được trong 24 giờ</Text>
            <Button title="Đăng tin" icon="send" busy={busy} onPress={submit} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  top: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  title: { flex: 1, color: INK, fontSize: 16, fontWeight: "700" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  tool: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.16)" },
  toolText: { color: INK, fontSize: 15, fontWeight: "700" },
  stage: { flex: 1, marginHorizontal: 8, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  textInput: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    paddingHorizontal: 24,
    color: INK,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "800",
    textAlign: "center",
    textAlignVertical: "center",
  },
  caption: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    color: INK,
    fontSize: 15,
  },
  bottom: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, gap: 12 },
  error: { color: "#FFB4A8", fontSize: 13, textAlign: "center" },
  swatches: { flexDirection: "row", justifyContent: "center", gap: 14 },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  hint: { color: "rgba(255,255,255,0.75)", fontSize: 12.5, flexShrink: 1 },
});
