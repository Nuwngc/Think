import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";

import { showToast, useStore } from "../store";
import type { Colors } from "../theme";
import { Avatar, useStyles } from "../ui";
import { Emo } from "./Emo";
import { bugOn, clockText, fmt, giftPreview, growth, logEmoji, logText, longLeft, newLogEntries, plotDeal, plotState, visitActionOf } from "./logic";
import { FButton, Note, pointOf, useFarmColors, useReducedMotion, type FarmPalette } from "./parts";
import { act, addFx, busyKey, itemOf, markLogSeen, setTab, useFarm, visitAct, type Point } from "./store";
import type { Farm, Plot, PublicPlot } from "./types";

// Ruộng: lưới ô đất trên nền cỏ, quà mỗi ngày, sân vườn (đồ trang trí, chó), vườn của bạn bè

/* ---------------- Chuyển động dùng chung (một vòng lặp cho mọi ô) ---------------- */

type Pulse = { ripe: Animated.Value; spark: Animated.Value; bug: Animated.Value; reduce: boolean };
const PulseCtx = createContext<Pulse | null>(null);
const native = Platform.OS !== "web";

export function PulseProvider({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const ripe = useRef(new Animated.Value(0)).current;
  const spark = useRef(new Animated.Value(0)).current;
  const bug = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = (v: Animated.Value, ms: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
          Animated.timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        ]),
      );
    const all = [loop(ripe, 2200), loop(spark, 1600), loop(bug, 1200)];
    for (const a of all) a.start();
    return () => {
      for (const a of all) a.stop();
    };
  }, [reduce, ripe, spark, bug]);
  const value = useMemo(() => ({ ripe, spark, bug, reduce }), [ripe, spark, bug, reduce]);
  return <PulseCtx.Provider value={value}>{children}</PulseCtx.Provider>;
}

const usePulse = () => useContext(PulseCtx);

/* ---------------- Một ô đất ---------------- */

/** Luống đất: các vạch ngang trên nền đất */
const Furrows = memo(function Furrows({ size, color }: { size: number; color: string }) {
  const n = Math.max(3, Math.floor((size - 8) / 14));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: n }, (_, k) => (
        <View key={k} style={{ position: "absolute", left: 0, right: 0, top: 11 + k * 14, height: 3, backgroundColor: color }} />
      ))}
    </View>
  );
});

type TileProps = {
  index: number;
  size: number;
  crop: { name: string; emoji: string } | null;
  state: "empty" | "growing" | "ripe";
  /** 0..1 */
  grow: number;
  sprout: boolean;
  left: number;
  bug: boolean;
  /** Ô của mình đã bị bạn bè hái trộm 1 sản phẩm */
  stolen?: boolean;
  tag: string | null;
  tagMuted: boolean;
  pending: boolean;
  label: string;
  plus: boolean;
  onPress: (i: number, e: GestureResponderEvent) => void;
  f: FarmPalette;
};

const Tile = memo(function Tile(p: TileProps) {
  const pulse = usePulse();
  const s = useStyles(makeStyles);
  const cropSize = p.size * 0.62;
  const scale = p.state === "growing" ? 0.45 + 0.55 * p.grow : 1;
  // Tạo một lần cho mỗi ô (ô đang lớn vẽ lại mỗi giây để chạy đồng hồ)
  const anim = useMemo(
    () =>
      pulse && !pulse.reduce
        ? {
            bounce: { transform: [{ translateY: pulse.ripe.interpolate({ inputRange: [0, 1], outputRange: [0, -p.size * 0.62 * 0.06] }) }] },
            spark: { opacity: pulse.spark.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) },
            bug: {
              transform: [
                { translateX: pulse.bug.interpolate({ inputRange: [0, 1], outputRange: [0, p.size * 0.03] }) },
                { rotate: pulse.bug.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "8deg"] }) },
              ],
            },
          }
        : null,
    [pulse, p.size],
  );
  const bounce = p.state === "ripe" && anim ? anim.bounce : null;
  return (
    <Pressable
      onPress={(e) => p.onPress(p.index, e)}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      style={({ pressed }) => [
        s.tile,
        { width: p.size, height: p.size, backgroundColor: p.state === "growing" ? p.f.soilWet : p.f.soil },
        pressed && { transform: [{ scale: 0.95 }] },
        p.pending && { opacity: 0.6 },
      ]}
    >
      <Furrows size={p.size} color={p.f.soilLine} />
      <View style={[s.tileEdge, { backgroundColor: p.f.soil2 }]} pointerEvents="none" />
      {p.crop ? (
        <Animated.View style={[{ width: cropSize, height: cropSize }, bounce]}>
          <View style={{ flex: 1, transform: [{ scale }], transformOrigin: "50% 85%", opacity: p.state === "growing" ? 0.55 + 0.45 * p.grow : 1 }}>
            <Emo ch={p.sprout ? "🌱" : p.crop.emoji} size={cropSize} />
          </View>
        </Animated.View>
      ) : p.plus ? (
        <Text style={s.plus}>+</Text>
      ) : null}
      {p.state === "ripe" ? (
        <Animated.View style={[s.spark, { width: p.size * 0.22, height: p.size * 0.22 }, anim ? anim.spark : null]} pointerEvents="none">
          <Emo ch="✨" size={p.size * 0.22} />
        </Animated.View>
      ) : null}
      {p.bug ? (
        <Animated.View style={[s.bug, { width: p.size * 0.3, height: p.size * 0.3 }, anim ? anim.bug : null]} pointerEvents="none">
          <Emo ch="🐛" size={p.size * 0.3} />
        </Animated.View>
      ) : null}
      {p.stolen && !p.bug ? (
        <View style={[s.bug, { width: p.size * 0.26, height: p.size * 0.26 }]} pointerEvents="none">
          <Emo ch="😤" size={p.size * 0.26} />
        </View>
      ) : null}
      {p.state === "growing" ? (
        <View style={s.timePill} pointerEvents="none">
          <Text style={s.timeText}>{clockText(p.left)}</Text>
        </View>
      ) : null}
      {p.tag ? (
        <View style={[s.tag, { backgroundColor: p.tagMuted ? "rgba(0,0,0,0.45)" : p.f.ripe }]} pointerEvents="none">
          <Text style={[s.tagText, { color: p.tagMuted ? "#FFFFFF" : p.f.onGold }]} numberOfLines={1}>
            {p.tag}
          </Text>
        </View>
      ) : null}
      {p.pending ? <ActivityIndicator style={s.pending} color="#FFFFFF" size="small" /> : null}
      {p.state === "ripe" ? <View style={[StyleSheet.absoluteFill, s.ring, { borderColor: p.f.ripe }]} pointerEvents="none" /> : null}
    </Pressable>
  );
});

/* ---------------- Lưới ô đất ---------------- */

function useGrid(width: number) {
  const cols = width >= 1000 ? 6 : width >= 480 ? 4 : 3;
  const gap = 10;
  const size = width > 0 ? Math.floor((width - gap * (cols - 1)) / cols) : 0;
  return { cols, gap, size };
}

function Grid({ children, onWidth, gap }: { children: ReactNode; onWidth: (w: number) => void; gap: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap }} onLayout={(e) => onWidth(e.nativeEvent.layout.width)} accessibilityRole="list">
      {children}
    </View>
  );
}

/** Sân vườn: đồ trang trí đã mua + chó giữ vườn */
export function Yard({ decor, dog }: { decor: string[]; dog: boolean }) {
  const cat = useFarm((s) => s.cat);
  const list = (decor || []).map((id) => cat?.decor.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
  if (!list.length && !dog) return null;
  const label = `Sân vườn: ${[...list.map((d) => d.name), dog ? "chó giữ vườn" : null].filter(Boolean).join(", ")}`;
  return (
    <View style={styles.yard} accessible accessibilityLabel={label}>
      {list.map((d) => (
        <Emo key={d.id} ch={d.emoji} size={36} />
      ))}
      {dog ? <Emo ch="🐕" size={40} style={{ marginLeft: "auto" }} /> : null}
    </View>
  );
}

/* ---------------- Ruộng của mình ---------------- */

export function FieldView({ t, onSeeds, onPlotInfo }: { t: number; onSeeds: (plot: number | null) => void; onPlotInfo: (plot: number) => void }) {
  const { f } = useFarmColors();
  const farm = useFarm((s) => s.farm) as Farm;
  const cat = useFarm((s) => s.cat);
  const items = useFarm((s) => s.items);
  const busy = useFarm((s) => s.busy);
  const [width, setWidth] = useState(0);
  const { gap, size } = useGrid(width);

  // Hàm bấm ô giữ nguyên giữa các lần vẽ (ô không đổi thì không phải vẽ lại)
  const latest = useRef({ onSeeds, onPlotInfo });
  latest.current = { onSeeds, onPlotInfo };
  const onPress = useCallback((i: number, e: GestureResponderEvent) => {
    const st0 = useFarm.getState();
    const pl = st0.farm?.plots[i];
    if (!pl) return;
    const now = Date.now() + st0.skew;
    const st = plotState(pl, now);
    const at = pointOf(e);
    if (st === "empty") return latest.current.onSeeds(i);
    if (bugOn(pl, now)) return act("clearBug", { plot: i }, at);
    if (st === "ripe") {
      addFx({ kind: "fly", at, emoji: itemOf(st0, pl.c as string).emoji });
      return act("harvest", { plots: [i] }, at);
    }
    latest.current.onPlotInfo(i);
  }, []);

  const firstTime = farm.stats.harvest === 0 && farm.plots.some((p) => plotState(p, t) === "ripe");
  return (
    <View style={{ gap: 14 }}>
      <GiftBanner />
      <AwayBanner />
      <Yard decor={farm.decor} dog={farm.dog} />
      <Grid onWidth={setWidth} gap={gap}>
        {size > 0
          ? farm.plots.map((pl, i) => {
              const st = plotState(pl, t);
              const crop = pl.c ? items[pl.c] || { name: pl.c, emoji: "🌱" } : null;
              const g = pl.c ? growth(pl, t) : null;
              const bug = bugOn(pl, t);
              const label =
                st === "empty"
                  ? `Ô ${i + 1}: đất trống, bấm để gieo hạt`
                  : st === "ripe"
                    ? `Ô ${i + 1}: ${crop?.name} đã chín${pl.st ? ", bị hái trộm 1" : ""}, ${bug ? "đang có sâu, bấm để bắt sâu" : "bấm để thu hoạch"}`
                    : `Ô ${i + 1}: ${crop?.name}, còn ${longLeft(pl.r - t)}${bug ? ", đang có sâu, bấm để bắt" : ""}`;
              return (
                <Tile
                  key={i}
                  index={i}
                  size={size}
                  crop={crop}
                  state={st}
                  grow={g ? Math.round(g.p * 100) / 100 : 0}
                  sprout={Boolean(g && st === "growing" && g.sprout)}
                  left={st === "growing" ? pl.r - t : 0}
                  bug={bug}
                  stolen={Boolean(pl.st)}
                  tag={st === "ripe" ? (bug ? "Bắt sâu" : "Thu hoạch") : null}
                  tagMuted={false}
                  pending={Boolean(busy[busyKey("harvest", { plots: [i] })] || busy[busyKey("clearBug", { plot: i })])}
                  label={label}
                  plus
                  onPress={onPress}
                  f={f}
                />
              );
            })
          : null}
        {size > 0 && cat ? <BuyPlotTile size={size} /> : null}
      </Grid>
      {firstTime ? (
        <Note onGrass>Lúa mì đã chín sẵn: bấm vào ô có viền vàng để thu hoạch, rồi bấm ô trống để gieo hạt mới. Hạt lúa mì miễn phí.</Note>
      ) : farm.plots.every((p) => !p.c) ? (
        <Note onGrass>Ruộng đang trống. Bấm vào ô đất để gieo hạt, hoặc bấm “Gieo” ở dưới để gieo cả ruộng một lần.</Note>
      ) : null}
    </View>
  );
}

function BuyPlotTile({ size }: { size: number }) {
  const { f } = useFarmColors();
  const farm = useFarm((s) => s.farm) as Farm;
  const cat = useFarm((s) => s.cat);
  const busy = useFarm((s) => Boolean(s.busy[busyKey("buyPlot")]));
  if (!cat) return null;
  const info = plotDeal(farm, cat);
  if (!info) return null;
  const locked = farm.level < info.level;
  const poor = farm.coins < info.cost;
  return (
    <Pressable
      onPress={locked || poor || busy ? undefined : (e) => act("buyPlot", {}, pointOf(e))}
      accessibilityRole="button"
      accessibilityLabel={locked ? `Ô đất thứ ${info.n} mở ở cấp ${info.level}` : `Mua ô đất thứ ${info.n} giá ${info.cost} xu`}
      accessibilityState={{ disabled: locked || poor }}
      style={({ pressed }) => [
        styles.buy,
        { width: size, height: size, borderColor: f.grassInk, opacity: locked ? 0.65 : poor ? 0.75 : 1 },
        pressed && !locked && { transform: [{ scale: 0.95 }] },
      ]}
    >
      {busy ? <ActivityIndicator color={f.grassInk} /> : <Emo ch={locked ? "🔒" : "🪙"} size={22} />}
      <Text style={[styles.buyText, { color: f.grassInk }]}>{locked ? `Cấp ${info.level}` : "Mua ô đất"}</Text>
      {!locked ? <Text style={[styles.buyText, { color: f.grassInk, fontWeight: "800" }]}>{fmt(info.cost)} xu</Text> : null}
    </Pressable>
  );
}

/** Quà mỗi ngày */
function GiftBanner() {
  const s = useStyles(makeStyles);
  const farm = useFarm((st) => st.farm) as Farm;
  const market = useFarm((st) => st.market);
  const cat = useFarm((st) => st.cat);
  const busy = useFarm((st) => Boolean(st.busy[busyKey("gift")]));
  const pulse = usePulse();
  // Ngày theo nông trại (máy chủ cập nhật sau mỗi thao tác), không theo giá chợ đã tải
  const gift = cat ? giftPreview(farm, farm.day || market?.day, cat.rules.dailyGift) : null;
  if (!gift) return null;
  const wiggle =
    pulse && !pulse.reduce
      ? { transform: [{ rotate: pulse.spark.interpolate({ inputRange: [0, 0.8, 0.9, 1], outputRange: ["0deg", "0deg", "-9deg", "9deg"] }) }] }
      : null;
  return (
    <View style={s.banner}>
      <Animated.View style={wiggle}>
        <Emo ch="🎁" size={34} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text style={s.bannerTitle}>Quà hôm nay: {gift.coins} xu</Text>
        <Text style={s.bannerText}>
          {gift.streak > 1 ? `Ngày thứ ${gift.streak} liên tiếp, quà tăng dần tới ${gift.max} xu.` : "Ghé mỗi ngày, quà tăng dần."}
        </Text>
      </View>
      <FButton title="Nhận" kind="gold" small busy={busy} onPress={(e) => act("gift", {}, pointOf(e))} />
    </View>
  );
}

/** Khi bạn vắng nhà: ai đã ghé vườn */
function AwayBanner() {
  const s = useStyles(makeStyles);
  const log = useFarm((st) => st.farm?.log);
  const seen = useFarm((st) => st.logSeen);
  const items = useFarm((st) => st.items);
  const users = useStore((st) => st.users);
  const entries = useMemo(() => newLogEntries(log, seen), [log, seen]);
  const nameOf = (id: number) => users[id]?.displayName || "Người dùng";
  if (!entries.length) return null;
  return (
    <View style={s.banner}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={s.bannerTitle}>Khi bạn vắng nhà</Text>
        {entries.slice(0, 3).map((e, k) => (
          <View key={`${e.t}-${k}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Emo ch={logEmoji(e.type)} size={20} />
            <Text style={[s.bannerText, { flex: 1 }]}>{logText(e, nameOf(e.by), e.c ? items[e.c]?.name || null : null)}</Text>
          </View>
        ))}
        {entries.length > 3 ? <Text style={s.bannerText}>…và {entries.length - 3} lần khác</Text> : null}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
          <FButton title="Xem nhật ký" kind="soft" small onPress={() => setTab("friends")} />
          <FButton title="Đã xem" kind="ghost" small onPress={markLogSeen} />
        </View>
      </View>
    </View>
  );
}

/* ---------------- Vườn của bạn bè ---------------- */

export function VisitView({ t }: { t: number }) {
  const { c, f } = useFarmColors();
  const s = useStyles(makeStyles);
  const visit = useFarm((st) => st.visit) as number;
  const v = useFarm((st) => st.visitFarm);
  const err = useFarm((st) => st.visitError);
  const me = useFarm((st) => st.farm);
  const cat = useFarm((st) => st.cat);
  const items = useFarm((st) => st.items);
  const busy = useFarm((st) => st.busy);
  const user = useStore((st) => st.users[visit]);
  const toast = (text: string) => showToast(text);
  const [width, setWidth] = useState(0);
  const { gap, size } = useGrid(width);

  if (err) {
    return (
      <View style={s.center}>
        <Text style={[s.bannerText, { textAlign: "center", color: c.text }]}>{err}</Text>
      </View>
    );
  }
  if (!v || !cat) {
    return (
      <View style={s.center}>
        <Emo ch="🚜" size={48} />
        <Text style={[s.bannerText, { color: f.grassInk }]}>Đang sang vườn bạn…</Text>
      </View>
    );
  }
  const R = cat.rules;
  const onPress = (i: number, e: GestureResponderEvent) => {
    const pl = (useFarm.getState().visitFarm || v).plots[i];
    if (!pl) return;
    const now = Date.now() + useFarm.getState().skew;
    const action = visitActionOf(pl, now);
    const at: Point = pointOf(e);
    if (!action) {
      if (!pl.c) toast("Ô đất trống.");
      else if (pl.r > now) toast(`${items[pl.c]?.name || "Cây"} còn ${longLeft(pl.r - now)} nữa mới chín.`);
      else if (pl.st === "me") toast("Bạn đã hái ô này rồi.");
      else toast("Ô này không hái được nữa, để lại cho chủ vườn nhé.");
      return;
    }
    if (action === "steal") addFx({ kind: "fly", at, emoji: itemOf(useFarm.getState(), pl.c as string).emoji });
    visitAct(i, action, at);
  };
  return (
    <View style={{ gap: 14 }}>
      <View style={s.banner}>
        <Avatar user={user} size={36} dot={false} />
        <Text style={[s.bannerText, { flex: 1 }]}>
          Bấm vào con sâu để bắt giúp (+{R.helpCoins} xu). Ô có chữ “Hái trộm” thì hái được 1 sản phẩm.
          {v.dog ? <Text style={{ fontWeight: "800" }}> Vườn này có chó giữ vườn, coi chừng bị cắn!</Text> : null}
          {me ? ` Hôm nay: giúp ${me.helps}/${R.helpsPerDay}, hái trộm ${me.steals}/${R.stealsPerDay}.` : ""}
        </Text>
      </View>
      <Yard decor={v.decor} dog={v.dog} />
      <Grid onWidth={setWidth} gap={gap}>
        {size > 0
          ? v.plots.map((pl: PublicPlot, i) => {
              const st = plotState(pl, t);
              const crop = pl.c ? items[pl.c] || { name: pl.c, emoji: "🌱" } : null;
              const g = pl.c ? growth(pl, t) : null;
              let tag: string | null = null;
              let muted = false;
              if (st === "ripe" && pl.bug) tag = "Bắt sâu";
              else if (st === "ripe") {
                if (pl.st === "me") {
                  tag = "Đã hái";
                  muted = true;
                } else if (pl.canSteal) tag = "Hái trộm";
                else {
                  tag = "Đã chín";
                  muted = true;
                }
              }
              const label =
                st === "empty"
                  ? `Ô ${i + 1}: đất trống`
                  : st === "ripe"
                    ? `Ô ${i + 1}: ${crop?.name} đã chín, ${pl.bug ? "có sâu, bấm để bắt giúp" : pl.canSteal ? "bấm để hái trộm" : "không hái được nữa"}`
                    : `Ô ${i + 1}: ${crop?.name}, còn ${longLeft(pl.r - t)}${pl.bug ? ", có sâu, bấm để bắt giúp" : ""}`;
              return (
                <Tile
                  key={i}
                  index={i}
                  size={size}
                  crop={crop}
                  state={st}
                  grow={g ? Math.round(g.p * 100) / 100 : 0}
                  sprout={Boolean(g && st === "growing" && g.sprout)}
                  left={st === "growing" ? pl.r - t : 0}
                  bug={pl.bug}
                  tag={tag}
                  tagMuted={muted}
                  pending={Boolean(busy[busyKey("visit-help", { id: visit, plot: i })] || busy[busyKey("visit-steal", { id: visit, plot: i })])}
                  label={label}
                  plus={false}
                  onPress={onPress}
                  f={f}
                />
              );
            })
          : null}
      </Grid>
    </View>
  );
}

/* ---------------- Thanh thao tác dưới ruộng ---------------- */

export function FieldDock({ t, onSeeds }: { t: number; onSeeds: (plot: number | null) => void }) {
  const s = useStyles(makeStyles);
  const farm = useFarm((st) => st.farm) as Farm;
  const busy = useFarm((st) => Boolean(st.busy[busyKey("harvest", { plots: "all" })]));
  const ripe = farm.plots.filter((p: Plot) => plotState(p, t) === "ripe").length;
  const empty = farm.plots.filter((p) => !p.c).length;
  if (!ripe && !empty) return null;
  return (
    <View style={s.dock}>
      {ripe ? (
        <FButton
          grow
          kind="gold"
          emoji="🧺"
          busy={busy}
          title={ripe > 1 ? `Thu hoạch ${ripe} ô` : "Thu hoạch"}
          onPress={(e) => {
            const at = pointOf(e);
            const first = farm.plots.find((p) => plotState(p, t) === "ripe");
            if (first?.c) addFx({ kind: "fly", at, emoji: itemOf(useFarm.getState(), first.c).emoji });
            act("harvest", { plots: "all" }, at);
          }}
        />
      ) : null}
      {empty ? <FButton grow emoji="🌱" title={empty > 1 ? `Gieo ${empty} ô trống` : "Gieo ô trống"} onPress={() => onSeeds(null)} /> : null}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    tile: { borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center", paddingBottom: 3 },
    tileEdge: { position: "absolute", left: 0, right: 0, bottom: 0, height: 5 },
    ring: { borderRadius: 16, borderWidth: 3 },
    plus: { color: "rgba(255,255,255,0.55)", fontSize: 30, fontWeight: "300" },
    spark: { position: "absolute", top: "8%", right: "10%" },
    bug: { position: "absolute", top: "6%", left: "6%" },
    timePill: {
      position: "absolute",
      bottom: "6%",
      alignSelf: "center",
      paddingHorizontal: 7,
      paddingVertical: 1,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    timeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
    tag: { position: "absolute", bottom: "6%", alignSelf: "center", paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, maxWidth: "92%" },
    tagText: { fontSize: 12, fontWeight: "800" },
    pending: { position: "absolute" },
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderBottomWidth: 2,
      borderBottomColor: "rgba(0,0,0,0.08)",
    },
    bannerTitle: { color: c.text, fontSize: 14.5, fontWeight: "800" },
    bannerText: { color: c.text2, fontSize: 13.5, lineHeight: 19 },
    center: { alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 48, paddingHorizontal: 20 },
    dock: {
      flexDirection: "row",
      gap: 10,
      paddingHorizontal: 14,
      paddingTop: 10,
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
    },
  });

const styles = StyleSheet.create({
  yard: { flexDirection: "row", alignItems: "flex-end", gap: 6, minHeight: 40, paddingHorizontal: 4, flexWrap: "wrap" },
  buy: { borderRadius: 16, borderWidth: 2, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 3, padding: 6 },
  buyText: { fontSize: 12.5, fontWeight: "700", textAlign: "center" },
});
