import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hideToast, openChess, openConversation, useStore } from "../store";
import { useColors } from "../theme";
import { Avatar } from "../ui";

/** Thông báo nhỏ phía trên màn hình: tin mới ở cuộc trò chuyện khác, lỗi, xác nhận… */
export function ToastHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const toast = useStore((s) => s.toast);
  const sender = useStore((s) => (toast?.senderId != null ? s.users[toast.senderId] : undefined));
  if (!toast) return null;
  const tappable = toast.convId != null || toast.chessGameId != null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Pressable
        onPress={() => {
          hideToast();
          if (toast.convId != null) openConversation(toast.convId);
          else if (toast.chessGameId != null) openChess(toast.chessGameId || null);
        }}
        accessibilityRole={tappable ? "button" : "alert"}
        accessibilityLiveRegion="polite"
        style={({ pressed }) => [styles.toast, { backgroundColor: c.toast, opacity: pressed ? 0.9 : 1 }]}
      >
        {sender ? <Avatar user={sender} size={34} dot={false} /> : null}
        <View style={{ flex: 1 }}>
          {toast.title ? (
            <Text style={[styles.title, { color: c.toastText }]} numberOfLines={1}>
              {toast.title}
            </Text>
          ) : null}
          <Text style={[styles.text, { color: c.toastText }]} numberOfLines={3}>
            {toast.text}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, alignItems: "center" },
  toast: {
    width: "100%",
    maxWidth: 480,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 16,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  title: { fontSize: 14, fontWeight: "800" },
  text: { fontSize: 14, lineHeight: 19 },
});
