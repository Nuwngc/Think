import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, type GestureResponderEvent } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";

import { useColors } from "../theme";
import { cellName, SIZE } from "./engine";
import { cellSpeech, markName, numSide } from "./format";
import type { Side } from "./types";

// Bàn cờ caro 15×15 kiểu giấy kẻ ô: vẽ cả lưới lẫn quân trong MỘT hình SVG cho nhẹ,
// chạm được xử lý bằng một vùng chạm duy nhất (tính ô từ vị trí ngón tay), không phải 225 nút.
// Chạm một ô trống: hiện quân mờ (xem trước); chạm lại đúng ô đó: đánh; chạm ô khác: dời quân mờ sang đó.

const EDGE = 2;
const native = Platform.OS !== "web";

export type BoardPalette = {
  paper: string;
  line: string;
  border: string;
  x: string;
  o: string;
  last: string;
  shadow: string;
};

export function boardPalette(scheme: "light" | "dark"): BoardPalette {
  return scheme === "dark"
    ? { paper: "#172231", line: "#2A3C56", border: "#3B5579", x: "#FF6F61", o: "#6EA8FF", last: "rgba(255,206,84,0.3)", shadow: "#000000" }
    : { paper: "#FFFCF1", line: "#C5D5EC", border: "#9DB5D9", x: "#D3352B", o: "#1F60D2", last: "rgba(242,176,30,0.36)", shadow: "#3B5579" };
}

/** Nét vẽ quân X / O trong một ô (tâm cx, cy) */
function xPath(cx: number, cy: number, cell: number) {
  const h = cell * 0.25;
  return `M${cx - h} ${cy - h}L${cx + h} ${cy + h}M${cx + h} ${cy - h}L${cx - h} ${cy + h}`;
}
function oPath(cx: number, cy: number, cell: number) {
  const r = cell * 0.27;
  return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}`;
}
const strokeOf = (cell: number) => Math.max(1.6, cell * 0.11);

/** Hình một quân X hoặc O (huy hiệu bên cạnh tên người chơi, thẻ ở trang Trò chơi…) */
export function MarkIcon({ side, size = 18, color, stroke }: { side: Side; size?: number; color?: string; stroke?: number }) {
  const c = useColors();
  const pal = boardPalette(c.scheme);
  const col = color || (side === "x" ? pal.x : pal.o);
  return (
    <Svg width={size} height={size} pointerEvents="none">
      <Path
        d={side === "x" ? xPath(size / 2, size / 2, size * 1.25) : oPath(size / 2, size / 2, size * 1.25)}
        stroke={col}
        strokeWidth={stroke ?? Math.max(2, size * 0.14)}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

type Drawn = { x: string; o: string };

/** Nét của mọi quân trên bàn (gộp thành hai đường vẽ: một cho X, một cho O) */
function marksOf(board: number[], n: number, cell: number, skip: number | null): Drawn {
  let x = "";
  let o = "";
  for (let i = 0; i < n * n; i++) {
    const v = board[i];
    if (!v || i === skip) continue;
    const cx = EDGE + (i % n) * cell + cell / 2;
    const cy = EDGE + Math.floor(i / n) * cell + cell / 2;
    if (v === 1) x += xPath(cx, cy, cell);
    else o += oPath(cx, cy, cell);
  }
  return { x, o };
}

function gridOf(n: number, cell: number) {
  const end = EDGE + n * cell;
  let d = "";
  for (let k = 1; k < n; k++) {
    const p = EDGE + k * cell;
    d += `M${p} ${EDGE}V${end}M${EDGE} ${p}H${end}`;
  }
  return d;
}

const centerOf = (i: number, n: number, cell: number) => ({ x: EDGE + (i % n) * cell + cell / 2, y: EDGE + Math.floor(i / n) * cell + cell / 2 });

/** Quân vừa đặt: phồng nhẹ lên khi rơi xuống bàn */
function PopMark({ i, v, cell, pal }: { i: number; v: number; cell: number; pal: BoardPalette }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, friction: 5, tension: 170, useNativeDriver: native }).start();
  }, [t]);
  const { x, y } = centerOf(i, SIZE, cell);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x - cell / 2,
        top: y - cell / 2,
        width: cell,
        height: cell,
        opacity: t.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
      }}
    >
      <Svg width={cell} height={cell}>
        <Path
          d={v === 1 ? xPath(cell / 2, cell / 2, cell) : oPath(cell / 2, cell / 2, cell)}
          stroke={v === 1 ? pal.x : pal.o}
          strokeWidth={strokeOf(cell)}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

/** Đường thắng: vệt màu mờ + nét đậm, hiện dần ra */
function WinStroke({ line, cell, color, size }: { line: number[]; cell: number; color: string; size: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [t]);
  const a = centerOf(line[0], SIZE, cell);
  const b = centerOf(line[line.length - 1], SIZE, cell);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ext = cell * 0.38;
  const x1 = a.x - (dx / len) * ext;
  const y1 = a.y - (dy / len) * ext;
  const x2 = b.x + (dx / len) * ext;
  const y2 = b.y + (dy / len) * ext;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: t }]}>
      <Svg width={size} height={size}>
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeOpacity={0.22} strokeWidth={cell * 0.78} strokeLinecap="round" />
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={Math.max(2.5, cell * 0.13)} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

/** Pháo giấy X / O rơi xuống bàn khi thắng (như bản web). Tắt khi máy bật "giảm chuyển động". */
function Confetti({ side, size, pal }: { side: Side; size: number; pal: BoardPalette }) {
  const [reduce, setReduce] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const pieces = useMemo(
    () =>
      Array.from({ length: 16 }, (_, k) => ({
        side: (k % 3 === 2 ? (side === "x" ? "o" : "x") : side) as Side,
        left: 0.04 + Math.random() * 0.84,
        delay: Math.random() * 500,
        duration: 1200 + Math.random() * 800,
        rotate: Math.round(180 + Math.random() * 360) * (Math.random() < 0.5 ? -1 : 1),
      })),
    [side],
  );
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(Boolean(v)))
      .catch(() => alive && setReduce(false));
    const t = setTimeout(() => setDone(true), 2800);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);
  if (reduce !== false || done) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, k) => (
        <ConfettiPiece key={k} {...p} size={size} color={p.side === "x" ? pal.x : pal.o} />
      ))}
    </View>
  );
}

function ConfettiPiece({ side, left, delay, duration, rotate, size, color }: { side: Side; left: number; delay: number; duration: number; rotate: number; size: number; color: string }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration, delay, easing: Easing.bezier(0.3, 0.1, 0.6, 1), useNativeDriver: native }).start();
  }, [t, duration, delay]);
  const w = size * 0.07;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: left * size,
        top: -0.06 * size,
        width: w,
        height: w,
        opacity: t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 1, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, w * 0.1, w * 14] }) },
          { rotate: t.interpolate({ inputRange: [0, 0.12, 1], outputRange: ["0deg", "40deg", `${rotate}deg`] }) },
          { scale: t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.4, 1, 0.9] }) },
        ],
      }}
    >
      <Svg width={w} height={w}>
        <Path
          d={side === "x" ? xPath(w / 2, w / 2, w * 1.3) : oPath(w / 2, w / 2, w * 1.3)}
          stroke={color}
          strokeWidth={Math.max(2, w * 0.15)}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

export type BoardProps = {
  board: number[];
  /** Cỡ tối đa (px) cả bàn, gồm viền */
  size: number;
  /** Thắng lúc đang xem: pháo giấy quân của mình (đổi số để bắn lại) */
  confetti?: { side: Side; key: number } | null;
  last?: number | null;
  /** Các ô của đường thắng */
  line?: number[] | null;
  /** Được đánh lúc này không (đến lượt mình, ván chưa xong) */
  playable: boolean;
  /** Quân của mình (màu quân mờ khi xem trước) */
  mine: Side;
  /** Ô đang xem trước (quân mờ) */
  ghost: number | null;
  onGhost: (i: number | null) => void;
  onPlace: (i: number) => void;
  /** Chạm ô đã có quân / chưa tới lượt */
  onBlocked?: (i: number, why: "occupied" | "turn") => void;
  /** Mô tả cho trình đọc màn hình (tình hình ván) */
  label: string;
};

export const Board = memo(function Board({ board, size, confetti, last = null, line = null, playable, mine, ghost, onGhost, onPlace, onBlocked, label }: BoardProps) {
  const c = useColors();
  const pal = boardPalette(c.scheme);
  const cell = Math.max(12, Math.floor((size - EDGE * 2) / SIZE));
  const outer = cell * SIZE + EDGE * 2;
  const grid = useMemo(() => gridOf(SIZE, cell), [cell]);
  const marks = useMemo(() => marksOf(board, SIZE, cell, last), [board, cell, last]);
  const winner = line && line.length ? board[line[0]] : 0;
  const lastV = last != null ? board[last] : 0;

  // Luôn dùng hàm mới nhất trong lúc chạm (tránh tạo lại vùng chạm)
  const state = useRef({ board, playable, ghost, onGhost, onPlace, onBlocked });
  state.current = { board, playable, ghost, onGhost, onPlace, onBlocked };
  const touch = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const tapCell = (i: number) => {
    const st = state.current;
    if (i < 0 || i >= SIZE * SIZE) return;
    if (st.board[i]) {
      st.onBlocked?.(i, "occupied");
      return;
    }
    if (!st.playable) {
      st.onBlocked?.(i, "turn");
      return;
    }
    if (st.ghost === i) st.onPlace(i);
    else st.onGhost(i);
  };

  const cellAt = (x: number, y: number) => {
    const col = Math.floor((x - EDGE) / cell);
    const row = Math.floor((y - EDGE) / cell);
    if (col < 0 || row < 0 || col >= SIZE || row >= SIZE) return -1;
    return row * SIZE + col;
  };

  const onGrant = (e: GestureResponderEvent) => {
    const n = e.nativeEvent;
    touch.current = { x: n.locationX, y: n.locationY, px: n.pageX, py: n.pageY };
  };
  const onRelease = (e: GestureResponderEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    // Kéo đi xa (đang cuộn màn hình) thì không tính là chạm
    if (Math.hypot(e.nativeEvent.pageX - t.px, e.nativeEvent.pageY - t.py) > 14) return;
    tapCell(cellAt(t.x, t.y));
  };

  /* ---------- Trình đọc màn hình: di ô chọn bằng thao tác lên / xuống / trái / phải, rồi đánh ---------- */
  const cursor = ghost ?? (last != null ? last : Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2));
  const onAction = (name: string) => {
    const st = state.current;
    if (name === "activate") {
      if (st.ghost != null) tapCell(st.ghost);
      else {
        st.onGhost(cursor);
        AccessibilityInfo.announceForAccessibility(`Đang chọn ${cellName(cursor)}, ${cellSpeech(cursor)}. Chạm hai lần nữa để đánh.`);
      }
      return;
    }
    const r = Math.floor(cursor / SIZE);
    const col = cursor % SIZE;
    const dr = name === "up" ? -1 : name === "down" ? 1 : 0;
    const dc = name === "left" ? -1 : name === "right" ? 1 : 0;
    const next = Math.max(0, Math.min(SIZE - 1, r + dr)) * SIZE + Math.max(0, Math.min(SIZE - 1, col + dc));
    st.onGhost(next);
    const v = st.board[next];
    AccessibilityInfo.announceForAccessibility(`${cellName(next)}, ${cellSpeech(next)}${v ? `, đã có quân ${markName(numSide(v)!)}` : ", ô trống"}`);
  };

  const ghostOk = ghost != null && !board[ghost];
  const g = ghost != null ? centerOf(ghost, SIZE, cell) : null;
  const markColor = mine === "x" ? pal.x : pal.o;
  const radius = Math.min(14, cell * 0.55);

  return (
    <View
      style={[styles.wrap, { width: outer, height: outer, borderRadius: radius, shadowColor: pal.shadow, backgroundColor: pal.paper }]}
      onStartShouldSetResponder={() => true}
      onResponderGrant={onGrant}
      onResponderRelease={onRelease}
      onResponderTerminate={() => {
        touch.current = null;
      }}
      onResponderTerminationRequest={() => true}
      accessible
      accessibilityLabel={`${label}${ghost != null ? ` Ô đang chọn: ${cellName(ghost)}.` : ""}`}
      accessibilityHint="Chạm một ô để xem trước, chạm lại ô đó để đánh. Trình đọc màn hình: dùng thao tác lên, xuống, trái, phải để chọn ô."
      accessibilityActions={[
        { name: "activate", label: "Đánh vào ô đang chọn" },
        { name: "up", label: "Chọn ô phía trên" },
        { name: "down", label: "Chọn ô phía dưới" },
        { name: "left", label: "Chọn ô bên trái" },
        { name: "right", label: "Chọn ô bên phải" },
      ]}
      onAccessibilityAction={(e) => onAction(e.nativeEvent.actionName)}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width={outer} height={outer}>
          <Rect x={1} y={1} width={outer - 2} height={outer - 2} rx={radius} ry={radius} fill={pal.paper} />
          <Path d={grid} stroke={pal.line} strokeWidth={1} />
          {last != null && lastV ? (
            <Rect x={EDGE + (last % SIZE) * cell + 1} y={EDGE + Math.floor(last / SIZE) * cell + 1} width={cell - 2} height={cell - 2} rx={3} fill={pal.last} />
          ) : null}
          {g && ghost != null ? (
            <Rect
              x={g.x - cell / 2 + 1.5}
              y={g.y - cell / 2 + 1.5}
              width={cell - 3}
              height={cell - 3}
              rx={3}
              fill={ghostOk ? markColor : "transparent"}
              fillOpacity={0.12}
              stroke={markColor}
              strokeOpacity={0.75}
              strokeWidth={1.5}
              strokeDasharray={ghostOk ? undefined : "3 2"}
            />
          ) : null}
          {marks.x ? <Path d={marks.x} stroke={pal.x} strokeWidth={strokeOf(cell)} strokeLinecap="round" fill="none" /> : null}
          {marks.o ? <Path d={marks.o} stroke={pal.o} strokeWidth={strokeOf(cell)} fill="none" /> : null}
          {g && ghostOk ? (
            <Path
              d={mine === "x" ? xPath(g.x, g.y, cell) : oPath(g.x, g.y, cell)}
              stroke={markColor}
              strokeOpacity={0.42}
              strokeWidth={strokeOf(cell)}
              strokeLinecap="round"
              fill="none"
            />
          ) : null}
          <Rect x={1} y={1} width={outer - 2} height={outer - 2} rx={radius} ry={radius} fill="none" stroke={pal.border} strokeWidth={2} />
        </Svg>
      </View>
      {last != null && lastV ? <PopMark key={`${last}-${lastV}`} i={last} v={lastV} cell={cell} pal={pal} /> : null}
      {line && line.length >= 5 && winner ? (
        <WinStroke key={line.join(",")} line={line} cell={cell} size={outer} color={winner === 1 ? pal.x : pal.o} />
      ) : null}
      {confetti ? <Confetti key={confetti.key} side={confetti.side} size={outer} pal={pal} /> : null}
    </View>
  );
});

/** Bàn nhỏ chỉ để xem (thẻ ván dở, trang Trò chơi). n = số ô mỗi cạnh */
export const MiniBoard = memo(function MiniBoard({
  board,
  n = SIZE,
  size,
  line,
  scheme,
}: {
  board: number[];
  n?: number;
  size: number;
  line?: number[] | null;
  scheme?: "light" | "dark";
}) {
  const c = useColors();
  const pal = boardPalette(scheme || c.scheme);
  const cell = (size - EDGE * 2) / n;
  const outer = size;
  const marks = marksOf(board, n, cell, null);
  const grid = gridOf(n, cell);
  const a = line && line.length ? centerOf(line[0], n, cell) : null;
  const b = line && line.length ? centerOf(line[line.length - 1], n, cell) : null;
  const winColor = line && line.length && board[line[0]] === 2 ? pal.o : pal.x;
  return (
    <View pointerEvents="none" accessible={false} style={{ width: outer, height: outer }}>
      <Svg width={outer} height={outer}>
        <Rect x={1} y={1} width={outer - 2} height={outer - 2} rx={8} fill={pal.paper} />
        <Path d={grid} stroke={pal.line} strokeWidth={0.8} />
        {a && b ? <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={winColor} strokeOpacity={0.22} strokeWidth={cell * 0.75} strokeLinecap="round" /> : null}
        {marks.x ? <Path d={marks.x} stroke={pal.x} strokeWidth={Math.max(1.2, cell * 0.12)} strokeLinecap="round" fill="none" /> : null}
        {marks.o ? <Path d={marks.o} stroke={pal.o} strokeWidth={Math.max(1.2, cell * 0.12)} fill="none" /> : null}
        {a && b ? <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={winColor} strokeWidth={Math.max(1.5, cell * 0.14)} strokeLinecap="round" /> : null}
        <Rect x={1} y={1} width={outer - 2} height={outer - 2} rx={8} fill="none" stroke={pal.border} strokeWidth={1.5} />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
});
