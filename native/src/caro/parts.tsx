import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors, type Colors } from "../theme";
import { Icon, IconButton, useStyles, type IconName } from "../ui";
import { boardPalette, MarkIcon } from "./Board";
import { cellName, type CaroState } from "./engine";
import { countdownText, makesThreat, markName, numSide, signed } from "./format";
import { playCaro } from "./sound";
import { loadGameFresh, setSound, turnLeft, useCaro } from "./store";
import type { CaroGame, Side } from "./types";

// Các phần dùng chung của màn chơi caro: thanh tiêu đề, thẻ người chơi, kết quả, âm thanh theo nước đi.

/** Giờ hiện tại, tự cập nhật (để chạy đồng hồ đếm ngược) */
export function useNow(active: boolean, every = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

export function Header({ title, sub, onBack, right }: { title: string; sub?: string; onBack: () => void; right?: ReactNode }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={s.header}>
      <IconButton name="arrow-back" label="Quay lại" onPress={onBack} color={c.text} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {sub ? (
          <Text style={s.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Nút bật / tắt âm thanh caro */
export function SoundButton() {
  const c = useColors();
  const on = useCaro((s) => s.sound);
  return (
    <IconButton
      name={on ? "volume-up" : "volume-off"}
      label={on ? "Tắt âm thanh" : "Bật âm thanh"}
      onPress={() => {
        setSound(!on);
        if (!on) setTimeout(() => playCaro("place-x", 0.8), 60);
      }}
      color={c.text2}
    />
  );
}

/** Ảnh đại diện của máy */
export function BotAvatar({ size = 40 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#7B55D6", alignItems: "center", justifyContent: "center" }}>
      <Icon name="smart-toy" size={size * 0.56} color="#fff" />
    </View>
  );
}

/** Ảnh đại diện kèm huy hiệu X / O ở góc */
export function SideAvatar({ side, children, size = 40 }: { side: Side; children: ReactNode; size?: number }) {
  const c = useColors();
  const pal = boardPalette(c.scheme);
  const badge = Math.round(size * 0.52);
  return (
    <View style={{ width: size, height: size }}>
      {children}
      <View
        style={{
          position: "absolute",
          right: -badge * 0.3,
          bottom: -badge * 0.25,
          width: badge,
          height: badge,
          borderRadius: badge / 2,
          backgroundColor: c.surface,
          borderWidth: 2,
          borderColor: side === "x" ? pal.x : pal.o,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MarkIcon side={side} size={badge * 0.62} />
      </View>
    </View>
  );
}

/** Thẻ người chơi: ảnh + quân, tên, dòng phụ; viền đậm theo màu quân khi tới lượt */
export function PlayerCard({
  side,
  avatar,
  name,
  sub,
  delta,
  turn,
  right,
}: {
  side: Side;
  avatar: ReactNode;
  name: string;
  sub?: string;
  delta?: number | null;
  turn: boolean;
  right?: boolean;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const pal = boardPalette(c.scheme);
  const tint = side === "x" ? pal.x : pal.o;
  return (
    <View
      style={[s.card, right && { flexDirection: "row-reverse" }, turn && { borderColor: tint, borderWidth: 2.5, padding: 6.5 }]}
      accessible
      accessibilityLabel={`${name}, cầm quân ${markName(side)}${sub ? `, ${sub}` : ""}${delta != null ? `, ${signed(delta)} điểm` : ""}${turn ? ", đang tới lượt" : ""}`}
    >
      <SideAvatar side={side} size={36}>
        {avatar}
      </SideAvatar>
      <View style={[{ flex: 1, minWidth: 0 }, right && { alignItems: "flex-end" }]}>
        <Text style={s.cardName} numberOfLines={1}>
          {name}
        </Text>
        {sub || delta != null ? (
          <Text style={s.cardSub} numberOfLines={1}>
            {sub}
            {delta != null ? <Text style={{ color: delta >= 0 ? c.accent : c.danger, fontWeight: "800" }}>{` ${signed(delta)}`}</Text> : null}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Thanh thời gian còn lại của nước đang đi */
export function TurnBar({ fraction, color }: { fraction: number; color: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.barTrack} accessible={false}>
      <View style={[s.barFill, { width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export type Outcome = "win" | "loss" | "draw" | "aborted" | "none";

/** Thẻ kết quả ván: biểu tượng, tiêu đề, lý do, điểm cộng / trừ */
export function ResultCard({ outcome, title, reason, delta, after }: { outcome: Outcome; title: string; reason?: string; delta?: number | null; after?: number | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, friction: 6, tension: 140, useNativeDriver: Platform.OS !== "web" }).start();
  }, [t]);
  const tint = outcome === "win" ? c.accent : outcome === "loss" ? c.danger : c.text2;
  const bg = outcome === "win" ? c.jadeWash : outcome === "loss" ? c.dangerWash : c.field;
  const icon: IconName = outcome === "win" ? "emoji-events" : outcome === "loss" ? "sentiment-dissatisfied" : outcome === "draw" ? "handshake" : "block";
  return (
    <Animated.View
      style={[s.result, { backgroundColor: bg, opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={`${title}. ${reason || ""}${delta != null ? ` ${signed(delta)} điểm ELO.` : ""}`}
    >
      <View style={[s.resultIcon, { backgroundColor: outcome === "win" ? c.turmeric : "transparent" }]}>
        <Icon name={icon} size={outcome === "win" ? 28 : 32} color={outcome === "win" ? "#3A2A00" : tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.resultTitle, { color: tint }]}>{title}</Text>
        {reason ? <Text style={s.resultSub}>{reason}</Text> : null}
      </View>
      {delta != null ? (
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.resultDelta, { color: delta >= 0 ? c.accent : c.danger }]}>{signed(delta)}</Text>
          {after != null ? <Text style={s.resultSub}>ELO {after}</Text> : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Nút hành động trong ván (Đi lại, Ván mới, Đổi bên…) */
export function ActionButton({
  icon,
  title,
  onPress,
  disabled,
  kind = "plain",
  busy,
}: {
  icon: IconName;
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: "plain" | "primary" | "danger";
  busy?: boolean;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const bg = kind === "primary" ? c.jade : kind === "danger" ? c.dangerWash : c.surface;
  const fg = kind === "primary" ? c.onJade : kind === "danger" ? c.danger : c.text;
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.action, { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.8 : 1 }, kind === "plain" && { borderColor: c.line, borderWidth: StyleSheet.hairlineWidth }]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
    >
      <Icon name={icon} size={20} color={kind === "plain" ? c.accent : fg} />
      <Text style={[s.actionText, { color: fg }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * Âm thanh theo nước đi: bàn tiến thêm đúng một nước thì phát tiếng đặt quân (+ tiếng "sắp thắng" khi có thế 4,
 * hoặc tiếng báo tới lượt khi đối thủ vừa đi trong ván với bạn bè). Mở ván hay đi lại thì không phát.
 */
export function useMoveSounds(st: CaroState, mine: Side | null, opts: { online?: boolean; active: boolean; announce?: (i: number) => string | null }) {
  const n = st.moves.length;
  const lastN = useRef(n);
  const ref = useRef({ st, mine, opts });
  ref.current = { st, mine, opts };
  useEffect(() => {
    const before = lastN.current;
    lastN.current = n;
    if (n !== before + 1) return;
    const { st: cur, mine: me, opts: o } = ref.current;
    const i = cur.moves[n - 1];
    const mover = numSide(cur.board[i]);
    if (!mover) return;
    playCaro(mover === "x" ? "place-x" : "place-o", 0.9);
    if (!cur.winner && makesThreat(cur.board, i)) playCaro("threat", 0.8, 150);
    else if (o.online && o.active && me && mover !== me) playCaro("turn", 0.6, 170);
    const text = o.announce?.(i);
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [n]);
}

/**
 * Ván vừa kết thúc lúc đang xem: tiếng thắng / thua / hòa, đọc kết quả cho trình đọc màn hình,
 * và trả về lượt pháo giấy khi mình thắng (mở một ván đã xong từ trước thì không có gì).
 */
export function useEndEffects(outcome: Outcome | null, side: Side | null, speech?: string) {
  const prev = useRef(outcome);
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [confetti, setConfetti] = useState<{ side: Side; key: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = outcome;
    if (!outcome) setConfetti(null); // đi lại / ván mới
    if (before || !outcome) return;
    if (outcome === "win") {
      playCaro("win", 0.9, 300);
      if (side) setConfetti({ side, key: Date.now() });
    } else if (outcome === "loss") playCaro("lose", 0.9, 300);
    else if (outcome === "draw") playCaro("draw", 0.9, 300);
    if (speechRef.current) AccessibilityInfo.announceForAccessibility(speechRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);
  return confetti;
}

/* ---------------- Đồng hồ mỗi nước (tách riêng để chỉ phần nhỏ này vẽ lại mỗi 1/4 giây, không phải cả bàn cờ) ---------------- */

type ClockProps = { g: CaroGame; offset: number };

function useTurnLeft({ g, offset }: ClockProps) {
  const running = g.status === "active" && g.turnMs > 0 && g.turnStartedAt != null;
  const now = useNow(running, 250);
  const left = turnLeft(g, offset, now);
  const frac = left != null && g.turnMs ? left / g.turnMs : 1;
  const low = left != null && (frac <= 0.25 || left <= 5000);
  return { left, frac, low };
}

/** Số giây còn lại của nước đang đi (ở giữa hai thẻ người chơi) */
export function ClockFace(props: ClockProps) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { left, low } = useTurnLeft(props);
  const { g } = props;
  // Hết giờ mà chưa nhận được kết quả (mất sự kiện realtime): hỏi lại máy chủ
  const zero = left === 0;
  useEffect(() => {
    if (!zero) return;
    const t = setTimeout(() => loadGameFresh(g.id), 2500);
    return () => clearTimeout(t);
  }, [zero, g.id, g.turnStartedAt]);
  if (left == null) return <Text style={s.vs}>VS</Text>;
  return (
    <>
      <Text style={[s.clock, { color: low ? c.danger : c.text }]} accessibilityLabel={`Còn ${Math.ceil(left / 1000)} giây cho nước này`}>
        {countdownText(left)}
      </Text>
      <Text style={s.clockSub}>còn lại</Text>
    </>
  );
}

/** Thanh thời gian còn lại của nước đang đi: xanh → vàng → đỏ */
export function ClockBar(props: ClockProps) {
  const c = useColors();
  const { left, frac, low } = useTurnLeft(props);
  if (left == null) return <View style={{ height: 5 }} />;
  return <TurnBar fraction={frac} color={low ? c.danger : frac <= 0.5 ? c.turmeric : c.jade} />;
}

export const cellText = (i: number | null | undefined) => (i == null || i < 0 ? "" : cellName(i));

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 },
    title: { color: c.text, fontSize: 17, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5 },
    card: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 8,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
    },
    cardName: { color: c.text, fontSize: 15, fontWeight: "800" },
    cardSub: { color: c.muted, fontSize: 12.5, fontWeight: "600", marginTop: 1 },
    barTrack: { height: 5, borderRadius: 3, backgroundColor: c.field, overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 3 },
    result: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18 },
    resultIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
    resultTitle: { fontSize: 20, fontWeight: "900" },
    resultSub: { color: c.text2, fontSize: 13.5, marginTop: 2 },
    resultDelta: { fontSize: 22, fontWeight: "900" },
    action: { flex: 1, minHeight: 46, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8 },
    actionText: { fontSize: 14.5, fontWeight: "800", flexShrink: 1 },
    vs: { color: c.muted, fontSize: 17, fontWeight: "900" },
    clock: { fontSize: 19, fontWeight: "900", fontVariant: ["tabular-nums"] },
    clockSub: { color: c.muted, fontSize: 11, fontWeight: "700" },
  });
