import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { api, type CallReport, type TurnSettings } from "../api";
import { hm } from "../format";
import { showToast } from "../store";
import { useColors, type Colors } from "../theme";
import { Button, Card, Field, FormError, Icon, Loading, useStyles } from "../ui";

/* =========================================================
   Máy chủ chuyển tiếp (TURN) cho cuộc gọi (2.11.0). Bản web: form #turn-form (fillTurnForm trong public/app.js).
   Thiếu TURN là lý do hay gặp nhất khiến cuộc gọi kẹt ở "Đang kết nối…" khi dùng 4G.
   ========================================================= */

/** Chữ kết quả một lần nối cuộc gọi — giống bản web */
export function reportResult(r: CallReport): string {
  if (r.ok) return `✅ nối được (${r.path === "relay" ? "qua TURN" : r.path === "direct" ? "đi thẳng" : "không rõ đường"})`;
  return r.local.includes("relay") ? "❌ không nối được dù có TURN" : "❌ không nối được: TURN không dùng được";
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={[s.section, { borderColor: c.line }]}>
      <Pressable onPress={onToggle} style={s.sectionHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={s.sectionTitle}>{title}</Text>
        <Icon name={open ? "expand-less" : "expand-more"} size={22} color={c.accent} />
      </Pressable>
      {open ? <View style={s.sectionBody}>{children}</View> : null}
    </View>
  );
}

export function TurnSettingsCard() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const [t, setT] = useState<TurnSettings | null>(null);
  const [form, setForm] = useState({ meteredUrl: "", turnUrls: "", turnUsername: "", turnCredential: "", cfKeyId: "", cfToken: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fill = (v: TurnSettings) => {
    setT(v);
    setForm({ meteredUrl: "", turnUrls: v.turnUrls, turnUsername: v.turnUsername, turnCredential: "", cfKeyId: v.cfKeyId, cfToken: "" });
  };
  const load = useCallback(async () => {
    try {
      fill((await api.turnSettings()).calls);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được cài đặt.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!t) {
    return error ? (
      <Card style={s.pad}>
        <FormError text={error} />
        <Button title="Thử lại" kind="secondary" small onPress={load} />
      </Card>
    ) : (
      <Loading />
    );
  }

  const save = async (body: Parameters<typeof api.saveTurnSettings>[0]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveTurnSettings(body);
      fill(res.calls);
      showToast(res.calls.sources.length ? `Đã lưu. Cuộc gọi đang dùng: ${res.calls.sources.join(", ")}.` : "Đã lưu máy chủ TURN.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa lưu được.");
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const body: Parameters<typeof api.saveTurnSettings>[0] = {
      turnUrls: form.turnUrls.trim(),
      turnUsername: form.turnUsername.trim(),
      cfKeyId: form.cfKeyId.trim(),
    };
    if (form.turnCredential) body.turnCredential = form.turnCredential;
    if (form.meteredUrl.trim()) body.meteredUrl = form.meteredUrl.trim();
    if (form.cfToken) body.cfToken = form.cfToken;
    save(body);
  };
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));
  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));
  const has = t.sources.length > 0;

  return (
    <Card style={s.pad}>
      <Text style={s.muted}>
        Tiếng và hình đi thẳng giữa các máy. Khi mạng chặn kết nối thẳng (hay gặp khi dùng 4G), cuộc gọi phải đi vòng qua một máy chủ TURN — thiếu TURN là lý do
        cuộc gọi kẹt ở &quot;Đang kết nối…&quot;. Chưa cài gì thì Think tạm dùng TURN miễn phí dùng chung; nên tạo một tài khoản TURN miễn phí riêng cho chắc
        chắn (chọn một trong ba cách dưới).
      </Text>
      <View style={s.stateRow}>
        <View style={[s.tag, { backgroundColor: has ? c.jadeWash : c.field }]}>
          <Text style={[s.tagText, { color: has ? c.accent : c.muted }]}>{has ? "Có TURN" : "Chưa có TURN"}</Text>
        </View>
        <Text style={[s.muted, { flex: 1 }]}>
          {has ? `Đang dùng: ${t.sources.join(", ")}.` : "Chưa có máy chủ TURN nào: gọi qua 4G có thể không nối được."}
        </Text>
      </View>
      {t.errors.map((e) => (
        <Text key={e} style={[s.muted, { color: c.danger }]}>
          Lỗi {e}
        </Text>
      ))}

      <Section title="Metered — 20 GB / tháng miễn phí (dễ nhất)" open={open === "metered"} onToggle={() => toggle("metered")}>
        <Text style={s.muted}>
          Đăng ký miễn phí ở metered.ca (mục STUN / TURN). Trong trang quản lý, phần TURN Server có đường link lấy TURN dạng
          https://tên.metered.live/api/v1/turn/credentials?apiKey=… — chép cả link dán vào đây.
        </Text>
        <Field
          label="Link lấy TURN"
          value={form.meteredUrl}
          onChangeText={set("meteredUrl")}
          placeholder={t.meteredHost ? `Đang dùng link của ${t.meteredHost} (để trống = giữ)` : "https://tên.metered.live/api/v1/turn/credentials?apiKey=…"}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Link lấy TURN"
        />
        {t.meteredHost ? <Button title="Bỏ link Metered" kind="ghost" small onPress={() => save({ meteredUrl: "" })} disabled={busy} /> : null}
      </Section>

      <Section title="Máy chủ TURN có tên + mật khẩu (vd ExpressTURN — 1000 GB / tháng miễn phí)" open={open === "own"} onToggle={() => toggle("own")}>
        <Text style={s.muted}>
          Đăng ký miễn phí ở expressturn.com, trang quản lý có sẵn địa chỉ máy chủ (vd relay1.expressturn.com:3478), tên đăng nhập và mật khẩu.
        </Text>
        <Field
          label="Địa chỉ TURN"
          value={form.turnUrls}
          onChangeText={set("turnUrls")}
          placeholder="turn:relay1.expressturn.com:3478"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Địa chỉ TURN"
        />
        <Field
          label="Tên đăng nhập"
          value={form.turnUsername}
          onChangeText={set("turnUsername")}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Tên đăng nhập TURN"
        />
        <Field
          label="Mật khẩu"
          value={form.turnCredential}
          onChangeText={set("turnCredential")}
          placeholder={t.hasCredential ? "Đã lưu (để trống = giữ)" : ""}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Mật khẩu TURN"
        />
      </Section>

      <Section title="Cloudflare — 1000 GB / tháng miễn phí" open={open === "cf"} onToggle={() => toggle("cf")}>
        <Text style={s.muted}>dash.cloudflare.com → Realtime → TURN Server → Create: chép Turn Token ID và API Token.</Text>
        <Field
          label="Turn Token ID"
          value={form.cfKeyId}
          onChangeText={set("cfKeyId")}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Turn Token ID"
        />
        <Field
          label="API Token"
          value={form.cfToken}
          onChangeText={set("cfToken")}
          placeholder={t.hasCfToken ? "Đã lưu (để trống = giữ)" : ""}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="API Token Cloudflare"
        />
      </Section>

      <View style={s.switchRow}>
        <Text style={s.switchText}>Dùng TURN miễn phí dùng chung (Open Relay) khi chưa có TURN riêng</Text>
        <Switch
          value={t.openRelay}
          onValueChange={(on) => save({ openRelay: on })}
          disabled={busy}
          trackColor={{ false: c.line, true: c.jadeWash }}
          thumbColor={t.openRelay ? c.jade : "#fff"}
          accessibilityLabel="Dùng Open Relay"
        />
      </View>
      <FormError text={error} />
      <View style={{ flexDirection: "row" }}>
        <Button title="Lưu" small onPress={submit} busy={busy} />
      </View>

      <Text style={s.recentTitle}>Cuộc gọi gần đây</Text>
      {t.recent.length ? (
        t.recent.slice(0, 12).map((r) => (
          <View key={`${r.at}-${r.from}-${r.to ?? 0}`} style={[s.report, { borderLeftColor: r.ok ? c.jade : c.danger }]}>
            <Text style={s.reportWho}>
              {r.fromName} → {r.toName}
              {r.kind === "group" ? " (nhóm)" : ""}
            </Text>
            <Text style={[s.reportRes, { color: r.ok ? c.text2 : c.danger }]}>{reportResult(r)}</Text>
            <Text style={s.muted}>
              {hm(r.at)} · {r.platform === "app" ? "app" : "web"} · đường thử: {r.local.join(", ") || "không có"}
            </Text>
          </View>
        ))
      ) : (
        <Text style={s.muted}>Chưa có cuộc gọi nào từ lúc máy chủ khởi động lại.</Text>
      )}
    </Card>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    pad: { padding: 16, gap: 12 },
    muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
    stateRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    tagText: { fontSize: 11, fontWeight: "800" },
    section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
    sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11, minHeight: 48 },
    sectionTitle: { flex: 1, color: c.text, fontSize: 14.5, fontWeight: "700" },
    sectionBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
    recentTitle: { color: c.text, fontSize: 15, fontWeight: "800", marginTop: 4 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    switchText: { flex: 1, color: c.text, fontSize: 14.5, fontWeight: "600" },
    report: { borderLeftWidth: 3, paddingLeft: 10, gap: 2 },
    reportWho: { color: c.text, fontSize: 14, fontWeight: "700" },
    reportRes: { fontSize: 13.5 },
  });
