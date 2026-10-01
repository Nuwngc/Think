import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";

import { api } from "../api";
import { API_URL, PUSH_CONFIGURED, UPDATE_URL } from "../config";
import { pickAvatar, pickCover } from "../images";
import { Cover } from "../social/ProfileView";
import { applyMe, changePassword, closeSettings, logout, showToast, turnPushOff, turnPushOn, useStore } from "../store";
import { setThemeMode, useColors, useThemeMode, type Colors, type ThemeMode } from "../theme";
import { Avatar, Button, Card, confirm, Field, FormError, Icon, IconButton, KeyboardAware, SectionLabel, Sheet, SheetItem, useStyles } from "../ui";
import { checkForUpdate, currentVersionCode, currentVersionName } from "../update";
import { BubblesSetting } from "./BubblesSetting";

// Cài đặt (mở từ nút bánh răng ở trang cá nhân): tên và giới thiệu, ảnh bìa, giao diện sáng/tối,
// thông báo, bong bóng chat, đổi mật khẩu, cập nhật app, đăng xuất.

export function SettingsScreen() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { me, push, update } = useStore(useShallow((st) => ({ me: st.me, push: st.push, update: st.update })));
  const themeMode = useThemeMode((st) => st.mode);
  const [name, setName] = useState(me?.displayName || "");
  const [bio, setBio] = useState(me?.bio || "");
  const [savingName, setSavingName] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [avatarMenu, setAvatarMenu] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => setName(me?.displayName || ""), [me?.displayName]);
  useEffect(() => setBio(me?.bio || ""), [me?.bio]);
  if (!me) return null;

  const cleanBio = bio.replace(/\s+/g, " ").trim();
  const changed = name.trim() !== me.displayName || cleanBio !== (me.bio || "");

  const saveName = async () => {
    setSavingName(true);
    try {
      const { user } = await api.updateProfile({ displayName: name.trim(), bio: cleanBio });
      applyMe(user);
      showToast("Đã lưu tên và lời giới thiệu.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa lưu được.");
    } finally {
      setSavingName(false);
    }
  };

  const changeCover = async () => {
    try {
      const img = await pickCover();
      if (!img) return;
      setCoverBusy(true);
      const { user } = await api.uploadCover(img.uri, img.mime);
      applyMe(user);
      showToast("Đã đổi ảnh bìa.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa đổi được ảnh bìa.");
    } finally {
      setCoverBusy(false);
    }
  };

  const removeCover = async () => {
    if (!(await confirm("Gỡ ảnh bìa?", "Trang cá nhân sẽ dùng nền mặc định.", "Gỡ ảnh"))) return;
    setCoverBusy(true);
    try {
      const { user } = await api.removeCover();
      applyMe(user);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa gỡ được ảnh bìa.");
    } finally {
      setCoverBusy(false);
    }
  };

  const changeAvatar = async () => {
    setAvatarMenu(false);
    try {
      const img = await pickAvatar();
      if (!img) return;
      setAvatarBusy(true);
      const { user } = await api.uploadAvatar(img.uri, img.mime);
      applyMe(user);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa đổi được ảnh đại diện.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarMenu(false);
    setAvatarBusy(true);
    try {
      const { user } = await api.removeAvatar();
      applyMe(user);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa xóa được ảnh.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (!on) {
        await turnPushOff();
        return;
      }
      const state = await turnPushOn();
      if (state === "denied") {
        const open = await confirm(
          "Thông báo đang bị chặn",
          "Mở Cài đặt của điện thoại, chọn Thông báo và bật cho Think.",
          "Mở Cài đặt",
          false,
        );
        if (open) Linking.openSettings();
      } else if (state === "server-off") {
        showToast("Máy chủ chưa bật thông báo cho app. Nhờ admin xem hướng dẫn trong README.");
      } else if (state === "error") {
        showToast("Chưa bật được thông báo. Kiểm tra mạng rồi thử lại.");
      }
    } finally {
      setPushBusy(false);
    }
  };

  const pushText =
    push === "on"
      ? "Đang bật. Có tin mới khi đóng app, điện thoại sẽ báo."
      : push === "denied"
        ? "Điện thoại đang chặn thông báo của Think."
        : push === "server-off"
          ? "Máy chủ chưa bật thông báo cho app."
          : push === "unavailable"
            ? Platform.OS === "web"
              ? "Bản chạy thử trên trình duyệt không có thông báo."
              : PUSH_CONFIGURED
                ? "Máy này chưa dùng được thông báo."
                : "Bản app này chưa được cấu hình thông báo (thiếu google-services.json)."
            : push === "error"
              ? "Chưa bật được. Chạm để thử lại."
              : "Đang tắt.";

  return (
    <KeyboardAware bottomInset={false} style={{ backgroundColor: c.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <IconButton name="arrow-back" label="Quay lại trang cá nhân" onPress={closeSettings} color={c.text} />
        <Text style={s.title}>Cài đặt</Text>
      </View>
      <ScrollView contentContainerStyle={[s.content, { width: Math.min(width, 680), alignSelf: "center" }]} keyboardShouldPersistTaps="handled">
        <Card style={s.profile}>
          <Pressable onPress={() => setAvatarMenu(true)} accessibilityRole="button" accessibilityLabel="Đổi ảnh đại diện" style={{ opacity: avatarBusy ? 0.5 : 1 }}>
            <Avatar user={me} size={84} dot={false} />
            <View style={[s.camera, { backgroundColor: c.jade, borderColor: c.surface }]}>
              <Icon name="photo-camera" size={16} color="#fff" />
            </View>
          </Pressable>
          <Text style={s.name}>{me.displayName}</Text>
          <Text style={s.muted}>
            @{me.username} · {me.role === "admin" ? "Admin" : "Thành viên"}
          </Text>
        </Card>

        <SectionLabel>TÊN VÀ GIỚI THIỆU</SectionLabel>
        <Card style={s.form}>
          <Field label="Tên hiển thị" value={name} onChangeText={setName} maxLength={40} />
          <Field
            label="Giới thiệu ngắn"
            value={bio}
            onChangeText={setBio}
            maxLength={160}
            multiline
            placeholder="vd: Mê cờ vua, thích đi phượt"
            style={s.bioInput}
            textAlignVertical="top"
          />
          <Text style={[s.muted, { alignSelf: "flex-end" }]}>{bio.length}/160</Text>
          <Button title="Lưu" onPress={saveName} busy={savingName} disabled={!name.trim() || !changed} />
          <Text style={s.muted}>Mọi người trong nhóm sẽ thấy tên và lời giới thiệu trên trang cá nhân của bạn.</Text>
        </Card>

        <SectionLabel>ẢNH BÌA</SectionLabel>
        <Card style={s.form}>
          <View style={{ opacity: coverBusy ? 0.55 : 1 }}>
            <Cover path={me.cover} width={Math.min(width, 680) - 32 - 28} radius={14} />
          </View>
          <View style={s.row}>
            <Button title="Đổi ảnh bìa" icon="photo-camera" kind="secondary" small busy={coverBusy} onPress={changeCover} style={{ flex: 1 }} />
            {me.cover ? <Button title="Gỡ ảnh bìa" kind="danger" small onPress={removeCover} disabled={coverBusy} style={{ flex: 1 }} /> : null}
          </View>
        </Card>

        <SectionLabel>GIAO DIỆN</SectionLabel>
        <View style={s.themeRow} accessibilityRole="radiogroup" accessibilityLabel="Giao diện">
          {THEMES.map((t) => {
            const on = themeMode === t.mode;
            return (
              <Pressable
                key={t.mode}
                onPress={() => setThemeMode(t.mode)}
                style={[s.themeOpt, { backgroundColor: on ? c.jadeWash : c.surface, borderColor: on ? c.accent : c.line }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={t.label}
              >
                <View style={[s.swatch, { borderColor: c.line }]}>
                  <View style={{ flex: 1, backgroundColor: t.left }} />
                  <View style={{ flex: 1, backgroundColor: t.right }} />
                </View>
                <Text style={[s.themeText, { color: on ? c.accent : c.text2 }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>THÔNG BÁO</SectionLabel>
        <Card>
          <View style={s.settingRow}>
            <View style={[s.settingIcon, { backgroundColor: c.jadeWash }]}>
              <Icon name={push === "on" ? "notifications-active" : "notifications-off"} size={20} color={c.accent} />
            </View>
            <Pressable style={{ flex: 1 }} onPress={() => togglePush(push !== "on")} disabled={pushBusy}>
              <Text style={s.settingTitle}>Thông báo tin nhắn mới</Text>
              <Text style={s.muted}>{pushText}</Text>
            </Pressable>
            <Switch
              value={push === "on"}
              onValueChange={togglePush}
              disabled={pushBusy || push === "unavailable"}
              trackColor={{ false: c.line, true: c.jadeWash }}
              thumbColor={push === "on" ? c.jade : "#fff"}
              accessibilityLabel="Thông báo tin nhắn mới"
            />
          </View>
          {push === "on" ? (
            <Pressable
              style={({ pressed }) => [s.linkRow, pressed && { backgroundColor: c.field }]}
              onPress={() =>
                api
                  .testPush()
                  .then(() => showToast("Đã gửi thông báo thử. Nếu app đang mở, hãy thoát ra màn hình chính để xem."))
                  .catch((err) => showToast(err instanceof Error ? err.message : "Chưa gửi được."))
              }
            >
              <Text style={[s.link, { color: c.accent }]}>Gửi thử một thông báo</Text>
            </Pressable>
          ) : null}
        </Card>
        {push === "on" ? (
          <Text style={[s.muted, s.note]}>
            Bấm “Trả lời” ngay trong thông báo để nhắn lại mà không cần mở app. Nếu thông báo đến chậm, vào Cài đặt điện thoại → Pin → cho Think chạy
            nền không giới hạn.
          </Text>
        ) : null}

        <BubblesSetting />

        <SectionLabel>BẢO MẬT</SectionLabel>
        <Card>
          <Pressable style={({ pressed }) => [s.settingRow, pressed && { backgroundColor: c.field }]} onPress={() => setPwOpen(true)} accessibilityRole="button">
            <View style={[s.settingIcon, { backgroundColor: c.jadeWash }]}>
              <Icon name="key" size={20} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.settingTitle}>Đổi mật khẩu</Text>
              <Text style={s.muted}>Đổi xong, các máy khác sẽ bị đăng xuất</Text>
            </View>
            <Icon name="chevron-right" color={c.muted} />
          </Pressable>
        </Card>

        <SectionLabel>ỨNG DỤNG</SectionLabel>
        <Card>
          <View style={s.settingRow}>
            <View style={[s.settingIcon, { backgroundColor: c.jadeWash }]}>
              <Icon name="system-update" size={20} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.settingTitle}>Think Beta {currentVersionName()}</Text>
              <Text style={s.muted}>
                {update
                  ? `Có bản mới ${update.versionName}${update.notes ? `: ${update.notes}` : ""}`
                  : `Bản số ${currentVersionCode() || "?"} · Máy chủ ${API_URL.replace(/^https?:\/\//, "")}`}
              </Text>
            </View>
          </View>
          {update ? (
            <View style={{ padding: 12, paddingTop: 0 }}>
              <Button title={`Tải bản ${update.versionName}`} icon="download" onPress={() => Linking.openURL(update.apk)} />
            </View>
          ) : UPDATE_URL && Platform.OS === "android" ? (
            <Pressable
              style={({ pressed }) => [s.linkRow, pressed && { backgroundColor: c.field }]}
              disabled={checking}
              onPress={async () => {
                setChecking(true);
                const found = await checkForUpdate({ force: true });
                setChecking(false);
                if (!found) showToast("Bạn đang dùng bản mới nhất.");
              }}
            >
              <Text style={[s.link, { color: c.accent }]}>{checking ? "Đang kiểm tra…" : "Kiểm tra bản mới"}</Text>
            </Pressable>
          ) : null}
        </Card>

        <View style={{ height: 18 }} />
        <Button
          title="Đăng xuất"
          kind="danger"
          icon="logout"
          onPress={async () => {
            if (await confirm("Đăng xuất?", "Tin nhắn lưu trên máy này sẽ được xóa. Đăng nhập lại là thấy đủ.", "Đăng xuất")) logout();
          }}
        />
        <View style={{ height: 24 }} />
      </ScrollView>

      <Sheet visible={avatarMenu} onClose={() => setAvatarMenu(false)} title="Ảnh đại diện">
        <SheetItem icon="photo-library" label="Chọn ảnh mới" onPress={changeAvatar} />
        {me.avatar ? <SheetItem icon="delete-outline" label="Xóa ảnh hiện tại" danger onPress={removeAvatar} /> : null}
      </Sheet>

      <PasswordSheet visible={pwOpen} onClose={() => setPwOpen(false)} />
    </KeyboardAware>
  );
}

function PasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCurrent("");
      setNext("");
      setAgain("");
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const submit = async () => {
    if (next.length < 6) return setError("Mật khẩu mới cần ít nhất 6 ký tự.");
    if (next !== again) return setError("Hai lần nhập mật khẩu mới chưa giống nhau.");
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      onClose();
      showToast("Đã đổi mật khẩu. Các máy khác đã bị đăng xuất.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa đổi được mật khẩu.");
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Đổi mật khẩu"
      footer={<Button title="Đổi mật khẩu" onPress={submit} busy={busy} />}
    >
      <Field label="Mật khẩu hiện tại" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
      <Field label="Mật khẩu mới" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
      <Field label="Nhập lại mật khẩu mới" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" onSubmitEditing={submit} />
      <FormError text={error} />
    </Sheet>
  );
}

const THEMES: { mode: ThemeMode; label: string; left: string; right: string }[] = [
  { mode: "system", label: "Theo máy", left: "#EEF2EF", right: "#0F1714" },
  { mode: "light", label: "Nền sáng", left: "#FFFFFF", right: "#EEF2EF" },
  { mode: "dark", label: "Nền tối", left: "#16211D", right: "#0F1714" },
];

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingBottom: 6 },
    title: { color: c.text, fontSize: 20, fontWeight: "800" },
    content: { paddingHorizontal: 16, paddingBottom: 24 },
    form: { padding: 14, gap: 10 },
    bioInput: { minHeight: 72, paddingTop: 12, paddingBottom: 12 },
    row: { flexDirection: "row", gap: 10 },
    themeRow: { flexDirection: "row", gap: 8 },
    themeOpt: { flex: 1, alignItems: "center", gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 2 },
    swatch: { width: 44, height: 28, borderRadius: 8, borderWidth: 1, overflow: "hidden", flexDirection: "row" },
    themeText: { fontSize: 13.5, fontWeight: "800" },
    profile: { alignItems: "center", padding: 18, gap: 6 },
    camera: { position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
    name: { color: c.text, fontSize: 20, fontWeight: "800", marginTop: 6 },
    muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
    note: { marginTop: 8, marginHorizontal: 6 },
    settingRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
    settingIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    settingTitle: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    linkRow: { paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    link: { fontSize: 14.5, fontWeight: "700" },
  });
