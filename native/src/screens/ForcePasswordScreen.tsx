import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { changePassword, logout, useStore } from "../store";
import { useColors } from "../theme";
import { Button, Field, FormError, Icon, KeyboardAware } from "../ui";

/** Lần đầu đăng nhập bằng mật khẩu tạm (hoặc admin vừa đặt lại): bắt buộc đặt mật khẩu mới */
export function ForcePasswordScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const me = useStore((s) => s.me);
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (next.length < 6) return setError("Mật khẩu mới cần ít nhất 6 ký tự.");
    if (next !== again) return setError("Hai lần nhập mật khẩu chưa giống nhau.");
    setError(null);
    setBusy(true);
    try {
      await changePassword("", next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa đổi được mật khẩu.");
      setBusy(false);
    }
  };

  return (
    <KeyboardAware style={{ backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32 }]} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <View style={[styles.icon, { backgroundColor: c.jadeWash }]}>
            <Icon name="lock-reset" size={30} color={c.accent} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>Đặt mật khẩu mới</Text>
          <Text style={[styles.text, { color: c.muted }]}>
            Chào {me?.displayName || "bạn"}! Bạn đang dùng mật khẩu tạm do admin cấp. Hãy đặt mật khẩu của riêng bạn để tiếp tục.
          </Text>
          <Field label="Mật khẩu mới" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" editable={!busy} />
          <Field
            label="Nhập lại mật khẩu mới"
            value={again}
            onChangeText={setAgain}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            returnKeyType="done"
            onSubmitEditing={submit}
            editable={!busy}
          />
          <FormError text={error} />
          <Button title="Lưu mật khẩu" onPress={submit} busy={busy} />
          <Button title="Đăng xuất" kind="ghost" onPress={() => logout()} disabled={busy} />
        </View>
      </ScrollView>
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, alignSelf: "center", borderRadius: 24, padding: 22, gap: 14 },
  icon: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontSize: 24, fontWeight: "800", textAlign: "center" },
  text: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
