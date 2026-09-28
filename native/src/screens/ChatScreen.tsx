import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";

import { convTitle, dayKey, dayLabel, lastSeenText, REACTIONS, systemText } from "../format";
import { forgetPick, pickImages, prepareImage, rememberPick } from "../images";
import { isPending } from "../messages";
import {
  cancelReply,
  closeConversation,
  discard,
  emitTyping,
  loadMessages,
  namesOf,
  react,
  recall,
  retry,
  sendImages,
  sendText,
  setAtBottom,
  setDraft,
  showToast,
  startReply,
  useStore,
} from "../store";
import { useColors, type Colors } from "../theme";
import type { ChatItem, Conversation, Message } from "../types";
import { Avatar, Button, confirm, ConvAvatar, Icon, IconButton, KeyboardAware, Sheet, SheetItem, useKeyboardOpen, useStyles } from "../ui";
import { KnightIcon } from "../chess/Board";
import { ChallengeSheet } from "../chess/Sheets";
import { GroupInfoSheet } from "./GroupInfoSheet";
import { ImageViewer } from "./ImageViewer";
import { MessageRow } from "./MessageItem";

const GROUP_GAP = 5 * 60 * 1000;

type Row =
  | { type: "msg"; key: string; item: ChatItem; first: boolean; last: boolean }
  | { type: "day"; key: string; label: string }
  | { type: "system"; key: string; item: Message }
  | { type: "seen"; key: string; readers: number[]; dm: boolean; seen: boolean }
  | { type: "top"; key: string };

const sameGroup = (a: ChatItem | undefined, b: ChatItem) =>
  Boolean(a && a.kind !== "system" && a.senderId === b.senderId && dayKey(a.createdAt) === dayKey(b.createdAt) && Math.abs(b.createdAt - a.createdAt) < GROUP_GAP);

/** Dựng danh sách dòng hiển thị (từ cũ tới mới), rồi đảo lại cho FlatList "inverted" */
function buildRows(list: ChatItem[], conv: Conversation, meId: number): Row[] {
  const rows: Row[] = [{ type: "top", key: "top" }];
  let lastDay = "";
  list.forEach((m, i) => {
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      rows.push({ type: "day", key: `d${day}`, label: dayLabel(m.createdAt) });
      lastDay = day;
    }
    const key = isPending(m) ? `c${m.clientId}` : `m${m.id}`;
    if (m.kind === "system" && !isPending(m)) {
      rows.push({ type: "system", key, item: m });
      return;
    }
    const prev = list[i - 1];
    const next = list[i + 1];
    rows.push({ type: "msg", key, item: m, first: !sameGroup(prev, m), last: !next || !sameGroup(m, next) });
  });
  const last = list[list.length - 1];
  if (last && !isPending(last) && !last.deleted && last.kind !== "system") {
    if (conv.type === "dm" && last.senderId === meId) {
      rows.push({ type: "seen", key: "seen", readers: [], dm: true, seen: (conv.peerLastReadId || 0) >= last.id });
    } else if (conv.type !== "dm" && conv.reads) {
      const readers = Object.entries(conv.reads)
        .map(([uid, rid]) => [Number(uid), rid] as const)
        .filter(([uid, rid]) => uid !== meId && uid !== last.senderId && rid >= last.id)
        .map(([uid]) => uid);
      if (readers.length) rows.push({ type: "seen", key: "seen", readers, dm: false, seen: true });
    }
  }
  return rows.reverse();
}

export function ChatScreen({ convId }: { convId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { conv, box, users, me, typingIds, draft, replying, offline, atBottom } = useStore(
    useShallow((st) => ({
      conv: st.convs[convId],
      box: st.msgs[convId],
      users: st.users,
      me: st.me,
      typingIds: st.typing[convId],
      draft: st.drafts[convId] || "",
      replying: st.replying[convId],
      offline: st.offline,
      atBottom: st.atBottom,
    })),
  );
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  const meId = me?.id ?? 0;
  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);
  const lastTyping = useRef(0);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [reactorsFor, setReactorsFor] = useState<ChatItem | null>(null);
  const [failedFor, setFailedFor] = useState<ChatItem | null>(null);
  const [viewer, setViewer] = useState<ChatItem | null>(null);
  const [chessOpen, setChessOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const list = useMemo(() => box?.list ?? [], [box?.list]);
  const rows = useMemo(() => (conv ? buildRows(list, conv, meId) : []), [list, conv, meId]);

  useEffect(() => {
    if (!conv) closeConversation();
  }, [conv]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setAtBottom(e.nativeEvent.contentOffset.y < 80);
  }, []);

  const jumpTo = useCallback(
    (messageId: number) => {
      const index = rows.findIndex((r) => r.type === "msg" && !isPending(r.item) && r.item.id === messageId);
      if (index < 0) {
        showToast("Tin nhắn gốc ở xa quá, hãy kéo lên để xem.");
        return;
      }
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    },
    [rows],
  );

  const onChangeText = (text: string) => {
    setDraft(convId, text);
    const now = Date.now();
    if (text.trim() && now - lastTyping.current > 2000) {
      lastTyping.current = now;
      emitTyping(convId);
    }
  };

  const send = () => {
    if (sendText(convId, draft)) listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const attach = async (camera: boolean) => {
    setAttachOpen(false);
    try {
      await rememberPick(convId);
      const assets = await pickImages({ camera }).finally(forgetPick);
      if (!assets.length) return;
      if (assets.length > 10) showToast("Mỗi lần gửi tối đa 10 ảnh.");
      const prepared = [];
      for (const a of assets.slice(0, 10)) {
        try {
          prepared.push(await prepareImage(a));
        } catch {
          showToast("Không đọc được một ảnh, đã bỏ qua ảnh đó.");
        }
      }
      if (prepared.length) {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
        await sendImages(convId, prepared);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không mở được thư viện ảnh.");
    }
  };

  const renderItem = useCallback(
    ({ item: row }: { item: Row }) => {
      switch (row.type) {
        case "msg":
          return (
            <MessageRow
              item={row.item}
              conv={conv!}
              first={row.first}
              last={row.last}
              meId={meId}
              sender={users[row.item.senderId]}
              names={names}
              onLongPress={(m) => !isPending(m) && setMenuFor(m)}
              onPressImage={setViewer}
              onPressQuote={jumpTo}
              onPressReactions={setReactorsFor}
              onPressFailed={setFailedFor}
            />
          );
        case "day":
          return (
            <View style={s.center}>
              <Text style={s.day}>{row.label}</Text>
            </View>
          );
        case "system":
          return (
            <View style={s.center}>
              <Text style={s.system}>{systemText(row.item, names)}</Text>
            </View>
          );
        case "seen":
          return (
            <View style={s.seen}>
              {row.dm ? (
                row.seen ? (
                  <>
                    <Avatar user={conv?.peerId != null ? users[conv.peerId] : null} size={16} dot={false} />
                    <Text style={s.seenText}>Đã xem</Text>
                  </>
                ) : (
                  <Text style={s.seenText}>Đã gửi</Text>
                )
              ) : (
                <>
                  {row.readers.slice(0, 5).map((uid) => (
                    <Avatar key={uid} user={users[uid]} size={16} dot={false} />
                  ))}
                  {row.readers.length > 5 ? <Text style={s.seenText}>+{row.readers.length - 5}</Text> : null}
                </>
              )}
            </View>
          );
        case "top":
          return <ListTop conv={conv!} box={box} names={names} users={users} meId={meId} />;
      }
    },
    [conv, meId, users, names, jumpTo, s, box],
  );

  if (!conv) return null;

  const title = convTitle(conv, names.nameOf);
  const peer = conv.type === "dm" && conv.peerId != null ? users[conv.peerId] : undefined;
  const typers = (typingIds || []).map((id) => names.nameOf(id));
  let status: string;
  if (offline) status = "Chưa kết nối máy chủ";
  else if (typers.length && conv.type === "dm") status = "Đang nhập…";
  else if (conv.type === "dm") status = peer?.disabled ? "Tài khoản này đã bị khóa" : lastSeenText(peer);
  else {
    const ids = conv.type === "group" ? conv.memberIds || [] : Object.values(users).filter((u) => !u.disabled).map((u) => u.id);
    const active = ids.filter((uid) => uid !== meId && users[uid]?.online).length;
    status = `${ids.length} thành viên${active ? `, ${active} người đang hoạt động` : ""}`;
  }
  const typingText =
    typers.length === 0
      ? ""
      : typers.length === 1
        ? `${typers[0]} đang nhập…`
        : typers.length === 2
          ? `${typers[0]} và ${typers[1]} đang nhập…`
          : `${typers[0]} và ${typers.length - 1} người khác đang nhập…`;

  const loading = !box || (!box.loaded && box.loading) || (!box.loaded && !box.error);

  return (
    <KeyboardAware bottomInset={false} style={{ backgroundColor: c.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 4 }]}>
        <IconButton name="arrow-back" label="Quay lại" onPress={closeConversation} color={c.text} />
        <Pressable
          style={s.headerMain}
          onPress={() => setInfoOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${title}. Xem thông tin`}
        >
          <ConvAvatar conv={conv} users={users} meId={meId} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[s.status, peer?.online && !offline && { color: c.accent }]} numberOfLines={1}>
              {status}
            </Text>
          </View>
        </Pressable>
        {conv.type === "dm" && peer && !peer.disabled ? (
          <Pressable
            onPress={() => setChessOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Thách ${peer.displayName} một ván cờ`}
            style={({ pressed }) => [s.chessBtn, { opacity: pressed ? 0.55 : 1 }]}
          >
            <KnightIcon size={22} color={c.text2} hole={c.surface} />
          </Pressable>
        ) : null}
        <IconButton name={conv.type === "group" ? "group" : "info-outline"} label="Thông tin cuộc trò chuyện" onPress={() => setInfoOpen(true)} />
      </View>

      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={s.fill}>
            <ActivityIndicator color={c.accent} />
            <Text style={s.muted}>Đang tải tin nhắn…</Text>
          </View>
        ) : box && !box.loaded && box.error ? (
          <View style={s.fill}>
            <Text style={s.muted}>{box.error}</Text>
            <Button title="Thử lại" icon="refresh" kind="secondary" onPress={() => loadMessages(convId)} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={renderItem}
            onScroll={onScroll}
            scrollEventThrottle={100}
            onEndReached={() => loadMessages(convId, { older: true })}
            onEndReachedThreshold={0.4}
            maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 120 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingVertical: 8 }}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
            }}
            initialNumToRender={20}
            windowSize={11}
          />
        )}
        {!atBottom && !loading ? (
          <Pressable
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            style={[s.jump, { backgroundColor: c.surface, borderColor: c.line }]}
            accessibilityRole="button"
            accessibilityLabel="Xuống tin mới nhất"
          >
            <Icon name="keyboard-arrow-down" size={26} color={c.accent} />
            {conv.unread ? <View style={[s.jumpDot, { backgroundColor: c.turmeric }]} /> : null}
          </Pressable>
        ) : null}
      </View>

      {typingText ? (
        <View style={s.typing}>
          <Text style={s.typingText} numberOfLines={1}>
            {typingText}
          </Text>
        </View>
      ) : null}

      {replying ? (
        <View style={[s.replyBar, { borderTopColor: c.line }]}>
          <View style={[s.replyAccent, { backgroundColor: c.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={[s.replyLabel, { color: c.accent }]} numberOfLines={1}>
              Đang trả lời {replying.senderId === meId ? "chính mình" : names.nameOf(replying.senderId)}
            </Text>
            <Text style={s.muted} numberOfLines={1}>
              {replying.text || "📷 Ảnh"}
            </Text>
          </View>
          <IconButton name="close" label="Hủy trả lời" size={20} onPress={() => cancelReply(convId)} />
        </View>
      ) : null}

      <Composer>
        <IconButton name="add-photo-alternate" label="Gửi ảnh" color={c.accent} onPress={() => setAttachOpen(true)} disabled={offline} />
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={onChangeText}
          placeholder={offline ? "Đang chờ kết nối máy chủ…" : "Nhập tin nhắn…"}
          placeholderTextColor={c.muted}
          style={s.input}
          multiline
          maxLength={4000}
          editable={!offline}
          accessibilityLabel="Nhập tin nhắn"
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || offline}
          style={({ pressed }) => [s.send, { backgroundColor: draft.trim() && !offline ? c.jade : c.field, opacity: pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Gửi"
        >
          <Icon name="send" size={20} color={draft.trim() && !offline ? c.onJade : c.muted} />
        </Pressable>
      </Composer>

      {/* Chạm giữ tin nhắn */}
      <Sheet visible={Boolean(menuFor)} onClose={() => setMenuFor(null)}>
        {menuFor ? (
          <>
            <View style={s.emojiRow}>
              {REACTIONS.map((e) => {
                const mine = menuFor.reactions?.some((r) => r.userId === meId && r.emoji === e);
                return (
                  <Pressable
                    key={e}
                    onPress={() => {
                      react(menuFor, e);
                      setMenuFor(null);
                    }}
                    style={({ pressed }) => [s.emojiBtn, mine && { backgroundColor: c.jadeWash }, pressed && { transform: [{ scale: 1.15 }] }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Bày tỏ cảm xúc ${e}`}
                  >
                    <Text style={s.emojiText}>{e}</Text>
                  </Pressable>
                );
              })}
            </View>
            <SheetItem
              icon="reply"
              label="Trả lời"
              onPress={() => {
                startReply(convId, menuFor);
                setMenuFor(null);
                setTimeout(() => inputRef.current?.focus(), 250);
              }}
            />
            {menuFor.text ? (
              <SheetItem
                icon="content-copy"
                label="Sao chép"
                onPress={async () => {
                  await Clipboard.setStringAsync(menuFor.text || "");
                  setMenuFor(null);
                  showToast("Đã sao chép tin nhắn.");
                }}
              />
            ) : null}
            {menuFor.reactions?.length ? (
              <SheetItem
                icon="emoji-emotions"
                label="Xem ai đã bày tỏ cảm xúc"
                onPress={() => {
                  setReactorsFor(menuFor);
                  setMenuFor(null);
                }}
              />
            ) : null}
            {menuFor.senderId === meId ? (
              <SheetItem
                icon="undo"
                label="Thu hồi"
                danger
                hint="Mọi người sẽ thấy “Tin nhắn đã được thu hồi”"
                onPress={async () => {
                  const m = menuFor;
                  setMenuFor(null);
                  if (!(await confirm("Thu hồi tin nhắn?", "Tin nhắn sẽ bị xóa với mọi người trong cuộc trò chuyện.", "Thu hồi"))) return;
                  recall(m).catch((err) => showToast(err instanceof Error ? err.message : "Chưa thu hồi được."));
                }}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>

      {/* Ai đã bày tỏ cảm xúc */}
      <Sheet visible={Boolean(reactorsFor)} onClose={() => setReactorsFor(null)} title="Cảm xúc">
        {(reactorsFor?.reactions || []).map((r) => (
          <View key={`${r.userId}${r.emoji}`} style={s.reactor}>
            <Avatar user={users[r.userId]} size={36} dot={false} />
            <Text style={[s.reactorName, { color: c.text }]} numberOfLines={1}>
              {r.userId === meId ? "Bạn" : names.nameOf(r.userId)}
            </Text>
            <Text style={s.emojiText}>{r.emoji}</Text>
          </View>
        ))}
      </Sheet>

      {/* Tin gửi lỗi */}
      <Sheet visible={Boolean(failedFor)} onClose={() => setFailedFor(null)} title="Chưa gửi được">
        {failedFor && isPending(failedFor) && failedFor.error ? <Text style={s.muted}>{failedFor.error}</Text> : null}
        <SheetItem
          icon="refresh"
          label="Gửi lại"
          onPress={() => {
            if (failedFor && isPending(failedFor)) retry(convId, failedFor.clientId);
            setFailedFor(null);
          }}
        />
        <SheetItem
          icon="delete-outline"
          label="Bỏ tin này"
          danger
          onPress={() => {
            if (failedFor && isPending(failedFor)) discard(convId, failedFor.clientId);
            setFailedFor(null);
          }}
        />
      </Sheet>

      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title="Gửi ảnh">
        <SheetItem icon="photo-library" label="Chọn ảnh trong máy" hint="Tối đa 10 ảnh mỗi lần" onPress={() => attach(false)} />
        <SheetItem icon="photo-camera" label="Chụp ảnh" onPress={() => attach(true)} />
      </Sheet>

      <ImageViewer item={viewer} onClose={() => setViewer(null)} />
      <GroupInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} conv={conv} />
      {conv.type === "dm" ? <ChallengeSheet visible={chessOpen} onClose={() => setChessOpen(false)} opponentId={conv.peerId} /> : null}
    </KeyboardAware>
  );
}

/** Thanh nhập tin: khi bàn phím mở thì bỏ khoảng chừa cho thanh điều hướng (bàn phím đã che chỗ đó) */
function Composer({ children }: { children: ReactNode }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  return (
    <View style={[s.composer, { paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 8), borderTopColor: c.line }]}>{children}</View>
  );
}

/** Đầu cuộc trò chuyện: đang tải tin cũ hơn, hoặc lời giới thiệu khi đã hết */
function ListTop({
  conv,
  box,
  names,
  users,
  meId,
}: {
  conv: Conversation;
  box: ReturnType<typeof useStore.getState>["msgs"][number] | undefined;
  names: ReturnType<typeof namesOf>;
  users: ReturnType<typeof useStore.getState>["users"];
  meId: number;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  if (box?.hasMore) {
    return <View style={s.center}>{box.loading ? <ActivityIndicator color={c.accent} /> : <View style={{ height: 24 }} />}</View>;
  }
  const peer = conv.type === "dm" && conv.peerId != null ? users[conv.peerId] : undefined;
  let text = "Phòng chung của cả nhóm. Tin nhắn ở đây mọi thành viên đều đọc được.";
  if (conv.type === "dm") text = `Đây là đầu cuộc trò chuyện riêng giữa bạn và ${peer?.displayName || "người này"}.`;
  if (conv.type === "group") {
    const owner = conv.createdBy === meId ? "bạn" : names.nameOf(conv.createdBy);
    text = `Nhóm riêng do ${owner} làm trưởng nhóm. Chỉ thành viên trong nhóm mới đọc được tin nhắn ở đây.`;
  }
  return (
    <View style={s.intro}>
      <ConvAvatar conv={conv} users={users} size={72} dot={false} />
      <Text style={s.introName}>{convTitle(conv, names.nameOf)}</Text>
      <Text style={s.introText}>{text}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 6,
      paddingBottom: 8,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    headerMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
    chessBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
    title: { color: c.text, fontSize: 16.5, fontWeight: "800" },
    status: { color: c.muted, fontSize: 12.5 },
    fill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    muted: { color: c.muted, fontSize: 13.5, lineHeight: 19 },
    center: { alignItems: "center", paddingVertical: 8 },
    day: {
      fontSize: 12,
      fontWeight: "700",
      color: c.muted,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: c.field,
      overflow: "hidden",
    },
    system: { fontSize: 12.5, color: c.muted, textAlign: "center", paddingHorizontal: 24 },
    seen: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 3, paddingHorizontal: 16, paddingTop: 3 },
    seenText: { color: c.muted, fontSize: 11.5, marginLeft: 3 },
    intro: { alignItems: "center", gap: 6, paddingHorizontal: 32, paddingTop: 28, paddingBottom: 12 },
    introName: { color: c.text, fontWeight: "800", fontSize: 19, marginTop: 4 },
    introText: { color: c.muted, fontSize: 13.5, textAlign: "center", lineHeight: 19 },
    jump: {
      position: "absolute",
      right: 14,
      bottom: 12,
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 3,
    },
    jumpDot: { position: "absolute", top: 6, right: 6, width: 10, height: 10, borderRadius: 5 },
    typing: { paddingHorizontal: 16, paddingBottom: 4 },
    typingText: { color: c.accent, fontSize: 12.5, fontStyle: "italic" },
    replyBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingLeft: 14,
      paddingRight: 4,
      paddingVertical: 6,
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    replyAccent: { width: 3, alignSelf: "stretch", borderRadius: 2 },
    replyLabel: { fontSize: 13, fontWeight: "800" },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 6,
      paddingHorizontal: 8,
      paddingTop: 8,
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    input: {
      flex: 1,
      minHeight: 42,
      maxHeight: 130,
      borderRadius: 21,
      backgroundColor: c.field,
      color: c.text,
      fontSize: 16,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
    },
    send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
    emojiRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
    emojiBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
    emojiText: { fontSize: 28 },
    reactor: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
    reactorName: { flex: 1, fontSize: 15.5, fontWeight: "600" },
  });
