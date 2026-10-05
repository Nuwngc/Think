import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";

import { api } from "../api";
import { useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Sheet, useStyles } from "../ui";
import { ClassBadge } from "./Analysis";
import { BotAvatar } from "./parts";
import { openStats, useChess } from "./store";
import type { ChessStats } from "./types";

// Thống kê cờ vua của một người (GET /api/chess/stats/<người>): ô số liệu, biểu đồ ELO theo thời gian,
// thắng / hòa / thua theo màu quân, đối đầu từng bạn, với máy, khai cuộc hay chơi.

type WDL = { win: number; draw: number; loss: number };
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const dateText = (t: number) => new Date(t).toLocaleDateString("vi-VN", { day: "numeric", month: "numeric", year: "2-digit" });

export function StatsSheet() {
  const s = useStyles(makeStyles);
  const userId = useChess((st) => st.statsFor);
  const meId = useStore((st) => st.me?.id ?? 0);
  const name = useStore((st) => (userId != null ? st.users[userId]?.displayName : undefined));
  const [stats, setStats] = useState<ChessStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userId == null) return;
    let alive = true;
    setStats(null);
    setError(null);
    api
      .chessStats(userId === meId ? "me" : userId)
      .then((r) => alive && setStats(r.stats))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Chưa tải được thống kê."));
    return () => {
      alive = false;
    };
  }, [userId, meId]);

  const mine = userId === meId;
  return (
    <Sheet visible={userId != null} onClose={() => openStats(null)} title={mine ? "Thống kê cờ vua của bạn" : `Thống kê: ${name || "Người dùng"}`}>
      {error ? <Text style={[s.muted, s.error]}>{error}</Text> : null}
      {!stats && !error ? <Text style={s.muted}>Đang tải…</Text> : null}
      {stats ? <StatsBody st={stats} /> : null}
    </Sheet>
  );
}

function StatsBody({ st }: { st: ChessStats }) {
  const s = useStyles(makeStyles);
  const t = st.totals;
  const all = t.all.win + t.all.draw + t.all.loss;
  const score = (o: WDL) => `${o.win} – ${o.draw} – ${o.loss}`;
  return (
    <View style={{ gap: 14 }}>
      <View style={s.tiles}>
        <Tile value={String(st.rating.rating)} label={`ELO${st.rating.provisional ? " (tạm)" : ""} · cao nhất ${st.rating.peak}`} />
        <Tile value={String(all)} label="ván đã xong" />
        <Tile value={`${pct(t.all.win, all)}%`} label="tỉ lệ thắng" />
        <Tile value={String(st.streak.best)} label={`chuỗi thắng dài nhất${st.streak.current > 1 ? ` (đang ${st.streak.current})` : ""}`} />
        {st.fastestMate ? <Tile value={`${st.fastestMate.moves} nước`} label="chiếu hết nhanh nhất" /> : null}
      </View>

      {st.history.length >= 2 ? (
        <View style={{ gap: 6 }}>
          <Text style={s.label}>ELO qua các ván xếp hạng</Text>
          <EloChart points={st.history} />
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <Text style={s.label}>Kết quả</Text>
        <WdlRow label="Tất cả" t={t.all} />
        <WdlRow label="Cầm quân Trắng" t={t.white} />
        <WdlRow label="Cầm quân Đen" t={t.black} />
        <WdlRow label="Với bạn bè" t={t.friends} />
        <WdlRow label="Với máy" t={t.bots} />
      </View>

      {st.opponents.length ? (
        <View style={{ gap: 4 }}>
          <Text style={s.label}>Đối đầu (thắng – hòa – thua)</Text>
          {st.opponents.map((o) => (
            <OpponentRow key={o.userId} userId={o.userId} fallback={o.name} sub={`Ván gần nhất ${dateText(o.last)}`} score={score(o)} />
          ))}
        </View>
      ) : null}

      {st.bots.length ? (
        <View style={{ gap: 4 }}>
          <Text style={s.label}>Với máy (thắng – hòa – thua)</Text>
          {st.bots.map((b) => (
            <View key={b.bot} style={s.row}>
              <BotAvatar bot={{ elo: b.elo || 1200, avatar: b.avatar }} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {b.name}
                </Text>
                {b.elo ? <Text style={s.muted}>~{b.elo} ELO</Text> : null}
              </View>
              <Text style={s.score}>{score(b)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {st.openings.length ? (
        <View style={{ gap: 4 }}>
          <Text style={s.label}>Khai cuộc hay chơi</Text>
          {st.openings.map((o) => (
            <View key={o.name} style={s.row}>
              <ClassBadge cls="book" size={22} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {o.name}
                </Text>
                <Text style={s.muted}>
                  {o.eco} · {o.games} ván · thắng {pct(o.win, o.games)}%
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {!all ? <Text style={s.muted}>Chưa có ván nào xong. Chơi vài ván rồi quay lại xem nhé!</Text> : null}
    </View>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.tile}>
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

function OpponentRow({ userId, fallback, sub, score }: { userId: number; fallback: string; sub: string; score: string }) {
  const s = useStyles(makeStyles);
  const user = useStore((st) => st.users[userId]);
  return (
    <View style={s.row}>
      <Avatar user={user} size={34} dot={false} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {user?.displayName || fallback}
        </Text>
        <Text style={s.muted}>{sub}</Text>
      </View>
      <Text style={s.score}>{score}</Text>
    </View>
  );
}

/** Thanh thắng / hòa / thua (màu theo kết quả, luôn có chữ số bên cạnh) */
function WdlRow({ label, t }: { label: string; t: WDL }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const n = t.win + t.draw + t.loss;
  const seg = (v: number, color: string, op = 1) =>
    v ? <View style={{ flex: v, backgroundColor: color, opacity: op, borderRadius: 4, minWidth: 4 }} /> : null;
  return (
    <View style={{ gap: 5, paddingVertical: 5 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 10 }}>
        <Text style={s.rowTitle}>{label}</Text>
        <Text style={s.muted}>{n ? `${t.win} thắng · ${t.draw} hòa · ${t.loss} thua · thắng ${pct(t.win, n)}%` : "Chưa có ván nào"}</Text>
      </View>
      {n ? (
        <View style={{ flexDirection: "row", gap: 2, height: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {seg(t.win, c.accent)}
          {seg(t.draw, c.muted, 0.55)}
          {seg(t.loss, c.danger)}
        </View>
      ) : null}
    </View>
  );
}

/** Biểu đồ ELO: một đường, lưới mảnh, chạm / kéo ngón tay để xem từng ván */
function EloChart({ points }: { points: { t: number; r: number; d?: number }[] }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const [w, setW] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const box = useRef<View>(null);
  const H = 150;
  const PAD = { l: 36, r: 12, t: 22, b: 12 };
  const rs = points.map((p) => p.r);
  let lo = Math.min(...rs);
  let hi = Math.max(...rs);
  if (hi - lo < 40) {
    lo -= 20;
    hi += 20;
  }
  lo = Math.floor(lo / 10) * 10;
  hi = Math.ceil(hi / 10) * 10;
  const last = points.length - 1;
  const x = (i: number) => PAD.l + (last ? (i / last) * (w - PAD.l - PAD.r) : (w - PAD.l - PAD.r) / 2);
  const y = (r: number) => PAD.t + (1 - (r - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const at = (lx: number) => Math.max(0, Math.min(last, Math.round(((lx - PAD.l) / Math.max(1, w - PAD.l - PAD.r)) * last)));
  const p = pick != null ? points[pick] : null;
  return (
    <Pressable
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={{ height: H }}
      ref={box}
      onPress={(e) => {
        // locationX: chỗ chạm trong biểu đồ (bản web có khi không có: tính từ pageX)
        const lx = e.nativeEvent.locationX;
        const pageX = e.nativeEvent.pageX;
        if (Number.isFinite(lx)) setPick(at(lx));
        else box.current?.measure((_x, _y, _w, _h, px) => setPick(at(pageX - px)));
      }}
      accessibilityLabel={`Điểm ELO qua ${last} ván xếp hạng, từ ${rs[0]} đến ${rs[last]}, cao nhất ${Math.max(...rs)}. Chạm để xem từng ván.`}
    >
      {w ? (
        <View pointerEvents="none">
          <Svg width={w} height={H}>
            {[lo, (lo + hi) / 2, hi].map((v) => (
              <Line key={v} x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke={c.line} strokeWidth={1} />
            ))}
            {[lo, (lo + hi) / 2, hi].map((v) => (
              <SvgText key={`t${v}`} x={PAD.l - 6} y={y(v) + 4} fontSize={10} fontWeight="600" fill={c.muted} textAnchor="end">
                {String(Math.round(v))}
              </SvgText>
            ))}
            <Polyline
              points={points.map((q, i) => `${x(i)},${y(q.r)}`).join(" ")}
              fill="none"
              stroke={c.accent}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Circle cx={x(last)} cy={y(rs[last])} r={4} fill={c.accent} stroke={c.surface} strokeWidth={2} />
            {p && pick != null ? (
              <>
                <Line x1={x(pick)} x2={x(pick)} y1={PAD.t} y2={H - PAD.b} stroke={c.muted} strokeWidth={1} />
                <Circle cx={x(pick)} cy={y(p.r)} r={5} fill={c.accent} stroke={c.surface} strokeWidth={2} />
              </>
            ) : null}
          </Svg>
        </View>
      ) : null}
      {p && pick != null ? (
        <View style={[s.tip, { left: Math.max(0, Math.min(w - 170, x(pick) - 85)) }]} pointerEvents="none">
          <Text style={s.tipText}>{pick === 0 ? `Bắt đầu: ${p.r}` : `${p.r} (${(p.d ?? 0) >= 0 ? "+" : ""}${p.d ?? 0}) · ${dateText(p.t)}`}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    label: { color: c.text2, fontSize: 13, fontWeight: "800" },
    muted: { color: c.muted, fontSize: 12.5 },
    error: { color: c.danger },
    tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tile: { width: "48%", flexGrow: 1, padding: 12, borderRadius: 14, backgroundColor: c.field, gap: 2 },
    tileValue: { color: c.text, fontSize: 22, fontWeight: "800", fontVariant: ["tabular-nums"] },
    tileLabel: { color: c.muted, fontSize: 12, fontWeight: "600" },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    rowTitle: { color: c.text, fontSize: 14.5, fontWeight: "700" },
    score: { color: c.text, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
    tip: { position: "absolute", top: 0, width: 170, alignItems: "center" },
    tipText: {
      backgroundColor: c.text,
      color: c.bg,
      fontSize: 12,
      fontWeight: "700",
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      overflow: "hidden",
    },
  });
