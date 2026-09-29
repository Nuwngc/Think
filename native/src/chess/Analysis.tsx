import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";

import { useColors, type Colors } from "../theme";
import { Button, Icon, useStyles, type IconName } from "../ui";
import { CLASS_ORDER, coachText, evalSpeech, evalText, MOVE_CLASS, NOTABLE } from "./format";
import { SideAvatar, useSide } from "./parts";
import { loadAnalysis, requestAnalysis, useChess } from "./store";
import type { AnalysedPosition, AnalysisResult, ChessGame, Color, MoveClass } from "./types";

// Phân tích ván bằng Stockfish kiểu "Game Review": nhận xét từng nước (thiên tài, tuyệt vời, tốt nhất… sai lầm nghiêm trọng),
// thanh đánh giá, biểu đồ, bảng tổng kết độ chính xác và số nước mỗi loại.

/** Huy hiệu loại nước đi: vòng tròn màu có ký hiệu */
export function ClassBadge({ cls, size = 20 }: { cls: MoveClass; size?: number }) {
  const info = MOVE_CLASS[cls] || MOVE_CLASS.good;
  const ink = cls === "inaccuracy" ? "#3B2A00" : "#FFFFFF";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: info.color,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: size >= 16 ? 1 : 0,
        borderColor: "rgba(255,255,255,0.7)",
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {info.icon ? (
        <Icon name={info.icon as IconName} size={Math.round(size * 0.66)} color={ink} />
      ) : (
        <Text style={{ color: ink, fontSize: Math.round(size * 0.52), fontWeight: "900", letterSpacing: -0.5 }}>{info.symbol}</Text>
      )}
    </View>
  );
}

/** Thanh đánh giá cạnh bàn cờ: phần trắng = khả năng thắng của Trắng */
export function EvalBar({ pos, height, orientation, width = 14 }: { pos: AnalysedPosition | undefined; height: number; orientation: Color; width?: number }) {
  const wp = pos ? Math.max(2, Math.min(98, pos.wp)) : 50;
  const white = (height * wp) / 100;
  const text = (evalText(pos) || "0.0").replace(/^\+/, "");
  const whiteBottom = orientation === "w";
  return (
    <View
      style={{ width, height, borderRadius: 4, overflow: "hidden", backgroundColor: "#2A2F2D" }}
      accessibilityLabel={`Đánh giá thế cờ: ${evalSpeech(pos) || text}`}
    >
      <View style={{ position: "absolute", left: 0, right: 0, height: white, backgroundColor: "#F4F4F0", ...(whiteBottom ? { bottom: 0 } : { top: 0 }) }} />
      <Text
        style={{
          position: "absolute",
          left: -4,
          right: -4,
          textAlign: "center",
          fontSize: 8,
          fontWeight: "800",
          color: wp >= 50 ? "#2A2F2D" : "#F4F4F0",
          ...((wp >= 50) === whiteBottom ? { bottom: 3 } : { top: 3 }),
        }}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

/* ---------------- Trạng thái chưa có kết quả ---------------- */

export function AnalysisPanel({ g, ply, onJump, viewer = false }: { g: ChessGame; ply: number; onJump: (ply: number) => void; viewer?: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const a = useChess((st) => st.analyses[g.id]);
  // Người xem ván được chia sẻ: không yêu cầu phân tích được, chỉ xem kết quả nếu người chơi đã phân tích
  const viewerOnly = viewer && (!a || a.status === "none" || a.status === "error");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!useChess.getState().analyses[g.id]) loadAnalysis(g.id);
  }, [g.id]);

  if (g.status !== "finished" || g.moves.length < 2) return null;

  if (!viewerOnly && (!a || a.status === "none" || a.status === "error")) {
    return (
      <View style={s.card}>
        <View style={s.headRow}>
          <Icon name="insights" size={22} color={c.accent} />
          <Text style={s.title}>Đánh giá ván đấu</Text>
        </View>
        <Text style={s.hint}>
          {a?.status === "error"
            ? a.error || "Phân tích bị lỗi."
            : "Stockfish trên máy chủ chấm từng nước như huấn luyện viên: thiên tài, tuyệt vời, tốt nhất, theo sách… đến sai lầm nghiêm trọng, kèm độ chính xác và khai cuộc. Mất khoảng 1 phút."}
        </Text>
        <Button
          title={a?.status === "error" ? "Thử lại" : "Đánh giá ván đấu"}
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
  if (viewerOnly) {
    if (!a) return null;
    return (
      <View style={s.card}>
        <View style={s.headRow}>
          <Icon name="insights" size={22} color={c.accent} />
          <Text style={s.title}>Đánh giá ván đấu</Text>
        </View>
        <Text style={s.hint}>Ván này chưa được phân tích. Người chơi có thể bấm phân tích bằng Stockfish.</Text>
      </View>
    );
  }
  if (!a) return null;

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
  return <ReviewSummary g={g} r={r} ply={ply} onJump={onJump} />;
}

/* ---------------- Nhận xét từng nước ---------------- */

export function ReviewCoach({
  r,
  ply,
  total,
  onJump,
  bestView,
  onToggleBest,
}: {
  r: AnalysisResult;
  ply: number;
  total: number;
  onJump: (ply: number) => void;
  bestView: boolean;
  onToggleBest: () => void;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const m = ply > 0 ? r.moves[ply - 1] : undefined;
  const before = ply > 0 ? r.positions[ply - 1] : undefined;
  const pos = r.positions[ply];
  const nav = (
    <View style={s.coachNav}>
      <Button title="Nước trước" icon="chevron-left" kind="secondary" small style={{ flex: 1 }} disabled={ply === 0} onPress={() => onJump(Math.max(0, ply - 1))} />
      <Button title="Nước sau" icon="chevron-right" small style={{ flex: 1 }} disabled={ply >= total} onPress={() => onJump(ply + 1)} />
    </View>
  );
  if (!m) {
    return (
      <View style={[s.coach, { borderLeftColor: c.jade }]}>
        <View style={s.coachHead}>
          <View style={[s.coachIcon, { backgroundColor: c.jadeWash }]}>
            <Icon name="insights" size={20} color={c.accent} />
          </View>
          <Text style={s.coachTitle}>Xem lại ván đấu</Text>
        </View>
        <Text style={s.coachText}>
          {r.opening ? `Khai cuộc: ${r.opening.name}. ` : ""}Bấm “Nước sau” để xem nhận xét từng nước.
        </Text>
        {nav}
      </View>
    );
  }
  const info = MOVE_CLASS[m.cls] || MOVE_CLASS.good;
  const t = coachText(m, before, r);
  const canBest = Boolean(before?.best && before.bestSan && before.best !== m.uci && !["best", "book", "forced", "brilliant", "great"].includes(m.cls));
  const shown = bestView ? before : pos;
  return (
    <View style={[s.coach, { borderLeftColor: info.color }]} accessibilityLiveRegion="polite">
      <View style={s.coachHead}>
        <ClassBadge cls={bestView ? "best" : m.cls} size={34} />
        <View style={{ flex: 1 }}>
          <Text style={s.coachKicker}>
            {Math.ceil(m.ply / 2)}
            {m.color === "w" ? "." : "…"} {m.color === "w" ? "Trắng" : "Đen"} · {info.label}
          </Text>
          <Text style={s.coachTitle}>{bestView ? `Nước tốt nhất: ${before?.bestSan}` : t.title}</Text>
        </View>
        <View style={[s.evalChip, { backgroundColor: shown && shown.wp >= 50 ? "#F4F4F0" : "#26302C" }]}>
          <Text style={[s.evalText, { color: shown && shown.wp >= 50 ? "#14201C" : "#FFFFFF" }]}>{evalText(shown)}</Text>
        </View>
      </View>
      {bestView ? (
        <Text style={s.coachText}>Thế cờ trước nước {m.san}. Mũi tên xanh là nước máy chọn.</Text>
      ) : t.detail ? (
        <Text style={s.coachText}>{t.detail}</Text>
      ) : null}
      {canBest ? (
        <Pressable
          onPress={onToggleBest}
          style={({ pressed }) => [s.bestBtn, pressed && { backgroundColor: c.jadeWash }]}
          accessibilityRole="button"
          accessibilityState={{ selected: bestView }}
        >
          <Icon name={bestView ? "replay" : "star"} size={18} color={bestView ? c.text2 : MOVE_CLASS.best.color} />
          <Text style={s.bestBtnText}>{bestView ? `Quay lại nước ${m.san}` : `Xem nước tốt nhất (${before?.bestSan})`}</Text>
        </Pressable>
      ) : null}
      {nav}
    </View>
  );
}

/* ---------------- Bảng tổng kết ---------------- */

function SideHead({ g, color, right }: { g: ChessGame; color: Color; right?: boolean }) {
  const s = useStyles(makeStyles);
  const side = useSide(g, color);
  return (
    <View style={[s.sideHead, right && { flexDirection: "row-reverse" }]}>
      <SideAvatar g={g} color={color} size={28} />
      <Text style={[s.sideName, right && { textAlign: "right" }]} numberOfLines={1}>
        {side.name}
      </Text>
    </View>
  );
}

function ReviewSummary({ g, r, ply, onJump }: { g: ChessGame; r: AnalysisResult; ply: number; onJump: (ply: number) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const count = (color: Color, k: MoveClass) => r.counts?.[color]?.[k] || 0;
  const moments = r.moves.filter((m) => m.cls === "brilliant" || m.cls === "great" || m.cls === "blunder" || m.cls === "miss" || m.cls === "mistake").slice(0, 12);
  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <Icon name="insights" size={22} color={c.accent} />
        <Text style={s.title}>Tổng kết ván đấu</Text>
        <Text style={s.engine}>{r.engine}</Text>
      </View>
      <View style={s.sidesRow}>
        <SideHead g={g} color="w" />
        <Text style={s.accLabel}>Độ chính xác</Text>
        <SideHead g={g} color="b" right />
      </View>
      <View style={s.accRow}>
        <View style={[s.accBox, { backgroundColor: "#F4F4F0", borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }]}>
          <Text style={[s.acc, { color: "#14201C" }]}>{r.accuracy.w ?? "—"}</Text>
        </View>
        <View style={[s.accBox, { backgroundColor: "#26302C" }]}>
          <Text style={[s.acc, { color: "#FFFFFF" }]}>{r.accuracy.b ?? "—"}</Text>
        </View>
      </View>
      <View>
        {CLASS_ORDER.map((k, i) => {
          const w = count("w", k);
          const b = count("b", k);
          const info = MOVE_CLASS[k];
          const zero = !w && !b;
          return (
            <View key={k} style={[s.tableRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]} accessibilityLabel={`${info.label}: Trắng ${w}, Đen ${b}`}>
              <Text style={[s.tableNum, { color: w ? info.color : c.muted, opacity: w ? 1 : 0.6 }]}>{w}</Text>
              <View style={[s.tableLabel, zero && { opacity: 0.5 }]}>
                <ClassBadge cls={k} />
                <Text style={[s.tableText, zero && { color: c.muted }]}>{info.label}</Text>
              </View>
              <Text style={[s.tableNum, { color: b ? info.color : c.muted, opacity: b ? 1 : 0.6 }]}>{b}</Text>
            </View>
          );
        })}
      </View>
      {r.opening ? (
        <View style={s.opening}>
          <ClassBadge cls="book" />
          <Text style={s.openingText}>
            Khai cuộc: <Text style={{ fontWeight: "800", color: c.text }}>{r.opening.name}</Text> ({r.opening.eco})
          </Text>
        </View>
      ) : null}
      {moments.length ? (
        <View style={{ gap: 6 }}>
          <Text style={s.momentsTitle}>KHOẢNH KHẮC ĐÁNG CHÚ Ý</Text>
          <View style={s.chips}>
            {moments.map((m) => (
              <Pressable
                key={m.ply}
                onPress={() => onJump(m.ply)}
                style={({ pressed }) => [s.chip, m.ply === ply && { borderColor: MOVE_CLASS[m.cls].color }, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={`Nước ${Math.ceil(m.ply / 2)} ${m.san}, ${MOVE_CLASS[m.cls].label}`}
              >
                <ClassBadge cls={m.cls} />
                <Text style={s.chipText}>
                  {Math.ceil(m.ply / 2)}
                  {m.color === "w" ? "." : "…"} {m.san}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Biểu đồ khả năng thắng của Trắng qua từng nước (trên = Trắng hơn), chạm để nhảy tới nước đó */
export function EvalGraph({ r, ply, onJump }: { r: AnalysisResult; ply: number; onJump: (ply: number) => void }) {
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
  const marks = r.moves.filter((m) => NOTABLE.has(m.cls) && m.cls !== "inaccuracy");
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
          <Line x1={x(ply)} y1={0} x2={x(ply)} y2={h} stroke={c.jade} strokeWidth={2.5} />
        </Svg>
      ) : null}
      {w
        ? marks.map((m) => {
            const p = r.positions[m.ply];
            if (!p) return null;
            return (
              <View
                key={m.ply}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: x(m.ply) - 5.5,
                  top: Math.max(0, Math.min(h - 11, y(p.wp) - 5.5)),
                  width: 11,
                  height: 11,
                  borderRadius: 6,
                  backgroundColor: MOVE_CLASS[m.cls].color,
                  borderWidth: 2,
                  borderColor: c.surface,
                }}
              />
            );
          })
        : null}
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: 16, padding: 14, gap: 12 },
    headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flex: 1, color: c.text, fontSize: 16, fontWeight: "800" },
    engine: { color: c.muted, fontSize: 12, fontWeight: "600" },
    pct: { color: c.accent, fontSize: 15, fontWeight: "800" },
    hint: { color: c.muted, fontSize: 13, lineHeight: 18 },
    track: { height: 8, borderRadius: 4, backgroundColor: c.field, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4, backgroundColor: c.jade },
    coach: { backgroundColor: c.surface, borderRadius: 16, padding: 14, gap: 10, borderLeftWidth: 5 },
    coachHead: { flexDirection: "row", alignItems: "center", gap: 10 },
    coachIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
    coachKicker: { color: c.muted, fontSize: 12, fontWeight: "700" },
    coachTitle: { color: c.text, fontSize: 16, fontWeight: "800", lineHeight: 21 },
    coachText: { color: c.text2, fontSize: 14.5, lineHeight: 20 },
    coachNav: { flexDirection: "row", gap: 8 },
    bestBtn: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: c.field },
    bestBtnText: { color: c.text, fontSize: 14, fontWeight: "700" },
    evalChip: { minWidth: 52, paddingHorizontal: 8, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.line },
    evalText: { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
    sidesRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    sideHead: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
    sideName: { flex: 1, color: c.text, fontSize: 14, fontWeight: "700" },
    accLabel: { color: c.muted, fontSize: 12, fontWeight: "700" },
    accRow: { flexDirection: "row", gap: 10 },
    accBox: { flex: 1, borderRadius: 12, paddingVertical: 8, alignItems: "center" },
    acc: { fontSize: 28, fontWeight: "900", fontVariant: ["tabular-nums"] },
    tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
    tableNum: { width: 40, textAlign: "center", fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
    tableLabel: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
    tableText: { color: c.text, fontSize: 14, fontWeight: "600" },
    opening: { flexDirection: "row", alignItems: "center", gap: 8 },
    openingText: { flex: 1, color: c.text2, fontSize: 14, lineHeight: 19 },
    momentsTitle: { color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 5, paddingRight: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.field, borderWidth: 2, borderColor: "transparent" },
    chipText: { color: c.text, fontSize: 13.5, fontWeight: "700" },
  });
