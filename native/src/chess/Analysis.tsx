import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";

import { useColors, type Colors } from "../theme";
import { Button, Icon, useStyles } from "../ui";
import { evalText, MOVE_CLASS, moveComment } from "./format";
import { useSide } from "./parts";
import { loadAnalysis, requestAnalysis, useChess } from "./store";
import type { AnalysisResult, ChessGame, Color } from "./types";

// Phân tích ván bằng Stockfish (máy chủ chấm từng nước): độ chính xác, biểu đồ đánh giá, nhận xét từng nước

export function AnalysisPanel({ g, ply, onJump }: { g: ChessGame; ply: number; onJump: (ply: number) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const a = useChess((st) => st.analyses[g.id]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!useChess.getState().analyses[g.id]) loadAnalysis(g.id);
  }, [g.id]);

  if (g.status !== "finished" || g.moves.length < 2) return null;

  if (!a || a.status === "none" || a.status === "error") {
    return (
      <View style={s.card}>
        <View style={s.headRow}>
          <Icon name="insights" size={22} color={c.accent} />
          <Text style={s.title}>Phân tích ván đấu</Text>
        </View>
        <Text style={s.hint}>
          {a?.status === "error"
            ? a.error || "Phân tích bị lỗi."
            : "Máy Stockfish trên máy chủ sẽ chấm từng nước: nước hay, thiếu chính xác, sai lầm, và độ chính xác của mỗi bên. Mất khoảng 1 phút."}
        </Text>
        <Button
          title={a?.status === "error" ? "Thử lại" : "Phân tích bằng Stockfish"}
          icon="auto-graph"
          busy={busy || !a}
          onPress={async () => {
            setBusy(true);
            await requestAnalysis(g.id);
            setBusy(false);
          }}
        />
      </View>
    );
  }

  if (a.status === "queued" || a.status === "running") {
    const pct = a.total ? Math.round((a.progress / a.total) * 100) : 0;
    return (
      <View style={s.card} accessibilityLiveRegion="polite">
        <View style={s.headRow}>
          <Icon name="insights" size={22} color={c.accent} />
          <Text style={s.title}>Đang phân tích…</Text>
          <Text style={s.pct}>{pct}%</Text>
        </View>
        <View style={s.track}>
          <View style={[s.fill, { width: `${Math.max(3, pct)}%` }]} />
        </View>
        <Text style={s.hint}>
          {a.status === "queued" && a.position && a.position > 1
            ? `Đang chờ tới lượt (thứ ${a.position}). Bạn cứ làm việc khác, xong app sẽ báo.`
            : `Stockfish đang chấm thế cờ ${a.progress}/${a.total}. Bạn cứ làm việc khác, xong app sẽ báo.`}
        </Text>
      </View>
    );
  }

  const r = a.result;
  if (!r) return null;
  return <AnalysisResultView g={g} r={r} ply={ply} onJump={onJump} />;
}

function AnalysisResultView({ g, r, ply, onJump }: { g: ChessGame; r: AnalysisResult; ply: number; onJump: (ply: number) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const move = ply > 0 ? r.moves[ply - 1] : undefined;
  const pos = r.positions[ply];
  const comment = move ? moveComment(move, r.positions[ply - 1]) : "Thế cờ ban đầu. Chạm vào biểu đồ hoặc dùng nút ‹ › để xem từng nước.";
  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <Icon name="insights" size={22} color={c.accent} />
        <Text style={s.title}>Phân tích ván đấu</Text>
        <Text style={s.engine}>{r.engine}</Text>
      </View>
      <View style={s.sides}>
        <SideStats g={g} r={r} color="w" />
        <SideStats g={g} r={r} color="b" />
      </View>
      <EvalGraph r={r} ply={ply} onJump={onJump} />
      <View style={s.comment}>
        <View style={[s.evalChip, { backgroundColor: pos && pos.wp >= 50 ? "#F4F4F0" : "#26302C" }]}>
          <Text style={[s.evalText, { color: pos && pos.wp >= 50 ? "#14201C" : "#FFFFFF" }]}>{evalText(pos)}</Text>
        </View>
        <Text style={[s.commentText, move && move.cls !== "good" && move.cls !== "best" ? { color: MOVE_CLASS[move.cls].color } : null]}>
          {comment}
        </Text>
      </View>
      {pos?.bestSan && ply < g.moves.length ? <Text style={s.hint}>Máy gợi ý đi tiếp: {pos.bestSan} (mũi tên xanh trên bàn cờ).</Text> : null}
    </View>
  );
}

function SideStats({ g, r, color }: { g: ChessGame; r: AnalysisResult; color: Color }) {
  const s = useStyles(makeStyles);
  const side = useSide(g, color);
  const n = r.counts[color];
  return (
    <View style={s.side}>
      <View style={s.sideHead}>
        <View style={[s.dot, { backgroundColor: color === "w" ? "#FFFFFF" : "#222222" }]} />
        <Text style={s.sideName} numberOfLines={1}>
          {side.name}
        </Text>
      </View>
      <Text style={s.acc}>{r.accuracy[color] ?? "—"}%</Text>
      <Text style={s.accLabel}>độ chính xác</Text>
      <View style={s.counts}>
        <Count label="?!" value={n.inaccuracy} color={MOVE_CLASS.inaccuracy.color} name="thiếu chính xác" />
        <Count label="?" value={n.mistake} color={MOVE_CLASS.mistake.color} name="sai lầm" />
        <Count label="??" value={n.blunder} color={MOVE_CLASS.blunder.color} name="sai lầm nghiêm trọng" />
      </View>
    </View>
  );
}

function Count({ label, value, color, name }: { label: string; value: number; color: string; name: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.count} accessibilityLabel={`${value} ${name}`}>
      <Text style={[s.countSym, { color }]}>{label}</Text>
      <Text style={s.countNum}>{value}</Text>
    </View>
  );
}

/** Biểu đồ khả năng thắng của Trắng qua từng nước (trên = Trắng hơn), chạm để nhảy tới nước đó */
function EvalGraph({ r, ply, onJump }: { r: AnalysisResult; ply: number; onJump: (ply: number) => void }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const h = 84;
  const n = r.positions.length - 1;
  const x = (i: number) => (n ? (i / n) * w : 0);
  const y = (wp: number) => h - (wp / 100) * h;
  let line = "";
  r.positions.forEach((p, i) => {
    line += `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.wp).toFixed(1)}`;
  });
  const area = `${line}L${w},${h}L0,${h}Z`;
  const marks = r.moves.filter((m) => m.cls === "mistake" || m.cls === "blunder");
  return (
    <Pressable
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      onPress={(e) => {
        if (!w) return;
        const i = Math.round((e.nativeEvent.locationX / w) * n);
        onJump(Math.max(0, Math.min(n, i)));
      }}
      style={{ height: h, borderRadius: 10, overflow: "hidden" }}
      accessibilityRole="adjustable"
      accessibilityLabel="Biểu đồ đánh giá ván cờ. Chạm để xem nước đi đó."
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => onJump(Math.max(0, Math.min(n, ply + (e.nativeEvent.actionName === "increment" ? 1 : -1))))}
    >
      {w ? (
        <Svg width={w} height={h}>
          <Rect x={0} y={0} width={w} height={h} fill="#26302C" />
          <Path d={area} fill="#F4F4F0" />
          <Line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="rgba(128,128,128,0.6)" strokeWidth={1} strokeDasharray="4 4" />
          {marks.map((m) => (
            <Line key={m.ply} x1={x(m.ply)} y1={0} x2={x(m.ply)} y2={h} stroke={MOVE_CLASS[m.cls].color} strokeWidth={1.5} opacity={0.75} />
          ))}
          <Line x1={x(ply)} y1={0} x2={x(ply)} y2={h} stroke={c.jade} strokeWidth={2.5} />
        </Svg>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: 16, padding: 14, gap: 10 },
    headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flex: 1, color: c.text, fontSize: 16, fontWeight: "800" },
    engine: { color: c.muted, fontSize: 12, fontWeight: "600" },
    pct: { color: c.accent, fontSize: 15, fontWeight: "800" },
    hint: { color: c.muted, fontSize: 13, lineHeight: 18 },
    track: { height: 8, borderRadius: 4, backgroundColor: c.field, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4, backgroundColor: c.jade },
    sides: { flexDirection: "row", gap: 10 },
    side: { flex: 1, backgroundColor: c.field, borderRadius: 12, padding: 10, alignItems: "center", gap: 2 },
    sideHead: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
    dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: c.line },
    sideName: { color: c.text2, fontSize: 13, fontWeight: "700", flexShrink: 1 },
    acc: { color: c.text, fontSize: 26, fontWeight: "900" },
    accLabel: { color: c.muted, fontSize: 11.5, marginTop: -2 },
    counts: { flexDirection: "row", gap: 10, marginTop: 6 },
    count: { alignItems: "center" },
    countSym: { fontSize: 13, fontWeight: "900" },
    countNum: { color: c.text, fontSize: 14, fontWeight: "800" },
    comment: { flexDirection: "row", alignItems: "center", gap: 10 },
    evalChip: { minWidth: 52, paddingHorizontal: 8, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.line },
    evalText: { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
    commentText: { flex: 1, color: c.text, fontSize: 14, lineHeight: 19, fontWeight: "600" },
  });
