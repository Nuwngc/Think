import { StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useColors, type Colors } from "../theme";
import { useStyles } from "../ui";
import { Emo } from "./Emo";
import { clockText, fmt } from "./logic";
import { FButton, Note, farmPalette, pointOf } from "./parts";
import { act, busyKey, itemOf, useFarm } from "./store";
import type { Farm, Order } from "./types";

// Đơn hàng: phiếu giấy kraft ghim trên bảng, khách đặt mua nông sản / món ăn

/** Đường kẻ đứt trên phiếu (viền nét đứt của Android không vẽ được một cạnh) */
function Dashes({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 4, overflow: "hidden", height: 1 }} pointerEvents="none">
      {Array.from({ length: 60 }, (_, k) => (
        <View key={k} style={{ width: 5, height: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}

function Ticket({ o, t, k, width }: { o: Order; t: number; k: number; width: number }) {
  const s = useStyles(makeStyles);
  const farm = useFarm((st) => st.farm) as Farm;
  const cat = useFarm((st) => st.cat);
  const items = useFarm((st) => st.items);
  const busy = useFarm((st) => st.busy);
  const tilt = k % 3 === 0 ? "-0.6deg" : k % 3 === 1 ? "0.5deg" : "0deg";
  const kraftLine = farmPalette(useColors()).kraftLine;
  const who = cat?.customers[o.who] || { name: "Khách", emoji: "🧑" };
  if (o.at > t) {
    return (
      <View style={[s.ticket, s.wait, { width, transform: [{ rotate: tilt }] }]} accessible accessibilityLabel={`Khách đang tới, còn ${clockText(o.at - t)}`}>
        <View style={s.pin} />
        <View style={s.who}>
          <Emo ch="⏳" size={30} />
          <Text style={s.whoText}>Khách đang tới</Text>
        </View>
        <Dashes color={kraftLine} />
        <View style={{ alignItems: "center", paddingVertical: 10 }}>
          <Text style={[s.lineText, { flex: 0, fontWeight: "800", fontVariant: ["tabular-nums"] }]}>{clockText(o.at - t)}</Text>
        </View>
        <Dashes color={kraftLine} />
      </View>
    );
  }
  const ok = o.items.every(([id, q]) => (farm.inv[id] || 0) >= q);
  return (
    <View style={[s.ticket, { width, transform: [{ rotate: tilt }] }]} accessibilityLabel={`Đơn của ${who.name}`}>
      <View style={s.pin} />
      <View style={s.who}>
        <Emo ch={who.emoji} size={32} />
        <Text style={s.whoText}>{who.name}</Text>
      </View>
      <Dashes color={kraftLine} />
      <View style={s.lines}>
        {o.items.map(([id, q]) => {
          const it = itemOf({ items }, id);
          const n = farm.inv[id] || 0;
          return (
            <View key={id} style={s.line} accessible accessibilityLabel={`${it.name}: cần ${q}, có ${n}`}>
              <Emo ch={it.emoji} size={26} />
              <Text style={s.lineText} numberOfLines={1}>
                {it.name}
              </Text>
              <Text style={[s.lineCount, n >= q ? s.ok : s.short]}>
                {Math.min(n, q)}/{q}
                {n >= q ? " ✓" : ""}
              </Text>
            </View>
          );
        })}
      </View>
      <Dashes color={kraftLine} />
      <View style={s.reward}>
        <Emo ch="🪙" size={20} />
        <Text style={s.rewardText}>{fmt(o.coins)}</Text>
        <Emo ch="⭐" size={20} style={{ marginLeft: 8 }} />
        <Text style={s.rewardText}>{o.xp}</Text>
      </View>
      <View style={s.actions}>
        <FButton
          grow
          title="Giao hàng"
          disabled={!ok}
          busy={Boolean(busy[busyKey("deliver", { order: o.id })])}
          onPress={(e) => act("deliver", { order: o.id }, pointOf(e))}
        />
        <FButton
          kind="ghost"
          emoji="🗑️"
          label={`Đổi đơn của ${who.name} (khách mới tới sau 3 phút)`}
          busy={Boolean(busy[busyKey("discard", { order: o.id })])}
          onPress={() => act("discard", { order: o.id })}
        />
      </View>
    </View>
  );
}

export function OrdersView({ t }: { t: number }) {
  const farm = useFarm((st) => st.farm) as Farm;
  const { width } = useWindowDimensions();
  // Màn rộng (máy tính bảng, xoay ngang): 2 cột phiếu
  const inner = Math.min(width, 760) - 28;
  const cols = inner >= 520 ? 2 : 1;
  const w = cols === 2 ? (inner - 14) / 2 : inner;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, paddingTop: 6 }}>
        {farm.orders.map((o, k) => (
          <Ticket key={o.id} o={o} t={t} k={k} width={w} />
        ))}
      </View>
      <Note>Giao đơn được nhiều xu hơn bán ở chợ, kèm kinh nghiệm. Đơn khó quá thì bấm thùng rác để đổi đơn khác, khách mới tới sau 3 phút.</Note>
    </View>
  );
}

const makeStyles = (c: Colors) => {
  const f = farmPalette(c);
  return StyleSheet.create({
    ticket: {
      backgroundColor: f.kraft,
      borderTopLeftRadius: 6,
      borderTopRightRadius: 6,
      borderBottomLeftRadius: 14,
      borderBottomRightRadius: 14,
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 12,
      gap: 10,
      borderBottomWidth: 2,
      borderBottomColor: f.kraftLine,
    },
    wait: { opacity: 0.75 },
    pin: {
      position: "absolute",
      top: -6,
      alignSelf: "center",
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: f.pin,
      borderBottomWidth: 2,
      borderBottomColor: "rgba(0,0,0,0.2)",
    },
    who: { flexDirection: "row", alignItems: "center", gap: 8 },
    whoText: { color: f.kraftInk, fontSize: 15, fontWeight: "800" },
    lines: { gap: 6 },
    line: { flexDirection: "row", alignItems: "center", gap: 8 },
    lineText: { flex: 1, color: f.kraftInk, fontSize: 14 },
    lineCount: { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
    ok: { color: c.accent },
    short: { color: c.danger },
    reward: { flexDirection: "row", alignItems: "center", gap: 4 },
    rewardText: { color: f.kraftInk, fontSize: 15, fontWeight: "800" },
    actions: { flexDirection: "row", gap: 8 },
  });
};
