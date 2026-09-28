import { useEffect, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KnightIcon } from "../chess/Board";
import { ChessHome } from "../chess/ChessHome";
import { GameScreen } from "../chess/GameScreen";
import { chessBadge, closeGame, useChess } from "../chess/store";
import { closeConversation, setTab, unreadTotal, useStore, type Tab } from "../store";
import { useColors } from "../theme";
import { Badge, Icon, type IconName } from "../ui";
import { AdminScreen } from "./AdminScreen";
import { ChatListScreen } from "./ChatListScreen";
import { ChatScreen } from "./ChatScreen";
import { ProfileScreen } from "./ProfileScreen";

export function MainScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tab = useStore((s) => s.tab);
  const currentId = useStore((s) => s.currentId);
  const isAdmin = useStore((s) => s.me?.role === "admin");
  const unread = useStore((s) => unreadTotal(s.convs));
  const meId = useStore((s) => s.me?.id ?? 0);
  const chessTodo = useChess((s) => chessBadge(s, meId));
  const gameId = useChess((s) => s.openId);

  // Nút Quay lại của Android: đóng khung chat, rồi về tab Tin nhắn, rồi mới thoát app
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const s = useStore.getState();
      if (s.currentId != null) {
        closeConversation();
        return true;
      }
      if (s.tab === "chess" && useChess.getState().openId != null) {
        closeGame();
        return true;
      }
      if (s.tab !== "chats") {
        setTab("chats");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  if (currentId != null) return <ChatScreen key={currentId} convId={currentId} />;
  if (tab === "chess" && gameId != null) return <GameScreen key={gameId} id={gameId} />;

  const shown: Tab = tab === "admin" && !isAdmin ? "chats" : tab;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        {shown === "chats" ? <ChatListScreen /> : shown === "chess" ? <ChessHome /> : shown === "me" ? <ProfileScreen /> : <AdminScreen />}
      </View>
      <View style={[styles.nav, { backgroundColor: c.surface, borderTopColor: c.line, paddingBottom: Math.max(insets.bottom, 8) }]}>
        <NavItem icon="chat-bubble" label="Tin nhắn" active={shown === "chats"} badge={unread} onPress={() => setTab("chats")} />
        <NavItem
          label="Cờ vua"
          active={shown === "chess"}
          badge={chessTodo}
          badgeLabel="việc cần làm"
          onPress={() => setTab("chess")}
          renderIcon={(color, bg) => <KnightIcon size={24} color={color} hole={bg} />}
        />
        <NavItem icon="person" label="Cá nhân" active={shown === "me"} onPress={() => setTab("me")} />
        {isAdmin ? <NavItem icon="admin-panel-settings" label="Quản trị" active={shown === "admin"} onPress={() => setTab("admin")} /> : null}
      </View>
    </View>
  );
}

function NavItem({
  icon,
  label,
  active,
  badge = 0,
  badgeLabel = "tin chưa đọc",
  onPress,
  renderIcon,
}: {
  icon?: IconName;
  label: string;
  active: boolean;
  badge?: number;
  badgeLabel?: string;
  onPress: () => void;
  renderIcon?: (color: string, bg: string) => ReactNode;
}) {
  const c = useColors();
  const color = active ? c.accent : c.muted;
  return (
    <Pressable
      onPress={onPress}
      style={styles.navItem}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge ? `${label}, ${badge} ${badgeLabel}` : label}
    >
      <View style={[styles.navIcon, active && { backgroundColor: c.jadeWash }]}>
        {renderIcon ? renderIcon(color, active ? c.jadeWash : c.surface) : icon ? <Icon name={icon} size={23} color={color} /> : null}
        {badge ? <Badge count={badge} style={styles.navBadge} /> : null}
      </View>
      <Text style={[styles.navLabel, { color: active ? c.accent : c.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  navItem: { flex: 1, alignItems: "center", gap: 2 },
  navIcon: { width: 58, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  navBadge: { position: "absolute", top: -4, right: 4 },
  navLabel: { fontSize: 12, fontWeight: "700" },
});
