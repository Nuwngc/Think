import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../api";
import { fmtBytes, fmtNum, lastSeenText } from "../format";
import { showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { AdminUser, StoragePayload } from "../types";
import { API_URL } from "../config";
import { Avatar, Button, Card, confirm, Field, FormError, Icon, KeyboardAware, Loading, SectionLabel, Sheet, SheetItem, useStyles } from "../ui";

type Seg = "users" | "storage";

export function AdminScreen() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<Seg>("users");
  return (
    <KeyboardAware bottomInset={false} style={{ backgroundColor: c.bg }}>
      <View style={[s.top, { paddingTop: insets.top + 12 }]}>
        <Text style={s.h1}>Quản trị</Text>
        <View style={[s.segmented, { backgroundColor: c.field }]}>
          {(["users", "storage"] as Seg[]).map((k) => (
            <Pressable
              key={k}
              onPress={() => setSeg(k)}
              style={[s.segment, seg === k && { backgroundColor: c.surface }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: seg === k }}
            >
              <Text style={[s.segmentText, { color: seg === k ? c.text : c.muted }]}>{k === "users" ? "Tài khoản" : "Bộ nhớ máy chủ"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {seg === "users" ? <UsersPanel /> : <StoragePanel />}
    </KeyboardAware>
  );
}

/* =========================================================
   Tài khoản
   ========================================================= */

function UsersPanel() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const meId = useStore((st) => st.me?.id);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<AdminUser | null>(null);
  const [credential, setCredential] = useState<{ user: AdminUser; password: string; reset: boolean } | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", admin: false });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Tải lại khi có người đổi tên, ảnh, quyền, bị khóa… (không tải lại khi chỉ đổi trạng thái online)
  const userVersion = useStore((st) =>
    Object.values(st.users)
      .map((u) => `${u.id}:${u.displayName}:${u.avatar}:${u.role}:${u.disabled}`)
      .join("|"),
  );

  const load = useCallback(async () => {
    try {
      const { users: list } = await api.adminUsers();
      setUsers(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, userVersion]);

  const create = async () => {
    setFormError(null);
    setCreating(true);
    try {
      const res = await api.createUser({
        username: form.username.trim().toLowerCase(),
        displayName: form.displayName.trim(),
        role: form.admin ? "admin" : "member",
      });
      setForm({ username: "", displayName: "", admin: false });
      setCredential({ user: res.user, password: res.password, reset: false });
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Chưa tạo được tài khoản.");
    } finally {
      setCreating(false);
    }
  };

  const act = async (label: string, task: () => Promise<void>) => {
    setMenuFor(null);
    try {
      await task();
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Chưa ${label} được.`);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Card style={s.pad}>
        <Text style={s.cardTitle}>Tạo tài khoản mới</Text>
        <Text style={s.muted}>App tạo sẵn mật khẩu tạm. Người đó đăng nhập lần đầu sẽ phải đặt mật khẩu riêng.</Text>
        <Field
          label="Tên đăng nhập"
          value={form.username}
          onChangeText={(v) => setForm((f) => ({ ...f, username: v }))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="vd: minh.tran"
        />
        <Field
          label="Tên hiển thị"
          value={form.displayName}
          onChangeText={(v) => setForm((f) => ({ ...f, displayName: v }))}
          placeholder="vd: Minh Trần"
          maxLength={40}
        />
        <View style={s.switchRow}>
          <Text style={[s.settingTitle, { flex: 1 }]}>Cho làm admin</Text>
          <Switch
            value={form.admin}
            onValueChange={(v) => setForm((f) => ({ ...f, admin: v }))}
            trackColor={{ false: c.line, true: c.jadeWash }}
            thumbColor={form.admin ? c.jade : "#fff"}
          />
        </View>
        <FormError text={formError} />
        <Button title="Tạo tài khoản" icon="person-add" onPress={create} busy={creating} disabled={!form.username.trim()} />
      </Card>

      <SectionLabel>THÀNH VIÊN{users ? ` · ${users.length}` : ""}</SectionLabel>
      {error ? <FormError text={error} /> : null}
      {!users && !error ? <Loading /> : null}
      {users ? (
        <Card>
          {users.map((u, i) => (
            <Pressable
              key={u.id}
              onPress={() => (u.id === meId ? showToast("Đổi thông tin của bạn trong tab Cá nhân.") : setMenuFor(u))}
              style={({ pressed }) => [s.userRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.field }]}
              accessibilityRole="button"
            >
              <Avatar user={u} size={42} meId={meId} />
              <View style={{ flex: 1 }}>
                <Text style={[s.settingTitle, u.disabled && { color: c.muted, textDecorationLine: "line-through" }]} numberOfLines={1}>
                  {u.displayName}
                  {u.id === meId ? " (bạn)" : ""}
                </Text>
                <Text style={s.muted} numberOfLines={1}>
                  @{u.username} · {u.disabled ? "Đã khóa" : u.mustChangePassword ? "Chưa đổi mật khẩu tạm" : lastSeenText(u)}
                </Text>
              </View>
              {u.role === "admin" ? (
                <View style={[s.tag, { backgroundColor: c.jadeWash }]}>
                  <Text style={[s.tagText, { color: c.accent }]}>ADMIN</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Sheet visible={Boolean(menuFor)} onClose={() => setMenuFor(null)} title={menuFor?.displayName}>
        {menuFor ? (
          <>
            <SheetItem
              icon="lock-reset"
              label="Đặt lại mật khẩu"
              hint="Tạo mật khẩu tạm mới, người này bị đăng xuất khỏi mọi máy"
              onPress={async () => {
                const u = menuFor;
                if (!(await confirm(`Đặt lại mật khẩu cho ${u.displayName}?`, "Người này sẽ bị đăng xuất khỏi mọi máy.", "Đặt lại"))) return;
                act("đặt lại mật khẩu", async () => {
                  const res = await api.resetPassword(u.id);
                  setCredential({ user: res.user, password: res.password, reset: true });
                });
              }}
            />
            <SheetItem
              icon={menuFor.disabled ? "lock-open" : "block"}
              label={menuFor.disabled ? "Mở khóa tài khoản" : "Khóa tài khoản"}
              danger={!menuFor.disabled}
              hint={menuFor.disabled ? undefined : "Người này không đăng nhập được nữa cho tới khi mở khóa"}
              onPress={async () => {
                const u = menuFor;
                if (!u.disabled && !(await confirm(`Khóa tài khoản ${u.displayName}?`, "Người này sẽ bị đăng xuất ngay.", "Khóa"))) return;
                act("đổi trạng thái", async () => {
                  await api.setDisabled(u.id, !u.disabled);
                });
              }}
            />
            <SheetItem
              icon="admin-panel-settings"
              label={menuFor.role === "admin" ? "Gỡ quyền admin" : "Cấp quyền admin"}
              onPress={() => {
                const u = menuFor;
                act("đổi quyền", async () => {
                  await api.setRole(u.id, u.role === "admin" ? "member" : "admin");
                });
              }}
            />
          </>
        ) : null}
      </Sheet>

      <CredentialSheet data={credential} onClose={() => setCredential(null)} />
    </ScrollView>
  );
}

/** Tên đăng nhập + mật khẩu tạm để gửi cho người được tạo tài khoản */
function CredentialSheet({ data, onClose }: { data: { user: AdminUser; password: string; reset: boolean } | null; onClose: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const text = data
    ? `Think — ${API_URL.replace(/^https?:\/\//, "")}\nTên đăng nhập: ${data.user.username}\nMật khẩu tạm: ${data.password}\nĐăng nhập lần đầu sẽ phải đặt mật khẩu mới.`
    : "";
  return (
    <Sheet visible={Boolean(data)} onClose={onClose} title={data?.reset ? "Đã đặt lại mật khẩu" : "Đã tạo tài khoản"}>
      <Text style={s.muted}>Gửi thông tin này cho {data?.user.displayName}. Mật khẩu tạm chỉ hiện một lần.</Text>
      <View style={[s.credential, { backgroundColor: c.field }]}>
        <Text style={s.credLabel}>Tên đăng nhập</Text>
        <Text style={s.credValue} selectable>
          {data?.user.username}
        </Text>
        <Text style={s.credLabel}>Mật khẩu tạm</Text>
        <Text style={[s.credValue, { letterSpacing: 1 }]} selectable>
          {data?.password}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button
          title="Sao chép"
          icon="content-copy"
          kind="secondary"
          style={{ flex: 1 }}
          onPress={async () => {
            await Clipboard.setStringAsync(text);
            showToast("Đã sao chép.");
          }}
        />
        <Button title="Gửi qua…" icon="share" style={{ flex: 1 }} onPress={() => Share.share({ message: text }).catch(() => undefined)} />
      </View>
    </Sheet>
  );
}

/* =========================================================
   Bộ nhớ máy chủ
   ========================================================= */

const AGES = [30, 90, 180, 365];

function StoragePanel() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const version = useStore((st) => st.storageVersion);
  const [data, setData] = useState<StoragePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"images" | "messages">("images");
  const [days, setDays] = useState(90);
  const [preview, setPreview] = useState<{ count: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.storage());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dung lượng.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  useEffect(() => setPreview(null), [kind, days]);

  if (error && !data) {
    return (
      <View style={s.content}>
        <FormError text={error} />
        <Button title="Thử lại" kind="secondary" onPress={load} />
      </View>
    );
  }
  if (!data) return <Loading />;

  const u = data.usage;
  const pct = Math.min(100, Math.max(0, u.percent || 0));
  const color = pct >= data.settings.cleanAt ? c.meterCrit : pct >= data.settings.cleanAt - 15 ? c.meterWarn : c.meterGood;

  const runPreview = async () => {
    setBusy("preview");
    try {
      const res = await api.cleanup(kind, days, true);
      setPreview({ count: res.result.count, bytes: res.result.bytes });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa xem trước được.");
    } finally {
      setBusy(null);
    }
  };

  const runClean = async () => {
    const what = kind === "images" ? "ảnh" : "tin nhắn";
    if (!(await confirm(`Dọn ${fmtNum(preview?.count || 0)} ${what}?`, `Xóa vĩnh viễn ${what} cũ hơn ${days} ngày khỏi máy chủ.`, "Dọn ngay"))) return;
    setBusy("clean");
    try {
      const res = await api.cleanup(kind, days, false);
      setData(res);
      setPreview(null);
      showToast(`Đã dọn ${fmtNum(res.result.count)} ${what}, giải phóng ${fmtBytes(res.result.bytes)}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa dọn được.");
    } finally {
      setBusy(null);
    }
  };

  const toggleAuto = async (on: boolean) => {
    setBusy("auto");
    try {
      setData(await api.saveStorageSettings({ autoClean: on }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa lưu được.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Card style={s.pad}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text style={[s.big, { color }]}>{Math.round(pct)}%</Text>
          <Text style={s.muted}>
            {fmtBytes(u.total)} / {fmtBytes(u.limit)}
          </Text>
        </View>
        <View style={[s.meter, { backgroundColor: c.field }]}>
          <View style={[s.meterFill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={s.muted}>{u.cloud ? "Lưu trên Firebase (gói miễn phí)" : "Lưu trên ổ đĩa máy chủ"}</Text>
        <View style={s.breakdown}>
          <Stat icon="chat-bubble-outline" label="Tin nhắn" value={`${fmtNum(u.db.messages)} · ${fmtBytes(u.db.bytes)}`} />
          <Stat icon="image" label="Ảnh" value={`${fmtNum(u.images.count)} · ${fmtBytes(u.images.bytes)}`} />
          <Stat icon="person-outline" label="Ảnh đại diện" value={`${fmtNum(u.avatars.count)} · ${fmtBytes(u.avatars.bytes)}`} />
        </View>
      </Card>

      <SectionLabel>TỰ DỌN KHI SẮP ĐẦY</SectionLabel>
      <Card>
        <View style={s.switchRow2}>
          <View style={{ flex: 1 }}>
            <Text style={s.settingTitle}>Tự dọn dữ liệu cũ nhất</Text>
            <Text style={s.muted}>
              Khi dùng quá {data.settings.cleanAt}%, tự xóa ảnh rồi tới tin nhắn cũ nhất cho tới khi còn {data.settings.cleanTo}%.
            </Text>
          </View>
          <Switch
            value={data.settings.autoClean}
            onValueChange={toggleAuto}
            disabled={busy === "auto"}
            trackColor={{ false: c.line, true: c.jadeWash }}
            thumbColor={data.settings.autoClean ? c.jade : "#fff"}
          />
        </View>
      </Card>

      <SectionLabel>DỌN THỦ CÔNG</SectionLabel>
      <Card style={s.pad}>
        <View style={s.chips}>
          {(["images", "messages"] as const).map((k) => (
            <Chip key={k} active={kind === k} label={k === "images" ? "Ảnh" : "Tin nhắn"} onPress={() => setKind(k)} />
          ))}
        </View>
        <Text style={s.muted}>Cũ hơn</Text>
        <View style={s.chips}>
          {AGES.map((d) => (
            <Chip key={d} active={days === d} label={d >= 365 ? "1 năm" : `${d} ngày`} onPress={() => setDays(d)} />
          ))}
        </View>
        {preview ? (
          <Text style={[s.settingTitle, { marginTop: 4 }]}>
            {preview.count
              ? `Sẽ xóa ${fmtNum(preview.count)} ${kind === "images" ? "ảnh" : "tin nhắn"} (khoảng ${fmtBytes(preview.bytes)}).`
              : "Không có gì cũ như vậy để dọn."}
          </Text>
        ) : null}
        {preview && preview.count ? (
          <Button title="Dọn ngay" kind="danger" icon="cleaning-services" onPress={runClean} busy={busy === "clean"} />
        ) : (
          <Button title="Xem trước" kind="secondary" onPress={runPreview} busy={busy === "preview"} />
        )}
        {kind === "images" ? (
          <Text style={s.muted}>Tin nhắn vẫn còn, chỉ ảnh bị xóa (hiện “Ảnh đã được dọn khỏi máy chủ”).</Text>
        ) : (
          <Text style={s.muted}>Tin nhắn cũ bị xóa khỏi máy chủ. Máy nào đã lưu thì vẫn còn bản của máy đó.</Text>
        )}
      </Card>
      {data.lastClean ? (
        <Text style={[s.muted, { marginTop: 10, marginHorizontal: 6 }]}>
          Lần dọn gần nhất ({data.lastClean.auto ? "tự động" : "thủ công"}): {new Date(data.lastClean.at).toLocaleDateString("vi-VN")} — {fmtNum(data.lastClean.images)} ảnh,{" "}
          {fmtNum(data.lastClean.messages)} tin nhắn.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Stat({ icon, label, value }: { icon: "chat-bubble-outline" | "image" | "person-outline"; label: string; value: string }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={s.stat}>
      <Icon name={icon} size={18} color={c.accent} />
      <Text style={[s.settingTitle, { flex: 1, fontSize: 14 }]}>{label}</Text>
      <Text style={s.muted}>{value}</Text>
    </View>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, { backgroundColor: active ? c.jade : c.field }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[s.chipText, { color: active ? c.onJade : c.text2 }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    top: { paddingHorizontal: 16, gap: 12, paddingBottom: 6 },
    h1: { color: c.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.8, marginHorizontal: 4 },
    segmented: { flexDirection: "row", borderRadius: 14, padding: 4 },
    segment: { flex: 1, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    segmentText: { fontSize: 14, fontWeight: "700" },
    content: { padding: 16, paddingBottom: 32 },
    pad: { padding: 16, gap: 12 },
    cardTitle: { color: c.text, fontSize: 17, fontWeight: "800" },
    muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
    settingTitle: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    switchRow: { flexDirection: "row", alignItems: "center" },
    switchRow2: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
    userRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
    tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    tagText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
    credential: { borderRadius: 14, padding: 14, gap: 2 },
    credLabel: { color: c.muted, fontSize: 12.5, marginTop: 6 },
    credValue: { color: c.text, fontSize: 20, fontWeight: "800" },
    big: { fontSize: 34, fontWeight: "800", letterSpacing: -1 },
    meter: { height: 10, borderRadius: 5, overflow: "hidden" },
    meterFill: { height: 10, borderRadius: 5 },
    breakdown: { gap: 8, marginTop: 4 },
    stat: { flexDirection: "row", alignItems: "center", gap: 10 },
    chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
    chipText: { fontSize: 14, fontWeight: "700" },
  });
