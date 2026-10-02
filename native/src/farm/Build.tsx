import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import type { Colors } from "../theme";
import { Sheet, useStyles } from "../ui";
import { Emo } from "./Emo";
import { fmt, longLeft, minutes, slotDeal } from "./logic";
import { Chip, FButton, Note, pointOf, useFarmColors } from "./parts";
import { act, busyKey, itemOf, useFarm } from "./store";
import type { Building, Farm, QueueItem } from "./types";

// Chế biến: chuồng trại, xưởng, bếp, quầy nước… mỗi nơi là một quầy có mái che sọc, làm lần lượt từng món theo hàng chờ

/** Mái che sọc viền vỏ sò */
const Awning = memo(function Awning({ a, b }: { a: string; b: string }) {
  const [w, setW] = useState(0);
  const n = Math.ceil(w / 18);
  return (
    <View style={styles.awning} onLayout={(e) => setW(e.nativeEvent.layout.width)} pointerEvents="none">
      {Array.from({ length: n }, (_, k) => (
        <View key={k} style={[styles.scallop, { backgroundColor: k % 2 ? b : a }]} />
      ))}
    </View>
  );
});

/** Vòng tiến độ quanh món đang làm */
function Ring({ p, color, track }: { p: number; color: string; track: string }) {
  const r = 21;
  const len = 2 * Math.PI * r;
  return (
    <Svg width={48} height={48} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={24} cy={24} r={r} stroke={track} strokeWidth={3} fill="none" />
      <Circle
        cx={24}
        cy={24}
        r={r}
        stroke={color}
        strokeWidth={3}
        fill="none"
        strokeDasharray={`${len} ${len}`}
        strokeDashoffset={len * (1 - Math.max(0, Math.min(1, p)))}
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
      />
    </Svg>
  );
}

function Slot({ x, t, bid, onEmpty }: { x: QueueItem | undefined; t: number; bid: string; onEmpty: () => void }) {
  const { c, f } = useFarmColors();
  const s = useStyles(makeStyles);
  const items = useFarm((st) => st.items);
  const it = x ? itemOf({ items }, x.id) : null;
  if (!x || !it) {
    return (
      <Pressable onPress={onEmpty} style={[s.slot, s.slotEmpty]} accessibilityRole="button" accessibilityLabel="Chỗ trống, bấm để làm món">
        <Text style={s.slotPlus}>+</Text>
      </Pressable>
    );
  }
  if (x.e <= t) {
    return (
      <Pressable
        onPress={(e) => act("collect", { building: bid }, pointOf(e))}
        style={[s.slot, { backgroundColor: c.turmericWash, borderWidth: 2, borderColor: c.turmeric }]}
        accessibilityRole="button"
        accessibilityLabel={`${it.name} đã xong, bấm để lấy`}
      >
        <Emo ch={it.emoji} size={30} />
        <View style={[s.check, { backgroundColor: c.jade }]}>
          <Text style={s.checkText}>✓</Text>
        </View>
      </Pressable>
    );
  }
  if (x.s <= t) {
    return (
      <View style={s.slot} accessible accessibilityRole="image" accessibilityLabel={`Đang làm ${it.name}`}>
        <Ring p={(t - x.s) / Math.max(1, x.e - x.s)} color={c.jade} track={c.line} />
        <Emo ch={it.emoji} size={28} />
      </View>
    );
  }
  return (
    <View style={s.slot} accessible accessibilityRole="image" accessibilityLabel={`${it.name} đang chờ`}>
      <Emo ch={it.emoji} size={28} dim />
      <View style={[s.waitDot, { backgroundColor: f.soilLine }]} />
    </View>
  );
}

function Stall({ b, t, onRecipes }: { b: Building; t: number; onRecipes: (bid: string) => void }) {
  const { c } = useFarmColors();
  const s = useStyles(makeStyles);
  const farm = useFarm((st) => st.farm) as Farm;
  const cat = useFarm((st) => st.cat);
  const busy = useFarm((st) => st.busy);
  const items = useFarm((st) => st.items);
  const own = farm.buildings[b.id];
  if (!own) {
    const locked = farm.level < b.level;
    return (
      <View style={s.stall}>
        <Awning a={c.line} b={c.field} />
        <View style={s.head}>
          <Emo ch={b.emoji} size={42} dim={locked} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{b.name}</Text>
            <Text style={s.desc}>{b.desc}</Text>
          </View>
        </View>
        <View style={s.actions}>
          {locked ? (
            <Chip emoji="🔒" text={`Mở ở cấp ${b.level}`} />
          ) : (
            <FButton
              emoji="🔨"
              small
              title={`Xây · ${fmt(b.cost)} xu`}
              disabled={farm.coins < b.cost}
              busy={Boolean(busy[busyKey("build", { building: b.id })])}
              onPress={(e) => act("build", { building: b.id }, pointOf(e))}
            />
          )}
        </View>
      </View>
    );
  }
  const done = own.q.filter((x) => x.e <= t).length;
  const working = own.q.find((x) => x.s <= t && x.e > t);
  const slot = cat ? slotDeal(farm, cat, b.id) : null;
  const slots = Array.from({ length: own.slots }, (_, k) => own.q[k]);
  return (
    <View style={s.stall}>
      <Awning a={c.jade} b={c.scheme === "dark" ? "#D5E2DC" : "#FFFFFF"} />
      <View style={s.head}>
        <Emo ch={b.emoji} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{b.name}</Text>
          <Text style={s.desc}>{b.desc}</Text>
        </View>
      </View>
      <View style={s.queue}>
        {slots.map((x, k) => (
          <Slot key={x ? `${x.id}-${x.s}` : `e${k}`} x={x} t={t} bid={b.id} onEmpty={() => onRecipes(b.id)} />
        ))}
      </View>
      <Text style={s.time}>
        {working
          ? `Đang làm ${(items[working.id]?.name || working.id).toLowerCase()}, còn ${longLeft(working.e - t)}`
          : done
            ? `${done} món đã xong, bấm để lấy`
            : "Đang rảnh"}
      </Text>
      <View style={s.actions}>
        {done ? (
          <FButton
            kind="gold"
            small
            emoji="🧺"
            title={`Lấy hàng (${done})`}
            busy={Boolean(busy[busyKey("collect", { building: b.id })])}
            onPress={(e) => act("collect", { building: b.id }, pointOf(e))}
          />
        ) : null}
        <FButton small title="Làm món" onPress={() => onRecipes(b.id)} />
        {slot != null ? (
          <FButton
            kind="ghost"
            small
            title={`+1 chỗ · ${fmt(slot)} xu`}
            disabled={farm.coins < slot}
            busy={Boolean(busy[busyKey("addSlot", { building: b.id })])}
            onPress={(e) => act("addSlot", { building: b.id }, pointOf(e))}
          />
        ) : null}
      </View>
    </View>
  );
}

export function BuildView({ t, onRecipes }: { t: number; onRecipes: (bid: string) => void }) {
  const cat = useFarm((st) => st.cat);
  const farm = useFarm((st) => st.farm) as Farm;
  const busy = useFarm((st) => Boolean(st.busy[busyKey("collect", { building: "all" })]));
  if (!cat) return null;
  const doneAll = Object.values(farm.buildings).reduce((a, b) => a + b.q.filter((x) => x.e <= t).length, 0);
  return (
    <View style={{ gap: 14 }}>
      {doneAll > 1 ? (
        <FButton kind="gold" emoji="🧺" title={`Lấy hết ${doneAll} món đã xong`} busy={busy} onPress={(e) => act("collect", { building: "all" }, pointOf(e))} />
      ) : null}
      {cat.buildings.map((b) => (
        <Stall key={b.id} b={b} t={t} onRecipes={onRecipes} />
      ))}
      <Note>Mỗi nơi làm lần lượt từng món theo hàng chờ. Món làm xong cần lấy về kho; thêm chỗ để xếp được nhiều món hơn.</Note>
    </View>
  );
}

/* ---------------- Bảng công thức ---------------- */

export function RecipeSheet({ bid, onClose }: { bid: string | null; onClose: () => void }) {
  const { c } = useFarmColors();
  const s = useStyles(makeStyles);
  const cat = useFarm((st) => st.cat);
  const farm = useFarm((st) => st.farm);
  const busy = useFarm((st) => st.busy);
  const b = bid && cat ? cat.buildings.find((x) => x.id === bid) : null;
  const own = b && farm ? farm.buildings[b.id] : null;
  return (
    <Sheet visible={Boolean(b && own)} onClose={onClose} title={b?.name || ""}>
      {b && own && farm && cat ? (
        <>
          <Note>
            {own.q.length >= own.slots
              ? `Hàng chờ đã đầy (${own.slots} chỗ). Chờ món xong rồi lấy hàng, hoặc thêm chỗ.`
              : `Còn ${own.slots - own.q.length} chỗ trong hàng chờ.`}
          </Note>
          {cat.products
            .filter((p) => p.building === b.id)
            .map((p) => {
              const locked = farm.level < p.level;
              const ins = Object.entries(p.inputs);
              const ok = ins.every(([id, q]) => (farm.inv[id] || 0) >= q);
              const full = own.q.length >= own.slots;
              return (
                <View key={p.id} style={[s.recipe, locked && { opacity: 0.55 }]}>
                  <Emo ch={p.emoji} size={40} dim={locked} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.title}>{p.name}</Text>
                    <Text style={s.desc}>{locked ? `Mở ở cấp ${p.level}` : `${minutes(p.min)} · bán ~${p.price} xu · +${p.xp} kinh nghiệm`}</Text>
                    <View style={s.needs}>
                      {ins.map(([id, q]) => {
                        const it = itemOf(useFarm.getState(), id);
                        const have = farm.inv[id] || 0;
                        const short = have < q;
                        return (
                          <View
                            key={id}
                            style={[s.need, { backgroundColor: short ? c.dangerWash : c.surface }]}
                            accessible
                            accessibilityLabel={`Cần ${q} ${it.name}, đang có ${have}`}
                          >
                            <Emo ch={it.emoji} size={18} />
                            <Text style={[s.needText, { color: short ? c.danger : c.text }]}>×{q}</Text>
                            <Text style={[s.needHave, { color: short ? c.danger : c.muted }]}>có {have}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                  <FButton
                    small
                    title="Làm"
                    label={`Làm ${p.name}`}
                    disabled={locked || !ok || full}
                    busy={Boolean(busy[busyKey("craft", { building: b.id, product: p.id })])}
                    onPress={(e) => act("craft", { building: b.id, product: p.id }, pointOf(e))}
                  />
                </View>
              );
            })}
        </>
      ) : null}
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    stall: { backgroundColor: c.surface, borderRadius: 16, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
    title: { color: c.text, fontSize: 16, fontWeight: "800" },
    desc: { color: c.muted, fontSize: 13, lineHeight: 18 },
    queue: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4 },
    slot: { width: 48, height: 48, borderRadius: 12, backgroundColor: c.field, alignItems: "center", justifyContent: "center" },
    slotEmpty: { backgroundColor: "transparent", borderWidth: 2, borderStyle: "dashed", borderColor: c.line },
    slotPlus: { color: c.muted, fontSize: 22, fontWeight: "400" },
    check: { position: "absolute", right: -5, top: -5, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
    checkText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
    waitDot: { position: "absolute", bottom: 5, width: 14, height: 3, borderRadius: 2 },
    time: { color: c.muted, fontSize: 12.5, paddingHorizontal: 14, minHeight: 18 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 },
    recipe: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.field },
    needs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    need: { flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 4, paddingRight: 8, paddingVertical: 2, borderRadius: 999 },
    needText: { fontSize: 12.5, fontWeight: "700" },
    needHave: { fontSize: 11.5, fontWeight: "600" },
  });

const styles = StyleSheet.create({
  awning: { height: 14, flexDirection: "row", overflow: "hidden" },
  scallop: { width: 18, height: 14, borderBottomLeftRadius: 9, borderBottomRightRadius: 9 },
});
