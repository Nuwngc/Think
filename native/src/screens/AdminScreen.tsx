import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";

import { api, type AiSettings } from "../api";
import { fmtBytes, fmtNum, hm, lastSeenText, shortTime } from "../format";
import { namesOf, showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { AdminUser, ErrorReport, StoragePayload } from "../types";
import { API_URL } from "../config";
import { Avatar, Button, Card, confirm, Field, FormError, Icon, KeyboardAware, Loading, SectionLabel, Sheet, SheetItem, useStyles } from "../ui";
import { TurnSettingsCard } from "./TurnSettings";

type Seg = "users" | "storage" | "errors" | "ai";
const SEGS: { key: Seg; label: string }[] = [
  { key: "users", label: "Tài khoản" },
  { key: "storage", label: "Bộ nhớ" },
  { key: "errors", label: "Báo lỗi" },
  { key: "ai", label: "AI, gọi" },
];

export function AdminScreen() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<Seg>("users");
  // Chấm đỏ trên mục "Báo lỗi app" khi có lỗi mới trong lúc đang xem mục khác
  const errorsVersion = useStore((st) => st.errorsVersion);
  const [seenErrors, setSeenErrors] = useState(errorsVersion);
  useEffect(() => {
    if (seg === "errors") setSeenErrors(errorsVersion);
  }, [seg, errorsVersion]);
  return (
    <KeyboardAware bottomInset={false} style={{ backgroundColor: c.bg }}>
      <View style={[s.top, { paddingTop: insets.top + 12 }]}>
        <Text style={s.h1}>Quản trị</Text>
        <View style={[s.segmented, { backgroundColor: c.field }]}>
          {SEGS.map(({ key: k, label }) => (
            <Pressable
              key={k}
              onPress={() => setSeg(k)}
              style={[s.segment, seg === k && { backgroundColor: c.surface }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: seg === k }}
            >
              <Text style={[s.segmentText, { color: seg === k ? c.text : c.muted }]} numberOfLines={1}>
                {label}
              </Text>
              {k === "errors" && errorsVersion !== seenErrors ? <View style={[s.dot, { backgroundColor: c.danger }]} /> : null}
            </Pressable>
          ))}
        </View>
      </View>
      {seg === "users" ? <UsersPanel /> : seg === "storage" ? <StoragePanel /> : seg === "ai" ? <AiPanel /> : <ErrorsPanel />}
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

/* =========================================================
   Think AI + máy chủ TURN cho cuộc gọi (2.10.0). Bản web: mục "AI, gọi" (loadAiAdmin trong public/app.js)
   ========================================================= */

function AiPanel() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [form, setForm] = useState({ provider: "gemini" as "gemini" | "openai", apiKey: "", model: "", baseUrl: "", perUserDaily: "", totalDaily: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const fill = (a: AiSettings) => {
    setAi(a);
    setForm({ provider: a.provider, apiKey: "", model: a.model, baseUrl: a.baseUrl || "", perUserDaily: String(a.perUserDaily), totalDaily: String(a.totalDaily) });
  };
  const load = useCallback(async () => {
    try {
      const a = await api.aiSettings();
      fill(a.ai);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được cài đặt.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!ai) {
    return error ? (
      <View style={s.content}>
        <FormError text={error} />
        <Button title="Thử lại" kind="secondary" onPress={load} />
      </View>
    ) : (
      <Loading />
    );
  }

  const save = async (extra: Partial<AiSettings> & { apiKey?: string } = {}) => {
    setBusy("save");
    setError(null);
    try {
      const body: Parameters<typeof api.saveAiSettings>[0] = {
        provider: form.provider,
        model: form.model.trim(),
        baseUrl: form.provider === "openai" ? form.baseUrl.trim() : "",
        perUserDaily: Number(form.perUserDaily) || undefined,
        totalDaily: Number(form.totalDaily) || undefined,
        ...extra,
      };
      if (form.apiKey.trim() && extra.apiKey === undefined) body.apiKey = form.apiKey.trim();
      const res = await api.saveAiSettings(body);
      fill(res.ai);
      showToast(res.ai.ready ? "Đã lưu. Think AI sẵn sàng trả lời." : "Đã lưu cài đặt Think AI.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa lưu được.");
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const r = await api.testAi();
      setTestResult({ ok: true, text: `Khóa dùng được (${r.model}). Think AI trả lời: “${r.reply}”` });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : "Chưa thử được." });
    } finally {
      setBusy(null);
    }
  };
  const gemini = form.provider === "gemini";
  const state = ai.ready ? "Đang chạy" : !ai.enabled ? "Đang tắt" : "Chưa có khóa";

  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card style={s.pad}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={[s.cardTitle, { flex: 1 }]}>Think AI</Text>
          <View style={[s.tag, { backgroundColor: ai.ready ? c.jadeWash : c.field }]}>
            <Text style={[s.tagText, { color: ai.ready ? c.accent : c.muted, letterSpacing: 0 }]}>{state}</Text>
          </View>
        </View>
        <Text style={s.muted}>
          Trợ lý AI trong chat: mọi người nhắn riêng cho Think AI, hoặc gõ @Think AI trong nhóm. Lấy khóa miễn phí ở Google AI Studio (aistudio.google.com → Get API key)
          rồi dán vào đây. Khóa chỉ lưu trên máy chủ, không hiện lại.
        </Text>
        <View style={s.switchRow}>
          <Text style={[s.settingTitle, { flex: 1 }]}>Bật Think AI</Text>
          <Switch
            value={ai.enabled}
            onValueChange={(on) => save({ enabled: on })}
            disabled={busy === "save"}
            trackColor={{ false: c.line, true: c.jadeWash }}
            thumbColor={ai.enabled ? c.jade : "#fff"}
            accessibilityLabel="Bật Think AI"
          />
        </View>
        <Text style={s.muted}>Dịch vụ AI</Text>
        <View style={s.chips}>
          <Chip active={gemini} label="Google Gemini" onPress={() => setForm((f) => ({ ...f, provider: "gemini" }))} />
          <Chip active={!gemini} label="Kiểu OpenAI" onPress={() => setForm((f) => ({ ...f, provider: "openai" }))} />
        </View>
        <Field
          label="Khóa API"
          value={form.apiKey}
          onChangeText={(v) => setForm((f) => ({ ...f, apiKey: v }))}
          placeholder={ai.hasKey ? `Đang dùng khóa ${ai.keyHint}. Dán khóa mới để đổi` : "Dán khóa API vào đây"}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Khóa API"
        />
        <Field
          label="Model"
          value={form.model}
          onChangeText={(v) => setForm((f) => ({ ...f, model: v }))}
          placeholder={gemini ? "gemini-flash-latest" : "vd llama-3.3-70b-versatile"}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Model"
        />
        {gemini ? (
          <View style={s.switchRow}>
            <Text style={[s.settingTitle, { flex: 1, fontSize: 14.5 }]}>Cho tra Google (tin tức, thời tiết…)</Text>
            <Switch
              value={ai.search}
              onValueChange={(on) => save({ search: on })}
              disabled={busy === "save"}
              trackColor={{ false: c.line, true: c.jadeWash }}
              thumbColor={ai.search ? c.jade : "#fff"}
              accessibilityLabel="Cho tra Google"
            />
          </View>
        ) : (
          <Field
            label="Địa chỉ API"
            value={form.baseUrl}
            onChangeText={(v) => setForm((f) => ({ ...f, baseUrl: v }))}
            placeholder="vd https://api.groq.com/openai/v1"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Địa chỉ API"
          />
        )}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Mỗi người / ngày"
              value={form.perUserDaily}
              onChangeText={(v) => setForm((f) => ({ ...f, perUserDaily: v.replace(/\D/g, "") }))}
              keyboardType="number-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Cả nhóm / ngày" value={form.totalDaily} onChangeText={(v) => setForm((f) => ({ ...f, totalDaily: v.replace(/\D/g, "") }))} keyboardType="number-pad" />
          </View>
        </View>
        <Text style={s.muted}>Hôm nay đã trả lời {fmtNum(ai.usedToday)} câu hỏi.</Text>
        <FormError text={error} />
        <View style={s.chips}>
          <Button title="Lưu" small onPress={() => save()} busy={busy === "save"} />
          <Button title="Thử khóa" kind="secondary" small onPress={test} busy={busy === "test"} />
          {ai.hasKey && ai.keySource === "settings" ? (
            <Button
              title="Xóa khóa"
              kind="secondary"
              small
              onPress={async () => {
                if (await confirm("Xóa khóa API?", "Think AI sẽ ngừng trả lời cho đến khi có khóa mới.", "Xóa")) save({ apiKey: "" });
              }}
            />
          ) : null}
        </View>
        {testResult ? <Text style={[s.muted, { color: testResult.ok ? c.text2 : c.danger }]}>{testResult.ok ? `✅ ${testResult.text}` : `❌ ${testResult.text}`}</Text> : null}
      </Card>

      <SectionLabel>CUỘC GỌI: MÁY CHỦ CHUYỂN TIẾP (TURN)</SectionLabel>
      <TurnSettingsCard />
    </ScrollView>
  );
}

/* =========================================================
   Báo lỗi app: app tự gửi khi bị tắt đột ngột, lỗi màn hình, lỗi chạy ngầm
   ========================================================= */

const ERROR_KINDS: Record<string, string> = {
  crash: "App bị tắt (crash)",
  native: "Lỗi Android",
  js: "Lỗi màn hình",
  promise: "Lỗi chạy ngầm",
  anr: "App bị treo",
  web: "Lỗi trang web",
  other: "Lỗi khác",
};

function ErrorsPanel() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const version = useStore((st) => st.errorsVersion);
  const { me, users } = useStore(useShallow((st) => ({ me: st.me, users: st.users })));
  const nameOf = useMemo(() => namesOf({ me, users }).nameOf, [me, users]);
  const [data, setData] = useState<{ errors: ErrorReport[]; total: number; times: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.adminErrors());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được báo lỗi.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const remove = async (id: number) => {
    try {
      await api.deleteError(id);
      setData((d) => (d ? { ...d, errors: d.errors.filter((e) => e.id !== id), total: Math.max(0, d.total - 1) } : d));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa xóa được.");
    }
  };

  const clearAll = async () => {
    if (!(await confirm("Xóa hết báo lỗi?", "Chỉ nên xóa sau khi đã sửa xong.", "Xóa hết"))) return;
    try {
      await api.clearErrors();
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa xóa được.");
    }
  };

  const copy = async (e: ErrorReport) => {
    const text = [
      `${ERROR_KINDS[e.kind] || e.kind}${e.fatal ? " (làm tắt app)" : ""} · ${e.count} lần`,
      e.message,
      [e.device, e.osVersion, e.appVersion && `app ${e.appVersion}`, e.platform].filter(Boolean).join(" · "),
      e.where ? `Ở: ${e.where}` : "",
      e.stack || "",
    ]
      .filter(Boolean)
      .join("\n");
    await Clipboard.setStringAsync(text);
    showToast("Đã sao chép chi tiết lỗi.");
  };

  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Text style={[s.muted, { marginHorizontal: 4, marginBottom: 10 }]}>
        App tự gửi báo lỗi về đây khi bị tắt đột ngột, màn hình bị lỗi hoặc chạy ngầm bị lỗi — kể cả trên máy không có dịch vụ Google (Huawei…). Lỗi giống nhau được gộp lại.
      </Text>
      {error ? <FormError text={error} /> : null}
      {!data && !error ? <Loading /> : null}
      {data && !data.errors.length ? (
        <Card style={s.pad}>
          <Text style={[s.settingTitle, { textAlign: "center" }]}>Chưa có báo lỗi nào. App đang chạy ổn 🎉</Text>
        </Card>
      ) : null}
      {data && data.errors.length ? (
        <>
          <View style={[s.switchRow, { marginBottom: 8, marginHorizontal: 4 }]}>
            <Text style={[s.muted, { flex: 1 }]}>
              {fmtNum(data.total)} loại lỗi, xảy ra tổng cộng {fmtNum(data.times)} lần.
            </Text>
            <Button title="Xóa hết" small kind="secondary" icon="delete-sweep" onPress={clearAll} />
          </View>
          <View style={{ gap: 10 }}>
            {data.errors.map((e) => (
              <Card key={e.id} style={[s.pad, { gap: 6 }, e.fatal && { borderColor: c.danger, borderWidth: 1 }]}>
                <View style={s.switchRow}>
                  <View style={[s.tag, { backgroundColor: e.fatal ? c.dangerWash : c.turmericWash }]}>
                    <Text style={[s.tagText, { color: e.fatal ? c.danger : c.text2 }]}>{(ERROR_KINDS[e.kind] || e.kind).toUpperCase()}</Text>
                  </View>
                  <Text style={[s.muted, { flex: 1, marginLeft: 8 }]}>{e.count > 1 ? `${fmtNum(e.count)} lần` : "1 lần"}</Text>
                  <Pressable onPress={() => copy(e)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Sao chép chi tiết lỗi" style={s.errBtn}>
                    <Icon name="content-copy" size={19} color={c.muted} />
                  </Pressable>
                  <Pressable onPress={() => remove(e.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Xóa báo lỗi này" style={s.errBtn}>
                    <Icon name="close" size={21} color={c.muted} />
                  </Pressable>
                </View>
                <Text style={s.settingTitle} selectable>
                  {e.message}
                </Text>
                <Text style={s.muted}>
                  {[e.device, e.osVersion, e.platform === "web" ? null : e.appVersion && `app ${e.appVersion}`].filter(Boolean).join(" · ") || e.platform}
                </Text>
                <Text style={s.muted}>
                  Lần cuối {shortTime(e.lastAt)} {hm(e.lastAt)}
                  {e.where ? ` · ở ${e.where}` : ""}
                  {e.userIds.length ? ` · ${e.userIds.map(nameOf).join(", ")}` : ""}
                </Text>
                {e.stack ? (
                  <>
                    <Pressable onPress={() => setOpen(open === e.id ? null : e.id)} accessibilityRole="button" style={s.stackToggle}>
                      <Icon name={open === e.id ? "expand-less" : "expand-more"} size={20} color={c.accent} />
                      <Text style={[s.muted, { color: c.accent, fontWeight: "700" }]}>Chi tiết kỹ thuật</Text>
                    </Pressable>
                    {open === e.id ? (
                      <ScrollView horizontal style={[s.stack, { backgroundColor: c.field }]}>
                        <Text style={s.stackText} selectable>
                          {e.stack}
                        </Text>
                      </ScrollView>
                    ) : null}
                  </>
                ) : null}
              </Card>
            ))}
          </View>
        </>
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
    segment: { flex: 1, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4, paddingHorizontal: 4 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    errBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    stackToggle: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
    stack: { borderRadius: 10, maxHeight: 260, padding: 10 },
    stackText: { color: c.text2, fontSize: 11.5, fontFamily: "monospace", lineHeight: 16 },
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
