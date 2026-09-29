import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProfileView } from "../social/ProfileView";
import { closeUser } from "../social/store";
import { openSettings, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { IconButton, useStyles } from "../ui";

/** Tab Cá nhân: trang cá nhân của mình (ảnh bìa, giới thiệu, đăng bài, Bảng tin / Bài của tôi) */
export function ProfileScreen() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const meId = useStore((st) => st.me?.id);
  if (meId == null) return null;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 6, backgroundColor: c.surface }]}>
        <Text style={s.h1}>Cá nhân</Text>
        <IconButton name="settings" label="Cài đặt" onPress={openSettings} color={c.text} />
      </View>
      <ProfileView userId={meId} own />
    </View>
  );
}

/** Trang cá nhân của người khác (mở từ bài đăng, bình luận, bảng xếp hạng…) */
export function UserProfileScreen({ userId }: { userId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const user = useStore((st) => st.users[userId]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[s.header, s.headerBack, { paddingTop: insets.top + 6, backgroundColor: c.surface }]}>
        <IconButton name="arrow-back" label="Quay lại" onPress={closeUser} color={c.text} />
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>
            {user?.displayName || "Trang cá nhân"}
          </Text>
          {user ? <Text style={s.sub}>@{user.username}</Text> : null}
        </View>
      </View>
      <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        <ProfileView userId={userId} own={false} />
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, paddingRight: 8, paddingBottom: 8 },
    headerBack: { justifyContent: "flex-start", gap: 6, paddingLeft: 6 },
    h1: { color: c.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
    title: { color: c.text, fontSize: 17, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5 },
  });
