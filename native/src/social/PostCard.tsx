import { Image } from "expo-image";
import { memo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { KnightIcon, MiniBoard } from "../chess/Board";
import { describeGame, myColor } from "../chess/format";
import type { ChessGame } from "../chess/types";
import { imageSize, linkParts, timeAgo } from "../format";
import { imageSource } from "../screens/MessageItem";
import { openChess, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { Post } from "../types";
import { Avatar, confirm, Icon, IconButton, useStyles } from "../ui";
import { closeSheet, deletePost, openComments, openLikers, openUser, toggleLike, viewImage } from "./store";

export const HEART = "#E5484D";

/** Thẻ ván cờ: bàn cờ nhỏ + tên hai bên + kết quả. Chạm để xem lại ván. */
export function GameCard({ game, onPress }: { game: ChessGame; onPress?: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const users = useStore((st) => st.users);
  const meId = useStore((st) => st.me?.id ?? 0);
  const d = describeGame(game, (id) => (id != null && users[id]?.displayName) || "Người dùng");
  const orientation = myColor(game, meId) === "b" ? "b" : "w";
  const body = (
    <>
      <MiniBoard fen={game.fen} size={104} orientation={orientation} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={s.gameKind}>
          <KnightIcon size={16} color={c.accent} hole={c.field} />
          <Text style={[s.gameKindText, { color: c.accent }]}>VÁN CỜ</Text>
        </View>
        <Text style={s.gameTitle} numberOfLines={3}>
          {d.title}
        </Text>
        <Text style={s.muted} numberOfLines={2}>
          {d.sub}
        </Text>
        {onPress ? <Text style={[s.gameLink, { color: c.accent }]}>Xem lại ván →</Text> : null}
      </View>
    </>
  );
  if (!onPress) return <View style={[s.game, { backgroundColor: c.field }]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.game, { backgroundColor: c.field, opacity: pressed ? 0.8 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Ván cờ ${d.title}. ${d.sub}. Chạm để xem lại ván`}
    >
      {body}
    </Pressable>
  );
}

/** Một bài đăng: người đăng, chữ, ảnh, ván cờ, thả tim, bình luận */
export const PostCard = memo(function PostCard({ post, flat = false }: { post: Post; flat?: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const author = useStore((st) => st.users[post.userId]);
  const meId = useStore((st) => st.me?.id ?? 0);
  const isAdmin = useStore((st) => st.me?.role === "admin");
  const [imgFailed, setImgFailed] = useState(false);
  const name = author?.displayName || "Người dùng";
  const canDelete = post.userId === meId || isAdmin;

  // Ảnh rộng bằng thẻ; giữ đúng tỉ lệ (lấy từ tên file) nhưng không quá cao
  const cardW = Math.min(width, 680) - (flat ? 40 : 24);
  const dims = imageSize(post.image) || { w: 4, h: 3 };
  const imgH = Math.round(cardW * Math.min(1.25, Math.max(0.5, dims.h / dims.w)));

  const remove = async () => {
    if (await confirm("Xóa bài đăng?", "Bài đăng cùng các bình luận sẽ bị xóa hẳn.", "Xóa")) deletePost(post.id);
  };

  return (
    <View style={[s.card, flat ? s.cardFlat : { backgroundColor: c.surface, borderColor: c.line }]}>
      <View style={[s.head, flat && { paddingHorizontal: 0 }]}>
        <Pressable
          onPress={() => openUser(post.userId)}
          style={s.author}
          accessibilityRole="link"
          accessibilityLabel={`Trang cá nhân của ${name}`}
        >
          <Avatar user={author} size={42} dot={false} />
          <View style={{ flexShrink: 1 }}>
            <Text style={s.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={s.muted}>{timeAgo(post.createdAt)}</Text>
          </View>
        </Pressable>
        <View style={{ flex: 1 }} />
        {canDelete ? <IconButton name="close" label="Xóa bài đăng" onPress={remove} color={c.muted} size={22} /> : null}
      </View>

      {post.text ? (
        <Text style={[s.text, flat && { paddingHorizontal: 0 }]} selectable>
          {linkParts(post.text).map((part, i) =>
            part.url ? (
              <Text key={i} style={{ color: c.accent, textDecorationLine: "underline" }} onPress={() => Linking.openURL(part.url!)}>
                {part.text}
              </Text>
            ) : (
              part.text
            ),
          )}
        </Text>
      ) : null}

      {post.image ? (
        imgFailed ? (
          <Pressable onPress={() => setImgFailed(false)} style={[s.imgGone, { backgroundColor: c.field }]} accessibilityRole="button">
            <Icon name="image" size={22} color={c.muted} />
            <Text style={s.muted}>Không tải được ảnh. Chạm để thử lại</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => viewImage(post.image)} accessibilityRole="imagebutton" accessibilityLabel="Ảnh trong bài, chạm để xem lớn">
            <Image
              source={imageSource(post.image)}
              style={{ width: cardW, height: imgH, backgroundColor: c.field, borderRadius: flat ? 14 : 0 }}
              contentFit="cover"
              cachePolicy="disk"
              transition={150}
              recyclingKey={post.image}
              onError={() => setImgFailed(true)}
            />
          </Pressable>
        )
      ) : null}

      {post.game ? (
        <View style={[s.gameWrap, flat && { paddingHorizontal: 0 }]}>
          <GameCard
            game={post.game}
            onPress={() => {
              closeSheet();
              openChess(post.game!.id);
            }}
          />
        </View>
      ) : null}

      <View style={[s.actions, flat && { paddingHorizontal: 0 }]}>
        <Pressable
          onPress={() => toggleLike(post.id)}
          style={({ pressed }) => [s.act, pressed && { backgroundColor: c.field }]}
          accessibilityRole="button"
          accessibilityState={{ selected: post.liked }}
          accessibilityLabel={`${post.liked ? "Bỏ thích" : "Thích"}, ${post.likes} lượt thích`}
        >
          <Icon name={post.liked ? "favorite" : "favorite-border"} size={21} color={post.liked ? HEART : c.text2} />
          <Text style={[s.actText, post.liked && { color: HEART }]}>{post.likes || "Thích"}</Text>
        </Pressable>
        <Pressable
          onPress={() => openComments(post.id)}
          style={({ pressed }) => [s.act, pressed && { backgroundColor: c.field }]}
          accessibilityRole="button"
          accessibilityLabel={`${post.comments} bình luận`}
        >
          <Icon name="chat-bubble-outline" size={20} color={c.text2} />
          <Text style={s.actText}>{post.comments || "Bình luận"}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {post.likes ? (
          <Pressable onPress={() => openLikers(post.id)} hitSlop={8} accessibilityRole="button">
            <Text style={s.who}>Ai đã thích?</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { marginHorizontal: 12, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", paddingBottom: 4 },
    cardFlat: { marginHorizontal: 0, borderWidth: 0, borderRadius: 0, backgroundColor: "transparent" },
    head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
    author: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
    name: { color: c.text, fontSize: 15.5, fontWeight: "800" },
    muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
    text: { color: c.text, fontSize: 15.5, lineHeight: 22, paddingHorizontal: 14, paddingBottom: 10 },
    imgGone: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, marginHorizontal: 14, borderRadius: 14 },
    gameWrap: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 4 },
    game: { flexDirection: "row", gap: 12, padding: 10, borderRadius: 16, alignItems: "center" },
    gameKind: { flexDirection: "row", alignItems: "center", gap: 4 },
    gameKindText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
    gameTitle: { color: c.text, fontSize: 15, fontWeight: "800", lineHeight: 20 },
    gameLink: { fontSize: 14, fontWeight: "800", marginTop: 2 },
    actions: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingTop: 4 },
    act: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
    actText: { color: c.text2, fontSize: 14.5, fontWeight: "700" },
    who: { color: c.muted, fontSize: 13.5, paddingHorizontal: 8 },
  });
