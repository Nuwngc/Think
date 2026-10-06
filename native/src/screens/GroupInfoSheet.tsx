import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { convTitle, fold, lastSeenText } from "../format";
import { pickAvatar } from "../images";
import { addMembers, namesOf, openDm, removeMember, renameGroup, setGroupAvatar, showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { Conversation } from "../types";
import { Avatar, Button, confirm, ConvAvatar, Field, FormError, Icon, IconButton, SectionLabel, Sheet, useStyles } from "../ui";

/** Thông tin cuộc trò chuyện: người (chat riêng), thành viên (phòng chung), quản lý nhóm (nhóm riêng) */
export function GroupInfoSheet({ visible, onClose, conv }: { visible: boolean; onClose: () => void; conv: Conversation }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { users, me } = useStore(useShallow((st) => ({ users: st.users, me: st.me })));
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  const meId = me?.id ?? 0;
  const [name, setName] = useState(conv.name || "");
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(conv.name || "");
      setAdding(false);
      setPicked([]);
      setQuery("");
      setError(null);
      setBusy(null);
    }
  }, [visible, conv.name]);

  const isGroup = conv.type === "group";
  const isOwner = isGroup && conv.createdBy === meId;
  const memberIds = useMemo(() => {
    if (conv.type === "group") return conv.memberIds || [];
    if (conv.type === "general") return Object.values(users).filter((u) => !u.disabled).map((u) => u.id);
    return [meId, conv.peerId].filter((x): x is number => x != null);
  }, [conv, users, meId]);
  const members = memberIds
    .map((id) => users[id])
    .filter(Boolean)
    .sort((a, b) => Number(b.id === conv.createdBy) - Number(a.id === conv.createdBy) || a.displayName.localeCompare(b.displayName, "vi"));

  const candidates = useMemo(() => {
    const q = fold(query);
    const inGroup = new Set(memberIds);
    return Object.values(users)
      .filter((u) => !u.disabled && !inGroup.has(u.id))
      .filter((u) => !q || fold(u.displayName).includes(q) || fold(u.username).includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
  }, [users, memberIds, query]);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(null);
    }
  };

  const saveName = () =>
    run("rename", async () => {
      const next = name.trim();
      if (!next) throw new Error("Tên nhóm cần từ 1 đến 60 ký tự.");
      await renameGroup(conv.id, next);
      showToast("Đã đổi tên nhóm.");
    });

  const confirmRemove = async (uid: number) => {
    const leaving = uid === meId;
    const ok = await confirm(
      leaving ? "Rời nhóm?" : `Xóa ${names.nameOf(uid)} khỏi nhóm?`,
      leaving ? "Bạn sẽ không đọc được tin nhắn trong nhóm này nữa." : "Người này sẽ không đọc được tin nhắn mới trong nhóm.",
      leaving ? "Rời nhóm" : "Xóa",
    );
    if (!ok) return;
    run(`rm${uid}`, async () => {
      await removeMember(conv.id, uid);
      if (leaving) onClose();
    });
  };

  const peer = conv.type === "dm" && conv.peerId != null ? users[conv.peerId] : undefined;

  // Ảnh nhóm: chọn trong máy (cắt vuông, thu nhỏ) rồi gửi; thành viên nào cũng đổi được
  const changePhoto = () =>
    run("photo", async () => {
      const img = await pickAvatar();
      if (!img) return;
      await setGroupAvatar(conv.id, img);
      showToast("Đã đổi ảnh nhóm.");
    });
  const removePhoto = async () => {
    if (!(await confirm("Xóa ảnh nhóm?", "Nhóm sẽ dùng lại chữ cái đầu của tên.", "Xóa ảnh"))) return;
    run("photo-rm", async () => {
      await setGroupAvatar(conv.id, null);
      showToast("Đã xóa ảnh nhóm.");
    });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={conv.type === "dm" ? "Thông tin" : conv.type === "group" ? "Thông tin nhóm" : "Phòng chung"}>
      <View style={s.hero}>
        {isGroup ? (
          <Pressable onPress={changePhoto} disabled={busy != null} accessibilityRole="button" accessibilityLabel="Đổi ảnh nhóm">
            <ConvAvatar conv={conv} users={users} size={72} dot={false} />
            <View style={[s.cam, { backgroundColor: c.surface, borderColor: c.line }]}>
              <Icon name="photo-camera" size={16} color={c.text} />
            </View>
          </Pressable>
        ) : (
          <ConvAvatar conv={conv} users={users} size={72} dot={false} />
        )}
        <Text style={s.heroName}>{convTitle(conv, names.nameOf)}</Text>
        <Text style={s.muted}>
          {conv.type === "dm"
            ? `@${peer?.username || ""} · ${peer?.disabled ? "Tài khoản đã bị khóa" : lastSeenText(peer)}`
            : `${members.length} thành viên${isGroup ? ` · Trưởng nhóm: ${conv.createdBy === meId ? "bạn" : names.nameOf(conv.createdBy)}` : ""}`}
        </Text>
      </View>

      {isGroup ? (
        <View style={s.photoRow}>
          <Button title="Đổi ảnh nhóm" icon="photo-camera" kind="secondary" small busy={busy === "photo"} onPress={changePhoto} />
          {conv.avatar ? <Button title="Xóa ảnh" icon="delete-outline" kind="secondary" small busy={busy === "photo-rm"} onPress={removePhoto} /> : null}
        </View>
      ) : null}

      {isGroup ? (
        <>
          <View style={s.inline}>
            <View style={{ flex: 1 }}>
              <Field label="Tên nhóm" value={name} onChangeText={setName} maxLength={60} accessibilityLabel="Tên nhóm" />
            </View>
            <Button title="Lưu" small onPress={saveName} busy={busy === "rename"} disabled={!name.trim() || name.trim() === conv.name} style={{ marginTop: 22 }} />
          </View>
          <FormError text={error} />
        </>
      ) : null}

      {conv.type !== "dm" ? (
        <>
          <View style={s.sectionRow}>
            <SectionLabel>THÀNH VIÊN</SectionLabel>
            {isGroup && !adding ? <Button title="Thêm người" icon="person-add" small kind="secondary" onPress={() => setAdding(true)} /> : null}
          </View>

          {adding ? (
            <View style={[s.addBox, { borderColor: c.line }]}>
              <Field value={query} onChangeText={setQuery} placeholder="Tìm người để thêm" autoCorrect={false} />
              {candidates.length === 0 ? <Text style={s.muted}>Mọi người đều đã ở trong nhóm.</Text> : null}
              {candidates.map((u) => {
                const on = picked.includes(u.id);
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => setPicked((l) => (on ? l.filter((x) => x !== u.id) : [...l, u.id]))}
                    style={s.person}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Avatar user={u} size={38} meId={meId} />
                    <Text style={s.personName} numberOfLines={1}>
                      {u.displayName}
                    </Text>
                    <Icon name={on ? "check-circle" : "radio-button-unchecked"} color={on ? c.accent : c.muted} />
                  </Pressable>
                );
              })}
              <View style={s.inline}>
                <Button title="Hủy" kind="secondary" small onPress={() => setAdding(false)} style={{ flex: 1 }} />
                <Button
                  title={picked.length ? `Thêm ${picked.length} người` : "Thêm"}
                  small
                  disabled={!picked.length}
                  busy={busy === "add"}
                  style={{ flex: 1 }}
                  onPress={() =>
                    run("add", async () => {
                      await addMembers(conv.id, picked);
                      setAdding(false);
                      setPicked([]);
                    })
                  }
                />
              </View>
            </View>
          ) : null}

          {members.map((u) => (
            <View key={u.id} style={s.person}>
              <Avatar user={u} size={42} meId={meId} />
              <Pressable
                style={{ flex: 1 }}
                disabled={u.id === meId}
                onPress={() => {
                  onClose();
                  openDm(u.id).catch((err) => showToast(err instanceof Error ? err.message : "Chưa mở được."));
                }}
                accessibilityHint="Nhắn riêng"
              >
                <Text style={s.personName} numberOfLines={1}>
                  {u.id === meId ? `${u.displayName} (bạn)` : u.displayName}
                </Text>
                <Text style={[s.muted, u.online && u.id !== meId && { color: c.accent }]} numberOfLines={1}>
                  {isGroup && u.id === conv.createdBy ? "Trưởng nhóm · " : ""}
                  {u.id === meId ? "Đang dùng" : lastSeenText(u)}
                </Text>
              </Pressable>
              {isOwner && u.id !== meId ? (
                <IconButton name="person-remove" label={`Xóa ${u.displayName} khỏi nhóm`} color={c.danger} onPress={() => confirmRemove(u.id)} />
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {isGroup ? <Button title="Rời nhóm" kind="danger" icon="exit-to-app" onPress={() => confirmRemove(meId)} busy={busy === `rm${meId}`} /> : null}
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    hero: { alignItems: "center", gap: 6, paddingVertical: 8 },
    cam: {
      position: "absolute",
      right: -6,
      bottom: -6,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
    },
    photoRow: { flexDirection: "row", justifyContent: "center", gap: 10 },
    heroName: { color: c.text, fontSize: 20, fontWeight: "800", textAlign: "center" },
    muted: { color: c.muted, fontSize: 13, textAlign: "left" },
    inline: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    addBox: { gap: 8, borderWidth: 1, borderRadius: 14, padding: 10 },
    person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
    personName: { color: c.text, fontSize: 15.5, fontWeight: "700", flexShrink: 1 },
  });
