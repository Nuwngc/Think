import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Fx } from "../formula/FormulaText";
import { useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Button, confirm, Field, FormError, Icon, Sheet, useStyles } from "../ui";
import { at, dayText, eventPresets, schedulePresets, untilText, whenText, type Preset } from "./core";
import { cancelScheduled, createEvent, scheduledIn, scheduleMessage, sendScheduledNow, usePlans } from "./store";

const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = 14;
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/**
 * Chọn giờ (kèo, hẹn giờ gửi): các nút giờ nhanh, hàng ngày (14 ngày tới), giờ / phút có nút − +.
 * Bản web dùng nút giờ nhanh + ô chọn ngày giờ của trình duyệt.
 */
export function WhenPicker({
  presets,
  value,
  onChange,
  defaultHour,
}: {
  presets: Preset[];
  value: number | null;
  onChange: (ts: number) => void;
  defaultHour: number;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const now = Date.now();
  const days = Array.from({ length: DAYS }, (_, i) => at(now, i, 0));
  // Chưa chọn gì mà bấm − / +: lấy mốc defaultHour sắp tới (hôm nay, đã qua thì ngày mai)
  const fallback = at(now, 0, defaultHour) > now ? at(now, 0, defaultHour) : at(now, 1, defaultHour);
  const d = value ? new Date(value) : null;
  const sameDay = (ts: number) => d != null && new Date(ts).toDateString() === d.toDateString();
  const setDay = (dayStart: number) => {
    const h = d ? d.getHours() : defaultHour;
    const m = d ? d.getMinutes() : 0;
    onChange(at(dayStart, 0, h, m));
  };
  const step = (mins: number) => onChange(value == null ? fallback : value + mins * 60000);
  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
        {presets.map((p) => {
          const on = value === p.at;
          return (
            <Pressable
              key={p.label}
              onPress={() => onChange(p.at)}
              style={[s.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.jadeWash : c.surface }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.chipTitle, on && { color: c.accent }]}>{p.label}</Text>
              <Text style={s.chipSub}>{dayText(p.at, now)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
        {days.map((ts, i) => {
          const on = sameDay(ts);
          const dt = new Date(ts);
          return (
            <Pressable
              key={ts}
              onPress={() => setDay(ts)}
              style={[s.day, { backgroundColor: on ? c.accent : c.field }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={dayText(ts, now)}
            >
              <Text style={[s.dayWd, { color: on ? "#fff" : c.muted }]}>{i === 0 ? "Nay" : i === 1 ? "Mai" : WD[dt.getDay()]}</Text>
              <Text style={[s.dayNum, { color: on ? "#fff" : c.text }]}>{dt.getDate()}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={s.timeRow}>
        <Stepper label="giờ" value={d ? pad(d.getHours()) : "--"} onMinus={() => step(-60)} onPlus={() => step(60)} />
        <Text style={s.colon}>:</Text>
        <Stepper label="phút" value={d ? pad(d.getMinutes()) : "--"} onMinus={() => step(-5)} onPlus={() => step(5)} />
      </View>
      <Text style={[s.summary, value != null && value <= now && { color: c.danger }]} accessibilityLiveRegion="polite">
        {value == null
          ? "Chọn một giờ nhanh ở trên, hoặc chọn ngày rồi giờ."
          : `${whenText(value, now)}${value > now ? ` · ${untilText(value, now)}` : " · giờ này đã qua"}`}
      </Text>
    </View>
  );
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={[s.stepper, { backgroundColor: c.field }]}>
      <Pressable onPress={onMinus} style={s.stepBtn} accessibilityRole="button" accessibilityLabel={`Bớt ${label}`} hitSlop={4}>
        <Icon name="remove" size={20} color={c.accent} />
      </Pressable>
      <Text style={s.stepValue}>{value}</Text>
      <Pressable onPress={onPlus} style={s.stepBtn} accessibilityRole="button" accessibilityLabel={`Thêm ${label}`} hitSlop={4}>
        <Icon name="add" size={20} color={c.accent} />
      </Pressable>
    </View>
  );
}

/* ---------------- Tạo kèo ---------------- */

export function EventSheet({ convId, visible, onClose }: { convId: number; visible: boolean; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [when, setWhen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => {
    if (!visible) return;
    setTitle("");
    setPlace("");
    setWhen(null);
    setError(null);
    setBusy(false);
    setPresets(eventPresets());
  }, [visible]);

  const submit = async () => {
    const t = title.trim();
    if (!t) return setError("Hãy đặt tên cho kèo.");
    if (!when) return setError("Hãy chọn giờ hẹn.");
    if (when <= Date.now() + 60000) return setError("Giờ hẹn phải sau bây giờ.");
    setBusy(true);
    setError(null);
    try {
      await createEvent(convId, { title: t, place: place.trim(), startsAt: when });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa tạo được kèo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Tạo kèo" footer={<Button title="Gửi kèo" icon="event" busy={busy} onPress={submit} />}>
      <Field
        label="Tên kèo"
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          setError(null);
        }}
        placeholder="vd: Đi ăn lẩu, đá bóng, cà phê cuối tuần"
        maxLength={100}
        accessibilityLabel="Tên kèo"
      />
      <Text style={s.label}>Thời gian</Text>
      <WhenPicker
        presets={presets}
        value={when}
        defaultHour={19}
        onChange={(ts) => {
          setWhen(ts);
          setError(null);
        }}
      />
      <Field
        label="Địa điểm (không bắt buộc)"
        value={place}
        onChangeText={setPlace}
        placeholder="vd: Quán lẩu cũ, 12 Hai Bà Trưng"
        maxLength={120}
        accessibilityLabel="Địa điểm"
      />
      <Text style={s.hint}>Trước giờ hẹn 1 tiếng, Think nhắc những ai chọn Đi hoặc Có thể.</Text>
      <FormError text={error} />
    </Sheet>
  );
}

/* ---------------- Hẹn giờ gửi tin ---------------- */

export function ScheduleSheet({
  convId,
  visible,
  prefill,
  mentions,
  onClose,
  onScheduled,
}: {
  convId: number;
  visible: boolean;
  prefill: string;
  mentions: number[];
  onClose: () => void;
  /** Đã hẹn xong (để xóa chữ trong ô nhập nếu lấy từ đó) */
  onScheduled: (text: string, sendAt: number) => void;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const [text, setText] = useState("");
  const [when, setWhen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => {
    if (!visible) return;
    setText(prefill);
    setWhen(null);
    setError(null);
    setBusy(false);
    setPresets(schedulePresets());
  }, [visible, prefill]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return setError("Hãy nhập tin nhắn muốn hẹn giờ gửi.");
    if (!when) return setError("Hãy chọn giờ gửi.");
    if (when < Date.now() + 60000) return setError("Hãy chọn giờ gửi sau bây giờ ít nhất 1 phút.");
    setBusy(true);
    setError(null);
    try {
      // @nhắc tên: chỉ người còn "@Tên" trong tin
      const users = useStore.getState().users;
      await scheduleMessage(
        convId,
        t,
        when,
        mentions.filter((id) => users[id] && t.includes(`@${users[id].displayName}`)),
      );
      onScheduled(t, when);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa hẹn giờ được.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Hẹn giờ gửi tin"
      footer={<Button title="Hẹn giờ gửi" icon="schedule-send" busy={busy} onPress={submit} />}
    >
      <Text style={s.label}>Tin nhắn</Text>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          setError(null);
        }}
        placeholder="Tin nhắn sẽ được gửi đúng giờ bạn chọn"
        placeholderTextColor={c.muted}
        multiline
        maxLength={4000}
        style={[s.textarea, { backgroundColor: c.field, color: c.text }]}
        accessibilityLabel="Tin nhắn hẹn giờ"
      />
      <Text style={s.label}>Gửi lúc</Text>
      <WhenPicker
        presets={presets}
        value={when}
        defaultHour={new Date().getHours() + 1}
        onChange={(ts) => {
          setWhen(ts);
          setError(null);
        }}
      />
      <Text style={s.hint}>Chỉ bạn thấy tin đang chờ. Đến giờ, tin được gửi như bạn tự gửi.</Text>
      <FormError text={error} />
    </Sheet>
  );
}

/** Thanh nhỏ trên ô nhập: "2 tin hẹn giờ · Gần nhất 20:00 hôm nay" */
export function ScheduledBar({ convId, onPress }: { convId: number; onPress: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const all = usePlans((st) => st.scheduled);
  usePlans((st) => st.tick);
  const list = scheduledIn(all, convId);
  if (!list.length) return null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.bar, { borderTopColor: c.line, backgroundColor: pressed ? c.field : c.surface }]}
      accessibilityRole="button"
      accessibilityLabel={`${list.length} tin hẹn giờ. Xem`}
    >
      <Icon name="schedule-send" size={20} color={c.accent} />
      <Text style={s.barText} numberOfLines={1}>
        <Text style={{ fontWeight: "800", color: c.text }}>{list.length > 1 ? `${list.length} tin hẹn giờ` : "Tin hẹn giờ"}</Text>
        {"  "}
        {list.length > 1 ? "Gần nhất " : ""}
        {whenText(list[0].sendAt)}
      </Text>
      <Text style={[s.barSee, { color: c.accent }]}>Xem</Text>
    </Pressable>
  );
}

export function ScheduledSheet({ convId, visible, onClose }: { convId: number; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const all = usePlans((st) => st.scheduled);
  usePlans((st) => st.tick);
  const list = scheduledIn(all, convId);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    if (visible && !list.length) onClose(); // hết tin chờ thì đóng
  }, [visible, list.length, onClose]);
  const run = async (id: number, fn: (id: number) => Promise<void>) => {
    setBusy(id);
    await fn(id);
    setBusy(null);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Tin đang chờ gửi">
      {list.map((x) => (
        <View key={x.id} style={[s.item, { backgroundColor: c.field }]}>
          <View style={s.itemWhen}>
            <Icon name="schedule" size={15} color={c.accent} />
            <Text style={[s.itemWhenText, { color: c.accent }]}>
              {whenText(x.sendAt)} · {untilText(x.sendAt) || "đang gửi…"}
            </Text>
          </View>
          <Text style={s.itemText} numberOfLines={5}>
            <Fx text={x.text} size={15} color={c.text} />
          </Text>
          <View style={s.itemActions}>
            <Button title="Gửi ngay" small kind="secondary" busy={busy === x.id} onPress={() => run(x.id, sendScheduledNow)} />
            <Button
              title="Hủy"
              small
              kind="danger"
              onPress={async () => {
                if (await confirm("Hủy tin hẹn giờ?", "Tin sẽ không được gửi.", "Hủy tin")) run(x.id, cancelScheduled);
              }}
            />
          </View>
        </View>
      ))}
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    label: { color: c.text2, fontSize: 13.5, fontWeight: "700", marginTop: 4 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 18 },
    textarea: {
      minHeight: 90,
      maxHeight: 180,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 16,
      textAlignVertical: "top",
    },
    chips: { gap: 6, paddingRight: 8 },
    chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 1 },
    chipTitle: { color: c.text, fontSize: 13.5, fontWeight: "800" },
    chipSub: { color: c.muted, fontSize: 11.5 },
    day: { width: 46, borderRadius: 12, paddingVertical: 6, alignItems: "center", gap: 1 },
    dayWd: { fontSize: 11, fontWeight: "700" },
    dayNum: { fontSize: 17, fontWeight: "800" },
    timeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    colon: { color: c.text, fontSize: 22, fontWeight: "800" },
    stepper: { flexDirection: "row", alignItems: "center", borderRadius: 12 },
    stepBtn: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
    stepValue: { minWidth: 34, textAlign: "center", color: c.text, fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] },
    summary: { color: c.accent, fontSize: 13.5, fontWeight: "700" },
    bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
    barText: { flex: 1, color: c.muted, fontSize: 13 },
    barSee: { fontSize: 13, fontWeight: "800" },
    item: { borderRadius: 14, padding: 12, gap: 6 },
    itemWhen: { flexDirection: "row", alignItems: "center", gap: 6 },
    itemWhenText: { fontSize: 12.5, fontWeight: "800" },
    itemText: { color: c.text, fontSize: 15, lineHeight: 20 },
    itemActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  });
