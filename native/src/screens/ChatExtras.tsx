import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { api } from "../api";
import { applyMention, mentionToken } from "../chatPlus";
import { themeOf } from "../chatThemes";
import { convTitle, dayLabel, fold, hm, messageSummary, shortTime } from "../format";
import { createPoll, forwardMessage, namesOf, pickMention, pinMessage, showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { Conversation, Message, Pin, User } from "../types";
import { Avatar, Button, ConvAvatar, FormError, Icon, IconButton, Sheet, useStyles } from "../ui";
import { imageSource } from "./MessageItem";

/** Mảng rỗng dùng chung khi chưa có tin ghim */
export const NO_PINS: Pin[] = [];

// Các phần thêm của khung chat (2.1.0): thanh tin đã ghim, tìm tin nhắn, chuyển tiếp, tạo bình chọn,
// gợi ý @nhắc tên, danh sách tin đã ghim, ảnh đã gửi.

/* ---------------- Thanh tin đã ghim (dưới đầu khung chat) ---------------- */

export function PinBar({ conv, onJump, onShowAll }: { conv: Conversation; onJump: (id: number) => void; onShowAll: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { pins, me, users } = useStore(useShallow((st) => ({ pins: st.pins[conv.id], me: st.me, users: st.users })));
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  if (!pins?.length) return null;
  const m = pins[0].message;
  const who = m.senderId === names.meId ? "Bạn" : names.nameOf(m.senderId);
  const accent = themeOf(conv).a;
  return (
    <View style={[s.pinBar, { borderBottomColor: c.line }]}>
      <Pressable
        style={s.pinMain}
        onPress={() => onJump(m.id)}
        accessibilityRole="button"
        accessibilityLabel={`Tin đã ghim của ${who}: ${messageSummary(m, names)}. Chạm để xem`}
      >
        <Icon name="push-pin" size={18} color={c.scheme === "dark" ? c.accent : accent} />
        <View style={{ flex: 1 }}>
          <Text style={[s.pinTitle, { color: c.scheme === "dark" ? c.accent : accent }]}>{pins.length > 1 ? `Tin đã ghim (${pins.length})` : "Tin đã ghim"}</Text>
          <Text style={s.pinText} numberOfLines={1}>
            {who}: {messageSummary(m, names)}
          </Text>
        </View>
      </Pressable>
      {pins.length > 1 ? <Button title="Xem tất cả" small kind="secondary" onPress={onShowAll} /> : null}
    </View>
  );
}

/* ---------------- Danh sách tin đã ghim ---------------- */

export function PinsSheet({ conv, visible, onClose, onJump }: { conv: Conversation; visible: boolean; onClose: () => void; onJump: (id: number) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { pinsRaw, me, users } = useStore(useShallow((st) => ({ pinsRaw: st.pins[conv.id], me: st.me, users: st.users })));
  // Không tạo mảng mới trong bộ chọn của store (sẽ làm React vẽ lại mãi không dừng)
  const pins = pinsRaw || NO_PINS;
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Tin nhắn đã ghim">
      {!pins.length ? <Text style={s.muted}>Chưa có tin nhắn nào được ghim. Chạm giữ một tin nhắn rồi chọn Ghim.</Text> : null}
      {pins.map((p) => (
        <View key={p.message.id} style={s.pinRow}>
          <Pressable
            style={s.pinRowMain}
            onPress={() => {
              onClose();
              setTimeout(() => onJump(p.message.id), 300);
            }}
            accessibilityRole="button"
          >
            <Avatar user={users[p.message.senderId]} size={36} dot={false} />
            <View style={{ flex: 1 }}>
              <Text style={[s.name, { color: c.text }]}>{p.message.senderId === names.meId ? "Bạn" : names.nameOf(p.message.senderId)}</Text>
              <Text style={s.rowText} numberOfLines={2}>
                {messageSummary(p.message, names)}
              </Text>
              <Text style={s.sub}>
                Ghim bởi {p.pinnedBy === names.meId ? "bạn" : names.nameOf(p.pinnedBy)} · {shortTime(p.pinnedAt)}
              </Text>
            </View>
          </Pressable>
          <Button title="Bỏ ghim" small kind="danger" onPress={() => pinMessage(p.message, false)} />
        </View>
      ))}
    </Sheet>
  );
}

/* ---------------- Tìm tin nhắn trong cuộc trò chuyện ---------------- */

export function ChatSearch({ conv, onClose, onPick }: { conv: Conversation; onClose: () => void; onPick: (id: number) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { users, me, list } = useStore(useShallow((st) => ({ users: st.users, me: st.me, list: st.msgs[conv.id]?.list })));
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ loading: boolean; results: Message[]; note: string }>({ loading: false, results: [], note: "Gõ ít nhất 2 chữ, không cần dấu." });
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    const id = ++seq.current;
    if (fold(query).length < 2) {
      setState({ loading: false, results: [], note: "Gõ ít nhất 2 chữ, không cần dấu." });
      return;
    }
    setState((st) => ({ ...st, loading: true, note: "Đang tìm…" }));
    const t = setTimeout(async () => {
      let results: Message[];
      try {
        results = (await api.search(conv.id, query)).results;
      } catch {
        // Mất mạng: tìm trong các tin đang có trên máy
        const k = fold(query);
        results = (list || [])
          .filter((m): m is Message => m.id != null && !m.deleted && m.kind !== "system" && fold(m.text).includes(k))
          .reverse();
      }
      if (id !== seq.current) return;
      setState({ loading: false, results, note: results.length ? `${results.length}${results.length >= 30 ? "+" : ""} tin nhắn` : "Không tìm thấy tin nhắn nào." });
    }, 280);
    return () => clearTimeout(t);
  }, [q, conv.id, list]);

  return (
    <View style={[s.searchRoot, { backgroundColor: c.bg }]}>
      <View style={[s.searchBar, { borderBottomColor: c.line }]}>
        <Icon name="search" size={20} color={c.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          autoFocus
          placeholder="Tìm trong cuộc trò chuyện"
          placeholderTextColor={c.muted}
          style={s.searchInput}
          returnKeyType="search"
          accessibilityLabel="Tìm tin nhắn trong cuộc trò chuyện"
        />
        <IconButton name="close" label="Đóng tìm kiếm" onPress={onClose} />
      </View>
      <Text style={s.searchNote}>{state.note}</Text>
      <FlatList
        data={state.results}
        keyExtractor={(m) => String(m.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }}
        renderItem={({ item: m }) => (
          <Pressable
            onPress={() => onPick(m.id)}
            style={({ pressed }) => [s.hit, pressed && { backgroundColor: c.field }]}
            accessibilityRole="button"
          >
            <Avatar user={users[m.senderId]} size={34} dot={false} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={s.hitHead}>
                <Text style={[s.name, { color: c.text }]} numberOfLines={1}>
                  {m.senderId === names.meId ? "Bạn" : names.nameOf(m.senderId)}
                </Text>
                <Text style={s.sub}>
                  {dayLabel(m.createdAt)} {hm(m.createdAt)}
                </Text>
              </View>
              <Highlighted text={m.kind === "poll" ? `📊 ${m.text || ""}` : m.text || ""} q={q} />
            </View>
          </Pressable>
        )}
        ListFooterComponent={state.loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 16 }} /> : null}
      />
    </View>
  );
}

/** Tô màu chỗ khớp (so khớp không dấu, giữ chữ gốc) */
function Highlighted({ text, q }: { text: string; q: string }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const src = text.replace(/\s+/g, " ").trim();
  const f = fold(src);
  const k = fold(q.trim());
  const i = k ? f.indexOf(k) : -1;
  if (i < 0) {
    return (
      <Text style={s.rowText} numberOfLines={2}>
        {src}
      </Text>
    );
  }
  const start = Math.max(0, i - 40);
  return (
    <Text style={s.rowText} numberOfLines={2}>
      {start ? `…${src.slice(start, i)}` : src.slice(0, i)}
      <Text style={{ backgroundColor: c.turmericWash, color: c.text, fontWeight: "700" }}>{src.slice(i, i + k.length)}</Text>
      {src.slice(i + k.length)}
    </Text>
  );
}

/* ---------------- Chuyển tiếp ---------------- */

export function ForwardSheet({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { convs, users, me } = useStore(useShallow((st) => ({ convs: st.convs, users: st.users, me: st.me })));
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (message) {
      setQ("");
      setPicked([]);
      setBusy(false);
    }
  }, [message]);

  const list = useMemo(() => {
    const k = fold(q);
    return Object.values(convs)
      .filter((x) => (x.type !== "dm" || x.lastMessage) && (!k || fold(convTitle(x, names.nameOf)).includes(k)))
      .sort((a, b) => (b.lastMessage?.createdAt || b.createdAt) - (a.lastMessage?.createdAt || a.createdAt));
  }, [convs, q, names]);

  const send = async () => {
    if (!message || !picked.length) return;
    setBusy(true);
    try {
      const n = await forwardMessage(message, picked);
      showToast(n > 1 ? `Đã chuyển tiếp tới ${n} nơi.` : "Đã chuyển tiếp.");
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa chuyển tiếp được.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={Boolean(message)}
      onClose={onClose}
      title="Chuyển tiếp"
      footer={<Button title={picked.length ? `Gửi tới ${picked.length} nơi` : "Chọn nơi gửi"} icon="send" disabled={!picked.length} busy={busy} onPress={send} />}
    >
      {message ? (
        <View style={[s.preview, { backgroundColor: c.field }]}>
          {message.image ? <Image source={imageSource(message.image)} style={s.previewImg} contentFit="cover" /> : null}
          <Text style={s.rowText} numberOfLines={2}>
            {messageSummary(message, names)}
          </Text>
        </View>
      ) : null}
      <View style={[s.searchBox, { backgroundColor: c.field }]}>
        <Icon name="search" size={18} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Tìm cuộc trò chuyện" placeholderTextColor={c.muted} style={s.searchBoxInput} />
      </View>
      {list.map((conv) => {
        const on = picked.includes(conv.id);
        return (
          <Pressable
            key={conv.id}
            onPress={() => {
              if (on) setPicked(picked.filter((x) => x !== conv.id));
              else if (picked.length >= 10) showToast("Chọn tối đa 10 nơi một lần.");
              else setPicked([...picked, conv.id]);
            }}
            style={({ pressed }) => [s.pickRow, pressed && { backgroundColor: c.field }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <ConvAvatar conv={conv} users={users} meId={names.meId} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={[s.name, { color: c.text }]} numberOfLines={1}>
                {convTitle(conv, names.nameOf)}
              </Text>
              <Text style={s.sub}>{conv.type === "dm" ? "Tin nhắn riêng" : `${conv.memberCount} thành viên`}</Text>
            </View>
            <View style={[s.check, { borderColor: on ? c.jade : c.muted, backgroundColor: on ? c.jade : "transparent" }]}>
              {on ? <Icon name="check" size={16} color="#fff" /> : null}
            </View>
          </Pressable>
        );
      })}
    </Sheet>
  );
}

/* ---------------- Tạo bình chọn ---------------- */

export function PollSheet({ convId, visible, onClose }: { convId: number; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setQuestion("");
      setOptions(["", ""]);
      setMulti(false);
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const submit = async () => {
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q) return setError("Hãy nhập câu hỏi.");
    if (new Set(opts).size < 2) return setError("Cần ít nhất 2 lựa chọn khác nhau.");
    setBusy(true);
    setError(null);
    try {
      await createPoll(convId, q, opts, multi);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa gửi được bình chọn.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Tạo bình chọn" footer={<Button title="Gửi bình chọn" icon="how-to-vote" busy={busy} onPress={submit} />}>
      <Text style={s.label}>Câu hỏi</Text>
      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder="vd: Cuối tuần đi đâu?"
        placeholderTextColor={c.muted}
        maxLength={200}
        style={[s.field, { backgroundColor: c.field, color: c.text }]}
        accessibilityLabel="Câu hỏi bình chọn"
      />
      <Text style={s.label}>Các lựa chọn</Text>
      {options.map((o, i) => (
        <View key={i} style={s.optRow}>
          <TextInput
            value={o}
            onChangeText={(t) => setOptions(options.map((x, k) => (k === i ? t : x)))}
            placeholder={`Lựa chọn ${i + 1}`}
            placeholderTextColor={c.muted}
            maxLength={100}
            style={[s.field, { flex: 1, backgroundColor: c.field, color: c.text }]}
            accessibilityLabel={`Lựa chọn ${i + 1}`}
          />
          {options.length > 2 ? (
            <IconButton name="close" label={`Xóa lựa chọn ${i + 1}`} size={20} onPress={() => setOptions(options.filter((_, k) => k !== i))} />
          ) : null}
        </View>
      ))}
      {options.length < 10 ? <Button title="Thêm lựa chọn" icon="add" small kind="secondary" onPress={() => setOptions([...options, ""])} /> : null}
      <View style={s.switchRow}>
        <Text style={[s.rowText, { flex: 1 }]}>Cho chọn nhiều đáp án</Text>
        <Switch value={multi} onValueChange={setMulti} accessibilityLabel="Cho chọn nhiều đáp án" />
      </View>
      <FormError text={error} />
    </Sheet>
  );
}

/* ---------------- Gợi ý @nhắc tên ---------------- */

/** Từ đang gõ dạng "@tên" ở cuối ô nhập: trả về phần chữ sau @, hoặc null */
export { mentionToken };

export function MentionList({ conv, draft, onPicked }: { conv: Conversation; draft: string; onPicked: (next: string) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { users, me } = useStore(useShallow((st) => ({ users: st.users, me: st.me })));
  const token = conv.type === "dm" ? null : mentionToken(draft);
  const people = useMemo(() => {
    if (token == null) return [] as User[];
    const k = fold(token);
    const ids = conv.type === "group" ? conv.memberIds || [] : Object.values(users).filter((u) => !u.disabled && !u.bot).map((u) => u.id);
    const list = ids
      .filter((id) => id !== me?.id)
      .map((id) => users[id])
      .filter((u): u is User => Boolean(u) && !u.disabled && !u.bot && (!k || fold(u.displayName).includes(k) || u.username.includes(k)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
    // Think AI luôn có trong gợi ý (gõ @ là thấy), dù không là thành viên nhóm
    const bot = Object.values(users).find((u) => u.bot && !u.disabled);
    if (bot && (!k || fold(bot.displayName).includes(k) || "ai".startsWith(k))) list.unshift(bot);
    return list.slice(0, 5);
  }, [token, conv, users, me]);
  if (!people.length || token == null) return null;
  return (
    <View style={[s.mentions, { backgroundColor: c.surface, borderColor: c.line }]} accessibilityLabel="Gợi ý nhắc tên">
      {people.map((u) => (
        <Pressable
          key={u.id}
          onPress={() => {
            pickMention(conv.id, u.displayName, u.id);
            onPicked(applyMention(draft, u.displayName));
          }}
          style={({ pressed }) => [s.mentionRow, pressed && { backgroundColor: c.field }]}
          accessibilityRole="button"
          accessibilityLabel={`Nhắc tên ${u.displayName}`}
        >
          <Avatar user={u} size={30} dot={false} />
          <Text style={[s.name, { color: c.text, flex: 1 }]} numberOfLines={1}>
            {u.displayName}
          </Text>
          <Text style={s.sub}>{u.bot ? "Trợ lý AI" : `@${u.username}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ---------------- Ảnh đã gửi ---------------- */

type MediaItem = { id: number; senderId: number; image: string; createdAt: number };

export function useMedia(convId: number, enabled: boolean) {
  const [state, setState] = useState<{ list: MediaItem[]; hasMore: boolean; loading: boolean }>({ list: [], hasMore: true, loading: false });
  const busy = useRef(false);
  const load = async (reset = false) => {
    if (busy.current) return;
    busy.current = true;
    setState((st) => ({ ...st, loading: true }));
    try {
      const before = reset ? undefined : state.list[state.list.length - 1]?.id;
      const data = await api.media(convId, before);
      setState((st) => ({ list: reset ? data.images : st.list.concat(data.images), hasMore: data.hasMore, loading: false }));
    } catch {
      setState((st) => ({ ...st, hasMore: false, loading: false }));
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    if (enabled) load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, enabled]);
  return { ...state, more: () => load(false) };
}

export function MediaGrid({ items, onOpen, size }: { items: MediaItem[]; onOpen: (img: string) => void; size: number }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.grid}>
      {items.map((x) => (
        <Pressable key={x.id} onPress={() => onOpen(x.image)} accessibilityRole="imagebutton" accessibilityLabel="Ảnh đã gửi, chạm để xem lớn">
          <Image source={imageSource(x.image)} style={[s.thumb, { width: size, height: size }]} contentFit="cover" cachePolicy="disk" recyclingKey={x.image} />
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    muted: { color: c.muted, fontSize: 14, lineHeight: 20 },
    name: { fontSize: 15, fontWeight: "700" },
    sub: { color: c.muted, fontSize: 12.5 },
    rowText: { color: c.text2, fontSize: 14.5, lineHeight: 20 },
    label: { color: c.text2, fontSize: 13.5, fontWeight: "700", marginTop: 4 },
    pinBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 7,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    pinMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
    pinTitle: { fontSize: 12.5, fontWeight: "800" },
    pinText: { color: c.text, fontSize: 13.5 },
    pinRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
    pinRowMain: { flex: 1, flexDirection: "row", gap: 10, alignItems: "flex-start" },
    searchRoot: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
    searchBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: 4, paddingVertical: 6, backgroundColor: c.surface, borderBottomWidth: StyleSheet.hairlineWidth },
    searchInput: { flex: 1, color: c.text, fontSize: 16, paddingVertical: 8 },
    searchNote: { color: c.muted, fontSize: 13, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 4 },
    hit: { flexDirection: "row", gap: 12, padding: 10, borderRadius: 14, alignItems: "flex-start" },
    hitHead: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "space-between" },
    preview: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14 },
    previewImg: { width: 44, height: 44, borderRadius: 8 },
    searchBox: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, height: 44 },
    searchBoxInput: { flex: 1, color: c.text, fontSize: 15.5, paddingVertical: 0 },
    pickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
    check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
    field: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16 },
    optRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    mentions: { marginHorizontal: 10, marginBottom: 6, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 4, elevation: 4 },
    mentionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    thumb: { borderRadius: 8, backgroundColor: c.field },
  });
