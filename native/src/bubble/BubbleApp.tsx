import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFonts } from "expo-font";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { initBubbles } from "../bubbles";
import { ThinkNative } from "../native";
import { ChatScreen } from "../screens/ChatScreen";
import { ErrorBoundary } from "../screens/ErrorBoundary";
import { ToastHost } from "../screens/ToastHost";
import { boot, lifecycleStarted, openConversation, restoreView, startLifecycle, useStore, viewState } from "../store";
import { loadThemeMode, useColors } from "../theme";
import { Button, Icon, Loading } from "../ui";

/**
 * Khung chat nổi khi chạm bong bóng chat (Android, màn hình "ThinkBubble" của BubbleActivity).
 * Dùng chung dữ liệu với app chính: mở cuộc trò chuyện, nhắn tin, thu nhỏ thì app chính trở lại như cũ.
 */
export default function BubbleApp({ convId }: { convId?: number }) {
  useFonts(MaterialIcons.font);
  // Không dùng KeyboardProvider ở đây: bàn phím trong khung nổi do BubbleActivity (Kotlin) tự chừa chỗ
  return (
    <SafeAreaProvider>
      <Bubble initial={convId || 0} />
    </SafeAreaProvider>
  );
}

/** Khoảng trống phía trên để bong bóng nằm ở góc (như Messenger) */
const HEAD_ROOM = 78;

function Bubble({ initial }: { initial: number }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const phase = useStore((s) => s.phase);
  const currentId = useStore((s) => s.currentId);
  const [target, setTarget] = useState(initial);
  const [showSeq, setShowSeq] = useState(0);
  // Màn hình app chính trước khi mở khung nổi (trả lại khi thu nhỏ)
  const saved = useRef<ReturnType<typeof viewState> | null>(null);
  const keepView = useRef(false);

  useEffect(() => {
    // Hiếm: app chính chưa chạy (vd bị máy tắt rồi mở lại từ bong bóng)
    if (!lifecycleStarted()) {
      loadThemeMode();
      startLifecycle();
      boot();
    }
    initBubbles();
  }, []);

  useEffect(() => {
    if (!ThinkNative) return;
    const sub = ThinkNative.addListener("onChatHead", (e) => {
      if (e.type === "open" || e.type === "bubble-shown") {
        if (e.convId) setTarget(e.convId);
        setShowSeq((n) => n + 1);
      } else if (e.type === "bubble-hidden") {
        if (keepView.current) {
          // Bấm "Mở trong app": app chính mở đúng cuộc trò chuyện này
          keepView.current = false;
          saved.current = null;
        } else if (saved.current) {
          restoreView(saved.current);
          saved.current = null;
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Mở cuộc trò chuyện của bong bóng (mỗi lần khung nổi hiện lại)
  useEffect(() => {
    if (phase !== "ready" || !target) return;
    if (!saved.current) saved.current = viewState();
    openConversation(target);
  }, [phase, target, showSeq]);

  const minimize = () => ThinkNative?.minimizeBubble();
  const openApp = () => {
    keepView.current = true;
    ThinkNative?.openApp();
  };

  // Nút Quay lại: thu nhỏ khung chat (bảng đang mở thì Android tự đóng bảng trước)
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!ThinkNative?.bubbleVisible()) return false;
      ThinkNative.minimizeBubble();
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.root}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={minimize} accessibilityLabel="Thu nhỏ khung chat" />
      <View style={[styles.card, { marginTop: insets.top + HEAD_ROOM, backgroundColor: c.bg }]}>
        <ErrorBoundary name="bong bóng chat">
          {phase === "ready" && currentId != null ? (
            <ChatScreen key={currentId} convId={currentId} bubble={{ onClose: minimize, onOpenApp: openApp }} />
          ) : phase === "ready" || phase === "boot" ? (
            <View style={styles.empty}>
              {phase === "boot" || target ? <Loading text="Đang mở cuộc trò chuyện…" /> : null}
              {phase === "ready" && !target ? <Text style={[styles.text, { color: c.muted }]}>Chưa chọn cuộc trò chuyện nào.</Text> : null}
              <Button title="Mở app Think" icon="open-in-new" kind="secondary" onPress={openApp} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="lock-outline" size={36} color={c.muted} />
              <Text style={[styles.text, { color: c.text }]}>Bạn cần đăng nhập trong app Think trước.</Text>
              <Button title="Mở app Think" icon="open-in-new" onPress={openApp} />
            </View>
          )}
        </ErrorBoundary>
      </View>
      <ToastHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  card: { flex: 1, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden", elevation: 12 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  text: { fontSize: 15, textAlign: "center", lineHeight: 21 },
});
