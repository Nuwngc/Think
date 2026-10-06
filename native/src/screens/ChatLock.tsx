import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";

import { LOCK_MAX, LOCK_MIN, lockLengthOk } from "../chatLock";
import { convTitle } from "../format";
import { closeConversation, namesOf, removeChatLock, setChatLock, showToast, unlockConversation, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { Conversation } from "../types";
import { Button, ConvAvatar, Field, FormError, Icon, IconButton, KeyboardAware, SectionLabel, useStyles } from "../ui";

// Khóa cuộc trò chuyện bằng mật khẩu (2.9.0, máy chủ: src/chat-lock.js; bản web: renderLockGate / lockPanel trong public/app.js).
// Khóa riêng trên tài khoản của mình (cả web và app), người khác trong cuộc trò chuyện không bị ảnh hưởng.

const MIN = LOCK_MIN;
const MAX = LOCK_MAX;

/** Màn khóa thay cho khung chat khi chưa nhập mật khẩu */
export function ChatLockGate({ conv, onClose }: { conv: Conversation; onClose?: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { users, me } = useStore(useShallow((st) => ({ users: st.users, me: st.me })));
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  const [forgot, setForgot] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [forgot]);

  async function submit() {
    if (!value) {
      setError(forgot ? "Nhập mật khẩu đăng nhập." : "Nhập mật khẩu khóa.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unlockConversation(conv.id, value, forgot);
      if (forgot) showToast("Đã bỏ khóa cuộc trò chuyện.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa mở khóa được.");
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAware style={{ backgroundColor: c.bg }}>
      <View style={[s.header, { paddingTop: onClose ? 6 : insets.top + 4 }]}>
        <IconButton
          name={onClose ? "keyboard-arrow-down" : "arrow-back"}
          label={onClose ? "Thu nhỏ" : "Quay lại"}
          onPress={onClose || closeConversation}
          color={c.text}
        />
        <ConvAvatar conv={conv} users={users} meId={names.meId} size={40} dot={false} />
        <Text style={s.title} numberOfLines={1}>
          {convTitle(conv, names.nameOf)}
        </Text>
      </View>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={[s.lockIc, { backgroundColor: c.jadeWash }]}>
          <Icon name="lock" size={32} color={c.accent} />
        </View>
        <Text style={s.heading}>{forgot ? "Bỏ khóa bằng mật khẩu đăng nhập" : "Cuộc trò chuyện đã khóa"}</Text>
        <Text style={s.hint}>
          {forgot
            ? "Nhập mật khẩu bạn dùng để đăng nhập Think. Cuộc trò chuyện sẽ hết khóa, muốn khóa lại thì đặt mật khẩu mới."
            : "Nhập mật khẩu bạn đã đặt cho cuộc trò chuyện này để xem tin nhắn."}
        </Text>
        <View style={s.stretch}>
          <Field
            ref={input}
            value={value}
            onChangeText={(v) => {
              setValue(v);
              setError(null);
            }}
            placeholder={forgot ? "Mật khẩu đăng nhập" : "Mật khẩu khóa"}
            accessibilityLabel={forgot ? "Mật khẩu đăng nhập" : "Mật khẩu khóa"}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={forgot ? 128 : MAX}
            returnKeyType="go"
            onSubmitEditing={submit}
            style={{ textAlign: "center" }}
          />
          <FormError text={error} />
        </View>
        <Button
          title={forgot ? "Bỏ khóa" : "Mở khóa"}
          icon="lock-open"
          kind={forgot ? "danger" : "primary"}
          busy={busy}
          onPress={submit}
          style={{ alignSelf: "stretch" }}
        />
        <Pressable
          onPress={() => {
            setForgot((v) => !v);
            setValue("");
            setError(null);
          }}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={s.link}>{forgot ? "Quay lại nhập mật khẩu khóa" : "Quên mật khẩu?"}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAware>
  );
}

type Mode = null | "set" | "change" | "remove" | "forgot";

/** Phần "Khóa bằng mật khẩu" trong bảng Tùy chỉnh đoạn chat */
export function LockSection({ conv }: { conv: Conversation }) {
  const s = useStyles(makeStyles);
  const [mode, setMode] = useState<Mode>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (m: Mode) => {
    setMode(m);
    setCurrent("");
    setNext("");
    setAgain("");
    setError(null);
  };
  useEffect(() => open(null), [conv.id, conv.locked]);

  async function submit() {
    if ((mode === "set" || mode === "change") && !lockLengthOk(next)) return setError(`Mật khẩu khóa cần từ ${MIN} đến ${MAX} ký tự.`);
    if ((mode === "set" || mode === "change") && next !== again) return setError("Hai lần nhập mật khẩu chưa giống nhau.");
    if ((mode === "change" || mode === "remove") && !current) return setError("Nhập mật khẩu khóa hiện tại.");
    if (mode === "forgot" && !current) return setError("Nhập mật khẩu đăng nhập.");
    setBusy(true);
    setError(null);
    try {
      if (mode === "set" || mode === "change") await setChatLock(conv.id, next, mode === "change" ? current : undefined);
      else await removeChatLock(conv.id, mode === "forgot" ? { accountPassword: current } : { password: current });
      showToast(
        mode === "set"
          ? "Đã khóa. Lần sau mở cuộc trò chuyện này phải nhập mật khẩu."
          : mode === "change"
            ? "Đã đổi mật khẩu khóa."
            : "Đã bỏ khóa cuộc trò chuyện.",
      );
      open(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa làm được.");
    } finally {
      setBusy(false);
    }
  }

  const pw = (label: string, value: string, onChange: (v: string) => void, max = MAX) => (
    <Field
      label={label}
      value={value}
      onChangeText={(v) => {
        onChange(v);
        setError(null);
      }}
      accessibilityLabel={label}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={max}
    />
  );

  return (
    <View style={s.section}>
      <SectionLabel>{conv.locked ? "🔒 Đang khóa bằng mật khẩu" : "Khóa bằng mật khẩu"}</SectionLabel>
      <Text style={s.sectionHint}>
        Chỉ khóa trên tài khoản của bạn (cả web và app): mở cuộc trò chuyện này phải nhập mật khẩu, danh sách không hiện nội dung tin nhắn. Thông báo và bong
        bóng chat vẫn đầy đủ, bấm vào thì hỏi mật khẩu. Người khác không bị ảnh hưởng.
      </Text>
      {mode == null ? (
        <View style={s.row}>
          {conv.locked ? (
            <>
              <Button title="Đổi mật khẩu" icon="password" kind="secondary" small onPress={() => open("change")} />
              <Button title="Bỏ khóa" icon="lock-open" kind="secondary" small onPress={() => open("remove")} />
            </>
          ) : (
            <Button title="Đặt mật khẩu" icon="lock" small onPress={() => open("set")} />
          )}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {mode === "change" || mode === "remove" ? pw("Mật khẩu khóa hiện tại", current, setCurrent) : null}
          {mode === "forgot" ? pw("Mật khẩu đăng nhập Think", current, setCurrent, 128) : null}
          {mode === "set" || mode === "change"
            ? pw(mode === "set" ? `Mật khẩu khóa (${MIN}–${MAX} ký tự)` : `Mật khẩu mới (${MIN}–${MAX} ký tự)`, next, setNext)
            : null}
          {mode === "set" || mode === "change" ? pw("Nhập lại mật khẩu", again, setAgain) : null}
          <FormError text={error} />
          <View style={s.row}>
            <Button title="Hủy" kind="secondary" small onPress={() => open(null)} style={{ flex: 1 }} />
            <Button
              title={mode === "set" ? "Khóa cuộc trò chuyện" : mode === "change" ? "Lưu mật khẩu mới" : "Bỏ khóa"}
              kind={mode === "remove" || mode === "forgot" ? "danger" : "primary"}
              small
              busy={busy}
              onPress={submit}
              style={{ flex: 1 }}
            />
          </View>
          {mode === "remove" ? (
            <Pressable onPress={() => open("forgot")} hitSlop={8} accessibilityRole="button">
              <Text style={s.link}>Quên mật khẩu? Dùng mật khẩu đăng nhập</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 6,
      paddingBottom: 8,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    title: { flex: 1, color: c.text, fontSize: 16.5, fontWeight: "800" },
    body: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 24,
      paddingVertical: 32,
      maxWidth: 420,
      width: "100%",
      alignSelf: "center",
    },
    lockIc: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
    heading: { color: c.text, fontSize: 19, fontWeight: "800", textAlign: "center" },
    hint: { color: c.muted, fontSize: 13.5, lineHeight: 19, textAlign: "center" },
    link: { color: c.accent, fontSize: 14, fontWeight: "800", textAlign: "center", paddingVertical: 4 },
    section: { gap: 8 },
    stretch: { alignSelf: "stretch", gap: 10 },
    sectionHint: { color: c.muted, fontSize: 13, lineHeight: 18 },
    row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  });
