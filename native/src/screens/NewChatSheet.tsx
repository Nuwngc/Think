import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { fold, lastSeenText } from "../format";
import { createGroup, openDm, showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { User } from "../types";
import { Avatar, Button, Field, FormError, Icon, Sheet, useStyles } from "../ui";

/** Nhắn riêng cho một người, hoặc tạo nhóm chat riêng */
export function NewChatSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const c = useColors();
  const { users, me } = useStore(useShallow((st) => ({ users: st.users, me: st.me })));
  const [mode, setMode] = useState<"people" | "group">("people");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<number | "group" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setMode("people");
      setQuery("");
      setPicked([]);
      setName("");
      setError(null);
      setBusy(null);
    }
  }, [visible]);

  const people = useMemo(() => {
    const q = fold(query);
    return Object.values(users)
      .filter((u) => u.id !== me?.id && !u.disabled && !u.bot)
      .filter((u) => !q || fold(u.displayName).includes(q) || fold(u.username).includes(q))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName, "vi"));
  }, [users, me, query]);

  const bot = useMemo(() => Object.values(users).find((u) => u.bot && !u.disabled) || null, [users]);

  const startDm = async (u: User) => {
    if (busy) return;
    setBusy(u.id);
    try {
      await openDm(u.id);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa mở được cuộc trò chuyện.");
      setBusy(null);
    }
  };

  const toggle = (id: number) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const makeGroup = async () => {
    if (picked.length < 2) return setError("Chọn ít nhất 2 người để tạo nhóm.");
    setError(null);
    setBusy("group");
    try {
      await createGroup(name.trim(), picked);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa tạo được nhóm.");
      setBusy(null);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={mode === "people" ? "Tin nhắn mới" : "Tạo nhóm mới"}
      footer={
        mode === "group" ? (
          <View style={{ gap: 8 }}>
            <FormError text={error} />
            <Button
              title={picked.length ? `Tạo nhóm (${picked.length + 1} người)` : "Tạo nhóm"}
              icon="group-add"
              onPress={makeGroup}
              busy={busy === "group"}
            />
          </View>
        ) : undefined
      }
    >
      {mode === "people" ? (
        <Pressable onPress={() => setMode("group")} style={({ pressed }) => [s.groupRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <View style={[s.groupIcon, { backgroundColor: c.jadeWash }]}>
            <Icon name="group-add" size={24} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>Tạo nhóm chat riêng</Text>
            <Text style={s.sub}>Chỉ những người trong nhóm mới đọc được</Text>
          </View>
          <Icon name="chevron-right" color={c.muted} />
        </Pressable>
      ) : (
        <Field label="Tên nhóm (có thể bỏ trống)" value={name} onChangeText={setName} maxLength={60} placeholder="Ví dụ: Đi Đà Lạt" />
      )}
      <Field value={query} onChangeText={setQuery} placeholder="Tìm theo tên" autoCorrect={false} />
      {mode === "people" && bot && (!query || fold("think ai tro ly").includes(fold(query))) ? (
        <Pressable
          onPress={() => startDm(bot)}
          style={({ pressed }) => [s.person, pressed && { backgroundColor: c.field }]}
          accessibilityRole="button"
          accessibilityLabel="Hỏi Think AI"
          accessibilityState={{ busy: busy === bot.id }}
        >
          <Avatar user={bot} size={44} dot={false} />
          <View style={{ flex: 1 }}>
            <Text style={[s.name, { color: c.accent }]} numberOfLines={1}>
              Hỏi Think AI
            </Text>
            <Text style={s.sub} numberOfLines={1}>
              Trợ lý AI: hỏi đáp, dịch, viết hộ, gợi ý…
            </Text>
          </View>
        </Pressable>
      ) : null}
      {people.length ? null : <Text style={s.sub}>Không tìm thấy ai.</Text>}
      {people.map((u) => {
        const on = picked.includes(u.id);
        return (
          <Pressable
            key={u.id}
            onPress={() => (mode === "people" ? startDm(u) : toggle(u.id))}
            style={({ pressed }) => [s.person, pressed && { backgroundColor: c.field }]}
            accessibilityRole={mode === "people" ? "button" : "checkbox"}
            accessibilityState={mode === "people" ? { busy: busy === u.id } : { checked: on }}
          >
            <Avatar user={u} size={44} meId={me?.id} />
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>
                {u.displayName}
              </Text>
              <Text style={[s.sub, u.online && { color: c.accent }]} numberOfLines={1}>
                {lastSeenText(u)}
              </Text>
            </View>
            {mode === "group" ? (
              <Icon name={on ? "check-circle" : "radio-button-unchecked"} size={24} color={on ? c.accent : c.muted} />
            ) : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    groupRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
    groupIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
    name: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    sub: { color: c.muted, fontSize: 13 },
  });
