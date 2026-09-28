import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { connectServer, logout, useStore } from "../store";
import { useColors } from "../theme";
import { Button, Icon, Loading } from "../ui";

/** Màn chờ khi đã đăng nhập nhưng chưa có dữ liệu trên máy và máy chủ chưa trả lời */
export function BootScreen() {
  const c = useColors();
  const error = useStore((s) => s.bootError);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.logo, { backgroundColor: c.jade }]}>
        <Icon name="chat-bubble" size={34} color={c.turmeric} />
      </View>
      <Text style={[styles.title, { color: c.text }]}>Think</Text>
      {error ? (
        <View style={styles.box}>
          <Text style={[styles.text, { color: c.text2 }]}>{error}</Text>
          <Text style={[styles.hint, { color: c.muted }]}>App sẽ tự thử lại sau vài giây.</Text>
          <Button title="Thử lại ngay" icon="refresh" onPress={() => connectServer()} />
          <Button title="Đăng nhập tài khoản khác" kind="ghost" onPress={() => logout()} />
        </View>
      ) : (
        <View style={styles.box}>
          <Loading />
          <Text style={[styles.hint, { color: c.muted }]}>
            {slow ? "Máy chủ đang thức dậy sau khi ngủ, có thể mất tới 1 phút…" : "Đang kết nối máy chủ…"}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  logo: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -1 },
  box: { width: "100%", maxWidth: 360, gap: 12, alignItems: "stretch", minHeight: 160 },
  text: { fontSize: 15, textAlign: "center", lineHeight: 21 },
  hint: { fontSize: 13, textAlign: "center", lineHeight: 19 },
});
