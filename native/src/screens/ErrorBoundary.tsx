import { reloadAppAsync } from "expo";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { makeReport, report } from "../errors";
import { useColors } from "../theme";
import { Button, Icon } from "../ui";

// Một màn hình bị lỗi thì hiện thông báo và nút thử lại, thay vì làm tắt cả app.
// Lỗi được gửi cho admin (Quản trị → Báo lỗi app).

type Props = { children: ReactNode; name?: string; onReset?: () => void };
type State = { error: Error | null; key: number };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      const r = makeReport("js", error, false);
      const where = this.props.name ? `${this.props.name}: ` : "";
      r.where = `${where}${r.where || ""}`.slice(0, 120);
      r.stack = `${r.stack || ""}\n--- component ---${String(info.componentStack || "").slice(0, 3000)}`.slice(0, 8000);
      report(r);
    } catch {
      /* bỏ qua */
    }
  }

  reset = () => {
    this.props.onReset?.();
    this.setState((s) => ({ error: null, key: s.key + 1 }));
  };

  render() {
    if (this.state.error) return <Fallback error={this.state.error} onRetry={this.reset} />;
    return <View style={styles.fill} key={this.state.key}>{this.props.children}</View>;
  }
}

function Fallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const c = useColors();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: c.dangerWash }]}>
        <Icon name="error-outline" size={34} color={c.danger} />
      </View>
      <Text style={[styles.title, { color: c.text }]}>Có lỗi xảy ra</Text>
      <Text style={[styles.body, { color: c.muted }]}>
        Màn hình này vừa gặp lỗi. Lỗi đã được gửi cho admin để sửa. Bạn thử mở lại nhé.
      </Text>
      <Text style={[styles.detail, { color: c.muted, borderColor: c.line }]} numberOfLines={4} selectable>
        {String(error?.message || error)}
      </Text>
      <View style={styles.buttons}>
        <Button title="Thử lại" icon="refresh" onPress={onRetry} />
        <Button title="Khởi động lại app" kind="secondary" onPress={() => reloadAppAsync("error").catch(onRetry)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  title: { fontSize: 20, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  detail: { fontSize: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, alignSelf: "stretch", marginTop: 4 },
  buttons: { alignSelf: "stretch", gap: 10, marginTop: 10 },
});
