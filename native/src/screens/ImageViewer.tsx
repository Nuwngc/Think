import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fileUrl } from "../api";
import { isPending } from "../messages";
import { currentToken } from "../session";
import { showToast } from "../store";
import type { ChatItem } from "../types";
import { IconButton } from "../ui";
import { imageSource } from "./MessageItem";

/** Xem ảnh toàn màn hình, chia sẻ / lưu ảnh qua bảng chia sẻ của máy */
export function ImageViewer({ item, path: imagePath, onClose }: { item?: ChatItem | null; path?: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const localUri = item && isPending(item) ? item.localUri : undefined;
  // Ảnh trong tin nhắn (item) hoặc ảnh bất kỳ trên máy chủ (path, vd ảnh bài đăng)
  const path = item?.image || imagePath || null;
  const visible = Boolean(localUri || path);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let uri = localUri;
      if (!uri && path) {
        const name = path.split("/").pop() || `think-${Date.now()}.jpg`;
        const token = currentToken();
        const res = await FileSystem.downloadAsync(fileUrl(path), `${FileSystem.cacheDirectory}${name}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (res.status !== 200) throw new Error("download");
        uri = res.uri;
      }
      if (!uri || !(await Sharing.isAvailableAsync())) throw new Error("share");
      await Sharing.shareAsync(uri, { dialogTitle: "Lưu hoặc gửi ảnh" });
    } catch {
      showToast("Chưa chia sẻ được ảnh này.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="fade" statusBarTranslucent navigationBarTranslucent>
      <View style={styles.root}>
        {visible ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Đóng ảnh">
            <Image
              source={localUri ? { uri: localUri } : imageSource(path!)}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              cachePolicy="disk"
            />
          </Pressable>
        ) : null}
        <View style={[styles.bar, { top: insets.top + 6 }]}>
          <IconButton name="close" label="Đóng" color="#fff" onPress={onClose} style={styles.btn} />
          <View style={{ flex: 1 }} />
          {Platform.OS !== "web" ? (
            busy ? (
              <View style={styles.btn}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : (
              <IconButton name="share" label="Lưu hoặc chia sẻ ảnh" color="#fff" onPress={share} style={styles.btn} />
            )
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  bar: { position: "absolute", left: 10, right: 10, flexDirection: "row", alignItems: "center" },
  btn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
});
