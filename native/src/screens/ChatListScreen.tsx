import { memo, useMemo, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";

import { useCall } from "../calls/engine";
import { byPinnedThenActivity } from "../chatPlus";
import { isMuted } from "../chatThemes";
import { convTitle, fold, listPreview, shortTime } from "../format";
import { markRead, namesOf, openConversation, setConvPrefs, turnPushOn, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { Conversation } from "../types";
import { Badge, ConvAvatar, Icon, IconButton, Sheet, SheetItem, useStyles } from "../ui";
import { MuteSheet, muteText } from "./ConvSettingsSheet";
import { NewChatSheet } from "./NewChatSheet";

type Filter = "all" | "unread" | "group" | "dm";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "unread", label: "Chưa đọc" },
  { key: "group", label: "Nhóm" },
  { key: "dm", label: "Riêng tư" },
];


export function ChatListScreen() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { convs, users, me, typing, offline } = useStore(
    useShallow((st) => ({ convs: st.convs, users: st.users, me: st.me, typing: st.typing, offline: st.offline })),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [newOpen, setNewOpen] = useState(false);
  // Chạm giữ một cuộc trò chuyện: ghim lên đầu / tắt thông báo
  const [menuId, setMenuId] = useState<number | null>(null);
  const [muteId, setMuteId] = useState<number | null>(null);
  const menuConv = menuId != null ? convs[menuId] : undefined;
  const muteConv = muteId != null ? convs[muteId] : undefined;

  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  const list = useMemo(() => {
    const q = fold(query);
    return Object.values(convs)
      .filter((x) => x.type !== "dm" || x.lastMessage)
      .filter((x) => filter === "all" || (filter === "unread" ? x.unread > 0 : filter === "dm" ? x.type === "dm" : x.type !== "dm"))
      .filter((x) => !q || fold(convTitle(x, names.nameOf)).includes(q) || fold(x.lastMessage?.text).includes(q))
      .sort(byPinnedThenActivity);
  }, [convs, query, filter, names]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>Think</Text>
          <Text style={s.kicker}>Chat riêng cho hội bạn</Text>
        </View>
        <IconButton name="edit" label="Tin nhắn mới" onPress={() => setNewOpen(true)} color={c.text} />
      </View>

      <Banners />

      <View style={s.search}>
        <Icon name="search" size={20} color={c.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Tìm cuộc trò chuyện"
          placeholderTextColor={c.muted}
          style={s.searchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? <IconButton name="close" label="Xóa ô tìm" size={18} onPress={() => setQuery("")} style={{ width: 32, height: 32 }} /> : null}
      </View>

      <View style={s.chips}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[s.chip, filter === f.key && { backgroundColor: c.jade }]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}
          >
            <Text style={[s.chipText, filter === f.key && { color: c.onJade }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={list}
        keyExtractor={(x) => String(x.id)}
        renderItem={({ item }) => (
          <ConvRow
            conv={item}
            typingIds={typing[item.id]}
            names={names}
            users={users}
            meId={me?.id ?? 0}
            onLongPress={offline ? undefined : setMenuId}
          />
        )}
        contentContainerStyle={{ paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={s.empty}>
            {query ? "Không có cuộc trò chuyện nào khớp." : filter === "unread" ? "Bạn đã đọc hết tin nhắn." : "Chưa có cuộc trò chuyện nào."}
          </Text>
        }
      />

      <Pressable
        onPress={() => setNewOpen(true)}
        style={({ pressed }) => [s.fab, { opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Tin nhắn mới hoặc tạo nhóm"
      >
        <Icon name="add" size={28} color={c.onJade} />
      </Pressable>

      <NewChatSheet visible={newOpen} onClose={() => setNewOpen(false)} />
      {menuConv ? (
        <Sheet visible={menuId != null} onClose={() => setMenuId(null)} title={convTitle(menuConv, names.nameOf)}>
          <SheetItem
            icon="push-pin"
            label={menuConv.pinnedAt ? "Bỏ ghim khỏi đầu danh sách" : "Ghim lên đầu danh sách"}
            onPress={() => {
              setMenuId(null);
              setConvPrefs(menuConv.id, { pinned: !menuConv.pinnedAt });
            }}
          />
          <SheetItem
            icon={isMuted(menuConv) ? "notifications-active" : "notifications-off"}
            label={isMuted(menuConv) ? "Bật lại thông báo" : "Tắt thông báo"}
            hint={muteText(menuConv)}
            onPress={() => {
              const id = menuConv.id;
              setMenuId(null);
              if (isMuted(menuConv)) setConvPrefs(id, { mutedUntil: 0 });
              else setTimeout(() => setMuteId(id), 250);
            }}
          />
          {menuConv.unread > 0 ? (
            <SheetItem
              icon="mark-chat-read"
              label="Đánh dấu đã đọc"
              onPress={() => {
                setMenuId(null);
                markRead(menuConv.id);
              }}
            />
          ) : null}
        </Sheet>
      ) : null}
      {muteConv ? <MuteSheet conv={muteConv} visible={muteId != null} onClose={() => setMuteId(null)} /> : null}
    </View>
  );
}

/** Dải báo trạng thái: chưa kết nối, có bản mới, chưa bật thông báo */
function Banners() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { offline, connection, update, push } = useStore(
    useShallow((st) => ({ offline: st.offline, connection: st.connection, update: st.update, push: st.push })),
  );
  return (
    <View style={{ gap: 8, paddingHorizontal: 16, marginBottom: 6 }}>
      {offline || connection === "offline" ? (
        <View style={[s.banner, { backgroundColor: c.turmericWash }]}>
          <Icon name="cloud-off" size={18} color={c.text2} />
          <Text style={s.bannerText}>
            {offline ? "Chưa kết nối được máy chủ, đang xem bản lưu trên máy. App tự thử lại…" : "Mất kết nối, đang kết nối lại…"}
          </Text>
        </View>
      ) : null}
      {update ? (
        <Pressable onPress={() => Linking.openURL(update.apk)} style={[s.banner, { backgroundColor: c.jadeWash }]} accessibilityRole="link">
          <Icon name="system-update" size={18} color={c.accent} />
          <Text style={s.bannerText}>
            Có bản app mới {update.versionName}. <Text style={{ color: c.accent, fontWeight: "800" }}>Tải về</Text>
          </Text>
        </Pressable>
      ) : null}
      {push === "denied" ? (
        <Pressable
          onPress={async () => {
            if ((await turnPushOn()) === "denied") Linking.openSettings();
          }}
          style={[s.banner, { backgroundColor: c.field }]}
          accessibilityRole="button"
        >
          <Icon name="notifications-off" size={18} color={c.text2} />
          <Text style={s.bannerText}>
            Thông báo đang tắt, bạn sẽ không biết có tin mới khi đóng app.{" "}
            <Text style={{ color: c.accent, fontWeight: "800" }}>Bật thông báo</Text>
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const ConvRow = memo(function ConvRow({
  conv,
  typingIds,
  names,
  users,
  meId,
  onLongPress,
}: {
  conv: Conversation;
  typingIds: number[] | undefined;
  names: ReturnType<typeof namesOf>;
  users: ReturnType<typeof useStore.getState>["users"];
  meId: number;
  onLongPress?: (id: number) => void;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const unread = conv.unread || 0;
  const muted = isMuted(conv);
  const typers = typingIds || [];
  const title = convTitle(conv, names.nameOf);
  const lm = conv.lastMessage;
  const calling = useCall((st) => Boolean(st.groups[conv.id])); // đang có cuộc gọi nhóm
  const preview = typers.length
    ? conv.type === "dm"
      ? "Đang nhập…"
      : `${names.nameOf(typers[0])} đang nhập…`
    : lm
      ? listPreview(lm, conv, names)
      : conv.type === "dm"
        ? "Chưa có tin nhắn"
        : "Nơi cả nhóm cùng nói chuyện";
  return (
    <Pressable
      onPress={() => openConversation(conv.id)}
      onLongPress={onLongPress ? () => onLongPress(conv.id) : undefined}
      delayLongPress={380}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}${calling ? ", đang có cuộc gọi nhóm" : ""}${conv.locked ? ", đã khóa" : ""}${conv.pinnedAt ? ", đã ghim" : ""}${muted ? ", đã tắt thông báo" : ""}${unread ? `, ${unread} tin chưa đọc` : ""}. ${preview}`}
      accessibilityHint={onLongPress ? "Chạm giữ để ghim hoặc tắt thông báo" : undefined}
    >
      <ConvAvatar conv={conv} users={users} meId={meId} size={52} />
      <View style={s.rowBody}>
        <View style={s.rowLine}>
          <Text style={[s.rowTitle, unread > 0 && s.bold]} numberOfLines={1}>
            {title}
          </Text>
          {calling ? <Icon name="call" size={15} color={c.accent} /> : null}
          {conv.locked ? <Icon name="lock" size={15} color={c.muted} /> : null}
          {muted ? <Icon name="notifications-off" size={15} color={c.muted} /> : null}
          {conv.pinnedAt ? <Icon name="push-pin" size={15} color={c.muted} /> : null}
          <Text style={[s.rowTime, unread > 0 && { color: c.accent, fontWeight: "700" }]}>{lm ? shortTime(lm.createdAt) : ""}</Text>
        </View>
        <View style={s.rowLine}>
          <Text
            style={[s.rowPreview, unread > 0 && { color: c.text, fontWeight: "600" }, typers.length > 0 && { color: c.accent, fontStyle: "italic" }]}
            numberOfLines={1}
          >
            {preview}
          </Text>
          <Badge count={unread} style={muted ? { backgroundColor: c.muted } : undefined} />
        </View>
      </View>
    </Pressable>
  );
});

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
    brand: { color: c.text, fontSize: 30, fontWeight: "800", letterSpacing: -1.2 },
    kicker: { color: c.muted, fontSize: 13, marginTop: 1 },
    banner: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12 },
    bannerText: { flex: 1, color: c.text2, fontSize: 13.5, lineHeight: 19 },
    search: {
      marginHorizontal: 16,
      height: 46,
      borderRadius: 14,
      backgroundColor: c.surface,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 14,
      paddingRight: 6,
      gap: 8,
    },
    searchInput: { flex: 1, color: c.text, fontSize: 15.5, paddingVertical: 0 },
    chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, flexWrap: "wrap" },
    chip: { paddingHorizontal: 14, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: c.surface },
    chipText: { color: c.text2, fontSize: 13.5, fontWeight: "700" },
    row: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 16, paddingVertical: 10 },
    rowBody: { flex: 1, gap: 3 },
    rowLine: { flexDirection: "row", alignItems: "center", gap: 8 },
    rowTitle: { flex: 1, color: c.text, fontSize: 16, fontWeight: "600" },
    bold: { fontWeight: "800" },
    rowTime: { color: c.muted, fontSize: 12.5 },
    rowPreview: { flex: 1, color: c.muted, fontSize: 14 },
    empty: { color: c.muted, textAlign: "center", marginTop: 40, fontSize: 14 },
    fab: {
      position: "absolute",
      right: 18,
      bottom: 18,
      width: 58,
      height: 58,
      borderRadius: 20,
      backgroundColor: c.jade,
      alignItems: "center",
      justifyContent: "center",
      elevation: 5,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
  });
