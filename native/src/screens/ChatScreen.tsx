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

import { emojiOf, themeOf } from "../chatThemes";
import { joinGroupCall, startCall, useCall } from "../calls/engine";
import { callInfoOf, chessShareOf, convTitle, dayKey, dayLabel, lastSeenText, REACTIONS, systemText } from "../format";
import { FormulaPad } from "../formula/FormulaPad";
import { insert as fxInsert } from "../formula/core";
import { forgetPick, pickImages, prepareImage, rememberPick } from "../images";
import { isPending } from "../messages";
import {
  cancelEdit,
  cancelReply,
  closeConversation,
  closePoll,
  isPinnedMsg,
  pinMessage,
  startEdit,
  discard,
  emitTyping,
  loadMessages,
  lockConversationNow,
  mentionsIn,
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
import { ChallengeSheet } from "../chess/Sheets";
import { AiSummaryBar } from "../ai/AiSummaryBar";
import { hideTranslation, runSummary, translate, useAiHelp } from "../ai/help";
import { ChatSearch, ForwardSheet, MentionList, PinBar, PinsSheet, PollSheet } from "./ChatExtras";
import { ChatLockGate } from "./ChatLock";
import { ConvSettingsSheet } from "./ConvSettingsSheet";
import { GroupInfoSheet } from "./GroupInfoSheet";
import { ImageViewer } from "./ImageViewer";
import { MessageRow } from "./MessageItem";
import { EventSheet, ScheduleSheet, ScheduledBar, ScheduledSheet } from "../plans/Sheets";
import { cancelEvent } from "../plans/store";
import { whenText } from "../plans/core";
import { voiceLabel } from "../voice/core";
import { releaseVoice } from "../voice/player";
import { VoiceRecorder } from "../voice/ui";

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

/** Khung chat nổi (bong bóng chat): nút thu nhỏ thay cho Quay lại, có nút mở app */
export type BubbleMode = { onClose: () => void; onOpenApp: () => void };

export function ChatScreen({ convId, bubble }: { convId: number; bubble?: BubbleMode }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { conv, box, users, me, typingIds, draft, replying, editing, pins, offline, atBottom } = useStore(
    useShallow((st) => ({
      conv: st.convs[convId],
      box: st.msgs[convId],
      users: st.users,
      me: st.me,
      typingIds: st.typing[convId],
      draft: st.drafts[convId] || "",
      replying: st.replying[convId],
      editing: st.editing[convId],
      pins: st.pins[convId],
      offline: st.offline,
      atBottom: st.atBottom,
    })),
  );
  // Khóa bằng mật khẩu: mở khóa tới lúc nào (store.unlocked)
  const unlockedUntil = useStore((st) => st.unlocked[convId] || 0);
  const aiReady = useStore((st) => st.aiReady);
  const translated = useAiHelp((st) => st.trans);
  const theme = themeOf(conv);
  const quickEmoji = emojiOf(conv);
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  const meId = me?.id ?? 0;
  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);
  // Đang ghi tin nhắn thoại: thanh ghi âm thay chỗ ô nhập
  const [recording, setRecording] = useState(false);
  // Rời khung chat: dừng tin thoại đang phát, trả lại trình phát cho máy
  useEffect(() => () => releaseVoice(), []);
  // Đặt con trỏ về cuối ô nhập sau khi app tự điền chữ (chọn @tên, bấm Sửa)
  const [caret, setCaret] = useState<number | null>(null);
  const caretToEnd = (text: string, delay = 0) => {
    setTimeout(() => {
      setCaret(text.length);
      inputRef.current?.focus();
      setTimeout(() => setCaret(null), 600);
    }, delay);
  };
  const lastTyping = useRef(0);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [reactorsFor, setReactorsFor] = useState<ChatItem | null>(null);
  const [failedFor, setFailedFor] = useState<ChatItem | null>(null);
  const [viewer, setViewer] = useState<ChatItem | null>(null);
  const [chessOpen, setChessOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  // Kèo, hẹn giờ gửi tin, bàn phím công thức (2.16.0)
  const [eventOpen, setEventOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<{ text: string; mentions: number[] } | null>(null);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const selRef = useRef<{ start: number; end: number } | null>(null);
  const caretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setPadOpen(false), [convId]);
  const [forwardFor, setForwardFor] = useState<Message | null>(null);
  // Nhảy tới một tin chưa tải (từ tìm kiếm / tin ghim): tải dần tin cũ hơn cho tới khi thấy
  const [jumpTarget, setJumpTarget] = useState<{ id: number; tries: number } | null>(null);
  const pinnedIds = useMemo(() => new Set((pins || []).map((p) => p.message.id)), [pins]);

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
        if (box?.hasMore) {
          showToast("Đang tìm tin nhắn cũ…");
          setJumpTarget({ id: messageId, tries: 0 });
        } else showToast("Không tìm thấy tin nhắn này nữa.");
        return;
      }
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    },
    [rows, box?.hasMore],
  );

  useEffect(() => {
    if (!jumpTarget || box?.loading) return;
    const index = rows.findIndex((r) => r.type === "msg" && !isPending(r.item) && r.item.id === jumpTarget.id);
    if (index >= 0) {
      setJumpTarget(null);
      setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 120);
      return;
    }
    if (!box?.hasMore || jumpTarget.tries >= 40) {
      setJumpTarget(null);
      showToast("Tin nhắn này ở xa quá, hãy kéo lên để xem.");
      return;
    }
    setJumpTarget({ ...jumpTarget, tries: jumpTarget.tries + 1 });
    loadMessages(convId, { older: true });
  }, [jumpTarget, rows, box?.loading, box?.hasMore, convId]);

  const onChangeText = (text: string) => {
    // Người dùng gõ tiếp: thả con trỏ ra (không giữ ở vị trí app đặt nữa)
    if (caret != null) setCaret(null);
    setDraft(convId, text);
    const now = Date.now();
    if (text.trim() && now - lastTyping.current > 2000) {
      lastTyping.current = now;
      emitTyping(convId);
    }
  };

  // Bàn phím công thức: chèn ký hiệu vào chỗ con trỏ, giữ bàn phím điện thoại mở
  const insertSymbol = (ins: string) => {
    const sel = caret != null ? { start: caret, end: caret } : selRef.current || { start: draft.length, end: draft.length };
    const r = fxInsert(draft, sel.start, sel.end, ins);
    setDraft(convId, r.value);
    selRef.current = { start: r.caret, end: r.caret };
    setCaret(r.caret);
    if (caretTimer.current) clearTimeout(caretTimer.current);
    caretTimer.current = setTimeout(() => setCaret(null), 600);
    inputRef.current?.focus();
  };

  const send = () => {
    // Ô nhập trống: gửi biểu tượng cảm xúc nhanh (như 👍 của Messenger)
    if (sendText(convId, draft, { quick: true })) listRef.current?.scrollToOffset({ offset: 0, animated: true });
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
              theme={theme}
              pinned={!isPending(row.item) && pinnedIds.has(row.item.id)}
            />
          );
        case "day":
          return (
            <View style={s.center}>
              <Text style={s.day}>{row.label}</Text>
            </View>
          );
        case "system": {
          // Nhật ký cuộc gọi (1-1 hoặc gọi nhóm): thêm nút "Gọi lại"
          const call = callInfoOf(row.item);
          const peerUser = conv?.type === "dm" && conv.peerId != null ? users[conv.peerId] : undefined;
          const canCall = Boolean(call && !bubble && conv && (conv.type !== "dm" || (peerUser && !peerUser.disabled && !peerUser.bot)));
          return (
            <View style={[s.center, canCall && s.callRow]}>
              <Text style={s.system}>{systemText(row.item, names)}</Text>
              {canCall && conv ? (
                <Pressable
                  onPress={() =>
                    conv.type === "dm"
                      ? peerUser && startCall(conv.id, peerUser, Boolean(call?.video))
                      : startCall(conv.id, { id: conv.id, displayName: convTitle(conv, names.nameOf), avatar: conv.avatar || null }, Boolean(call?.video), "group")
                  }
                  style={({ pressed }) => [s.callBack, { opacity: pressed ? 0.7 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Gọi lại"
                >
                  <Text style={s.callBackText}>Gọi lại</Text>
                </Pressable>
              ) : null}
            </View>
          );
        }
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
    [conv, meId, users, names, jumpTo, s, box, theme, pinnedIds, bubble],
  );

  if (!conv) return null;
  if (conv.locked && !(unlockedUntil > Date.now())) return <ChatLockGate conv={conv} onClose={bubble?.onClose} />;

  const title = convTitle(conv, names.nameOf);
  const peer = conv.type === "dm" && conv.peerId != null ? users[conv.peerId] : undefined;
  const typers = (typingIds || []).map((id) => names.nameOf(id));
  let status: string;
  if (offline) status = "Chưa kết nối máy chủ";
  else if (typers.length && conv.type === "dm") status = "Đang nhập…";
  else if (conv.type === "dm") status = peer?.bot ? "Trợ lý AI · luôn sẵn sàng" : peer?.disabled ? "Tài khoản này đã bị khóa" : lastSeenText(peer);
  else {
    const ids = conv.type === "group" ? conv.memberIds || [] : Object.values(users).filter((u) => !u.disabled && !u.bot).map((u) => u.id);
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
  // Nút gọi thoại / gọi video: chat riêng với người thật, và gọi nhóm. Thách cờ và Tìm tin nhắn chuyển vào "Tùy chỉnh đoạn chat" cho đỡ chật.
  const human = conv.type === "dm" && peer && !peer.disabled && !peer.bot ? peer : null;
  const callable = Boolean((human || conv.type !== "dm") && !bubble);
  const groupTarget = { id: conv.id, displayName: title, avatar: conv.avatar || null };
  // Think AI giúp đọc chat (2.14.0): không có trong bong bóng chat và trong chat riêng với Think AI
  const aiUsable = aiReady && !bubble && !(conv.type === "dm" && peer?.bot);

  return (
    <KeyboardAware bottomInset={false} style={{ backgroundColor: c.bg }}>
      <View style={[s.header, { paddingTop: bubble ? 6 : insets.top + 4 }]}>
        {bubble ? (
          <IconButton name="keyboard-arrow-down" label="Thu nhỏ" onPress={bubble.onClose} color={c.text} />
        ) : (
          <IconButton name="arrow-back" label="Quay lại" onPress={closeConversation} color={c.text} />
        )}
        <Pressable
          style={s.headerMain}
          onPress={() => setSettingsOpen(true)}
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
        {human && callable ? (
          <>
            <IconButton name="call" label="Gọi thoại" onPress={() => startCall(conv.id, human, false)} />
            <IconButton name="videocam" label="Gọi video" onPress={() => startCall(conv.id, human, true)} />
          </>
        ) : callable ? (
          <>
            <IconButton name="call" label="Gọi nhóm" onPress={() => startCall(conv.id, groupTarget, false, "group")} />
            <IconButton name="videocam" label="Gọi video nhóm" onPress={() => startCall(conv.id, groupTarget, true, "group")} />
          </>
        ) : null}
        {conv.locked ? <IconButton name="lock" label="Khóa lại cuộc trò chuyện" onPress={() => lockConversationNow(convId)} /> : null}
        {callable ? null : <IconButton name="search" label="Tìm tin nhắn" onPress={() => setSearchOpen(true)} />}
        {bubble ? (
          <IconButton name="open-in-new" label="Mở trong app" onPress={bubble.onOpenApp} />
        ) : (
          <IconButton name="info-outline" label="Tùy chỉnh đoạn chat" onPress={() => setSettingsOpen(true)} />
        )}
      </View>
      {conv.type !== "dm" && !bubble ? <GroupCallBar convId={conv.id} title={title} avatar={conv.avatar || null} /> : null}
      {!bubble ? <AiSummaryBar convId={conv.id} enabled={aiUsable} /> : null}
      <PinBar conv={conv} onJump={jumpTo} onShowAll={() => setPinsOpen(true)} />

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
        {searchOpen ? (
          <ChatSearch
            conv={conv}
            onClose={() => setSearchOpen(false)}
            onPick={(id) => {
              setSearchOpen(false);
              setTimeout(() => jumpTo(id), 150);
            }}
          />
        ) : null}
      </View>

      {typingText ? (
        <View style={s.typing}>
          <Text style={s.typingText} numberOfLines={1}>
            {typingText}
          </Text>
        </View>
      ) : null}

      <ScheduledBar convId={convId} onPress={() => setScheduledOpen(true)} />

      {editing ? (
        <View style={[s.replyBar, { borderTopColor: c.line }]}>
          <View style={[s.replyAccent, { backgroundColor: c.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={[s.replyLabel, { color: c.accent }]} numberOfLines={1}>
              Đang sửa tin nhắn
            </Text>
            <Text style={s.muted} numberOfLines={1}>
              {editing.text || "📷 Ảnh"}
            </Text>
          </View>
          <IconButton name="close" label="Hủy sửa" size={20} onPress={() => cancelEdit(convId)} />
        </View>
      ) : replying ? (
        <View style={[s.replyBar, { borderTopColor: c.line }]}>
          <View style={[s.replyAccent, { backgroundColor: c.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={[s.replyLabel, { color: c.accent }]} numberOfLines={1}>
              Đang trả lời {replying.senderId === meId ? "chính mình" : names.nameOf(replying.senderId)}
            </Text>
            <Text style={s.muted} numberOfLines={1}>
              {replying.kind === "voice" ? voiceLabel(replying.audio?.ms) : replying.text || "📷 Ảnh"}
            </Text>
          </View>
          <IconButton name="close" label="Hủy trả lời" size={20} onPress={() => cancelReply(convId)} />
        </View>
      ) : null}

      <MentionList
        conv={conv}
        draft={draft}
        onPicked={(next) => {
          setDraft(convId, next);
          caretToEnd(next);
        }}
      />
      {padOpen && !recording ? <FormulaPad value={draft} onKey={insertSymbol} onClose={() => setPadOpen(false)} /> : null}
      <Composer>
        {recording ? null : (
          <IconButton name="add-circle-outline" label="Thêm: ảnh, bình chọn, kèo, hẹn giờ, công thức" color={theme.a} onPress={() => setAttachOpen(true)} disabled={offline} />
        )}
        {/* Tin nhắn thoại (khung chat nổi không ghi âm: hỏi quyền micro trên ứng dụng khác dễ bị máy chặn) */}
        {bubble ? null : <VoiceRecorder convId={convId} accent={theme.a} disabled={offline || Boolean(editing)} onActive={setRecording} />}
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={onChangeText}
          placeholder={offline ? "Đang chờ kết nối máy chủ…" : "Nhập tin nhắn…"}
          placeholderTextColor={c.muted}
          style={[s.input, recording && { display: "none" }]}
          multiline
          maxLength={4000}
          editable={!offline}
          selection={caret != null ? { start: caret, end: caret } : undefined}
          onSelectionChange={(e) => {
            selRef.current = e.nativeEvent.selection;
          }}
          accessibilityLabel="Nhập tin nhắn"
        />
        {recording ? null : draft.trim() || editing ? (
          <Pressable
            onPress={send}
            disabled={offline}
            style={({ pressed }) => [s.send, { backgroundColor: !offline ? theme.a : c.field, opacity: pressed ? 0.8 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={editing ? "Lưu tin nhắn đã sửa" : "Gửi"}
          >
            <Icon name={editing ? "check" : "send"} size={20} color={!offline ? "#fff" : c.muted} />
          </Pressable>
        ) : (
          <Pressable
            onPress={send}
            disabled={offline}
            style={({ pressed }) => [s.send, { transform: [{ scale: pressed ? 1.25 : 1 }], opacity: offline ? 0.4 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`Gửi ${quickEmoji}`}
          >
            <Text style={s.quickEmoji}>{quickEmoji}</Text>
          </Pressable>
        )}
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
            {menuFor.senderId === meId && menuFor.kind === "text" && menuFor.text != null ? (
              <SheetItem
                icon="edit"
                label="Sửa"
                onPress={() => {
                  startEdit(convId, menuFor);
                  setMenuFor(null);
                  caretToEnd(menuFor.text || "", 250);
                }}
              />
            ) : null}
            {menuFor.kind !== "poll" && menuFor.kind !== "event" ? (
              <SheetItem
                icon="forward"
                label="Chuyển tiếp"
                onPress={() => {
                  setForwardFor(menuFor);
                  setMenuFor(null);
                }}
              />
            ) : null}
            <SheetItem
              icon="push-pin"
              label={isPinnedMsg({ pins: { [convId]: pins || [] } }, menuFor) ? "Bỏ ghim" : "Ghim"}
              hint={isPinnedMsg({ pins: { [convId]: pins || [] } }, menuFor) ? undefined : "Hiện ở đầu cuộc trò chuyện cho mọi người"}
              onPress={() => {
                const m = menuFor;
                setMenuFor(null);
                pinMessage(m, !isPinnedMsg({ pins: { [convId]: pins || [] } }, m));
              }}
            />
            {menuFor.kind === "poll" && menuFor.senderId === meId && menuFor.poll && !menuFor.poll.closed ? (
              <SheetItem
                icon="how-to-vote"
                label="Kết thúc bình chọn"
                onPress={() => {
                  const m = menuFor;
                  setMenuFor(null);
                  closePoll(m);
                }}
              />
            ) : null}
            {menuFor.kind === "event" &&
            menuFor.event &&
            !menuFor.event.canceled &&
            menuFor.event.startsAt > Date.now() &&
            (menuFor.senderId === meId || me?.role === "admin") ? (
              <SheetItem
                icon="event-busy"
                label="Hủy kèo"
                danger
                hint="Ai đã chọn Đi / Có thể sẽ được báo"
                onPress={async () => {
                  const m = menuFor;
                  setMenuFor(null);
                  if (await confirm("Hủy kèo?", `Những ai đã chọn Đi / Có thể sẽ nhận được thông báo kèo “${m.text}” bị hủy.`, "Hủy kèo")) cancelEvent(m);
                }}
              />
            ) : null}
            {aiUsable && menuFor.kind === "text" && menuFor.text && !chessShareOf(menuFor.text) && !menuFor.story?.reaction ? (
              <SheetItem
                icon="translate"
                label={translated[menuFor.id]?.text ? "Ẩn bản dịch" : "Dịch (Think AI)"}
                onPress={() => {
                  const id = menuFor.id;
                  setMenuFor(null);
                  if (translated[id]?.text) hideTranslation(id);
                  else translate(id);
                }}
              />
            ) : null}
            {menuFor.text && menuFor.kind !== "poll" ? (
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

      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title="Gửi">
        {bubble ? (
          <SheetItem
            icon="photo-library"
            label="Gửi ảnh"
            hint="Mở trong app để chọn hoặc chụp ảnh"
            onPress={() => {
              setAttachOpen(false);
              bubble.onOpenApp();
            }}
          />
        ) : (
          <>
            <SheetItem icon="photo-library" label="Chọn ảnh trong máy" hint="Tối đa 10 ảnh mỗi lần" onPress={() => attach(false)} />
            <SheetItem icon="photo-camera" label="Chụp ảnh" onPress={() => attach(true)} />
          </>
        )}
        <SheetItem
          icon="poll"
          label="Tạo bình chọn"
          hint="Hỏi ý kiến mọi người, ai cũng chọn được"
          onPress={() => {
            setAttachOpen(false);
            setTimeout(() => setPollOpen(true), 250);
          }}
        />
        <SheetItem
          icon="event"
          label="Tạo kèo"
          hint="Hẹn mọi người đi đâu đó; ai đi bấm Đi, Think nhắc trước giờ"
          onPress={() => {
            setAttachOpen(false);
            setTimeout(() => setEventOpen(true), 250);
          }}
        />
        <SheetItem
          icon="schedule-send"
          label="Hẹn giờ gửi tin"
          hint="Viết trước, đến giờ Think tự gửi"
          onPress={() => {
            setAttachOpen(false);
            const t = editing ? "" : draft.trim(); // đang sửa tin thì không lấy chữ đang sửa
            setTimeout(() => setScheduleFor({ text: t, mentions: t ? mentionsIn(convId, t) : [] }), 250);
          }}
        />
        <SheetItem
          icon="functions"
          label="Công thức toán, hóa"
          hint="x², H₂O, √, π, →, ⇌… Gõ x^2 hay H_2O cũng được"
          onPress={() => {
            setAttachOpen(false);
            setPadOpen(true);
            setTimeout(() => inputRef.current?.focus(), 300);
          }}
        />
      </Sheet>

      <ImageViewer item={viewer} onClose={() => setViewer(null)} />
      <GroupInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} conv={conv} />
      <ConvSettingsSheet
        conv={conv}
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSearch={() => setSearchOpen(true)}
        onMembers={() => setInfoOpen(true)}
        onPins={() => setPinsOpen(true)}
        onChess={human && !bubble ? () => setChessOpen(true) : undefined}
        onSummary={aiUsable ? () => runSummary(conv.id, null) : undefined}
        onOpenImage={(image) => setViewer({ ...(list.find((m) => m.image === image) || { id: 0, conversationId: convId, senderId: 0, kind: "text", text: null, deleted: false, createdAt: 0, replyTo: null, reactions: [] }), image } as Message)}
      />
      <PinsSheet conv={conv} visible={pinsOpen} onClose={() => setPinsOpen(false)} onJump={jumpTo} />
      <PollSheet convId={convId} visible={pollOpen} onClose={() => setPollOpen(false)} />
      <EventSheet convId={convId} visible={eventOpen} onClose={() => setEventOpen(false)} />
      <ScheduleSheet
        convId={convId}
        visible={Boolean(scheduleFor)}
        prefill={scheduleFor?.text || ""}
        mentions={scheduleFor?.mentions || []}
        onClose={() => setScheduleFor(null)}
        onScheduled={(t, at) => {
          // Tin lấy từ ô nhập: hẹn xong thì xóa khỏi ô nhập
          if (t && useStore.getState().drafts[convId]?.trim() === t) setDraft(convId, "");
          showToast(`Đã hẹn gửi lúc ${whenText(at)}.`);
        }}
      />
      <ScheduledSheet convId={convId} visible={scheduledOpen} onClose={() => setScheduledOpen(false)} />
      <ForwardSheet message={forwardFor} onClose={() => setForwardFor(null)} />
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
  if (peer?.bot) return <AiIntro conv={conv} users={users} empty={!box?.list.length} />;
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

/** Thanh "Đang có cuộc gọi nhóm · Tham gia" (2.11.0, giống bản web) */
function GroupCallBar({ convId, title, avatar }: { convId: number; title: string; avatar: string | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { g, mine } = useCall(useShallow((st) => ({ g: st.groups[convId], mine: Boolean(st.view && st.view.convId === convId && st.view.phase !== "incoming") })));
  const users = useStore((st) => st.users);
  if (!g || mine) return null;
  return (
    <View style={[s.gcallBar, { backgroundColor: c.jadeWash, borderBottomColor: c.line }]} accessibilityLiveRegion="polite">
      <View style={[s.gcallIc, { backgroundColor: c.accent }]}>
        <Icon name={g.video ? "videocam" : "call"} size={18} color="#fff" />
      </View>
      <Text style={[s.gcallText, { color: c.accent }]} numberOfLines={1}>
        {g.participants.length} người đang gọi{g.video ? " video" : ""}
      </Text>
      <View style={s.gcallFaces}>
        {g.participants.slice(0, 3).map((uid) => (
          <View key={uid} style={{ marginLeft: -6 }}>
            <Avatar user={users[uid]} size={22} dot={false} />
          </View>
        ))}
      </View>
      <Button title="Tham gia" small onPress={() => joinGroupCall(convId, { title, avatar })} />
    </View>
  );
}

// Think AI (2.10.0): lời chào và vài câu hỏi gợi ý khi chưa nhắn gì (giống bản web)
const AI_SUGGESTIONS = ["Gợi ý món ăn tối nay 🍜", "Viết lời chúc sinh nhật cho bạn thân 🎂", "Dịch sang tiếng Anh: Hẹn gặp lại cuối tuần nhé!", "Giải thích ngắn gọn: lãi kép là gì?"];

function AiIntro({ conv, users, empty }: { conv: Conversation; users: ReturnType<typeof useStore.getState>["users"]; empty: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={s.intro}>
      <ConvAvatar conv={conv} users={users} size={72} dot={false} />
      <Text style={s.introName}>Think AI</Text>
      <Text style={s.introText}>
        Trợ lý AI của Think. Hỏi mình bất cứ điều gì: giải thích, dịch, viết hộ, gợi ý… Gửi ảnh để mình xem giúp. Trong nhóm, gõ @Think AI là mình trả lời.
      </Text>
      <Text style={[s.introText, { fontSize: 12.5 }]}>AI có thể nhầm, hãy kiểm tra lại thông tin quan trọng.</Text>
      {empty ? (
        <View style={s.chips}>
          {AI_SUGGESTIONS.map((q) => (
            <Pressable
              key={q}
              onPress={() => sendText(conv.id, q.replace(/\s*\p{Extended_Pictographic}+$/u, ""))}
              style={({ pressed }) => [s.chip, { backgroundColor: pressed ? c.jadeWash : c.surface, borderColor: c.line }]}
              accessibilityRole="button"
            >
              <Text style={[s.chipText, { color: c.accent }]}>{q}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    callRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 10 },
    gcallBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
    gcallIc: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    gcallText: { flex: 1, fontSize: 14, fontWeight: "800" },
    gcallFaces: { flexDirection: "row", paddingLeft: 6 },
    callBack: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.jadeWash },
    callBackText: { color: c.accent, fontSize: 12.5, fontWeight: "700" },
    chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 10, maxWidth: 420 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
    chipText: { fontSize: 14, fontWeight: "600" },
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
    quickEmoji: { fontSize: 27, lineHeight: 34 },
    emojiRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
    emojiBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
    emojiText: { fontSize: 28 },
    reactor: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
    reactorName: { flex: 1, fontSize: 15.5, fontWeight: "600" },
  });
