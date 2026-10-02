import { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import type { Colors } from "../theme";
import { Button, Sheet, useStyles } from "../ui";
import { Emo } from "./Emo";
import { fmt, growth, longLeft, minutes, unlockOf } from "./logic";
import { Meter, Note, farmPalette, pointOf, useFarmColors, useReducedMotion } from "./parts";
import { act, dismissLevelUp, setNotify, setPlantAll, setSound, useFarm } from "./store";

// Các bảng trượt của Nông trại: gieo hạt, thông tin ô đất, lên cấp, cách chơi

/** plot: ô vừa bấm; null = gieo mọi ô trống; undefined = đóng */
export function SeedSheet({ plot, onClose }: { plot: number | null | undefined; onClose: () => void }) {
  const { c } = useFarmColors();
  const s = useStyles(makeStyles);
  const farm = useFarm((st) => st.farm);
  const cat = useFarm((st) => st.cat);
  const plantAll = useFarm((st) => st.plantAll);
  const empties = farm ? farm.plots.map((p, i) => (p.c ? -1 : i)).filter((i) => i >= 0) : [];
  const open = plot !== undefined && Boolean(farm && cat) && empties.length > 0;
  const all = plot == null || plantAll;
  return (
    <Sheet visible={open} onClose={onClose} title="Gieo hạt">
      {open && farm && cat ? (
        <>
          {plot == null ? (
            <Note>Gieo cùng một loại cây cho {empties.length} ô trống.</Note>
          ) : empties.length > 1 ? (
            <Pressable style={s.toggle} onPress={() => setPlantAll(!plantAll)} accessibilityRole="switch" accessibilityState={{ checked: plantAll }}>
              <Text style={s.toggleText}>Gieo cho cả {empties.length} ô trống</Text>
              <Switch
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                value={plantAll}
                onValueChange={setPlantAll}
                trackColor={{ true: c.jade, false: c.line }}
                thumbColor={Platform.OS === "android" ? (plantAll ? "#FFFFFF" : "#F4F4F4") : undefined}
              />
            </Pressable>
          ) : null}
          {cat.crops.map((cr) => {
            const locked = farm.level < cr.level;
            const poor = cr.seed > farm.coins;
            return (
              <Pressable
                key={cr.id}
                disabled={locked || poor}
                onPress={(e) => {
                  const plots = all ? empties : [plot as number];
                  const at = pointOf(e);
                  onClose();
                  act("plant", { plots, crop: cr.id }, at);
                }}
                style={({ pressed }) => [s.seed, (locked || poor) && { opacity: 0.5 }, pressed && { backgroundColor: c.jadeWash }]}
                accessibilityRole="button"
                accessibilityState={{ disabled: locked || poor }}
                accessibilityLabel={`${cr.name}. ${locked ? `Mở ở cấp ${cr.level}` : `${minutes(cr.min)}, thu ${cr.yield}, hạt ${cr.seed ? `${cr.seed} xu` : "miễn phí"}`}`}
              >
                <Emo ch={cr.emoji} size={38} dim={locked} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.seedName}>{cr.name}</Text>
                  <Text style={s.seedSub}>{locked ? `Mở ở cấp ${cr.level}` : `${minutes(cr.min)} · thu ${cr.yield} · bán ~${cr.price} xu/cái`}</Text>
                </View>
                <View style={s.cost}>
                  {locked ? (
                    <Emo ch="🔒" size={18} />
                  ) : cr.seed ? (
                    <>
                      <Emo ch="🪙" size={18} />
                      <Text style={s.costText}>{cr.seed}</Text>
                    </>
                  ) : (
                    <Text style={s.costText}>Miễn phí</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
          <Note>Cây ngắn ngày hợp lúc đang chơi; cây lâu ngày (dưa hấu, bơ, cà phê, xoài) gieo trước khi đi ngủ là vừa.</Note>
        </>
      ) : null}
    </Sheet>
  );
}

/** Cây đang lớn: còn bao lâu, được bao nhiêu */
export function PlotInfoSheet({ plot, t, onClose }: { plot: number | null; t: number; onClose: () => void }) {
  const { c } = useFarmColors();
  const s = useStyles(makeStyles);
  const farm = useFarm((st) => st.farm);
  const items = useFarm((st) => st.items);
  const pl = plot != null && farm ? farm.plots[plot] : null;
  const crop = pl?.c ? items[pl.c] : null;
  const yieldOf = pl?.c ? useFarm.getState().cat?.crops.find((x) => x.id === pl.c)?.yield : null;
  // Cây vừa chín / vừa thu hoạch: đóng bảng
  useEffect(() => {
    if (plot != null && (!pl || !pl.c || pl.r <= t)) onClose();
  }, [plot, pl, t, onClose]);
  const g = pl ? growth(pl, t) : null;
  return (
    <Sheet visible={Boolean(pl && crop)} onClose={onClose} title={crop?.name || ""}>
      {pl && crop && g ? (
        <>
          <View style={s.infoTop}>
            <Emo ch={crop.emoji} size={44} />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={s.seedName}>Còn {longLeft(pl.r - t)} nữa chín</Text>
              <Meter value={g.p} color={c.meterGood} track={c.field} />
            </View>
          </View>
          <Bullet
            emoji="🧺"
            text={`Thu được ${yieldOf ?? 2} ${crop.name.toLowerCase()} (thỉnh thoảng được mùa thêm 1), bán khoảng ${crop.price} xu mỗi cái.`}
          />
          <Bullet emoji="🐛" text="Cây lâu ngày có thể bị sâu: bấm vào con sâu để bắt, không thì mất 1 sản phẩm. Bạn bè ghé vườn cũng bắt giúp được." />
          <Bullet emoji="😤" text="Cây chín mà để lâu, bạn bè ghé chơi có thể hái trộm 1 sản phẩm mỗi ô. Nuôi chó giữ vườn để đuổi kẻ trộm." />
        </>
      ) : null}
    </Sheet>
  );
}

function Bullet({ emoji, text }: { emoji: string; text: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.bullet}>
      <Emo ch={emoji} size={26} />
      <Text style={s.bulletText}>{text}</Text>
    </View>
  );
}

/** Lên cấp: thưởng xu, thứ vừa mở khóa */
export function LevelUpSheet() {
  const s = useStyles(makeStyles);
  const ups = useFarm((st) => st.levelUps);
  const cat = useFarm((st) => st.cat);
  const items = useFarm((st) => st.items);
  const reduce = useReducedMotion();
  const pop = useRef(new Animated.Value(0)).current;
  const open = Boolean(ups && ups.length && cat);
  useEffect(() => {
    if (!open) return;
    pop.setValue(reduce ? 1 : 0);
    if (!reduce) Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: Platform.OS !== "web" }).start();
  }, [open, reduce, pop]);
  const last = ups && ups.length ? ups[ups.length - 1] : null;
  const coins = (ups || []).reduce((a, u) => a + u.coins, 0);
  const unlocks = (ups || []).flatMap((u) => u.unlocks);
  return (
    <Sheet visible={open} onClose={dismissLevelUp} title="Lên cấp!" footer={open ? <Button title="Tuyệt!" onPress={dismissLevelUp} /> : null}>
      {open && last && cat ? (
        <View style={s.levelUp} accessibilityLiveRegion="polite">
          <Animated.View
            style={{
              transform: [
                { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
                { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ["-20deg", "0deg"] }) },
              ],
              opacity: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
            }}
          >
            <Emo ch="🎉" size={72} />
          </Animated.View>
          <Text style={s.levelTitle}>Cấp {last.level}</Text>
          <Text style={s.levelText}>
            Thưởng <Text style={{ fontWeight: "800" }}>{fmt(coins)} xu</Text>.
          </Text>
          {unlocks.length ? (
            <>
              <Note>Vừa mở khóa:</Note>
              <View style={s.unlocks}>
                {unlocks.map((id) => {
                  const u = unlockOf(cat, items, id);
                  return (
                    <View key={id} style={s.unlock}>
                      <Emo ch={u.emoji} size={40} />
                      <Text style={s.unlockText} numberOfLines={2}>
                        {u.name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}

/** Cách chơi + tùy chọn âm thanh, thông báo */
export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { c } = useFarmColors();
  const s = useStyles(makeStyles);
  const sound = useFarm((st) => st.sound);
  const notify = useFarm((st) => st.notify);
  const row = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <Pressable style={s.toggle} onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label}>
      <View style={{ flex: 1 }}>
        <Text style={s.toggleText}>{label}</Text>
        {hint ? <Text style={s.seedSub}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.jade, false: c.line }}
        thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
      />
    </Pressable>
  );
  return (
    <Sheet visible={open} onClose={onClose} title="Cách chơi">
      <Bullet emoji="🌱" text="Ruộng: bấm ô trống để gieo hạt (lúa mì miễn phí). Cây lớn cả khi bạn tắt máy; chín rồi bấm để thu hoạch." />
      <Bullet emoji="🏭" text="Chế biến: xây máy xay, chuồng gà, chuồng bò, xưởng, bếp, quầy nước… rồi làm trứng, sữa, đường, trân châu, mì cay, trà sữa…" />
      <Bullet emoji="📋" text="Đơn hàng: khách đặt mua, giao đủ hàng được nhiều xu và kinh nghiệm hơn bán ở chợ." />
      <Bullet emoji="📦" text="Kho: bán hàng ở chợ (giá đổi mỗi ngày, có món hot giá gấp rưỡi), nâng kho, mua chó giữ vườn và đồ trang trí." />
      <Bullet emoji="⭐" text="Thu hoạch, làm món, giao đơn đều có kinh nghiệm. Lên cấp được thưởng xu và mở thêm cây, món, ô đất." />
      <Bullet emoji="👥" text="Bạn bè: ghé vườn nhau để bắt sâu giúp hoặc hái trộm cây chín. Bảng xếp hạng theo cấp và theo xu kiếm được mỗi tuần." />
      <Bullet emoji="🎁" text="Mỗi ngày ghé nhận quà, ghé liên tục thì quà tăng dần." />
      <View style={s.prefs}>
        {row("Âm thanh", sound, setSound)}
        {Platform.OS !== "web" ? row("Báo khi cả ruộng chín", notify, setNotify, "Gửi thông báo trên máy lúc cây cuối cùng chín") : null}
      </View>
      <Text style={s.credit}>Hình biểu tượng: Twemoji (CC-BY 4.0). Âm thanh tự tổng hợp cho Think.</Text>
    </Sheet>
  );
}

const makeStyles = (c: Colors) => {
  const f = farmPalette(c);
  return StyleSheet.create({
    toggle: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
    toggleText: { flex: 1, color: c.text, fontSize: 15, fontWeight: "700" },
    seed: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.field },
    seedName: { color: c.text, fontSize: 15, fontWeight: "800" },
    seedSub: { color: c.muted, fontSize: 12.5 },
    cost: { flexDirection: "row", alignItems: "center", gap: 4 },
    costText: { color: f.goldInk, fontSize: 14, fontWeight: "800" },
    infoTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.field },
    bullet: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    bulletText: { flex: 1, color: c.text, fontSize: 14.5, lineHeight: 21 },
    levelUp: { alignItems: "center", gap: 12, paddingVertical: 6 },
    levelTitle: { color: c.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
    levelText: { color: c.text2, fontSize: 15 },
    unlocks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
    unlock: { width: 80, alignItems: "center", gap: 4 },
    unlockText: { color: c.text, fontSize: 12.5, fontWeight: "700", textAlign: "center" },
    prefs: { gap: 6, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    credit: { color: c.muted, fontSize: 12, lineHeight: 18 },
  });
};
