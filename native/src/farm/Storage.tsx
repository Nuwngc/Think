import { StyleSheet, Text, useWindowDimensions, View } from "react-native";

import type { Colors } from "../theme";
import { confirm, useStyles } from "../ui";
import { Emo } from "./Emo";
import { fmt, neededByOrders, storageDeal } from "./logic";
import { Chip, FButton, H2, Meter, Note, Panel, farmPalette, pointOf } from "./parts";
import { act, busyKey, itemOf, useFarm } from "./store";
import type { Farm, Item } from "./types";

// Kho: sức chứa, giá chợ hôm nay (món hot), bán hàng; cửa hàng (chó giữ vườn, đồ trang trí)

const KINDS: [Item["kind"], string][] = [
  ["food", "Món ăn, thức uống"],
  ["goods", "Nguyên liệu"],
  ["animal", "Chăn nuôi"],
  ["feed", "Thức ăn cho vật nuôi"],
  ["crop", "Nông sản"],
];

function StockRow({ id, n, need, first, narrow }: { id: string; n: number; need: number; first: boolean; narrow: boolean }) {
  const s = useStyles(makeStyles);
  const items = useFarm((st) => st.items);
  const market = useFarm((st) => st.market);
  const busy = useFarm((st) => st.busy);
  const it = itemOf({ items }, id);
  const pr = market?.prices[id] || { price: it.price, trend: 0 };
  const hot = market?.hot === id;
  const buttons = (
    <View style={[s.sell, narrow && { marginTop: 6 }]}>
      <FButton
        kind="soft"
        small
        title="Bán 1"
        label={`Bán 1 ${it.name}`}
        busy={Boolean(busy[busyKey("sell", { item: id, qty: 1 })])}
        onPress={(e) => act("sell", { item: id, qty: 1 }, pointOf(e))}
      />
      {n > 1 ? (
        <FButton
          small
          title={`Bán hết · ${fmt(pr.price * n)}`}
          label={`Bán hết ${n} ${it.name}`}
          busy={Boolean(busy[busyKey("sell", { item: id, qty: n })])}
          onPress={async (e) => {
            const at = pointOf(e);
            if (need && !(await confirm("Vẫn bán hết?", `Đơn hàng đang cần ${need} ${it.name.toLowerCase()}.`, "Bán hết", false))) return;
            act("sell", { item: id, qty: n }, at);
          }}
        />
      ) : null}
    </View>
  );
  return (
    <View style={[s.row, !first && s.rowLine]}>
      <Emo ch={it.emoji} size={34} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.name} numberOfLines={1}>
          {it.name} <Text style={s.count}>×{n}</Text>
        </Text>
        <Text style={s.sub}>
          {fmt(pr.price)} xu/cái
          {pr.trend ? (
            <Text style={pr.trend > 0 ? s.up : s.down} accessibilityLabel={pr.trend > 0 ? "giá tăng" : "giá giảm"}>
              {pr.trend > 0 ? " ▲" : " ▼"}
            </Text>
          ) : null}
          {hot ? <Text style={s.up}> · đang hot</Text> : null}
          {need ? <Text style={s.need}> · đơn hàng cần {need}</Text> : null}
        </Text>
        {narrow ? buttons : null}
      </View>
      {narrow ? null : buttons}
    </View>
  );
}

function Deal({
  emoji,
  title,
  text,
  state,
  level,
  cost,
  busy,
  onBuy,
  width,
}: {
  emoji: string;
  title: string;
  text: string;
  state: "owned" | "locked" | "open";
  level: number;
  cost: number;
  busy: boolean;
  onBuy: (e: Parameters<typeof pointOf>[0]) => void;
  width: number;
}) {
  const s = useStyles(makeStyles);
  const coins = useFarm((st) => st.farm?.coins ?? 0);
  return (
    <View style={[s.deal, { width }, state === "owned" && s.dealOwned]}>
      <Emo ch={emoji} size={44} dim={state === "locked"} />
      <Text style={s.dealTitle}>{title}</Text>
      <Text style={s.dealText}>{text}</Text>
      {state === "owned" ? (
        <Chip text="Đã có" style={{ alignSelf: "center" }} />
      ) : state === "locked" ? (
        <Chip emoji="🔒" text={`Cấp ${level}`} style={{ alignSelf: "center" }} />
      ) : (
        <FButton small title={`${fmt(cost)} xu`} label={`Mua ${title}, ${fmt(cost)} xu`} disabled={coins < cost} busy={busy} onPress={onBuy} />
      )}
    </View>
  );
}

export function StorageView({ t }: { t: number }) {
  const s = useStyles(makeStyles);
  const farm = useFarm((st) => st.farm) as Farm;
  const cat = useFarm((st) => st.cat);
  const items = useFarm((st) => st.items);
  const market = useFarm((st) => st.market);
  const busy = useFarm((st) => st.busy);
  const { width } = useWindowDimensions();
  if (!cat) return null;
  const R = cat.rules;
  const pct = farm.used / Math.max(1, farm.storage);
  const capCost = storageDeal(farm, cat);
  const need = neededByOrders(farm, t);
  const hot = market ? itemOf({ items }, market.hot) : null;
  const groups = KINDS.map(([kind, label]) => {
    const rows = Object.entries(farm.inv)
      .filter(([id, n]) => n > 0 && itemOf({ items }, id).kind === kind)
      .sort((a, b) => itemOf({ items }, b[0]).price - itemOf({ items }, a[0]).price);
    return { kind, label, rows };
  }).filter((g) => g.rows.length);
  const inner = Math.min(width, 760) - 28;
  const cols = inner >= 560 ? 4 : inner >= 420 ? 3 : 2;
  const dealW = (inner - 10 * (cols - 1)) / cols;
  const meterColor = pct >= 1 ? s.crit.color : pct >= 0.85 ? s.warn.color : s.good.color;
  return (
    <View style={{ gap: 16 }}>
      <Panel style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Emo ch="📦" size={26} />
          <Text style={[s.name, { flex: 1 }]}>
            Kho: {farm.used}/{farm.storage}
          </Text>
          {capCost != null ? (
            <FButton
              kind="soft"
              small
              title={`+${R.storageStep} chỗ · ${fmt(capCost)} xu`}
              disabled={farm.coins < capCost}
              busy={Boolean(busy[busyKey("upgradeStorage")])}
              onPress={(e) => act("upgradeStorage", {}, pointOf(e))}
            />
          ) : null}
        </View>
        <Meter value={pct} color={meterColor} track={s.track.color} height={10} />
      </Panel>
      {hot ? (
        <View style={s.hot}>
          <Emo ch={hot.emoji} size={36} />
          <Text style={s.hotText}>
            <Text style={{ fontWeight: "800" }}>Hôm nay {hot.name.toLowerCase()} đang hot</Text>: bán ở chợ được giá gấp rưỡi
            {farm.level < hot.level ? ` (món này mở ở cấp ${hot.level})` : ""}. Giá các món đổi mỗi ngày.
          </Text>
        </View>
      ) : null}
      {groups.length ? (
        groups.map((g) => (
          <Panel key={g.kind}>
            <Text style={s.group}>{g.label}</Text>
            {g.rows.map(([id, n], k) => (
              <StockRow key={id} id={id} n={n} need={need[id] || 0} first={k === 0} narrow={inner < 420} />
            ))}
          </Panel>
        ))
      ) : (
        <Note>Kho đang trống. Thu hoạch ở Ruộng hoặc làm món ở mục Chế biến để có hàng bán.</Note>
      )}
      <H2 emoji="🛒">Cửa hàng</H2>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Deal
          emoji="🐕"
          title="Chó giữ vườn"
          text={`Đuổi kẻ hái trộm (${Math.round(R.dogCatch * 100)}% bắt được, phải đền ${R.dogFine} xu)`}
          state={farm.dog ? "owned" : farm.level < R.dogLevel ? "locked" : "open"}
          level={R.dogLevel}
          cost={R.dogCost}
          busy={Boolean(busy[busyKey("buyDog")])}
          onBuy={(e) => act("buyDog", {}, pointOf(e))}
          width={dealW}
        />
        {cat.decor.map((d) => (
          <Deal
            key={d.id}
            emoji={d.emoji}
            title={d.name}
            text={`Trang trí sân vườn, +${d.beauty} điểm vườn đẹp`}
            state={(farm.decor || []).includes(d.id) ? "owned" : farm.level < d.level ? "locked" : "open"}
            level={d.level}
            cost={d.cost}
            busy={Boolean(busy[busyKey("buyDecor", { decor: d.id })])}
            onBuy={(e) => act("buyDecor", { decor: d.id }, pointOf(e))}
            width={dealW}
          />
        ))}
      </View>
      <Text style={s.credit}>Hình biểu tượng: Twemoji (CC-BY 4.0). Âm thanh tự tổng hợp cho Think.</Text>
    </View>
  );
}

const makeStyles = (c: Colors) => {
  const f = farmPalette(c);
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 9 },
    rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    name: { color: c.text, fontSize: 15, fontWeight: "700" },
    count: { color: c.muted, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5 },
    up: { color: c.accent, fontWeight: "800" },
    down: { color: c.danger, fontWeight: "800" },
    need: { color: f.goldInk, fontWeight: "700" },
    sell: { flexDirection: "row", gap: 6 },
    group: { color: c.muted, fontSize: 14, fontWeight: "800", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
    hot: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.turmericWash },
    hotText: { flex: 1, color: f.goldInk, fontSize: 14, lineHeight: 20 },
    deal: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 16,
      padding: 12,
      gap: 6,
      alignItems: "center",
    },
    dealOwned: { backgroundColor: c.jadeWash, borderColor: "transparent" },
    dealTitle: { color: c.text, fontSize: 14, fontWeight: "800", textAlign: "center" },
    dealText: { color: c.muted, fontSize: 12.5, lineHeight: 17, textAlign: "center", flexGrow: 1 },
    credit: { color: c.muted, fontSize: 12, lineHeight: 18 },
    good: { color: c.meterGood },
    warn: { color: c.meterWarn },
    crit: { color: c.meterCrit },
    track: { color: c.field },
  });
};
