import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL } from "../config";
import { login, useStore } from "../store";
import { useColors } from "../theme";
import { Button, Field, FormError, Icon, IconButton, KeyboardAware } from "../ui";

export function LoginScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const notice = useStore((s) => s.notice);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [busy]);

  const submit = async () => {
    if (busy) return;
    if (!username.trim() || !password) {
      setError("Nhập tên đăng nhập và mật khẩu.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập không được.");
      setBusy(false);
    }
  };

  return (
    <KeyboardAware style={{ backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <View style={[styles.logo, { backgroundColor: c.jade }]}>
            <Icon name="chat-bubble" size={32} color={c.turmeric} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>Think</Text>
          <Text style={[styles.subtitle, { color: c.muted }]}>Chat riêng cho hội bạn</Text>

          {notice ? (
            <View style={[styles.notice, { backgroundColor: c.turmericWash }]}>
              <Icon name="info-outline" size={18} color={c.text2} />
              <Text style={[styles.noticeText, { color: c.text2 }]}>{notice}</Text>
            </View>
          ) : null}

          <Field
            label="Tên đăng nhập"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passRef.current?.focus()}
            editable={!busy}
          />
          <View>
            <Field
              ref={passRef}
              label="Mật khẩu"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!busy}
              style={{ paddingRight: 48 }}
            />
            <IconButton
              name={show ? "visibility-off" : "visibility"}
              label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              onPress={() => setShow((v) => !v)}
              style={styles.eye}
              color={c.muted}
            />
          </View>
          <FormError text={error} />
          <Button title="Đăng nhập" onPress={submit} busy={busy} />
          {slow ? (
            <Text style={[styles.hint, { color: c.muted }]}>
              Máy chủ đang thức dậy sau khi ngủ, có thể mất tới 1 phút. Đừng tắt app nhé.
            </Text>
          ) : null}
          <Text style={[styles.hint, { color: c.muted }]}>
            Chưa có tài khoản? Nhờ admin của nhóm tạo cho bạn.{"\n"}Máy chủ: {API_URL.replace(/^https?:\/\//, "")}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, alignSelf: "center", borderRadius: 24, padding: 22, gap: 14 },
  logo: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontSize: 30, fontWeight: "800", textAlign: "center", letterSpacing: -1 },
  subtitle: { fontSize: 14, textAlign: "center", marginTop: -8, marginBottom: 4 },
  notice: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, alignItems: "flex-start" },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  eye: { position: "absolute", right: 4, bottom: 4 },
  hint: { fontSize: 12.5, textAlign: "center", lineHeight: 18 },
});
