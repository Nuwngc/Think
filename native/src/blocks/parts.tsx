import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, Platform, StyleSheet, View, type GestureResponderEvent, type PanResponderInstance } from "react-native";

import { canPlace, linesIfPlaced, shapeOf, SIZE, type Piece } from "./engine";

// Các phần dùng chung của Xếp Khối: viên khối, khối theo hình, hiệu ứng nổ, ô bàn, kéo khối từ khay vào bàn.
// Dùng cho game Xếp Khối (BlocksScreen.tsx) và câu đố Xếp Khối (src/puzzles/BlocksPuzzleBoard.tsx).

export const BLOCK_COLORS = ["#1C2662", "#FF5A63", "#FF9A1F", "#FFD23F", "#35D07F", "#29C4F0", "#4F7DFF", "#A56BFF"];
export const EMPTY = "#1C2662";
export const GAP = 4;
export const PAD = 8;
export const BORDER = 2;
export const GOLD = "#FFD54A";

/** Trộn màu hex với màu khác (t = 0..1), để làm mặt sáng / tối của khối */
export function mix(hex: string, other: string, t: number) {
  const a = hex.replace("#", "");
  const b = other.replace("#", "");
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const out = [0, 2, 4].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Một viên khối: màu chính + viền sáng phía trên / tối phía dưới cho nổi khối */
export const Block = memo(function Block({ color, size, radius, faded = false }: { color: number; size: number; radius?: number; faded?: boolean }) {
  const base = BLOCK_COLORS[color] || BLOCK_COLORS[1];
  const bw = Math.max(2, Math.round(size * 0.085));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.max(4, size * 0.18),
        backgroundColor: base,
        borderTopWidth: bw,
        borderLeftWidth: Math.max(1, Math.round(bw * 0.7)),
        borderBottomWidth: Math.round(bw * 1.3),
        borderRightWidth: Math.max(1, Math.round(bw * 0.7)),
        borderTopColor: mix(base, "#FFFFFF", 0.45),
        borderLeftColor: mix(base, "#FFFFFF", 0.2),
        borderBottomColor: mix(base, "#000000", 0.28),
        borderRightColor: mix(base, "#000000", 0.12),
        opacity: faded ? 0.5 : 1,
      }}
    />
  );
});

/** Một khối (nhiều viên) vẽ theo hình */
export function PieceView({ piece, cell, gap = 3 }: { piece: Piece; cell: number; gap?: number }) {
  const s = shapeOf(piece.shape);
  if (!s) return null;
  return (
    <View style={{ width: s.w * cell + (s.w - 1) * gap, height: s.h * cell + (s.h - 1) * gap }} pointerEvents="none">
      {s.cells.map(([r, c]) => (
        <View key={`${r}-${c}`} style={{ position: "absolute", left: c * (cell + gap), top: r * (cell + gap) }}>
          <Block color={piece.color} size={cell} />
        </View>
      ))}
    </View>
  );
}

/* ---------------- Hiệu ứng ---------------- */

export type Burst = { key: number; cells: { i: number; color: number }[]; center: { r: number; c: number } };

/** Ô bị xóa vỡ ra: sáng lên, phồng nhẹ rồi thu nhỏ bay đi */
export function Shard({ i, color, cell, center }: { i: number; color: number; cell: number; center: { r: number; c: number } }) {
  const t = useRef(new Animated.Value(0)).current;
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  const dist = Math.hypot(r - center.r, c - center.c);
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 560, delay: dist * 28, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
  }, [t, dist]);
  const pitch = cell + GAP;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: c * pitch,
        top: r * pitch,
        opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.9, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, (c - center.c) * 6] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, (r - center.r) * 6 + 30] }) },
          { scale: t.interpolate({ inputRange: [0, 0.25, 1], outputRange: [1, 1.15, 0] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "40deg"] }) },
        ],
      }}
    >
      <Block color={color} size={cell} />
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: cell * 0.18, backgroundColor: "#FFFFFF", opacity: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.55, 0.2, 0] }) },
        ]}
      />
    </Animated.View>
  );
}

/** Ô vừa đặt: phồng nhẹ lên khi rơi vào bàn */
export function PopBlock({ color, cell }: { color: number; cell: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, friction: 5, tension: 180, useNativeDriver: true }).start();
  }, [t]);
  return (
    <Animated.View style={{ transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }}>
      <Block color={color} size={cell} />
    </Animated.View>
  );
}

/** Khối mới xuất hiện trong khay: phóng to từ nhỏ */
export function Appear({ children, delay, animate }: { children: ReactNode; delay: number; animate: boolean }) {
  const t = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.spring(t, { toValue: 1, delay, friction: 5, tension: 160, useNativeDriver: true }).start();
  }, [t, delay, animate]);
  return <Animated.View style={{ opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }}>{children}</Animated.View>;
}

/* ---------------- Xem trước chỗ đặt, ô bàn ---------------- */

export type Preview = { r: number; c: number; color: number; cells: number[]; hot: Set<number> };

/** Xem trước khi đặt khối ở (r, c): các ô của khối và các hàng / cột sẽ nổ. null = không đặt được */
export function previewOf(board: number[], piece: Piece, r: number, c: number): Preview | null {
  if (!canPlace(board, piece.shape, r, c)) return null;
  const s = shapeOf(piece.shape)!;
  const lines = linesIfPlaced(board, piece.shape, r, c);
  const hot = new Set<number>();
  for (const row of lines.rows) for (let j = 0; j < SIZE; j++) hot.add(row * SIZE + j);
  for (const col of lines.cols) for (let j = 0; j < SIZE; j++) hot.add(j * SIZE + col);
  return { r, c, color: piece.color, cells: s.cells.map(([dr, dc]) => (r + dr) * SIZE + c + dc), hot };
}

/** Các ô của bàn 8×8 (đặt trong khung `gridStyles.grid`) */
export function GridCells({
  board,
  cell,
  preview,
  placed,
  marked,
}: {
  board: number[];
  cell: number;
  preview: Preview | null;
  placed: { key: number; cells: Set<number> } | null;
  /** Ô được tô viền (gợi ý chỗ đặt): màu khối */
  marked?: { cells: number[]; color: number } | null;
}) {
  const out = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = board[i];
    const isGhost = preview?.cells.includes(i);
    const hot = preview?.hot.has(i);
    const mark = marked?.cells.includes(i);
    let content = null;
    if (hot) content = <Block color={preview!.color} size={cell} />;
    else if (isGhost) content = <Block color={preview!.color} size={cell} faded />;
    else if (v) content = placed?.cells.has(i) ? <PopBlock key={`p${placed.key}`} color={v} cell={cell} /> : <Block color={v} size={cell} />;
    else if (mark) content = <Block color={marked!.color} size={cell} faded />;
    out.push(
      <View key={i} style={[gridStyles.cell, { width: cell, height: cell, borderRadius: Math.max(4, cell * 0.18) }]}>
        {content}
        {mark && !v ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, gridStyles.mark, { borderRadius: Math.max(4, cell * 0.18) }]} /> : null}
      </View>,
    );
  }
  return <>{out}</>;
}

export const gridStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GAP,
    padding: PAD,
    borderRadius: 18,
    backgroundColor: "#121A4C",
    borderWidth: BORDER,
    borderColor: "rgba(255,255,255,0.07)",
  },
  cell: { backgroundColor: EMPTY },
  fx: { position: "absolute", left: PAD, top: PAD, right: PAD, bottom: PAD },
  mark: { borderWidth: 2.5, borderColor: GOLD },
});

/** Bề ngang cả bàn (gồm khung) khi mỗi ô rộng `cell` */
export const gridWidth = (cell: number) => cell * SIZE + GAP * (SIZE - 1) + PAD * 2 + BORDER * 2;

/* ---------------- Kéo khối từ khay vào bàn ---------------- */

type DragOptions = {
  /** Khoảng cách giữa hai ô liền nhau trên bàn (ô + khe) */
  pitch: number;
  /** Khối ở ô khay k (null = trống / không kéo được lúc này) */
  pieceAt: (k: number) => Piece | null;
  /** Bàn hiện tại (để biết thả có vừa không) */
  boardNow: () => number[] | null;
  /** Bắt đầu kéo */
  onPick: (k: number) => void;
  /** Khối đang kéo ở trên ô (r, c) của bàn */
  onHover: (piece: Piece, r: number, c: number) => void;
  /** Chạm nhẹ vào khối (không kéo) */
  onTap: (k: number) => void;
  /** Thả vừa chỗ */
  onDrop: (k: number, r: number, c: number) => void;
  /** Thả sai chỗ (khối bay về khay) */
  onMiss: () => void;
};

/**
 * Kéo thả khối: mỗi ô khay một vùng chạm; khối đi theo ngón tay (nhô lên trên ngón tay trên điện thoại),
 * thả vừa chỗ thì đặt, sai chỗ thì bay về khay. Đặt `rootRef` vào khung ngoài cùng (cùng gốc toạ độ với khối đang kéo),
 * `gridRef` vào bàn, `slotRefs` vào ba ô khay, `measure` vào onLayout.
 */
export function useTrayDrag(opts: DragOptions) {
  const ref = useRef(opts);
  ref.current = opts;
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const rootRef = useRef<View>(null);
  const gridRef = useRef<View>(null);
  const slotRefs = useRef<(View | null)[]>([null, null, null]);
  const geo = useRef({ root: { x: 0, y: 0 }, grid: { x: 0, y: 0 }, slots: [] as { x: number; y: number; w: number; h: number }[] });
  const measure = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => (geo.current.root = { x, y }));
    gridRef.current?.measureInWindow((x, y) => (geo.current.grid = { x: x + PAD + BORDER, y: y + PAD + BORDER }));
    slotRefs.current.forEach((v, k) => v?.measureInWindow((x, y, w, h) => (geo.current.slots[k] = { x, y, w, h })));
  }, []);

  const ghost = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const ghostScale = useRef(new Animated.Value(1)).current;
  const dragRef = useRef<{ slot: number; piece: Piece; w: number; h: number; moved: boolean; x0: number; y0: number; lift: number } | null>(null);

  const handlers = useRef({
    grant: (_k: number, _e: GestureResponderEvent) => {},
    move: (_e: GestureResponderEvent) => {},
    release: (_e: GestureResponderEvent) => {},
  });
  const moveGhost = (x: number, y: number) => {
    const d = dragRef.current;
    if (!d) return;
    const pitch = ref.current.pitch;
    const left = x - d.w / 2;
    const top = d.lift ? y - d.h - d.lift : y - d.h / 2;
    const G = geo.current;
    ghost.setValue({ x: left - G.root.x, y: top - G.root.y });
    ref.current.onHover(d.piece, Math.round((top - G.grid.y) / pitch), Math.round((left - G.grid.x) / pitch));
  };
  handlers.current.grant = (k, e) => {
    const piece = ref.current.pieceAt(k);
    if (!piece) return;
    measure();
    const pitch = ref.current.pitch;
    const s = shapeOf(piece.shape)!;
    const lift = Platform.OS === "web" ? 0 : Math.max(36, pitch * 1.1);
    dragRef.current = { slot: k, piece, w: s.w * pitch - GAP, h: s.h * pitch - GAP, moved: false, x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, lift };
    ref.current.onPick(k);
    setDragSlot(k);
    ghostScale.setValue(0.6);
    Animated.timing(ghostScale, { toValue: 1, duration: 110, useNativeDriver: true }).start();
    moveGhost(e.nativeEvent.pageX, e.nativeEvent.pageY);
  };
  handlers.current.move = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const { pageX, pageY } = e.nativeEvent;
    if (Math.hypot(pageX - d.x0, pageY - d.y0) > 6) d.moved = true;
    moveGhost(pageX, pageY);
  };
  handlers.current.release = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const { pageX, pageY } = e.nativeEvent;
    if (!d.moved && Math.hypot(pageX - d.x0, pageY - d.y0) <= 6) {
      // Chạm nhẹ: chọn khối, rồi chạm vào bàn để đặt
      setDragSlot(null);
      ref.current.onTap(d.slot);
      return;
    }
    // Tính lại chỗ thả theo vị trí cuối cùng
    const pitch = ref.current.pitch;
    const left = pageX - d.w / 2;
    const top = d.lift ? pageY - d.h - d.lift : pageY - d.h / 2;
    const G = geo.current;
    const r = Math.round((top - G.grid.y) / pitch);
    const c = Math.round((left - G.grid.x) / pitch);
    const board = ref.current.boardNow();
    if (board && canPlace(board, d.piece.shape, r, c)) {
      setDragSlot(null);
      ref.current.onDrop(d.slot, r, c);
      return;
    }
    // Thả sai chỗ: khối bay về khay
    ref.current.onMiss();
    const slot = G.slots[d.slot];
    if (!slot) {
      setDragSlot(null);
      return;
    }
    Animated.parallel([
      Animated.timing(ghost, {
        toValue: { x: slot.x + slot.w / 2 - d.w / 2 - G.root.x, y: slot.y + slot.h / 2 - d.h / 2 - G.root.y },
        duration: 170,
        useNativeDriver: true,
      }),
      Animated.timing(ghostScale, { toValue: 0.5, duration: 170, useNativeDriver: true }),
    ]).start(() => setDragSlot(null));
  };

  const responders = useMemo<PanResponderInstance[]>(
    () =>
      [0, 1, 2].map((k) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => Boolean(ref.current.pieceAt(k)),
          onMoveShouldSetPanResponder: () => false,
          onPanResponderTerminationRequest: () => false,
          onPanResponderGrant: (e) => handlers.current.grant(k, e),
          onPanResponderMove: (e) => handlers.current.move(e),
          onPanResponderRelease: (e) => handlers.current.release(e),
          onPanResponderTerminate: (e) => handlers.current.release(e),
        }),
      ),
    [],
  );

  /** Ô của bàn dưới điểm chạm (toạ độ màn hình) */
  const cellAt = useCallback((pageX: number, pageY: number) => {
    const G = geo.current;
    const pitch = ref.current.pitch;
    return { r: Math.floor((pageY - G.grid.y) / pitch), c: Math.floor((pageX - G.grid.x) / pitch) };
  }, []);

  return { rootRef, gridRef, slotRefs, measure, responders, ghost, ghostScale, dragSlot, cellAt };
}
