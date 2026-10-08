import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Fx } from "../formula/FormulaText";
import { useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { EventInfo, Message, RsvpStatus } from "../types";
import { Avatar, confirm, Icon, Sheet, useStyles } from "../ui";
import { dateBlock, eventPhase, peopleText, untilText, whenText } from "./core";
import { cancelEvent, rsvp, usePlans } from "./store";

const RSVP: { key: RsvpStatus; label: string; icon: "check" | "close" | null }[] = [
  { key: "yes", label: "Đi", icon: "check" },
  { key: "maybe", label: "Có thể", icon: null },
  { key: "no", label: "Không đi", icon: "close" },
];

const EMPTY: EventInfo = { place: "", startsAt: 0, canceled: false, yes: [], maybe: [], no: [] };

/** Thẻ kèo trong khung chat (2.16.0) — giống .keo của bản web: ô lịch, giờ, địa điểm, Đi / Có thể / Không đi, ai đi */
export function EventCard({ m, meId, accent, nameOf }: { m: Message; meId: number; accent: string; nameOf: (id: number) => string }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const users = useStore((st) => st.users);
  const isAdmin = useStore((st) => st.me?.role === "admin");
  const canCancel = m.senderId === meId || isAdmin;
  usePlans((st) => st.tick); // vẽ lại mỗi phút: "còn 25 phút" → "Đã diễn ra"
  const [people, setPeople] = useState(false);
  const ev = m.event || { ...EMPTY, startsAt: m.createdAt };
  const now = Date.now();
  const phase = eventPhase(ev, now);
  const open = phase === "upcoming" || phase === "soon";
  const mine = RSVP.find((r) => ev[r.key].includes(meId))?.key ?? null;
  const date = dateBlock(ev.startsAt);
  const when = whenText(ev.startsAt, now);
  const status = phase === "canceled" ? "Đã hủy" : phase === "past" ? "Đã diễn ra" : untilText(ev.startsAt, now);
  const who = (uid: number) => (uid === meId ? "Bạn" : nameOf(uid));
  const total = ev.yes.length + ev.maybe.length + ev.no.length;
  const line = ev.yes.length ? `${peopleText(ev.yes.map(who))} ${phase === "past" ? "đã đi" : "sẽ đi"}` : "Chưa ai chọn Đi";
  const dim = phase === "canceled" || phase === "past";

  return (
    <View style={[s.card, { backgroundColor: c.theirs, borderColor: c.line }]}>
      <View style={s.top}>
        <View style={[s.date, dim && { opacity: 0.55 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[s.wd, dim && { backgroundColor: c.muted, color: c.surface }]}>{date.wd}</Text>
          <Text style={s.day}>{date.day}</Text>
          <Text style={s.mon}>{date.month}</Text>
        </View>
        <View style={s.main}>
          <Text style={[s.title, phase === "canceled" && { textDecorationLine: "line-through", color: c.muted }]}>
            <Fx text={m.text || ""} size={16} color={phase === "canceled" ? c.muted : c.text} />
          </Text>
          <View style={s.row}>
            <Icon name="schedule" size={14} color={c.muted} />
            <Text style={s.rowText}>
              {when}
              {status ? (
                <Text
                  style={[
                    { color: c.muted },
                    phase === "soon" && { color: c.turmericInk, fontWeight: "700" },
                    phase === "canceled" && { color: c.danger, fontWeight: "700" },
                  ]}
                >
                  {"  ·  "}
                  {status}
                </Text>
              ) : null}
            </Text>
          </View>
          {ev.place ? (
            <View style={s.row}>
              <Icon name="place" size={14} color={c.muted} />
              <Text style={s.rowText}>{ev.place}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {open ? (
        <View style={s.actions} accessibilityLabel="Bạn có đi không?">
          {RSVP.map((r) => {
            const n = ev[r.key].length;
            const on = mine === r.key;
            const bg = on ? (r.key === "yes" ? accent : r.key === "maybe" ? c.turmeric : c.text2) : c.field;
            const fg = on ? (r.key === "maybe" ? "#3A2A00" : r.key === "no" ? c.surface : "#fff") : c.text;
            return (
              <Pressable
                key={r.key}
                onPress={() => rsvp(m, on ? null : r.key)}
                style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${r.label}: ${n} người${on ? ", bạn đã chọn" : ""}`}
              >
                {on && r.icon ? <Icon name={r.icon} size={15} color={fg} /> : null}
                <Text style={[s.btnText, { color: fg }]}>{r.label}</Text>
                {n ? <Text style={[s.btnCount, { color: on ? fg : c.muted }]}>{n}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {total && phase !== "canceled" ? (
        <Pressable onPress={() => setPeople(true)} style={s.who} accessibilityRole="button" accessibilityLabel={`${line}. Chạm để xem ai đi, ai không`}>
          {ev.yes.length ? (
            <View style={s.faces}>
              {ev.yes.slice(0, 4).map((uid) => (
                <View key={uid} style={[s.face, { borderColor: c.theirs }]}>
                  <Avatar user={users[uid]} size={20} dot={false} />
                </View>
              ))}
            </View>
          ) : null}
          <Text style={s.whoText} numberOfLines={1}>
            {line}
          </Text>
        </Pressable>
      ) : null}

      {open && canCancel ? (
        <Pressable
          onPress={async () => {
            if (await confirm("Hủy kèo?", `Những ai đã chọn Đi / Có thể sẽ nhận được thông báo kèo “${m.text}” bị hủy.`, "Hủy kèo")) cancelEvent(m);
          }}
          hitSlop={8}
          style={{ alignSelf: "flex-start" }}
          accessibilityRole="button"
        >
          <Text style={[s.cancel, { color: c.danger }]}>Hủy kèo</Text>
        </Pressable>
      ) : null}

      <Sheet visible={people} onClose={() => setPeople(false)} title={m.text || "Kèo"}>
        {RSVP.map((r) =>
          ev[r.key].length ? (
            <View key={r.key} style={{ gap: 6 }}>
              <Text style={s.peopleHead}>
                {r.label} · {ev[r.key].length}
              </Text>
              {ev[r.key].map((uid) => (
                <View key={uid} style={s.person}>
                  <Avatar user={users[uid]} size={34} dot={false} />
                  <Text style={s.personName}>{who(uid)}</Text>
                </View>
              ))}
            </View>
          ) : null,
        )}
      </Sheet>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { width: 300, maxWidth: "100%", borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
    top: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    date: { width: 52, borderRadius: 12, overflow: "hidden", backgroundColor: c.turmericWash, borderWidth: 1, borderColor: c.turmeric, alignItems: "stretch" },
    wd: { backgroundColor: c.turmeric, color: "#3A2A00", fontSize: 11.5, fontWeight: "800", textAlign: "center", paddingVertical: 2 },
    day: { color: c.turmericInk, fontSize: 22, fontWeight: "800", lineHeight: 26, textAlign: "center", paddingTop: 2 },
    mon: { color: c.turmericInk, fontSize: 11, fontWeight: "700", textAlign: "center", paddingBottom: 4 },
    main: { flex: 1, gap: 3 },
    title: { color: c.text, fontSize: 16, fontWeight: "800", lineHeight: 21 },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
    rowText: { flex: 1, color: c.text2, fontSize: 13, lineHeight: 17 },
    actions: { flexDirection: "row", gap: 6 },
    btn: { flex: 1, minHeight: 38, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4 },
    btnText: { fontSize: 13.5, fontWeight: "700" },
    btnCount: { fontSize: 13.5, fontWeight: "800" },
    who: { flexDirection: "row", alignItems: "center", gap: 8 },
    faces: { flexDirection: "row", paddingLeft: 6 },
    face: { marginLeft: -6, borderRadius: 12, borderWidth: 2 },
    whoText: { flex: 1, color: c.text2, fontSize: 12.5 },
    cancel: { fontSize: 12.5, fontWeight: "700", paddingVertical: 2 },
    peopleHead: { color: c.muted, fontSize: 12.5, fontWeight: "800", marginTop: 4 },
    person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 },
    personName: { color: c.text, fontSize: 15.5, fontWeight: "600" },
  });
