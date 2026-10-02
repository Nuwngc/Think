import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";

import { useStore } from "../store";
import type { Colors } from "../theme";
import { Button, IconButton, useStyles } from "../ui";
import { BuildView, RecipeSheet } from "./Build";
import { Emo } from "./Emo";
import { FieldDock, FieldView, PulseProvider, VisitView } from "./Field";
import { FriendsView } from "./Friends";
import { badges, fmt } from "./logic";
import { OrdersView } from "./Orders";
import { Meter, farmPalette, useFarmColors, useReducedMotion } from "./parts";
import { HelpSheet, LevelUpSheet, PlotInfoSheet, SeedSheet } from "./Sheets";
import { preloadFarmSounds, releaseFarmSounds } from "./sound";
import { StorageView } from "./Storage";
import { loadFarm, loadSocial, loadVisit, openVisit, serverNow, setFarmOpen, setSound, setTab, useFarm, type Fx, type Point } from "./store";
import type { FarmTab } from "./types";

// Màn game Nông trại trong app Think Beta (giống bản web public/farm-ui.js)

const TABS: { key: FarmTab; label: string; emoji: string }[] = [
  { key: "field", label: "Ruộng", emoji: "🌱" },
  { key: "build", label: "Chế biến", emoji: "🏭" },
  { key: "orders", label: "Đơn hàng", emoji: "📋" },
  { key: "storage", label: "Kho", emoji: "📦" },
  { key: "friends", label: "Bạn bè", emoji: "👥" },
];

const nativeDriver = Platform.OS !== "web";

/** Nền cỏ chấm bi */
function Grass({ a, b }: { a: string; b: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <Pattern id="farm-grass" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
          <Circle cx="9" cy="9" r="1.5" fill={b} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={a} />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#farm-grass)" />
    </Svg>
  );
}

/* ---------------- Hiệu ứng: chữ bay lên, sản phẩm bay về Kho ---------------- */

function FloatFx({ fx, origin }: { fx: Extract<Fx, { kind: "float" }>; origin: Point }) {
  const s = useStyles(makeStyles);
  const v = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  const { width } = useWindowDimensions();
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduce ? 900 : 1300, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }).start();
  }, [v, reduce]);
  const x = fx.at ? Math.min(width - 84, Math.max(84, fx.at.x - origin.x)) : null;
  const y = fx.at ? fx.at.y - origin.y - 36 : null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        s.float,
        x != null && y != null ? { left: x - 80, top: y } : { left: 0, right: 0, top: "42%" },
        {
          opacity: v.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: reduce ? 0 : v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [10, 0, -60] }) },
            { scale: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.8, 1, 1] }) },
          ],
        },
      ]}
    >
      <View style={s.floatPill}>
        {fx.parts.map((p, k) => (
          <View key={k} style={s.floatPart}>
            {p.emoji ? <Emo ch={p.emoji} size={18} /> : null}
            <Text style={s.floatText}>{p.text}</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

function FlyFx({ fx, origin, target }: { fx: Extract<Fx, { kind: "fly" }>; origin: Point; target: Point | null }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 620, easing: Easing.bezier(0.5, -0.2, 0.6, 1), useNativeDriver: nativeDriver }).start();
  }, [v]);
  if (!target) return null;
  const x0 = fx.at.x - origin.x - 17;
  const y0 = fx.at.y - origin.y - 17;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x0,
        top: y0,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }),
        transform: [
          { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, target.x - origin.x - 17 - x0] }) },
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, target.y - origin.y - 17 - y0] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) },
        ],
      }}
    >
      <Emo ch={fx.emoji} size={34} />
    </Animated.View>
  );
}

/* ---------------- Thanh trên ---------------- */

function CoinPill({ coins }: { coins: number }) {
  const s = useStyles(makeStyles);
  const bump = useFarm((st) => st.coinBump);
  const v = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!bump || reduce) return;
    v.setValue(0);
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 140, useNativeDriver: nativeDriver }),
      Animated.timing(v, { toValue: 0, duration: 260, useNativeDriver: nativeDriver }),
    ]).start();
  }, [bump, reduce, v]);
  return (
    <Animated.View
      style={[s.coins, { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }]}
      accessible
      accessibilityLabel={`${fmt(coins)} xu`}
      accessibilityLiveRegion="polite"
    >
      <Emo ch="🪙" size={20} />
      <Text style={s.coinsText}>{fmt(coins)}</Text>
    </Animated.View>
  );
}

const Header = memo(function Header({ onBack, onHelp }: { onBack: () => void; onHelp: () => void }) {
  const { c } = useFarmColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const farm = useFarm((st) => st.farm);
  const visit = useFarm((st) => st.visit);
  const visitLevel = useFarm((st) => st.visitFarm?.level ?? null);
  const sound = useFarm((st) => st.sound);
  const visitName = useStore((st) => (visit != null ? st.users[visit]?.displayName || "Người dùng" : ""));
  const visiting = visit != null;
  const level = visiting ? visitLevel : (farm?.level ?? null);
  return (
    <View style={[s.head, { paddingTop: insets.top + 6 }]}>
      <IconButton name="arrow-back" label={visiting ? "Về vườn của mình" : "Về trang Trò chơi"} onPress={visiting ? () => openVisit(null) : onBack} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">
          {visiting ? `Vườn của ${visitName}` : "Nông trại"}
        </Text>
        {level != null ? (
          <View style={s.levelRow}>
            <View style={s.levelBadge}>
              <Text style={s.levelText}>Cấp {level}</Text>
            </View>
            {!visiting && farm ? (
              <>
                <Meter value={farm.xpNext ? farm.xpCur / farm.xpNext : 1} color={c.turmeric} track={c.field} height={6} style={{ flex: 1, maxWidth: 140 }} />
                {farm.xpNext ? (
                  <Text style={s.xpText} accessibilityLabel={`Kinh nghiệm ${farm.xpCur} trên ${farm.xpNext}`}>
                    {fmt(farm.xpCur)}/{fmt(farm.xpNext)}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
      </View>
      {farm ? <CoinPill coins={farm.coins} /> : null}
      <IconButton name={sound ? "volume-up" : "volume-off"} label={sound ? "Tắt âm thanh" : "Bật âm thanh"} onPress={() => setSound(!sound)} />
      {!visiting ? <IconButton name="info-outline" label="Cách chơi" onPress={onHelp} /> : null}
    </View>
  );
});

function Tabs({
  t,
  onTab,
  onKhoLayout,
  onLayout,
}: {
  t: number;
  onTab: (tab: FarmTab) => void;
  onKhoLayout: (ref: View | null) => void;
  onLayout: () => void;
}) {
  const { c } = useFarmColors();
  const s = useStyles(makeStyles);
  const tab = useFarm((st) => st.tab);
  const farm = useFarm((st) => st.farm);
  const friends = useFarm((st) => st.friends);
  const b = badges(farm, t, friends);
  return (
    <View style={s.tabs} accessibilityRole="tablist" onLayout={onLayout}>
      {TABS.map((x) => {
        const on = tab === x.key;
        const n = b[x.key];
        return (
          <Pressable
            key={x.key}
            onPress={() => onTab(x.key)}
            style={s.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n ? `${x.label}, ${n}` : x.label}
          >
            <View ref={x.key === "storage" ? onKhoLayout : undefined} collapsable={false} style={{ transform: [{ scale: on ? 1.1 : 1 }] }}>
              <Emo ch={x.emoji} size={24} />
            </View>
            <Text style={[s.tabText, { color: on ? c.accent : c.muted }]} numberOfLines={1}>
              {x.label}
            </Text>
            {on ? <View style={[s.tabBar, { backgroundColor: c.jade }]} /> : null}
            {n ? (
              <View style={s.tabBadge}>
                <Text style={s.tabBadgeText}>{n > 99 ? "99+" : n}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------------- Màn chính ---------------- */

export function FarmScreen({ onBack }: { onBack: () => void }) {
  const { c, f } = useFarmColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const farm = useFarm((st) => st.farm);
  const cat = useFarm((st) => st.cat);
  const tab = useFarm((st) => st.tab);
  const visit = useFarm((st) => st.visit);
  const error = useFarm((st) => st.error);
  const loading = useFarm((st) => st.loading);
  const fx = useFarm((st) => st.fx);
  const appActive = useStore((st) => st.appActive);
  const [t, setT] = useState(serverNow);
  const [seedFor, setSeedFor] = useState<number | null | undefined>(undefined);
  const [infoFor, setInfoFor] = useState<number | null>(null);
  const [recipesFor, setRecipesFor] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [origin, setOrigin] = useState<Point>({ x: 0, y: 0 });
  const [kho, setKho] = useState<Point | null>(null);
  const rootRef = useRef<View>(null);
  const khoRef = useRef<View | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setFarmOpen(true);
    preloadFarmSounds();
    return () => {
      setFarmOpen(false);
      releaseFarmSounds();
    };
  }, []);

  // Đồng hồ: cây lớn, món làm xong, khách tới (dừng khi app chạy nền)
  useEffect(() => {
    if (!appActive) return;
    setT(serverNow());
    const id = setInterval(() => setT(serverNow()), 1000);
    return () => clearInterval(id);
  }, [appActive]);

  // Mở lại app: lấy bản mới (bạn bè có thể vừa ghé vườn)
  const wasActive = useRef(appActive);
  useEffect(() => {
    if (appActive && !wasActive.current) {
      loadFarm();
      if (useFarm.getState().visit != null) loadVisit();
    }
    wasActive.current = appActive;
  }, [appActive]);

  const measure = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => setOrigin({ x, y }));
    khoRef.current?.measureInWindow((x, y, w, h) => setKho({ x: x + w / 2, y: y + h / 2 }));
  }, []);

  const onTab = (next: FarmTab) => {
    setTab(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (visit != null) await loadVisit();
      else await Promise.all([loadFarm(), tab === "friends" ? loadSocial() : null]);
    } finally {
      setRefreshing(false);
    }
  };

  const closeSeeds = useCallback(() => setSeedFor(undefined), []);
  const closeInfo = useCallback(() => setInfoFor(null), []);
  const closeRecipes = useCallback(() => setRecipesFor(null), []);
  const openHelp = useCallback(() => setHelp(true), []);
  const closeHelp = useCallback(() => setHelp(false), []);

  const visiting = visit != null;
  const ready = Boolean(farm && cat);
  const grassy = visiting || (ready && tab === "field");

  const slow = Math.floor(t / 15000) * 15000;
  let body: ReactNode;
  if (visiting) body = <VisitView t={t} />;
  else if (!ready) {
    body = error ? (
      <View style={s.center}>
        <Emo ch="🌧️" size={48} />
        <Text style={s.centerText}>{error}</Text>
        <Button title="Thử lại" onPress={() => loadFarm()} busy={loading} />
      </View>
    ) : (
      <View style={s.center}>
        <Emo ch="🚜" size={56} />
        <Text style={s.centerText}>Đang ra đồng…</Text>
      </View>
    );
  } else if (tab === "build") body = <BuildView t={t} onRecipes={setRecipesFor} />;
  else if (tab === "orders") body = <OrdersView t={t} />;
  // Kho, Bạn bè không cần đồng hồ từng giây (đỡ vẽ lại trên máy yếu)
  else if (tab === "storage") body = <StorageView t={slow} />;
  else if (tab === "friends") body = <FriendsView t={slow} />;
  else body = <FieldView t={t} onSeeds={setSeedFor} onPlotInfo={setInfoFor} />;

  return (
    <PulseProvider>
      <View ref={rootRef} style={s.root} onLayout={measure} collapsable={false}>
        <Header onBack={onBack} onHelp={openHelp} />
        {ready && !visiting ? (
          <Tabs
            t={t}
            onTab={onTab}
            onKhoLayout={(ref) => {
              khoRef.current = ref;
            }}
            onLayout={measure}
          />
        ) : null}
        <View style={{ flex: 1 }}>
          {grassy ? <Grass a={f.grass} b={f.grass2} /> : null}
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[s.body, { paddingBottom: (ready && !visiting && tab === "field" ? 16 : 28) + (visiting ? insets.bottom : 0) }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} colors={[c.jade]} />}
            onLayout={measure}
          >
            <View style={s.inner}>{body}</View>
          </ScrollView>
        </View>
        {ready && !visiting && tab === "field" ? (
          <View style={{ backgroundColor: c.surface, paddingBottom: Math.max(insets.bottom, 10) }}>
            <FieldDock t={t} onSeeds={setSeedFor} />
          </View>
        ) : !visiting ? (
          <View style={{ height: insets.bottom, backgroundColor: c.bg }} />
        ) : null}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {fx.map((x) => (x.kind === "float" ? <FloatFx key={x.id} fx={x} origin={origin} /> : <FlyFx key={x.id} fx={x} origin={origin} target={kho} />))}
        </View>
        <SeedSheet plot={seedFor} onClose={closeSeeds} />
        <PlotInfoSheet plot={infoFor} t={t} onClose={closeInfo} />
        <RecipeSheet bid={recipesFor} onClose={closeRecipes} />
        <HelpSheet open={help} onClose={closeHelp} />
        <LevelUpSheet />
      </View>
    </PulseProvider>
  );
}

const makeStyles = (c: Colors) => {
  const f = farmPalette(c);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: 4,
      paddingRight: 6,
      paddingBottom: 8,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    title: { color: c.text, fontSize: 19, fontWeight: "800", letterSpacing: -0.2 },
    levelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    levelBadge: { backgroundColor: c.jade, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
    levelText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
    xpText: { color: c.muted, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
    coins: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingLeft: 7,
      paddingRight: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: c.turmericWash,
    },
    coinsText: { color: f.goldInk, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
    tabs: { flexDirection: "row", backgroundColor: c.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    tab: { flex: 1, alignItems: "center", gap: 2, paddingTop: 8, paddingBottom: 7 },
    tabText: { fontSize: 12, fontWeight: "700" },
    tabBar: { position: "absolute", bottom: 0, left: "22%", right: "22%", height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
    tabBadge: {
      position: "absolute",
      top: 3,
      left: "55%",
      minWidth: 18,
      height: 18,
      paddingHorizontal: 5,
      borderRadius: 9,
      backgroundColor: c.turmeric,
      alignItems: "center",
      justifyContent: "center",
    },
    tabBadgeText: { color: "#3B2A00", fontSize: 11, fontWeight: "800" },
    body: { padding: 14 },
    inner: { width: "100%", maxWidth: 760, alignSelf: "center" },
    center: { alignItems: "center", justifyContent: "center", gap: 14, paddingVertical: 56, paddingHorizontal: 20 },
    centerText: { color: c.muted, fontSize: 15, textAlign: "center", lineHeight: 21 },
    float: { position: "absolute", width: 160, alignItems: "center" },
    floatPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: c.surface,
      elevation: 6,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    floatPart: { flexDirection: "row", alignItems: "center", gap: 3 },
    floatText: { color: c.text, fontSize: 14, fontWeight: "800" },
  });
};
