import { Image } from "expo-image";
import { memo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { fileUrl } from "../api";
import { hm, imageSize, isEmojiOnly, linkParts, reactionSummary, type Names } from "../format";
import { isPending } from "../messages";
import { currentToken } from "../session";
import { useColors, type Colors } from "../theme";
import type { ChatItem, Conversation, User } from "../types";
import { Avatar, Icon, useStyles } from "../ui";

export type MessageRowProps = {
  item: ChatItem;
  conv: Pick<Conversation, "type">;
  first: boolean;
  last: boolean;
  meId: number;
  sender: User | undefined;
  names: Names;
  onLongPress: (m: ChatItem) => void;
  onPressImage: (m: ChatItem) => void;
  onPressQuote: (id: number) => void;
  onPressReactions: (m: ChatItem) => void;
  onPressFailed: (m: ChatItem) => void;
};

/** Ảnh trong tin nhắn cần đăng nhập mới xem được: gửi kèm mã phiên */
export function imageSource(path: string) {
  const token = currentToken();
  return {
    uri: fileUrl(path),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cacheKey: path,
  };
}

export const MessageRow = memo(function MessageRow(p: MessageRowProps) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { item: m, first, last, meId } = p;
  const mine = m.senderId === meId;
  const pending = isPending(m);
  const failed = pending && m.status === "failed";
  const showName = !mine && p.conv.type !== "dm" && first;

  return (
    <View style={[s.row, mine ? s.rowMine : s.rowTheirs, first && s.rowFirst]}>
      {!mine ? <View style={s.avatarSlot}>{last ? <Avatar user={p.sender} size={30} dot={false} /> : null}</View> : null}
      <View style={[s.col, mine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}>
        {showName ? <Text style={s.sender}>{p.sender?.displayName || "Người dùng"}</Text> : null}
        <Pressable
          onLongPress={() => !pending && !m.deleted && p.onLongPress(m)}
          onPress={() => (failed ? p.onPressFailed(m) : undefined)}
          delayLongPress={300}
          accessibilityHint={pending ? undefined : "Chạm giữ để trả lời, bày tỏ cảm xúc hoặc thu hồi"}
        >
          <Bubble {...p} mine={mine} />
        </Pressable>
        {!m.deleted && m.reactions?.length ? (
          <Pressable onPress={() => p.onPressReactions(m)} style={[s.reacts, mine ? s.reactsMine : s.reactsTheirs]} accessibilityRole="button">
            <ReactionPill list={m.reactions} meId={meId} />
          </Pressable>
        ) : null}
        {failed ? (
          <Pressable onPress={() => p.onPressFailed(m)} accessibilityRole="button">
            <Text style={[s.meta, { color: c.danger }]}>Chưa gửi được. Chạm để thử lại.</Text>
          </Pressable>
        ) : last || pending ? (
          <Text style={s.meta}>{pending ? "Đang gửi…" : hm(m.createdAt)}</Text>
        ) : null}
      </View>
    </View>
  );
});

function ReactionPill({ list, meId }: { list: { userId: number; emoji: string }[]; meId: number }) {
  const s = useStyles(makeStyles);
  const c = useColors();
  const sum = reactionSummary(list, meId);
  return (
    <View style={[s.pill, { borderColor: sum.mine ? c.accent : c.line }]}>
      <Text style={s.pillEmoji}>{sum.top.join("")}</Text>
      {sum.total > 1 ? <Text style={s.pillCount}>{sum.total}</Text> : null}
    </View>
  );
}

function Bubble(p: MessageRowProps & { mine: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { item: m, mine } = p;
  const fg = mine ? c.mineText : c.theirsText;
  if (m.deleted) {
    return (
      <View style={[s.bubble, s.deleted, { borderColor: c.line }]}>
        <Text style={[s.text, { color: c.muted, fontStyle: "italic" }]}>Tin nhắn đã được thu hồi</Text>
      </View>
    );
  }
  const localUri = isPending(m) ? m.localUri : undefined;
  const hasImage = Boolean(m.image || localUri);
  const purged = !hasImage && !isPending(m) && Boolean(m.imagePurged);
  const quote = m.replyTo;
  const emoji = !hasImage && !purged && !quote && isEmojiOnly(m.text);
  if (emoji) return <Text style={s.emoji}>{m.text}</Text>;
  const imageOnly = (hasImage || purged) && !m.text && !quote;

  return (
    <View
      style={[
        s.bubble,
        { backgroundColor: mine ? c.jade : c.theirs },
        !mine && c.scheme === "light" && s.bubbleShadow,
        imageOnly && s.imageOnly,
        (hasImage || purged) && !imageOnly && { padding: 4 },
      ]}
    >
      {quote ? <Quote {...p} mine={mine} /> : null}
      {hasImage ? <MessageImage {...p} localUri={localUri} /> : purged ? <GoneImage text="Ảnh đã được dọn khỏi máy chủ" /> : null}
      {m.text ? (
        <Text style={[s.text, { color: fg }, (hasImage || purged) && { paddingHorizontal: 8, paddingVertical: 6 }]} selectable={false}>
          {linkParts(m.text).map((part, i) =>
            part.url ? (
              <Text key={i} style={{ textDecorationLine: "underline", color: fg }} onPress={() => Linking.openURL(part.url!)}>
                {part.text}
              </Text>
            ) : (
              part.text
            ),
          )}
        </Text>
      ) : null}
    </View>
  );
}

function Quote(p: MessageRowProps & { mine: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const r = p.item.replyTo!;
  const who = r.senderId == null ? "Tin nhắn cũ" : r.senderId === p.meId ? "Bạn" : p.names.nameOf(r.senderId);
  const text = r.missing
    ? "Tin nhắn cũ đã được dọn khỏi máy chủ"
    : r.deleted
      ? "Tin nhắn đã được thu hồi"
      : r.text || (r.image ? "📷 Ảnh" : "");
  return (
    <Pressable
      onPress={() => r.id && !r.missing && p.onPressQuote(r.id)}
      style={[s.quote, { backgroundColor: p.mine ? c.quoteMine : c.quoteTheirs, borderLeftColor: p.mine ? "#fff" : c.accent }]}
      accessibilityLabel={`Trả lời ${who}: ${text}`}
    >
      <Text style={[s.quoteName, { color: p.mine ? "#fff" : c.accent }]} numberOfLines={1}>
        {who}
      </Text>
      <Text style={[s.quoteText, { color: p.mine ? "rgba(255,255,255,0.88)" : c.text2 }]} numberOfLines={2}>
        {text}
      </Text>
    </Pressable>
  );
}

function MessageImage(p: MessageRowProps & { localUri?: string }) {
  const { width: screenW } = useWindowDimensions();
  const s = useStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const m = p.item;
  const dims =
    (isPending(m) && m.width && m.height ? { w: m.width, h: m.height } : null) || imageSize(m.image) || { w: 240, h: 180 };
  const maxW = Math.min(260, screenW * 0.66);
  const scale = Math.min(1, maxW / dims.w, 320 / dims.h);
  const w = Math.max(80, Math.round(dims.w * scale));
  const h = Math.max(60, Math.round(dims.h * scale));
  if (failed) {
    return (
      <Pressable onPress={() => setFailed(false)} accessibilityRole="button">
        <GoneImage text="Không tải được ảnh. Chạm để thử lại" />
      </Pressable>
    );
  }
  const source = p.localUri ? { uri: p.localUri } : imageSource(m.image!);
  return (
    <Pressable onPress={() => p.onPressImage(m)} accessibilityRole="imagebutton" accessibilityLabel="Ảnh, chạm để xem lớn">
      <Image
        source={source}
        style={[s.image, { width: w, height: h }]}
        contentFit="cover"
        cachePolicy="disk"
        transition={150}
        recyclingKey={m.image || p.localUri}
        onError={() => setFailed(true)}
      />
    </Pressable>
  );
}

function GoneImage({ text }: { text: string }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={[s.gone, { backgroundColor: c.field }]}>
      <Icon name="image" size={22} color={c.muted} />
      <Text style={[s.goneText, { color: c.muted }]}>{text}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: "row", paddingHorizontal: 10, marginTop: 2 },
    rowFirst: { marginTop: 8 },
    rowMine: { justifyContent: "flex-end", paddingLeft: 56 },
    rowTheirs: { justifyContent: "flex-start", paddingRight: 48 },
    avatarSlot: { width: 30, marginRight: 8, justifyContent: "flex-end" },
    col: { flexShrink: 1, maxWidth: "100%" },
    sender: { color: c.muted, fontSize: 12.5, fontWeight: "700", marginBottom: 3, marginLeft: 6 },
    bubble: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8, maxWidth: "100%", overflow: "hidden" },
    bubbleShadow: { borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    imageOnly: { padding: 0, backgroundColor: "transparent", borderWidth: 0 },
    deleted: { backgroundColor: "transparent", borderWidth: 1, borderStyle: "dashed" },
    text: { fontSize: 15.5, lineHeight: 21.5 },
    emoji: { fontSize: 40, lineHeight: 50, paddingHorizontal: 2 },
    quote: { borderLeftWidth: 3, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, marginBottom: 6, marginTop: 1 },
    quoteName: { fontSize: 12.5, fontWeight: "800" },
    quoteText: { fontSize: 13.5, lineHeight: 18 },
    image: { borderRadius: 14, backgroundColor: c.field },
    gone: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 14, maxWidth: 240 },
    goneText: { flexShrink: 1, fontSize: 13 },
    reacts: { marginTop: -6, zIndex: 1 },
    reactsMine: { marginRight: 8 },
    reactsTheirs: { marginLeft: 8 },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: c.surface,
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    pillEmoji: { fontSize: 13 },
    pillCount: { fontSize: 12, fontWeight: "700", color: c.text2 },
    meta: { color: c.muted, fontSize: 11.5, marginTop: 3, marginHorizontal: 6 },
  });
