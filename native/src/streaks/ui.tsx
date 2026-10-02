import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { useColors, type Colors } from "../theme";
import { Button, Sheet, useStyles } from "../ui";
import { Flame } from "./Flame";
import { weekLabels } from "./logic";
import { closeStreaks, loadStreaks, openStreaks, setRemind, streakOf, useStreaks } from "./store";
import type { GameStreak, Streak } from "./types";

// Giao diện chuỗi hằng ngày: nhãn trên thẻ game, huy hiệu trong từng game, khung chuỗi ở trang Trò chơi,
// bảng chi tiết và bảng chúc mừng khi đạt mốc (StreakHost đặt một lần ở MainScreen).

const native = Platform.OS !== "web";

function useReduceMotion() {
  const ref = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        ref.current = Boolean(v);
      })
      .catch(() => undefined);
  }, []);
  return ref;
}

/** Ngọn lửa lay nhẹ (khi đang cháy) */
function LiveFlame({ size, lit }: { size: number; lit: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    if (!lit) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    const t = setTimeout(() => {
      if (!reduce.current) loop.start();
    }, 50);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [lit, v, reduce]);
  return (
    <Animated.View
      style={{
        transformOrigin: "50% 90%",
        transform: [
          { scaleX: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) },
          { scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) },
          { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-1.5deg", "1.5deg"] }) },
        ],
      }}
    >
      <Flame size={size} lit={lit} />
    </Animated.View>
  );
}

/** 7 ngày gần nhất */
export function WeekStrip({ week, small }: { week: boolean[]; small?: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const start = useStreaks((st) => st.data?.weekStartDay ?? 0);
  const labels = weekLabels(start);
  const dot = small ? 18 : 24;
  return (
    <View style={[s.week, small && { gap: 4 }]} accessible accessibilityLabel={`7 ngày gần nhất: ${week.filter(Boolean).length} ngày có chơi`}>
      {week.map((on, i) => (
        <View key={i} style={s.weekItem}>
          <View
            style={[
              s.dot,
              { width: dot, height: dot, borderRadius: dot / 2 },
              on && { backgroundColor: c.scheme === "dark" ? "#4A2E14" : "#FFE7CC" },
              i === 6 && { borderWidth: 2, borderColor: on ? "#FF9A3D" : c.line },
            ]}
          >
            {on ? <Flame size={small ? 12 : 16} /> : null}
          </View>
          <Text style={[s.weekLabel, small && { fontSize: 10 }, i === 6 && { color: c.text }]}>{labels[i]}</Text>
        </View>
      ))}
    </View>
  );
}

/** Nhãn chuỗi trên thẻ game ở trang Trò chơi (trên nền màu của thẻ) */
export function StreakChip({ game }: { game: string }) {
  const s = useStyles(makeStyles);
  const g = useStreaks((st) => streakOf(st, game));
  if (!g || !g.current) return null;
  return (
    <View
      style={[s.chip, g.atRisk && s.chipRisk]}
      accessible
      accessibilityLabel={g.atRisk ? `Chuỗi ${g.current} ngày, chơi hôm nay để giữ chuỗi` : `Chuỗi ${g.current} ngày`}
    >
      <Flame size={14} lit={!g.atRisk} />
      <Text style={[s.chipText, g.atRisk && { color: "#3A2A00" }]}>{g.atRisk ? `${g.current} ngày · sắp đứt` : `${g.current} ngày`}</Text>
    </View>
  );
}

/** Huy hiệu chuỗi trong từng game; onDark = đặt trên nền màu đậm (thẻ ELO) */
export function StreakBadge({ game, onDark }: { game: string; onDark?: boolean }) {
  const s = useStyles(makeStyles);
  const c = useColors();
  const has = useStreaks((st) => Boolean(st.data));
  const g = useStreaks((st) => streakOf(st, game));
  useEffect(() => {
    if (!useStreaks.getState().data) loadStreaks();
  }, []);
  if (!has) return null;
  const n = g ? g.current : 0;
  const lit = Boolean(g && g.today);
  const risk = Boolean(g && g.atRisk);
  const dark = c.scheme === "dark";
  const bg = onDark
    ? risk
      ? "#FFD54A"
      : lit
        ? "#FFFFFF"
        : "rgba(255,255,255,0.16)"
    : risk
      ? dark
        ? "#3A2F12"
        : "#FFF3C4"
      : lit
        ? dark
          ? "#4A2E14"
          : "#FFEBD6"
        : c.field;
  const fg = onDark ? (risk ? "#3A2A00" : lit ? "#A14400" : "#FFFFFF") : risk ? (dark ? "#F2C04E" : "#7A5600") : lit ? (dark ? "#FFC58F" : "#A14400") : c.muted;
  return (
    <Pressable
      onPress={() => openStreaks(game)}
      hitSlop={6}
      style={({ pressed }) => [s.badge, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }, risk && !onDark && { borderWidth: 1.5, borderColor: "#F5B300" }]}
      accessibilityRole="button"
      accessibilityLabel={`Chuỗi ${g?.name || ""}: ${n} ngày${risk ? ", chơi hôm nay để giữ chuỗi" : lit ? ", hôm nay đã chơi" : ""}. Xem chi tiết`}
    >
      <Flame size={20} lit={lit} />
      <Text style={[s.badgeText, { color: fg }]}>{n}</Text>
    </Pressable>
  );
}

/** Khung chuỗi chung ở đầu trang Trò chơi */
export function StreakHero() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const o = useStreaks((st) => st.data?.overall ?? null);
  if (!o) return null;
  const title = o.current ? `${o.current} ngày liên tiếp chơi game` : "Chuỗi chơi game";
  const line = o.today
    ? `Hôm nay đã giữ chuỗi${o.best > o.current ? ` · Kỷ lục ${o.best} ngày` : o.current > 1 ? " · Kỷ lục mới!" : ""}`
    : o.atRisk
      ? "Chơi một game hôm nay để giữ chuỗi!"
      : "Ngày nào cũng chơi một chút để chuỗi lớn dần.";
  return (
    <Pressable
      onPress={() => openStreaks(null)}
      style={({ pressed }) => [s.hero, o.atRisk && { borderColor: "#F5B300", borderWidth: 1.5 }, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${line}. Xem chuỗi từng game`}
    >
      <View style={s.heroFlame}>
        <LiveFlame size={60} lit={o.today || o.current > 0} />
        <Text style={[s.heroNum, !(o.today || o.current > 0) && { color: c.text, textShadowRadius: 0 }]}>{o.current}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.heroTitle}>{title}</Text>
        <Text style={[s.heroLine, o.atRisk && { color: c.scheme === "dark" ? "#F2C04E" : "#7A5600", fontWeight: "700" }]}>{line}</Text>
        <WeekStrip week={o.week} />
      </View>
      <Text style={s.heroMore}>›</Text>
    </Pressable>
  );
}

/* ---------------- Bảng chi tiết, chúc mừng ---------------- */

function Row({ g, focus }: { g: GameStreak; focus: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={[s.row, focus && { backgroundColor: c.jadeWash }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowName}>{g.name}</Text>
        <Text style={[s.rowSub, g.atRisk && { color: c.scheme === "dark" ? "#F2C04E" : "#7A5600", fontWeight: "700" }]}>
          {g.atRisk ? "Chơi hôm nay để giữ chuỗi" : g.today ? "Hôm nay đã chơi" : g.best ? `Kỷ lục ${g.best} ngày` : "Chưa có chuỗi"}
        </Text>
        <WeekStrip week={g.week} small />
      </View>
      <View style={s.rowCount} accessible accessibilityLabel={`${g.current} ngày, kỷ lục ${g.best} ngày`}>
        <Flame size={26} lit={g.today} />
        <Text style={[s.rowNum, g.today && { color: "#D35400" }]}>{g.current}</Text>
      </View>
    </View>
  );
}

function BigFlame({ o, size }: { o: Streak; size: number }) {
  const s = useStyles(makeStyles);
  const lit = o.today || o.current > 0;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <LiveFlame size={size} lit={lit} />
      <Text style={[s.bigNum, { fontSize: size * 0.27 }, !lit && s.bigNumOff]}>{o.current}</Text>
    </View>
  );
}

function Pop({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, friction: 4, tension: 110, useNativeDriver: native }).start();
  }, [v]);
  return (
    <Animated.View
      style={{
        opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
        transform: [
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
          { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-12deg", "0deg"] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

export function StreakHost() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const sheet = useStreaks((st) => st.sheet);
  const data = useStreaks((st) => st.data);
  const detail = sheet?.kind === "detail" ? sheet : null;
  const mile = sheet?.kind === "milestone" ? sheet.event : null;
  const reached = data ? Math.max(data.overall.best, ...data.games.map((g) => g.best)) : 0;
  const n = mile ? mile.milestone || mile.overallMilestone || 0 : 0;
  return (
    <>
      <Sheet visible={Boolean(detail)} onClose={closeStreaks} title="Chuỗi hằng ngày">
        {detail && data ? (
          <>
            <View style={s.top}>
              <BigFlame o={data.overall} size={84} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.topTitle}>{data.overall.current ? `${data.overall.current} ngày liên tiếp chơi game` : "Chưa có chuỗi chơi game"}</Text>
                <Text style={s.note}>{data.overall.best ? `Kỷ lục: ${data.overall.best} ngày` : "Chơi game bất kỳ hôm nay để bắt đầu."}</Text>
                <WeekStrip week={data.overall.week} />
              </View>
            </View>
            <View style={s.rows}>
              {data.games.map((g, i) => (
                <View key={g.id} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line } : null}>
                  <Row g={g} focus={g.id === detail.game} />
                </View>
              ))}
            </View>
            <View style={s.miles} accessible accessibilityLabel={`Các mốc chuỗi. Đã đạt tới ${reached} ngày`}>
              {data.milestones.slice(0, 8).map((m) => (
                <View key={m} style={[s.mile, m <= reached && { backgroundColor: c.scheme === "dark" ? "#4A2E14" : "#FFEBD6" }]}>
                  <Text style={[s.mileText, m <= reached && { color: c.scheme === "dark" ? "#FFC58F" : "#A14400" }]}>{m} ngày</Text>
                </View>
              ))}
            </View>
            <Pressable
              style={s.remind}
              onPress={() => setRemind(!data.remind)}
              accessibilityRole="switch"
              accessibilityState={{ checked: data.remind }}
              accessibilityLabel="Nhắc giữ chuỗi"
            >
              <View style={{ flex: 1 }}>
                <Text style={s.remindTitle}>Nhắc giữ chuỗi</Text>
                <Text style={s.note}>Khoảng 20 giờ, nếu chuỗi (từ 2 ngày) sắp mất mà hôm nay bạn chưa chơi.</Text>
              </View>
              <Switch
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                value={data.remind}
                onValueChange={setRemind}
                trackColor={{ true: c.jade, false: c.line }}
                thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
              />
            </Pressable>
            <Text style={s.note}>
              Mỗi game có chuỗi riêng: ngày nào có chơi (đi một nước cờ, đặt một khối, làm một việc ở nông trại…) thì chuỗi tăng 1, bỏ một ngày là chuỗi về 0.
              Ngày tính theo giờ Việt Nam. Chơi Xếp Khối, cờ caro với máy lúc mất mạng vẫn được tính khi có mạng lại.
            </Text>
          </>
        ) : detail ? (
          <Text style={s.note}>Đang tải…</Text>
        ) : null}
      </Sheet>
      <Sheet
        visible={Boolean(mile)}
        onClose={closeStreaks}
        title={n ? `${n} ngày liên tiếp!` : ""}
        footer={mile ? <Button title="Tuyệt!" onPress={closeStreaks} /> : null}
      >
        {mile ? (
          <View style={s.cheer} accessibilityLiveRegion="polite">
            <Pop>
              <View style={{ width: 120, height: 120, alignItems: "center", justifyContent: "center" }}>
                <Flame size={120} />
                <Text style={[s.bigNum, { fontSize: 32 }]}>{n}</Text>
              </View>
            </Pop>
            <Text style={s.cheerTitle}>
              {mile.milestone ? `Chuỗi ${mile.name}` : "Chuỗi chơi game"} vừa đạt mốc {n} ngày
            </Text>
            <Text style={[s.note, { textAlign: "center" }]}>
              {n >= 30 ? "Quá đỉnh! Giữ lửa tiếp nhé." : "Giỏi lắm! Mai nhớ ghé chơi tiếp để chuỗi không bị đứt."}
            </Text>
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    week: { flexDirection: "row", gap: 6, marginTop: 4 },
    weekItem: { alignItems: "center", gap: 2 },
    dot: { backgroundColor: c.field, alignItems: "center", justifyContent: "center" },
    weekLabel: { color: c.muted, fontSize: 11, fontWeight: "700" },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.92)",
    },
    chipRisk: { backgroundColor: "#FFD54A" },
    chipText: { color: "#8A3A00", fontSize: 12.5, fontWeight: "800" },
    badge: { flexDirection: "row", alignItems: "center", gap: 4, height: 34, paddingLeft: 8, paddingRight: 10, borderRadius: 17 },
    badgeText: { fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
    hero: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 14,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    heroFlame: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
    heroNum: {
      position: "absolute",
      bottom: 4,
      color: "#FFFFFF",
      fontSize: 17,
      fontWeight: "900",
      textShadowColor: "rgba(120,40,0,0.55)",
      textShadowRadius: 2,
      textShadowOffset: { width: 0, height: 1 },
    },
    heroTitle: { color: c.text, fontSize: 16, fontWeight: "800" },
    heroLine: { color: c.muted, fontSize: 13.5 },
    heroMore: { color: c.muted, fontSize: 28, lineHeight: 30 },
    top: { flexDirection: "row", alignItems: "center", gap: 16 },
    topTitle: { color: c.text, fontSize: 18, fontWeight: "800" },
    note: { color: c.muted, fontSize: 13.5, lineHeight: 19 },
    bigNum: {
      position: "absolute",
      bottom: "8%",
      color: "#FFFFFF",
      fontWeight: "900",
      textShadowColor: "rgba(120,40,0,0.55)",
      textShadowRadius: 3,
      textShadowOffset: { width: 0, height: 1 },
    },
    bigNumOff: { color: c.text, textShadowRadius: 0 },
    rows: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
    rowName: { color: c.text, fontSize: 15, fontWeight: "800" },
    rowSub: { color: c.muted, fontSize: 12.5 },
    rowCount: { flexDirection: "row", alignItems: "center", gap: 4 },
    rowNum: { color: c.muted, fontSize: 20, fontWeight: "900", fontVariant: ["tabular-nums"] },
    miles: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    mile: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: c.field },
    mileText: { color: c.muted, fontSize: 13, fontWeight: "800" },
    remind: { flexDirection: "row", alignItems: "center", gap: 12 },
    remindTitle: { color: c.text, fontSize: 15, fontWeight: "800" },
    cheer: { alignItems: "center", gap: 10, paddingVertical: 8 },
    cheerTitle: { color: c.text, fontSize: 19, fontWeight: "800", textAlign: "center" },
  });
