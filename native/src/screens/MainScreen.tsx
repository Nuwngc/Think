import { useEffect, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BlocksScreen } from "../blocks/BlocksScreen";
import { BotGame } from "../caro/BotGame";
import { CaroGame } from "../caro/CaroGame";
import { CaroHome } from "../caro/CaroHome";
import { caroBadge, useCaro } from "../caro/store";
import { ChessHome } from "../chess/ChessHome";
import { GameScreen } from "../chess/GameScreen";
import { chessBadge, useChess } from "../chess/store";
import { SocialHost } from "../social/SocialHost";
import { StreakHost } from "../streaks/ui";
import { closeUser, useSocial } from "../social/store";
import { FarmScreen } from "../farm/FarmScreen";
import { openVisit as openFarmVisit, useFarm } from "../farm/store";
import { GamesHome } from "../games/GamesHome";
import { PuzzleHost } from "../puzzles/PuzzleScreen";
import {
  closeConversation,
  closeSettings,
  leaveCaroBot,
  leaveCaroGame,
  leaveGame,
  puzzleBack,
  setTab,
  showGamesHub,
  unreadTotal,
  useStore,
  type Tab,
} from "../store";
import { useColors } from "../theme";
import { Badge, Icon, type IconName } from "../ui";
import { AdminScreen } from "./AdminScreen";
import { ChatListScreen } from "./ChatListScreen";
import { ChatScreen } from "./ChatScreen";
import { ProfileScreen, UserProfileScreen } from "./ProfileScreen";
import { SettingsScreen } from "./SettingsScreen";

export function MainScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tab = useStore((s) => s.tab);
  const gamesView = useStore((s) => s.gamesView);
  const currentId = useStore((s) => s.currentId);
  const isAdmin = useStore((s) => s.me?.role === "admin");
  const unread = useStore((s) => unreadTotal(s.convs));
  const meId = useStore((s) => s.me?.id ?? 0);
  const chessTodo = useChess((s) => chessBadge(s, meId));
  const caroTodo = useCaro((s) => caroBadge(s, meId));
  const gameId = useChess((s) => s.openId);
  const caroId = useCaro((s) => s.openId);
  const caroBot = useCaro((s) => s.botOpen);
  const viewUser = useSocial((s) => s.viewUser);
  const settingsOpen = useStore((s) => s.settingsOpen);

  // Nút Quay lại của Android: đóng khung chat / ván cờ / ván caro / câu đố / vườn bạn bè / trang cá nhân người khác / Cài đặt, rồi về tab Tin nhắn,
  // rồi mới thoát app (game Xếp Khối tự xử lý nút Quay lại khi đang mở)
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const s = useStore.getState();
      if (s.currentId != null) {
        closeConversation();
        return true;
      }
      if (s.tab === "games" && s.gamesView === "chess" && useChess.getState().openId != null) {
        leaveGame();
        return true;
      }
      if (s.tab === "games" && s.gamesView === "caro" && useCaro.getState().openId != null) {
        leaveCaroGame();
        return true;
      }
      if (s.tab === "games" && s.gamesView === "caro" && useCaro.getState().botOpen) {
        leaveCaroBot();
        return true;
      }
      if (s.tab === "games" && s.gamesView === "puzzle") {
        puzzleBack(); // câu đố → bản đồ màn → chỗ đã mở
        return true;
      }
      if (s.tab === "games" && s.gamesView === "farm" && useFarm.getState().visit != null) {
        openFarmVisit(null);
        return true;
      }
      if (s.tab === "games" && s.gamesView !== "hub") {
        showGamesHub();
        return true;
      }
      if (useSocial.getState().viewUser != null) {
        closeUser();
        return true;
      }
      if (s.tab === "me" && s.settingsOpen) {
        closeSettings();
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

  const full =
    currentId != null ? (
      <ChatScreen key={currentId} convId={currentId} />
    ) : tab === "games" && gamesView === "chess" && gameId != null ? (
      <GameScreen key={gameId} id={gameId} />
    ) : tab === "games" && gamesView === "caro" && caroId != null ? (
      <CaroGame key={caroId} id={caroId} />
    ) : tab === "games" && gamesView === "caro" && caroBot ? (
      <BotGame />
    ) : tab === "games" && gamesView === "blocks" ? (
      <BlocksScreen onBack={showGamesHub} />
    ) : tab === "games" && gamesView === "farm" ? (
      <FarmScreen onBack={showGamesHub} />
    ) : tab === "games" && gamesView === "puzzle" ? (
      <PuzzleHost />
    ) : viewUser != null ? (
      <UserProfileScreen key={viewUser} userId={viewUser} />
    ) : null;

  const shown: Tab = tab === "admin" && !isAdmin ? "chats" : tab;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {full ?? (
        <>
          <View style={{ flex: 1 }}>
            {shown === "chats" ? (
              <ChatListScreen />
            ) : shown === "games" ? (
              gamesView === "chess" ? (
                <ChessHome />
              ) : gamesView === "caro" ? (
                <CaroHome />
              ) : (
                <GamesHome />
              )
            ) : shown === "me" ? (
              settingsOpen ? (
                <SettingsScreen />
              ) : (
                <ProfileScreen />
              )
            ) : (
              <AdminScreen />
            )}
          </View>
          <View style={[styles.nav, { backgroundColor: c.surface, borderTopColor: c.line, paddingBottom: Math.max(insets.bottom, 8) }]}>
            <NavItem icon="chat-bubble" label="Tin nhắn" active={shown === "chats"} badge={unread} onPress={() => setTab("chats")} />
            <NavItem
              icon="sports-esports"
              label="Trò chơi"
              active={shown === "games"}
              badge={chessTodo + caroTodo}
              badgeLabel="việc cần làm ở Cờ vua và Cờ caro"
              onPress={() => setTab("games")}
            />
            <NavItem icon="person" label="Cá nhân" active={shown === "me"} onPress={() => setTab("me")} />
            {isAdmin ? <NavItem icon="admin-panel-settings" label="Quản trị" active={shown === "admin"} onPress={() => setTab("admin")} /> : null}
          </View>
        </>
      )}
      {/* Bảng viết bài / bình luận / chia sẻ ván cờ dùng chung cho mọi màn */}
      <SocialHost />
      {/* Bảng chuỗi hằng ngày, chúc mừng khi đạt mốc */}
      <StreakHost />
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
