import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { demoBubble, setBubbles, useBubbles } from "../bubbles";
import { showToast } from "../store";
import { useColors, type Colors } from "../theme";
import { Card, Icon, SectionLabel, useStyles } from "../ui";

/** Cài đặt → Bong bóng chat (chỉ Android) */
export function BubblesSetting() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { supported, on, canDraw, waiting } = useBubbles(
    useShallow((b) => ({ supported: b.supported, on: b.on, canDraw: b.canDraw, waiting: b.waiting })),
  );
  if (!supported) return null;
  const active = on && canDraw;
  const hint = waiting
    ? "Bật “Hiển thị trên ứng dụng khác” (Cho phép hiển thị trên ứng dụng khác) cho Think, rồi quay lại app."
    : active
      ? "Đang bật. Có tin mới khi không mở app: ảnh người nhắn nổi trên màn hình, chạm để trả lời ngay."
      : on
        ? "Cần cấp quyền “Hiển thị trên ứng dụng khác”. Bật lại để cấp quyền."
        : "Ảnh người nhắn nổi trên màn hình như Messenger, chạm để trả lời mà không cần mở app.";

  const toggle = async (next: boolean) => {
    const r = await setBubbles(next);
    if (r === "permission") showToast("Bật “Hiển thị trên ứng dụng khác” cho Think rồi quay lại app nhé.", {}, 6000);
    else if (r === "on") showToast("Đã bật bong bóng chat.");
    else if (r === "unsupported") showToast("Máy này chưa hỗ trợ bong bóng chat (cần Android 8 trở lên).");
  };

  return (
    <>
      <SectionLabel>BONG BÓNG CHAT</SectionLabel>
      <Card>
        <View style={s.row}>
          <View style={[s.icon, { backgroundColor: c.jadeWash }]}>
            <Icon name="bubble-chart" size={20} color={c.accent} />
          </View>
          <Pressable style={{ flex: 1 }} onPress={() => toggle(!active)} accessibilityRole="button">
            <Text style={s.title}>Bong bóng chat</Text>
            <Text style={s.muted}>{hint}</Text>
          </Pressable>
          <Switch
            value={active}
            onValueChange={toggle}
            trackColor={{ false: c.line, true: c.jadeWash }}
            thumbColor={active ? c.jade : "#fff"}
            accessibilityLabel="Bong bóng chat"
          />
        </View>
        {active ? (
          <Pressable
            style={({ pressed }) => [s.linkRow, pressed && { backgroundColor: c.field }]}
            onPress={() => {
              if (demoBubble()) showToast("Bong bóng đã hiện ở cạnh màn hình. Chạm để mở khung chat, kéo xuống dấu ✕ để ẩn.", {}, 6000);
              else showToast("Chưa có cuộc trò chuyện nào để thử.");
            }}
            accessibilityRole="button"
          >
            <Text style={[s.link, { color: c.accent }]}>Thử bong bóng</Text>
          </Pressable>
        ) : null}
      </Card>
      <Text style={[s.muted, s.note]}>
        Khi bật, Think chạy nền để nhận tin ngay (có thông báo “Bong bóng chat đang bật”), kể cả máy không có dịch vụ Google như Huawei. Tốn pin hơn
        một chút. Tắt cuộc trò chuyện nào thì không hiện bong bóng của cuộc đó.
      </Text>
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
    icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    title: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
    note: { marginTop: 8, marginHorizontal: 6 },
    linkRow: { paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    link: { fontSize: 14.5, fontWeight: "700" },
  });
