import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type PanResponderInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { confirm, Avatar, Icon, type IconName } from "../ui";
import { useStore } from "../store";
import { canPlace, fitsAnywhere, linesIfPlaced, praise, shapeOf, SIZE, type Piece } from "./engine";
import { preloadBlockSounds, playBlock } from "./sound";
import { ensureGame, loadBlocks, localBest, pendingFor, placePiece, recordGame, setSound, startGame, sync, useBlocks } from "./store";

// Game Xếp Khối (kiểu Block Blast): kéo khối từ khay vào bàn 8×8, đầy hàng / cột thì nổ và được điểm.
// Chơi hoàn toàn trên máy; điểm các ván được gửi lên bảng xếp hạng khi có mạng.

export const BLOCK_COLORS = ["#1C2662", "#FF5A63", "#FF9A1F", "#FFD23F", "#35D07F", "#29C4F0", "#4F7DFF", "#A56BFF"];
const EMPTY = "#1C2662";
const GAP = 4;
const PAD = 8;
const BORDER = 2;
const GOLD = "#FFD54A";

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

function Crown({ size = 22, color = GOLD }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5Z" fill={color} />
      <Path d="M5 20.5h14" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function TopButton({ icon, label, onPress, pressed }: { icon: IconName; label: string; onPress: () => void; pressed?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed: p }) => [styles.topBtn, p && { transform: [{ scale: 0.94 }], backgroundColor: "rgba(255,255,255,0.18)" }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={pressed != null ? { selected: pressed } : undefined}
      hitSlop={4}
    >
      <Icon name={icon} size={24} color="#FFFFFF" />
    </Pressable>
  );
}

/* ---------------- Hiệu ứng ---------------- */

type Burst = { key: number; cells: { i: number; color: number }[]; center: { r: number; c: number } };
type Floater = { key: number; text: string; r: number; c: number };
type Banner = { key: number; text: string; tone: "normal" | "hot" | "gold" };

/** Ô bị xóa vỡ ra: sáng lên, phồng nhẹ rồi thu nhỏ bay đi */
function Shard({ i, color, cell, center }: { i: number; color: number; cell: number; center: { r: number; c: number } }) {
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
        style={[StyleSheet.absoluteFill, { borderRadius: cell * 0.18, backgroundColor: "#FFFFFF", opacity: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.55, 0.2, 0] }) }]}
      />
    </Animated.View>
  );
}

function FloatText({ text, r, c, cell }: { text: string; r: number; c: number; cell: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 950, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [t]);
  const pitch = cell + GAP;
  return (
    <Animated.Text
      pointerEvents="none"
      style={[
        styles.float,
        {
          left: (c + 0.5) * pitch - 60,
          top: (r + 0.5) * pitch - 16,
          opacity: t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [6, -50] }) }, { scale: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.7, 1.1, 1] }) }],
        },
      ]}
    >
      {text}
    </Animated.Text>
  );
}

function BannerText({ text, tone }: { text: string; tone: Banner["tone"] }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 1250, easing: Easing.linear, useNativeDriver: true }).start();
  }, [t]);
  const color = tone === "normal" ? "#FFFFFF" : "#FFE27A";
  const shadow = tone === "normal" ? "#6B3BD6" : tone === "hot" ? "#D9480F" : "#B7791F";
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bannerWrap,
        {
          opacity: t.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { scale: t.interpolate({ inputRange: [0, 0.15, 0.25, 1], outputRange: [0.3, 1.12, 1, 0.96] }) },
            { translateY: t.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0, -10, -30] }) },
          ],
        },
      ]}
    >
      <Text style={[styles.banner, { color, textShadowColor: shadow }]}>{text}</Text>
    </Animated.View>
  );
}

/** Ô vừa đặt: phồng nhẹ lên khi rơi vào bàn */
function PopBlock({ color, cell }: { color: number; cell: number }) {
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

/** Điểm chạy dần lên số mới */
function useCountUp(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target <= from.current) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = from.current;
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / 450);
      const v = Math.round(start + (target - start) * (1 - (1 - k) ** 3));
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target]);
  return shown;
}

const fmt = (n: number) => Number(n || 0).toLocaleString("vi-VN");

/* =========================================================
   Màn hình game
   ========================================================= */

export function BlocksScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const game = useBlocks((s) => s.game);
  const soundOn = useBlocks((s) => s.sound);
  const meId = useStore((s) => s.me?.id ?? null);
  const bestSaved = useBlocks((s) => localBest(s, meId));
  const boardBest = useBlocks((s) => (s.board && s.board.uid === meId ? s.board.me.best : 0));
  const pendingCount = useBlocks((s) => pendingFor(s, meId).length);
  const syncError = useBlocks((s) => s.syncError);

  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ r: number; c: number; color: number; cells: number[]; hot: Set<number> } | null>(null);
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const [placed, setPlaced] = useState<{ key: number; cells: Set<number> } | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [floats, setFloats] = useState<Floater[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [ended, setEnded] = useState<{ record: boolean; best: number } | null>(null);
  const [panel, setPanel] = useState(false);
  const [refilled, setRefilled] = useState(0);
  const [cursor, setCursor] = useState({ r: 0, c: 0 });
  const keyRef = useRef(1);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (endTimer.current) clearTimeout(endTimer.current);
    },
    [],
  );

  // Cỡ bàn: vừa chiều ngang, chừa chỗ cho điểm và khay khối
  const avail = height - insets.top - insets.bottom;
  const boardOuter = Math.max(220, Math.min(width - 24, 480, avail - 56 - 110 - 180));
  const cell = Math.floor((boardOuter - PAD * 2 - GAP * (SIZE - 1)) / SIZE);
  const pitch = cell + GAP;
  const mini = Math.max(12, Math.min(26, Math.floor(cell * 0.5)));

  useEffect(() => {
    loadBlocks().then(() => ensureGame());
    preloadBlockSounds();
    sync();
  }, []);

  // Rời màn khi ván vừa hết mà chưa kịp hiện kết quả: vẫn ghi điểm
  useEffect(() => () => void recordGame(), []);

  const displayed = useCountUp(game?.score ?? 0);
  const best = Math.max(bestSaved, boardBest, game?.score ?? 0);

  /* ---------- Vị trí trên màn hình (để kéo thả) ---------- */
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

  const showPreview = useCallback(
    (piece: Piece | null, r: number, c: number) => {
      const g = useBlocks.getState().game;
      setPreview((prev) => {
        if (!g || !piece || !canPlace(g.board, piece.shape, r, c)) return prev ? null : prev;
        if (prev && prev.r === r && prev.c === c && prev.color === piece.color) return prev;
        const s = shapeOf(piece.shape)!;
        const lines = linesIfPlaced(g.board, piece.shape, r, c);
        const hot = new Set<number>();
        for (const row of lines.rows) for (let j = 0; j < SIZE; j++) hot.add(row * SIZE + j);
        for (const col of lines.cols) for (let j = 0; j < SIZE; j++) hot.add(j * SIZE + col);
        return { r, c, color: piece.color, cells: s.cells.map(([dr, dc]) => (r + dr) * SIZE + c + dc), hot };
      });
    },
    [],
  );

  /* ---------- Đặt khối ---------- */
  const commit = useCallback(
    (slot: number, r: number, c: number) => {
      const res = placePiece(slot, r, c);
      setPreview(null);
      if (!res) {
        playBlock("invalid", 0.5);
        return;
      }
      playBlock("place", 0.9);
      if (res.lines) {
        playBlock(res.lines >= 3 ? "clear3" : res.lines === 2 ? "clear2" : "clear1", 0.8);
        if (res.combo >= 2) setTimeout(() => playBlock(`combo${Math.min(8, res.combo - 1)}` as "combo1", 0.7), 90);
      }
      if (res.allClear) setTimeout(() => playBlock("allclear", 0.9), 260);
      const key = keyRef.current++;
      setPlaced({ key, cells: new Set(res.placed) });
      const rs = res.placed.map((i) => Math.floor(i / SIZE));
      const cs = res.placed.map((i) => i % SIZE);
      const center = { r: (Math.min(...rs) + Math.max(...rs)) / 2, c: (Math.min(...cs) + Math.max(...cs)) / 2 };
      if (res.clearedCells.length) {
        setBursts((b) => [...b, { key, cells: res.clearedCells, center }]);
        setTimeout(() => setBursts((b) => b.filter((x) => x.key !== key)), 1000);
      }
      setFloats((f) => [...f, { key, text: `+${res.gained}`, r: center.r, c: center.c }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.key !== key)), 1000);
      const words = res.allClear ? "Sạch bàn!" : praise(res.lines, res.combo);
      if (words) {
        setBanner({ key, text: words, tone: res.allClear ? "gold" : res.lines >= 4 ? "hot" : "normal" });
        setTimeout(() => setBanner((b) => (b && b.key === key ? null : b)), 1300);
      }
      if (res.refilled) setRefilled(key);
      AccessibilityInfo.announceForAccessibility(
        `Được ${res.gained} điểm${res.lines ? `, ăn ${res.lines} hàng` : ""}${res.combo >= 2 ? `, combo ${res.combo}` : ""}. Tổng ${res.state.score}.`,
      );
      if (res.over && res.record) {
        const info = res.record;
        if (endTimer.current) clearTimeout(endTimer.current);
        endTimer.current = setTimeout(() => {
          endTimer.current = null;
          playBlock(info.record ? "best" : "gameover", 0.9);
          setEnded(info);
        }, res.lines ? 900 : 550);
      }
    },
    [],
  );

  /* ---------- Kéo thả ---------- */
  const handlers = useRef({
    grant: (_k: number, _e: GestureResponderEvent) => {},
    move: (_e: GestureResponderEvent) => {},
    release: (_e: GestureResponderEvent) => {},
  });
  handlers.current.grant = (k, e) => {
    const g = useBlocks.getState().game;
    const piece = g?.tray[k];
    if (!g || g.over || !piece) return;
    measure();
    const s = shapeOf(piece.shape)!;
    const lift = Platform.OS === "web" ? 0 : Math.max(36, pitch * 1.1);
    dragRef.current = { slot: k, piece, w: s.w * pitch - GAP, h: s.h * pitch - GAP, moved: false, x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, lift };
    setSelected(null);
    setDragSlot(k);
    ghostScale.setValue(0.6);
    Animated.timing(ghostScale, { toValue: 1, duration: 110, useNativeDriver: true }).start();
    moveGhost(e.nativeEvent.pageX, e.nativeEvent.pageY);
    playBlock("pick", 0.6);
  };
  const moveGhost = (x: number, y: number) => {
    const d = dragRef.current;
    if (!d) return;
    const left = x - d.w / 2;
    const top = d.lift ? y - d.h - d.lift : y - d.h / 2;
    const G = geo.current;
    ghost.setValue({ x: left - G.root.x, y: top - G.root.y });
    showPreview(d.piece, Math.round((top - G.grid.y) / pitch), Math.round((left - G.grid.x) / pitch));
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
      setPreview(null);
      setSelected(selected === d.slot ? null : d.slot);
      return;
    }
    // Tính lại chỗ thả theo vị trí cuối cùng
    const left = pageX - d.w / 2;
    const top = d.lift ? pageY - d.h - d.lift : pageY - d.h / 2;
    const G = geo.current;
    const r = Math.round((top - G.grid.y) / pitch);
    const c = Math.round((left - G.grid.x) / pitch);
    const g = useBlocks.getState().game;
    if (g && canPlace(g.board, d.piece.shape, r, c)) {
      setDragSlot(null);
      commit(d.slot, r, c);
      return;
    }
    // Thả sai chỗ: khối bay về khay
    setPreview(null);
    playBlock("invalid", 0.5);
    const slot = G.slots[d.slot];
    if (!slot) {
      setDragSlot(null);
      return;
    }
    Animated.parallel([
      Animated.timing(ghost, { toValue: { x: slot.x + slot.w / 2 - d.w / 2 - G.root.x, y: slot.y + slot.h / 2 - d.h / 2 - G.root.y }, duration: 170, useNativeDriver: true }),
      Animated.timing(ghostScale, { toValue: 0.5, duration: 170, useNativeDriver: true }),
    ]).start(() => setDragSlot(null));
  };

  const responders = useMemo<PanResponderInstance[]>(
    () =>
      [0, 1, 2].map((k) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => Boolean(useBlocks.getState().game?.tray[k]) && !useBlocks.getState().game?.over,
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

  // Chạm vào bàn khi đã chọn khối: đặt góc trên trái của khối vào ô đó
  const onBoardPress = (e: GestureResponderEvent) => {
    if (selected == null || !game) return;
    // Tọa độ trên màn hình (locationX tính theo ô con được chạm, không theo cả bàn)
    const G = geo.current;
    const r = Math.floor((e.nativeEvent.pageY - G.grid.y) / pitch);
    const c = Math.floor((e.nativeEvent.pageX - G.grid.x) / pitch);
    const p = game.tray[selected];
    if (!p) return;
    if (canPlace(game.board, p.shape, r, c)) {
      const k = selected;
      setSelected(null);
      commit(k, r, c);
    } else playBlock("invalid", 0.5);
  };

  /* ---------- Trình đọc màn hình: chọn khối, di con trỏ trên bàn, đặt ---------- */
  const selectSlot = (k: number | null) => {
    setSelected(k);
    const g = useBlocks.getState().game;
    const p = k != null ? g?.tray[k] : null;
    if (!g || !p) {
      setPreview(null);
      return;
    }
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (canPlace(g.board, p.shape, r, c)) {
          setCursor({ r, c });
          showPreview(p, r, c);
          return;
        }
      }
    }
  };
  const moveCursor = (dr: number, dc: number) => {
    const g = useBlocks.getState().game;
    const p = selected != null ? g?.tray[selected] : null;
    if (!p) return;
    const next = { r: Math.max(0, Math.min(SIZE - 1, cursor.r + dr)), c: Math.max(0, Math.min(SIZE - 1, cursor.c + dc)) };
    setCursor(next);
    showPreview(p, next.r, next.c);
    const ok = g ? canPlace(g.board, p.shape, next.r, next.c) : false;
    AccessibilityInfo.announceForAccessibility(`Hàng ${next.r + 1}, cột ${next.c + 1}${ok ? "" : ", không đặt được"}`);
  };
  const boardActions =
    selected != null
      ? [
          { name: "activate", label: "Đặt khối ở con trỏ" },
          { name: "up", label: "Con trỏ lên trên" },
          { name: "down", label: "Con trỏ xuống dưới" },
          { name: "left", label: "Con trỏ sang trái" },
          { name: "right", label: "Con trỏ sang phải" },
        ]
      : [];
  const onBoardAction = (name: string) => {
    if (name === "up") moveCursor(-1, 0);
    else if (name === "down") moveCursor(1, 0);
    else if (name === "left") moveCursor(0, -1);
    else if (name === "right") moveCursor(0, 1);
    else if (name === "activate" && selected != null && game) {
      const p = game.tray[selected];
      if (p && canPlace(game.board, p.shape, cursor.r, cursor.c)) {
        const k = selected;
        setSelected(null);
        commit(k, cursor.r, cursor.c);
      } else playBlock("invalid", 0.5);
    }
  };

  /* ---------- Nút Quay lại (Android) ---------- */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panel) {
        setPanel(false);
        return true;
      }
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [panel, onBack]);

  const cancelEnd = () => {
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = null;
  };

  const restart = async () => {
    if (game && !game.over && game.moves > 0 && !(await confirm("Chơi ván mới?", "Bỏ ván này; điểm ván này không được tính.", "Ván mới", false))) return;
    cancelEnd();
    startGame();
    setEnded(null);
    setSelected(null);
    setPreview(null);
    setRefilled(keyRef.current++);
    playBlock("start", 0.7);
  };

  const again = () => {
    cancelEnd();
    startGame();
    setEnded(null);
    setRefilled(keyRef.current++);
    playBlock("start", 0.7);
  };

  const combo = game && game.combo >= 2 ? game.combo : 0;
  const comboScale = useRef(new Animated.Value(combo ? 1 : 0)).current;
  useEffect(() => {
    if (!combo) {
      Animated.timing(comboScale, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      return;
    }
    comboScale.setValue(0.6);
    Animated.spring(comboScale, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }).start();
  }, [combo, comboScale]);

  /* ---------- Vẽ ---------- */
  const cells = [];
  if (game) {
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = game.board[i];
      const isGhost = preview?.cells.includes(i);
      const hot = preview?.hot.has(i);
      let content = null;
      if (hot) content = <Block color={preview!.color} size={cell} />;
      else if (isGhost) content = <Block color={preview!.color} size={cell} faded />;
      else if (v) content = placed?.cells.has(i) ? <PopBlock key={`p${placed.key}`} color={v} cell={cell} /> : <Block color={v} size={cell} />;
      cells.push(
        <View key={i} style={[styles.cell, { width: cell, height: cell, borderRadius: Math.max(4, cell * 0.18) }]}>
          {content}
        </View>,
      );
    }
  }

  const syncText =
    pendingCount && meId == null
      ? `${pendingCount} ván chờ gửi lên bảng xếp hạng (khi bạn đăng nhập Think có mạng).`
      : pendingCount && syncError
        ? `Mất mạng: ${pendingCount} ván sẽ tự gửi lên bảng xếp hạng khi có mạng lại.`
        : pendingCount
          ? `Đang gửi ${pendingCount} ván lên bảng xếp hạng…`
          : "";

  const dragPiece = dragSlot != null ? game?.tray[dragSlot] : null;

  return (
    <View ref={rootRef} style={styles.root} onLayout={measure} collapsable={false}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id="bbBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#2E3F9E" />
            <Stop offset="0.45" stopColor="#22307F" />
            <Stop offset="1" stopColor="#19235F" />
          </LinearGradient>
          <RadialGradient id="bbGlow" cx="50%" cy="0%" r="70%">
            <Stop offset="0" stopColor="#7896FF" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#7896FF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bbBg)" />
        <Rect x="0" y="0" width="100%" height="60%" fill="url(#bbGlow)" />
      </Svg>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <TopButton icon="arrow-back" label="Quay lại" onPress={onBack} />
        <View style={styles.best} accessibilityLabel={`Kỷ lục ${best}`}>
          <Crown />
          <Text style={styles.bestText}>{fmt(best)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <TopButton icon={soundOn ? "volume-up" : "volume-off"} label={soundOn ? "Tắt âm thanh" : "Bật âm thanh"} pressed={soundOn} onPress={() => {
          setSound(!soundOn);
          if (!soundOn) setTimeout(() => playBlock("pick"), 60);
        }} />
        <TopButton icon="refresh" label="Ván mới" onPress={restart} />
        <TopButton icon="leaderboard" label="Bảng xếp hạng" onPress={() => {
          setPanel(true);
          sync();
        }} />
      </View>

      <View style={styles.middle}>
        <View style={styles.head}>
          <Text style={styles.score} accessibilityRole="header" accessibilityLabel={`Điểm ${game?.score ?? 0}`}>
            {fmt(displayed)}
          </Text>
          <Animated.View style={[styles.combo, { opacity: comboScale, transform: [{ scale: comboScale }] }]}>
            <Text style={styles.comboText}>{combo ? `Combo ×${combo}` : " "}</Text>
          </Animated.View>
        </View>

        <Pressable
          ref={gridRef}
          onPress={onBoardPress}
          onLayout={measure}
          style={[styles.grid, { width: cell * SIZE + GAP * (SIZE - 1) + PAD * 2 + BORDER * 2 }]}
          accessibilityLabel={
            selected != null
              ? `Bàn chơi 8 × 8. Con trỏ hàng ${cursor.r + 1}, cột ${cursor.c + 1}. Dùng thao tác lên, xuống, trái, phải để di chuyển, chạm hai lần để đặt.`
              : "Bàn chơi 8 × 8. Chọn một khối ở khay bên dưới trước."
          }
          accessibilityActions={boardActions}
          onAccessibilityAction={(e) => onBoardAction(e.nativeEvent.actionName)}
          collapsable={false}
        >
          {cells}
          <View style={styles.fx} pointerEvents="none">
            {bursts.flatMap((b) => b.cells.map((x) => <Shard key={`${b.key}-${x.i}`} i={x.i} color={x.color} cell={cell} center={b.center} />))}
            {floats.map((f) => (
              <FloatText key={f.key} text={f.text} r={f.r} c={f.c} cell={cell} />
            ))}
          </View>
          {banner ? <BannerText key={banner.key} text={banner.text} tone={banner.tone} /> : null}
        </Pressable>

        <View style={[styles.tray, { height: mini * 5 + 36 }]}>
          {[0, 1, 2].map((k) => {
            const p = game?.tray[k] ?? null;
            const fits = p && game ? fitsAnywhere(game.board, p.shape) : false;
            return (
              <View
                key={k}
                ref={(v) => {
                  slotRefs.current[k] = v;
                }}
                collapsable={false}
                style={[styles.slot, selected === k && styles.slotSelected]}
                {...responders[k].panHandlers}
                accessible
                accessibilityRole="button"
                accessibilityLabel={p ? `Khối ${shapeOf(p.shape)?.cells.length} ô${fits ? "" : ", không còn chỗ đặt"}${selected === k ? ", đang chọn" : ""}` : "Đã đặt"}
                accessibilityState={{ selected: selected === k, disabled: !p }}
                accessibilityActions={p ? [{ name: "activate" }] : []}
                onAccessibilityAction={() => selectSlot(selected === k ? null : k)}
              >
                {p ? (
                  <Appear key={`${refilled}-${k}`} delay={k * 60} animate={refilled > 0}>
                    <View style={{ opacity: dragSlot === k ? 0 : fits ? 1 : 0.35 }}>
                      <PieceView piece={p} cell={mini} />
                    </View>
                  </Appear>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      {syncText ? <Text style={[styles.sync, { marginBottom: insets.bottom + 10 }]}>{syncText}</Text> : <View style={{ height: insets.bottom + 10 }} />}

      {dragPiece ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.ghost, { transform: [{ translateX: ghost.x }, { translateY: ghost.y }, { scale: ghostScale }] }]}
        >
          <PieceView piece={dragPiece} cell={cell} gap={GAP} />
        </Animated.View>
      ) : null}

      {ended && game?.over ? (
        <View style={styles.over} accessibilityViewIsModal>
          <View style={[styles.overCard, ended.record && styles.overCardRecord]}>
            <Text style={[styles.overKicker, ended.record && { color: GOLD, fontSize: 18 }]}>{ended.record ? "KỶ LỤC MỚI!" : "HẾT CHỖ ĐẶT KHỐI"}</Text>
            <Text style={styles.overScore}>{fmt(game.score)}</Text>
            <View style={styles.overStat}>
              <Crown size={18} />
              <Text style={styles.overStatText}>Kỷ lục {fmt(ended.best)}</Text>
            </View>
            <Text style={styles.overStatText}>
              {game.lines} hàng · {game.moves} khối
            </Text>
            <Pressable onPress={again} style={({ pressed }) => [styles.btnPrimary, pressed && { transform: [{ translateY: 2 }] }]} accessibilityRole="button">
              <Icon name="refresh" size={22} color="#3A1D00" />
              <Text style={styles.btnPrimaryText}>Chơi lại</Text>
            </Pressable>
            <Pressable onPress={() => setPanel(true)} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Icon name="leaderboard" size={20} color="#FFFFFF" />
              <Text style={styles.btnText}>Bảng xếp hạng</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {panel ? <Leaderboard onClose={() => setPanel(false)} /> : null}
    </View>
  );
}

/** Khối mới xuất hiện trong khay: phóng to từ nhỏ */
function Appear({ children, delay, animate }: { children: React.ReactNode; delay: number; animate: boolean }) {
  const t = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.spring(t, { toValue: 1, delay, friction: 5, tension: 160, useNativeDriver: true }).start();
  }, [t, delay, animate]);
  return <Animated.View style={{ opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }}>{children}</Animated.View>;
}

/* ---------------- Bảng xếp hạng ---------------- */

function Leaderboard({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"week" | "all">("week");
  const meId = useStore((s) => s.me?.id ?? null);
  const users = useStore((s) => s.users);
  const board = useBlocks((s) => (s.board && s.board.uid === meId ? s.board : null));
  const syncError = useBlocks((s) => s.syncError);
  const pending = useBlocks((s) => pendingFor(s, meId).length);
  const rows = board ? board.leaderboard[tab] : null;
  const mine = board?.me;
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [t]);
  return (
    <Animated.View style={[styles.panelWrap, { opacity: t }]} accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Đóng bảng xếp hạng" />
      <Animated.View
        style={[styles.panel, { paddingBottom: insets.bottom + 16, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }] }]}
      >
        <View style={styles.panelHead}>
          <Text style={styles.panelTitle}>Bảng xếp hạng</Text>
          <TopButton icon="close" label="Đóng" onPress={onClose} />
        </View>
        {mine ? (
          <View style={styles.stats}>
            {[
              [fmt(mine.best), "kỷ lục"],
              [mine.rank ? `#${mine.rank}` : "—", "hạng mọi lúc"],
              [mine.weekRank ? `#${mine.weekRank}` : "—", "hạng tuần"],
              [fmt(mine.games), "ván đã chơi"],
            ].map(([v, label]) => (
              <View key={label} style={styles.stat}>
                <Text style={styles.statValue}>{v}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.tabs} accessibilityRole="tablist">
          {(
            [
              ["week", "Tuần này"],
              ["all", "Mọi lúc"],
            ] as const
          ).map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => setTab(k)}
              style={[styles.tab, tab === k && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === k }}
            >
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 6 }}>
          {meId == null ? (
            <Text style={styles.empty}>Đăng nhập Think (có mạng) để xem bảng xếp hạng. Điểm các ván bạn chơi ở đây vẫn được giữ và gửi lên sau.</Text>
          ) : !rows ? (
            <Text style={styles.empty}>{syncError ? "Chưa tải được bảng xếp hạng (mất mạng?)." : "Đang tải…"}</Text>
          ) : !rows.length ? (
            <Text style={styles.empty}>{tab === "week" ? "Tuần này chưa ai chơi. Mở màn đi!" : "Chưa ai có điểm. Chơi một ván để mở màn!"}</Text>
          ) : (
            rows.map((r, i) => (
              <View key={r.userId} style={[styles.rank, r.userId === meId && styles.rankMe]}>
                <View style={[styles.rankNo, i < 3 && { backgroundColor: ["#F5B300", "#B7C1CE", "#C97834"][i] }]}>
                  <Text style={[styles.rankNoText, i < 3 && { color: "#2A1A00" }]}>{i + 1}</Text>
                </View>
                <Avatar user={users[r.userId]} size={34} dot={false} />
                <Text style={styles.rankName} numberOfLines={1}>
                  {users[r.userId]?.displayName || "Người dùng"}
                  {r.userId === meId ? " (bạn)" : ""}
                </Text>
                <Text style={styles.rankScore}>{fmt(r.score)}</Text>
              </View>
            ))
          )}
        </ScrollView>
        {pending ? <Text style={styles.note}>{pending} ván chưa gửi lên (sẽ tự gửi khi có mạng).</Text> : null}
        <Text style={styles.note}>{tab === "week" ? "Tuần mới bắt đầu 0 giờ thứ Hai." : "Điểm cao nhất mỗi người từng đạt."}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#19235F", overflow: "hidden" },
  top: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 },
  topBtn: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  best: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingLeft: 8, paddingRight: 12, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.18)" },
  bestText: { color: GOLD, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  middle: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: { alignItems: "center", marginBottom: 12, minHeight: 96 },
  score: {
    color: "#FFFFFF",
    fontSize: 54,
    fontWeight: "900",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 0,
  },
  combo: { marginTop: 4, height: 28, paddingHorizontal: 14, borderRadius: 14, justifyContent: "center", backgroundColor: "#FFB82E", borderBottomWidth: 3, borderBottomColor: "#C77100" },
  comboText: { color: "#3A1D00", fontSize: 16, fontWeight: "800" },
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
  float: {
    position: "absolute",
    width: 120,
    textAlign: "center",
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  bannerWrap: { position: "absolute", left: 0, right: 0, top: "38%", alignItems: "center" },
  banner: { fontSize: 38, fontWeight: "900", textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 0 },
  tray: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", width: "100%", maxWidth: 520, marginTop: 14, paddingHorizontal: 8 },
  slot: { flex: 1, height: "100%", alignItems: "center", justifyContent: "center", borderRadius: 18 },
  slotSelected: { backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 2, borderColor: GOLD },
  ghost: { position: "absolute", left: 0, top: 0 },
  sync: { color: "rgba(255,255,255,0.78)", fontSize: 13, textAlign: "center", paddingHorizontal: 20 },
  over: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,12,40,0.78)", alignItems: "center", justifyContent: "center" },
  overCard: { width: "86%", maxWidth: 360, padding: 24, borderRadius: 26, backgroundColor: "#2F3F9E", alignItems: "center", gap: 6 },
  overCardRecord: { borderWidth: 3, borderColor: GOLD },
  overKicker: { color: "#C9D3FF", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  overScore: {
    color: "#FFFFFF",
    fontSize: 64,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 5 },
    textShadowRadius: 0,
  },
  overStat: { flexDirection: "row", alignItems: "center", gap: 6 },
  overStatText: { color: "#DDE3FF", fontSize: 15 },
  btnPrimary: {
    alignSelf: "stretch",
    marginTop: 16,
    height: 52,
    borderRadius: 16,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFB12E",
    borderBottomWidth: 4,
    borderBottomColor: "#C26400",
  },
  btnPrimaryText: { color: "#3A1D00", fontSize: 17, fontWeight: "800" },
  btn: { alignSelf: "stretch", height: 50, borderRadius: 16, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  btnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  panelWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,12,40,0.6)", justifyContent: "flex-end" },
  panel: { backgroundColor: "#1E2A72", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, gap: 12 },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  panelTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "800" },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)" },
  statValue: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  statLabel: { color: "#C3CBF2", fontSize: 11.5, textAlign: "center" },
  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.22)" },
  tab: { flex: 1, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: "#FFFFFF" },
  tabText: { color: "#C3CBF2", fontSize: 14.5, fontWeight: "800" },
  tabTextOn: { color: "#1B2568" },
  empty: { color: "#C3CBF2", textAlign: "center", lineHeight: 21, marginVertical: 14 },
  rank: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)" },
  rankMe: { backgroundColor: "rgba(255,213,74,0.16)", borderWidth: 1.5, borderColor: "rgba(255,213,74,0.6)" },
  rankNo: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rankNoText: { color: "#C3CBF2", fontWeight: "800", fontSize: 14 },
  rankName: { flex: 1, color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  rankScore: { color: GOLD, fontWeight: "800", fontSize: 16, fontVariant: ["tabular-nums"] },
  note: { color: "#AEB8E8", fontSize: 12.5, textAlign: "center" },
});
