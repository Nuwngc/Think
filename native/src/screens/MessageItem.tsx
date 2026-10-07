import { Image } from "expo-image";
import { memo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { fileUrl } from "../api";
import { KnightIcon } from "../chess/Board";
import { chessShareOf, hm, imageSize, isEmojiOnly, linkParts, reactionSummary, type ChessShare, type Names } from "../format";
import { isPending } from "../messages";
import { currentToken } from "../session";
import { mentionParts, pollPercents } from "../chatPlus";
import type { ChatTheme } from "../chatThemes";
import { closePoll, openChess, showToast, useStore, votePoll } from "../store";
import { StoryRefCard } from "../stories/StoryRefCard";
import { TranslationBox } from "../ai/TranslationBox";
import { useColors, type Colors } from "../theme";
import type { ChatItem, Conversation, Message, User } from "../types";
import { Avatar, Icon, useStyles } from "../ui";
import { voiceLabel } from "../voice/core";
import { VoiceBubble } from "../voice/ui";

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
  /** Chủ đề cuộc trò chuyện (màu bong bóng tin của mình) */
  theme?: ChatTheme;
  /** Tin này đang được ghim */
  pinned?: boolean;
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
        <Tags item={m} pinned={Boolean(p.pinned)} />
        {"story" in m && m.story && !m.deleted ? (
          <StoryRefCard story={m.story} mine={mine} meId={meId} nameOf={p.names.nameOf} onGone={() => showToast("Tin không còn xem được.")} />
        ) : null}
        <Pressable
          onLongPress={() => !pending && !m.deleted && p.onLongPress(m)}
          onPress={() => (failed ? p.onPressFailed(m) : undefined)}
          delayLongPress={300}
          accessibilityHint={pending ? undefined : "Chạm giữ để trả lời, bày tỏ cảm xúc hoặc thu hồi"}
        >
          {m.kind === "poll" && !m.deleted && !pending ? <PollCard {...p} mine={mine} /> : <Bubble {...p} mine={mine} />}
        </Pressable>
        {!pending && !m.deleted ? <TranslationBox messageId={m.id as number} /> : null}
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

/** Nhãn nhỏ trên bong bóng: đã chuyển tiếp / đã chỉnh sửa / đã ghim */
function Tags({ item: m, pinned }: { item: ChatItem; pinned: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  if (m.deleted || isPending(m)) return null;
  const tags: { icon: "forward" | "edit" | "push-pin"; text: string }[] = [];
  if (m.forwarded) tags.push({ icon: "forward", text: "Đã chuyển tiếp" });
  if (m.editedAt) tags.push({ icon: "edit", text: "Đã chỉnh sửa" });
  if (pinned) tags.push({ icon: "push-pin", text: "Đã ghim" });
  if (!tags.length) return null;
  return (
    <View style={s.tags}>
      {tags.map((t) => (
        <View key={t.text} style={s.tag}>
          <Icon name={t.icon} size={12} color={c.muted} />
          <Text style={s.tagText}>{t.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** Bình chọn: câu hỏi + các lựa chọn có thanh phần trăm, chạm để chọn */
function PollCard(p: MessageRowProps & { mine: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const m = p.item as Message;
  const users = useStore((st) => st.users);
  const poll = m.poll || { multi: false, closed: false, options: [] };
  const accent = p.theme?.a || c.jade;
  const { voters: total, percents } = pollPercents(poll.options);
  const max = Math.max(1, ...poll.options.map((o) => o.votes.length));
  return (
    <View style={[s.poll, { backgroundColor: c.theirs, borderColor: c.line }]}>
      <View style={s.pollHead}>
        <Icon name="poll" size={18} color={accent} />
        <Text style={[s.pollQ, { color: c.text }]}>{m.text}</Text>
      </View>
      <Text style={s.pollSub}>{poll.closed ? "Bình chọn đã kết thúc" : poll.multi ? "Chọn một hoặc nhiều đáp án" : "Chọn một đáp án"}</Text>
      {poll.options.map((o, i) => {
        const n = o.votes.length;
        const pct = percents[i];
        const on = o.votes.includes(p.meId);
        return (
          <Pressable
            key={i}
            disabled={poll.closed}
            onPress={() => votePoll(m, i)}
            style={({ pressed }) => [s.pollOpt, { backgroundColor: c.field, borderColor: on ? accent : "transparent", opacity: pressed ? 0.75 : 1 }]}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: poll.closed }}
            accessibilityLabel={`${o.text}: ${n} phiếu${on ? ", bạn đã chọn" : ""}`}
          >
            <View style={[s.pollBar, { width: `${total ? (n / total) * 100 : 0}%`, backgroundColor: accent }]} />
            <View style={[s.pollMark, { borderRadius: poll.multi ? 6 : 10, borderColor: on ? accent : c.muted, backgroundColor: on ? accent : "transparent" }]}>
              {on ? <Icon name="check" size={13} color="#fff" /> : null}
            </View>
            <Text style={[s.pollText, { color: c.text, fontWeight: poll.closed && n === max && n > 0 ? "800" : "500" }]}>{o.text}</Text>
            <View style={s.pollVoters}>
              {o.votes.slice(0, 3).map((uid) => (
                <View key={uid} style={s.pollVoter}>
                  <Avatar user={users[uid]} size={18} dot={false} />
                </View>
              ))}
            </View>
            <Text style={s.pollPct}>{total ? `${pct}%` : "0"}</Text>
          </Pressable>
        );
      })}
      <View style={s.pollFootRow}>
        <Text style={s.pollFoot}>{total ? `${total} người đã bình chọn` : "Chưa có ai bình chọn"}</Text>
        {p.mine && !poll.closed ? (
          <Pressable onPress={() => closePoll(m)} hitSlop={8} accessibilityRole="button">
            <Text style={[s.pollFoot, { color: accent, fontWeight: "800" }]}>Kết thúc</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

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
  if (m.kind === "voice") {
    return (
      <View
        style={[
          s.bubble,
          { backgroundColor: mine ? p.theme?.a || c.jade : c.theirs, paddingVertical: 6, paddingLeft: 6, paddingRight: 8 },
          !mine && c.scheme === "light" && s.bubbleShadow,
        ]}
      >
        {m.replyTo ? <Quote {...p} mine={mine} /> : null}
        <VoiceBubble m={m} mine={mine} accent={p.theme?.a || c.jade} />
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
  // Ván cờ được chia sẻ: hiện thành thẻ bấm được để mở ván
  const shared = !hasImage && !purged ? chessShareOf(m.text) : null;

  return (
    <View
      style={[
        s.bubble,
        { backgroundColor: mine ? p.theme?.a || c.jade : c.theirs },
        !mine && c.scheme === "light" && s.bubbleShadow,
        !mine && "mentions" in m && m.mentions?.includes(p.meId) && { borderWidth: 1.5, borderColor: c.turmeric },
        imageOnly && s.imageOnly,
        (hasImage || purged) && !imageOnly && { padding: 4 },
      ]}
    >
      {quote ? <Quote {...p} mine={mine} /> : null}
      {hasImage ? <MessageImage {...p} localUri={localUri} /> : purged ? <GoneImage text="Ảnh đã được dọn khỏi máy chủ" /> : null}
      {shared ? (
        <ChessCard share={shared} mine={mine} />
      ) : m.text ? (
        <Text style={[s.text, { color: fg }, (hasImage || purged) && { paddingHorizontal: 8, paddingVertical: 6 }]} selectable={false}>
          {linkParts(m.text).map((part, i) =>
            part.url ? (
              <Text key={i} style={{ textDecorationLine: "underline", color: fg }} onPress={() => Linking.openURL(part.url!)}>
                {part.text}
              </Text>
            ) : (
              mentionParts(part.text, m.mentions, p.names.nameOf, p.meId).map((x, k) =>
                x.mention ? (
                  <Text
                    key={`${i}-${k}`}
                    style={[{ fontWeight: "800" }, !mine && { color: c.accent }, x.me && { backgroundColor: c.turmericWash, color: c.text }]}
                  >
                    {x.text}
                  </Text>
                ) : (
                  x.text
                ),
              )
            ),
          )}
        </Text>
      ) : null}
    </View>
  );
}

function ChessCard({ share, mine }: { share: ChessShare; mine: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const fg = mine ? "#fff" : c.text;
  const sub = mine ? "rgba(255,255,255,0.86)" : c.text2;
  return (
    <Pressable
      onPress={() => openChess(share.id)}
      style={({ pressed }) => [s.chess, { backgroundColor: mine ? c.quoteMine : c.quoteTheirs, opacity: pressed ? 0.8 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Ván cờ ${share.title}. ${share.sub}. Chạm để xem lại ván`}
    >
      <View style={[s.chessIcon, { backgroundColor: mine ? "#F2F4DA" : c.surface }]}>
        <KnightIcon size={30} color="#2B4A3F" hole={mine ? "#F2F4DA" : c.surface} />
      </View>
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text style={[s.chessTitle, { color: fg }]}>{share.title}</Text>
        {share.sub ? <Text style={[s.chessSub, { color: sub }]}>{share.sub}</Text> : null}
        <Text style={[s.chessLink, { color: mine ? "#fff" : c.accent }]}>Chạm để xem lại ván</Text>
      </View>
    </Pressable>
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
      : r.text || (r.audio ? voiceLabel() : r.image ? "📷 Ảnh" : "");
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
    chess: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, marginVertical: 2, maxWidth: 290 },
    chessIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    chessTitle: { fontSize: 15, fontWeight: "800", lineHeight: 20 },
    chessSub: { fontSize: 13, lineHeight: 18 },
    chessLink: { fontSize: 13, fontWeight: "800", marginTop: 2 },
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
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6, marginBottom: 2, marginHorizontal: 8 },
    tag: { flexDirection: "row", alignItems: "center", gap: 3 },
    tagText: { color: c.muted, fontSize: 11.5 },
    poll: { width: 290, maxWidth: "100%", borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 7 },
    pollHead: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    pollQ: { flex: 1, fontSize: 15.5, fontWeight: "800", lineHeight: 21 },
    pollSub: { color: c.muted, fontSize: 12, marginLeft: 26, marginTop: -4 },
    pollOpt: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 42,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 12,
      borderWidth: 1.5,
      overflow: "hidden",
    },
    pollBar: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.18 },
    pollMark: { width: 20, height: 20, borderWidth: 2, alignItems: "center", justifyContent: "center" },
    pollText: { flex: 1, fontSize: 14.5 },
    pollVoters: { flexDirection: "row" },
    pollVoter: { marginLeft: -5, borderRadius: 10, borderWidth: 1.5, borderColor: c.field },
    pollPct: { minWidth: 34, textAlign: "right", fontSize: 12.5, fontWeight: "800", color: c.text2 },
    pollFootRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 1 },
    pollFoot: { color: c.muted, fontSize: 12 },
  });
