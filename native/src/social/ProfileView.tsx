import { Image } from "expo-image";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { api, fileUrl } from "../api";
import { KnightIcon } from "../chess/Board";
import { ChallengeSheet } from "../chess/Sheets";
import { joinedText } from "../format";
import { pickAvatar, pickCover } from "../images";
import { applyMe, openDm, openSettings, showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { User } from "../types";
import { Avatar, Button, Icon, useStyles } from "../ui";
import { Achievements } from "./Achievements";
import { PostCard } from "./PostCard";
import { listKey, loadPosts, loadProfile, openComposer, setSeg, useSocial, type ListKey } from "./store";

export const MAX_W = 680;

/** Nền ảnh bìa mặc định (ngọc bích → nghệ), giống bản web */
export function CoverGradient() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="thinkCover" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#0E7C66" />
          <Stop offset="0.45" stopColor="#2E9E83" />
          <Stop offset="1" stopColor="#F2B01E" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#thinkCover)" />
    </Svg>
  );
}

/** Ảnh bìa (hoặc nền mặc định) theo tỉ lệ 16:6 */
export function Cover({ path, width, radius = 0, children }: { path?: string | null; width: number; radius?: number; children?: ReactNode }) {
  const c = useColors();
  const height = Math.max(110, Math.round((width * 6) / 16));
  return (
    <View style={{ width, height, borderRadius: radius, overflow: "hidden", backgroundColor: c.field }}>
      {path ? (
        <Image source={{ uri: fileUrl(path) }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" transition={150} />
      ) : (
        <CoverGradient />
      )}
      {children}
    </View>
  );
}

async function changeCover(setBusy: (v: boolean) => void) {
  try {
    const img = await pickCover();
    if (!img) return;
    setBusy(true);
    const { user } = await api.uploadCover(img.uri, img.mime);
    applyMe(user);
    showToast("Đã đổi ảnh bìa.");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Chưa đổi được ảnh bìa.");
  } finally {
    setBusy(false);
  }
}

async function changeAvatar(setBusy: (v: boolean) => void) {
  try {
    const img = await pickAvatar();
    if (!img) return;
    setBusy(true);
    const { user } = await api.uploadAvatar(img.uri, img.mime);
    applyMe(user);
    showToast("Đã đổi ảnh đại diện.");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Chưa đổi được ảnh đại diện.");
  } finally {
    setBusy(false);
  }
}

/* =========================================================
   Phần đầu trang: ảnh bìa, ảnh đại diện, tên, giới thiệu, số liệu
   ========================================================= */

function Hero({ user, own, width }: { user: User; own: boolean; width: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const stats = useSocial((st) => st.profiles[user.id]);
  const [coverBusy, setCoverBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [dmBusy, setDmBusy] = useState(false);

  return (
    <View style={[s.hero, { backgroundColor: c.surface }]}>
      <View style={{ opacity: coverBusy ? 0.55 : 1 }}>
        <Cover path={user.cover} width={width}>
          {own ? (
            <Pressable
              onPress={() => changeCover(setCoverBusy)}
              style={({ pressed }) => [s.coverEdit, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel="Đổi ảnh bìa"
            >
              {coverBusy ? <ActivityIndicator color="#fff" size="small" /> : <Icon name="photo-camera" size={17} color="#fff" />}
              <Text style={s.coverEditText}>Ảnh bìa</Text>
            </Pressable>
          ) : null}
        </Cover>
      </View>

      <View style={s.idRow}>
        {own ? (
          <Pressable
            onPress={() => changeAvatar(setAvatarBusy)}
            style={[s.avatarRing, { backgroundColor: c.surface, opacity: avatarBusy ? 0.55 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Đổi ảnh đại diện"
          >
            <Avatar user={user} size={92} dot={false} />
            <View style={[s.cam, { backgroundColor: c.jade, borderColor: c.surface }]}>
              <Icon name="photo-camera" size={15} color="#fff" />
            </View>
          </Pressable>
        ) : (
          <View style={[s.avatarRing, { backgroundColor: c.surface }]}>
            <Avatar user={user} size={92} />
          </View>
        )}
        <View style={s.heroActions}>
          {own ? (
            <Button title="Chỉnh sửa trang cá nhân" icon="settings" kind="secondary" small onPress={openSettings} />
          ) : (
            <>
              <Button
                title="Nhắn tin"
                icon="chat-bubble-outline"
                small
                busy={dmBusy}
                onPress={async () => {
                  setDmBusy(true);
                  try {
                    await openDm(user.id);
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : "Không mở được cuộc trò chuyện.");
                  } finally {
                    setDmBusy(false);
                  }
                }}
              />
              {!user.disabled && !user.bot ? (
                <Pressable
                  onPress={() => setChallenge(true)}
                  style={({ pressed }) => [s.chessBtn, { backgroundColor: c.field, opacity: pressed ? 0.8 : 1 }]}
                  accessibilityRole="button"
                >
                  <KnightIcon size={19} color={c.accent} hole={c.field} />
                  <Text style={[s.chessBtnText, { color: c.accent }]}>Thách cờ</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </View>

      <View style={s.info}>
        <View style={s.nameRow}>
          <Text style={s.name}>{user.displayName}</Text>
          {user.role === "admin" ? (
            <View style={[s.tag, { backgroundColor: c.jadeWash }]}>
              <Text style={[s.tagText, { color: c.accent }]}>Admin</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.handle}>
          @{user.username}
          {user.joinedAt ? ` · ${joinedText(user.joinedAt)}` : ""}
        </Text>
        {user.bio ? (
          <Text style={s.bio}>{user.bio}</Text>
        ) : own ? (
          <Pressable onPress={openSettings} hitSlop={6} accessibilityRole="button">
            <Text style={[s.addBio, { color: c.accent }]}>+ Thêm lời giới thiệu</Text>
          </Pressable>
        ) : null}
        {stats ? (
          <View
            style={s.stats}
            accessible
            accessibilityLabel={`${stats.posts} bài viết, ${stats.likes} lượt thích${stats.chess ? `, ELO cờ vua ${stats.chess.rating}` : ""}${stats.caro ? `, ELO cờ caro ${stats.caro.rating}` : ""}${stats.blocks ? `, kỷ lục Xếp Khối ${stats.blocks.best}` : ""}`}
          >
            <Text style={s.stat}>
              <Text style={s.statNum}>{stats.posts}</Text> bài viết
            </Text>
            <Text style={s.stat}>
              <Text style={s.statNum}>{stats.likes}</Text> lượt thích
            </Text>
            {stats.chess ? (
              <Text style={s.stat}>
                ♞ ELO <Text style={s.statNum}>{stats.chess.rating}</Text>
              </Text>
            ) : null}
            {stats.caro ? (
              <Text style={s.stat}>
                ⭕ Caro <Text style={s.statNum}>{stats.caro.rating}</Text>
              </Text>
            ) : null}
            {stats.blocks ? (
              <Text style={s.stat}>
                🧩 Xếp Khối <Text style={s.statNum}>{stats.blocks.best.toLocaleString("vi-VN")}</Text>
              </Text>
            ) : null}
          </View>
        ) : null}
        {stats?.achievements ? <Achievements data={stats.achievements} /> : null}
      </View>
      {!own ? <ChallengeSheet visible={challenge} onClose={() => setChallenge(false)} opponentId={user.id} /> : null}
    </View>
  );
}

/* =========================================================
   Trang cá nhân: của mình (có ô viết bài, Bảng tin / Bài của tôi) hoặc của người khác
   ========================================================= */

export function ProfileView({ userId, own }: { userId: number; own: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { width: winW } = useWindowDimensions();
  const width = Math.min(winW, MAX_W);
  const me = useStore((st) => st.me);
  const other = useStore((st) => st.users[userId]);
  const user = own && me ? { ...other, ...me } : other;
  const seg = useSocial((st) => st.seg);
  const key: ListKey = own && seg === "feed" ? "feed" : listKey(userId);
  const list = useSocial((st) => st.lists[key]);
  const posts = useSocial((st) => st.posts);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    loadProfile(userId);
  }, [userId]);
  useEffect(() => {
    if (!useSocial.getState().lists[key]?.loaded) loadPosts(key);
  }, [key]);

  const refresh = useCallback(async () => {
    setPulling(true);
    await Promise.all([loadProfile(userId), loadPosts(key)]);
    setPulling(false);
  }, [userId, key]);

  if (!user) {
    return (
      <View style={s.center}>
        <Text style={s.muted}>Không tìm thấy người này.</Text>
      </View>
    );
  }

  const data = (list?.ids || []).map((id) => posts[id]).filter(Boolean);
  const empty = !list || !list.loaded ? null : list.error ? list.error : own && seg === "feed"
    ? "Chưa có bài đăng nào. Hãy là người đầu tiên chia sẻ!"
    : own
      ? "Bạn chưa đăng bài nào. Viết gì đó cho mọi người cùng xem nhé."
      : `${user.displayName} chưa đăng bài nào.`;

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <Hero user={user} own={own} width={width} />
      {own ? (
        <>
          <View style={[s.composer, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Avatar user={user} size={36} dot={false} />
            <Pressable
              onPress={() => openComposer()}
              style={({ pressed }) => [s.composerFake, { backgroundColor: c.field, opacity: pressed ? 0.75 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Bạn đang nghĩ gì?"
            >
              <Text style={[s.composerText, { color: c.muted }]}>Bạn đang nghĩ gì?</Text>
            </Pressable>
            <Pressable onPress={() => openComposer({ pickImage: true })} hitSlop={6} accessibilityRole="button" accessibilityLabel="Đăng ảnh" style={s.composerImg}>
              <Icon name="add-photo-alternate" size={26} color={c.accent} />
            </Pressable>
          </View>
          <View style={[s.seg, { backgroundColor: c.field }]} accessibilityRole="tablist">
            {(
              [
                ["feed", "Bảng tin"],
                ["mine", "Bài của tôi"],
              ] as const
            ).map(([k, label]) => (
              <Pressable
                key={k}
                onPress={() => setSeg(k)}
                style={[s.segItem, seg === k && [s.segOn, { backgroundColor: c.surface }]]}
                accessibilityRole="tab"
                accessibilityState={{ selected: seg === k }}
              >
                <Text style={[s.segText, { color: seg === k ? c.text : c.muted }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <Text style={s.section}>BÀI VIẾT</Text>
      )}
    </View>
  );

  return (
    <FlatList
      data={data}
      keyExtractor={(p) => String(p.id)}
      renderItem={({ item }) => <PostCard post={item} />}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={header}
      ListEmptyComponent={
        empty ? (
          <View style={s.empty}>
            <Icon name={list?.error ? "cloud-off" : "dynamic-feed"} size={34} color={c.muted} />
            <Text style={[s.muted, { textAlign: "center" }]}>{empty}</Text>
            {list?.error ? <Button title="Thử lại" small kind="secondary" onPress={() => loadPosts(key)} /> : null}
          </View>
        ) : (
          <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />
        )
      }
      ListFooterComponent={list?.loading && data.length ? <ActivityIndicator color={c.accent} style={{ marginVertical: 16 }} /> : <View style={{ height: 24 }} />}
      onEndReached={() => loadPosts(key, true)}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} colors={[c.jade]} tintColor={c.accent} />}
      style={{ flex: 1 }}
      contentContainerStyle={{ width, alignSelf: "center" }}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const Gap = () => <View style={{ height: 12 }} />;

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    muted: { color: c.muted, fontSize: 14, lineHeight: 20 },
    hero: { paddingBottom: 16, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, overflow: "hidden" },
    coverEdit: {
      position: "absolute",
      right: 10,
      bottom: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: "rgba(10,20,16,0.62)",
    },
    coverEditText: { color: "#fff", fontSize: 13, fontWeight: "700" },
    idRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10, paddingHorizontal: 14, marginTop: -44 },
    avatarRing: { padding: 4, borderRadius: 60 },
    cam: { position: "absolute", right: 4, bottom: 4, width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
    heroActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, flexShrink: 1, paddingBottom: 4 },
    chessBtn: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 6 },
    chessBtnText: { fontSize: 14, fontWeight: "700" },
    info: { paddingHorizontal: 18, paddingTop: 8, gap: 4 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    name: { color: c.text, fontSize: 23, fontWeight: "800", letterSpacing: -0.4 },
    tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    tagText: { fontSize: 12, fontWeight: "800" },
    handle: { color: c.muted, fontSize: 14 },
    bio: { color: c.text, fontSize: 15, lineHeight: 21, marginTop: 4 },
    addBio: { fontSize: 14.5, fontWeight: "800", marginTop: 4 },
    stats: { flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 4, marginTop: 8 },
    stat: { color: c.text2, fontSize: 14.5 },
    statNum: { color: c.text, fontWeight: "800" },
    composer: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, padding: 10, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
    composerFake: { flex: 1, minHeight: 42, borderRadius: 21, justifyContent: "center", paddingHorizontal: 14 },
    composerText: { fontSize: 15.5 },
    composerImg: { padding: 4 },
    seg: { flexDirection: "row", marginHorizontal: 12, borderRadius: 14, padding: 4 },
    segItem: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10 },
    segOn: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    segText: { fontSize: 14.5, fontWeight: "800" },
    section: { color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginHorizontal: 18, marginTop: 4 },
    empty: { alignItems: "center", gap: 10, padding: 28 },
  });
