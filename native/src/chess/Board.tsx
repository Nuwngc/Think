import { Chess, type Move, type Square } from "chess.js";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Polygon, SvgXml } from "react-native-svg";

import { ClassBadge } from "./Analysis";
import { squareAt, squares, squareXY } from "./anim";
import { makeLayout, type Layout, type Sprite } from "./layout";
import { PIECES } from "./pieces";
import { themeOf, usePrefs } from "./prefs";
import type { Color, MoveClass } from "./types";

// Bàn cờ (kiểu chess.com): chạm quân để chọn (hiện chấm ở các ô đi được) rồi chạm ô đích, hoặc kéo quân bằng ngón tay.
// Quân trượt mượt từ ô đi tới ô đến (nước của mình, của đối thủ, khi xem lại ván), quân bị ăn mờ dần. Phong cấp thì chọn quân.

export const BOARD_COLORS = { light: "#EEEED2", dark: "#6E9C84" };
const LAST = "rgba(242,176,30,0.42)";
const SELECTED = "rgba(242,176,30,0.75)";
const CHECK = "rgba(214,48,32,0.7)";
const HINT = "rgba(20,32,28,0.28)";
const HOVER = "rgba(255,255,255,0.75)";

const FILES = "abcdefgh";
const NAMES: Record<string, string> = { k: "Vua", q: "Hậu", r: "Xe", b: "Tượng", n: "Mã", p: "Tốt" };
// Quân trượt bằng luồng JS, không dùng native driver: với kiến trúc mới (Fabric), vị trí chạy trên luồng native không được
// ghi lại vào cây giao diện của React, nên khi React xếp lại các quân (vd tốt phong cấp lên hàng trên) quân bị kéo về ô cũ
// (lỗi bản 0.6: phong Hậu ở a8 thì Xe vừa đi a8→d8 hiện lại ở a8, che mất Hậu). Mỗi lần chỉ vài quân trượt nên luồng JS thừa sức.
const nativeDriver = false;

export function PieceImage({ code, size }: { code: string; size: number }) {
  const xml = PIECES[code];
  if (!xml) return null;
  return <SvgXml xml={xml} width={size} height={size} />;
}

type SquareProps = {
  sq: Square;
  light: boolean;
  /** Màu ô sáng / tối (theo Tùy chọn → Màu bàn cờ) */
  colors: { light: string; dark: string };
  size: number;
  mark: "last" | "sel" | "check" | null;
  hover: boolean;
  fileLabel: string | null;
  rankLabel: string | null;
  label: string;
  onPress: (sq: Square) => void;
};

// Ô bàn cờ (nền, tô màu, tọa độ). Quân cờ vẽ ở lớp riêng phía trên để trượt được.
const SquareView = memo(function SquareView({ sq, light, colors, size, mark, hover, fileLabel, rankLabel, label, onPress }: SquareProps) {
  const coordColor = light ? colors.dark : colors.light;
  return (
    <Pressable
      onPress={() => onPress(sq)}
      style={{ width: size, height: size, backgroundColor: light ? colors.light : colors.dark }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {mark ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            mark === "check"
              ? { backgroundColor: CHECK, borderRadius: size / 2, transform: [{ scale: 0.92 }] }
              : { backgroundColor: mark === "sel" ? SELECTED : LAST },
          ]}
        />
      ) : null}
      {hover ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderWidth: Math.max(3, size * 0.07), borderColor: HOVER }]} /> : null}
      {rankLabel ? <Text style={[styles.rank, { color: coordColor, fontSize: Math.max(9, size * 0.2) }]}>{rankLabel}</Text> : null}
      {fileLabel ? <Text style={[styles.file, { color: coordColor, fontSize: Math.max(9, size * 0.2) }]}>{fileLabel}</Text> : null}
    </Pressable>
  );
});

/** Chấm chỉ dẫn vẽ trên quân (ô có quân đối phương thì là vòng tròn) */
const HintView = memo(function HintView({ kind, size }: { kind: "dot" | "ring"; size: number }) {
  return kind === "dot" ? (
    <View style={[styles.center, { width: size, height: size }]} pointerEvents="none">
      <View style={{ width: size * 0.3, height: size * 0.3, borderRadius: size, backgroundColor: HINT }} />
    </View>
  ) : (
    <View pointerEvents="none" style={{ width: size, height: size, borderRadius: size / 2, borderWidth: Math.max(3, size * 0.08), borderColor: HINT }} />
  );
});

/** Một quân cờ ở lớp quân (vị trí là giá trị Animated để trượt / kéo) */
const PieceSprite = memo(function PieceSprite({ code, size, pos, lifted }: { code: string; size: number; pos: Animated.ValueXY; lifted: boolean }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.sprite,
        { width: size, height: size, zIndex: lifted ? 20 : 1, elevation: lifted ? 8 : 0 },
        { transform: [...pos.getTranslateTransform(), { scale: lifted ? 1.3 : 1 }] },
      ]}
    >
      <PieceImage code={code} size={size} />
    </Animated.View>
  );
});

/** Quân vừa bị ăn: mờ dần ở ô của nó */
const GoneSprite = memo(function GoneSprite({ code, size, x, y, ms }: { code: string; size: number; x: number; y: number; ms: number }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(op, { toValue: 0, duration: ms, easing: Easing.linear, useNativeDriver: nativeDriver }).start();
  }, [op, ms]);
  return (
    <Animated.View pointerEvents="none" style={[styles.sprite, { width: size, height: size, opacity: op, transform: [{ translateX: x }, { translateY: y }] }]}>
      <PieceImage code={code} size={size} />
    </Animated.View>
  );
});

export type BoardProps = {
  fen: string;
  size: number;
  orientation: Color;
  /** Màu quân người xem được đi lúc này (null = chỉ xem) */
  movable: Color | null;
  /** Nước vừa đi (dạng e2e4) để tô màu */
  lastMove?: string | null;
  onMove?: (uci: string) => void;
  /** Hiện chấm ở các ô đi được khi chọn quân */
  hints?: boolean;
  /** Tô màu nước vừa đi */
  showLast?: boolean;
  /** Hiện chữ và số ở mép bàn cờ */
  coords?: boolean;
  /** Quân trượt khi đi */
  animate?: boolean;
  /** Mũi tên gợi ý (dạng e2e4), vd nước tốt nhất máy tìm được */
  arrow?: string | null;
  /** Huy hiệu loại nước (thiên tài, sai lầm…) ở góc ô vừa đi tới, khi xem lại ván đã phân tích */
  badge?: { sq: string; cls: MoveClass } | null;
  /** Chạm vào ô không đi được khi đang chọn quân (để phát tiếng báo) */
  onIllegal?: () => void;
  /** Tô sáng một ô (vd gợi ý của câu đố: quân cần đi) */
  highlight?: string | null;
};

const ARROW = "rgba(21,120,90,0.78)";

/** Tâm của một ô trên bàn cờ (theo chiều đang xem) */
function center(sq: string, cell: number, orientation: Color) {
  const { x, y } = squareXY(sq, cell, orientation);
  return { x: x + cell / 2, y: y + cell / 2 };
}

function Arrow({ uci, cell, orientation }: { uci: string; cell: number; orientation: Color }) {
  const a = center(uci.slice(0, 2), cell, orientation);
  const b = center(uci.slice(2, 4), cell, orientation);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = cell * 0.42;
  const w = cell * 0.17;
  // Thân mũi tên dừng trước đầu mũi tên
  const ex = b.x - ux * head;
  const ey = b.y - uy * head;
  const px = -uy;
  const py = ux;
  const pts = [`${b.x},${b.y}`, `${ex + px * head * 0.6},${ey + py * head * 0.6}`, `${ex - px * head * 0.6},${ey - py * head * 0.6}`].join(" ");
  return (
    <Svg width={cell * 8} height={cell * 8} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Line x1={a.x + ux * cell * 0.15} y1={a.y + uy * cell * 0.15} x2={ex} y2={ey} stroke={ARROW} strokeWidth={w} strokeLinecap="round" />
      <Polygon points={pts} fill={ARROW} />
    </Svg>
  );
}

export function Board({
  fen,
  size,
  orientation,
  movable,
  lastMove,
  onMove,
  hints = true,
  showLast = true,
  coords = true,
  animate = true,
  arrow,
  badge,
  onIllegal,
  highlight,
}: BoardProps) {
  const cell = Math.floor(size / 8);
  const themeId = usePrefs((p) => p.theme);
  const colors = useMemo(() => {
    const t = themeOf(themeId);
    return { light: t.light, dark: t.dark };
  }, [themeId]);
  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);
  const [selected, setSelected] = useState<Square | null>(null);
  // Đang chọn quân phong cấp (fen: thế cờ lúc mở bảng chọn)
  const [promo, setPromo] = useState<{ from: Square; to: Square; fen: string } | null>(null);
  const promoRef = useRef(promo);
  promoRef.current = promo;
  const [hover, setHover] = useState<Square | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const reduce = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        reduce.current = Boolean(v);
      })
      .catch(() => undefined);
  }, []);

  // Bàn cờ đổi (đối thủ vừa đi, xem lại nước cũ, hết giờ…): bỏ chọn, đóng bảng phong cấp
  useEffect(() => {
    setSelected(null);
    const p = promoRef.current;
    // Thế cờ chưa đổi mà bảng phong cấp bị đóng: tốt đang kéo dở về lại chỗ cũ (thế cờ đổi thì lớp quân tự xếp lại)
    if (p && p.fen === committed.current?.fen) snapBack(p.from);
    setPromo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, movable]);

  const canMove = movable != null && chess.turn() === movable && !chess.isGameOver();
  const targets = useMemo(() => {
    const map = new Map<string, Move[]>();
    if (!selected || !canMove) return map;
    for (const m of chess.moves({ square: selected, verbose: true }) as Move[]) {
      const list = map.get(m.to) || [];
      list.push(m);
      map.set(m.to, list);
    }
    return map;
  }, [chess, selected, canMove]);

  const checkSq = useMemo(() => {
    if (!chess.inCheck()) return null;
    const turn = chess.turn();
    for (const row of chess.board()) for (const p of row) if (p && p.type === "k" && p.color === turn) return p.square;
    return null;
  }, [chess]);

  /* ---------------- Lớp quân: trượt mượt ---------------- */
  const committed = useRef<Layout | null>(null);
  const layout = useMemo(() => makeLayout(committed.current, fen, orientation, cell, lastMove), [fen, orientation, cell, lastMove]);
  const pos = useRef(new Map<number, Animated.ValueXY>()).current;
  const dropped = useRef<{ from: string; to: string } | null>(null);
  /** Quân đang ở ô `sq` (theo thế cờ đang hiện) trượt về đúng ô của nó */
  const snapBack = useCallback(
    (sq: string) => {
      const L = committed.current;
      const sp = L?.sprites.find((x) => x.sq === sq);
      const pv = sp ? pos.get(sp.id) : undefined;
      if (L && pv)
        Animated.timing(pv, {
          toValue: squareXY(sq, L.cell, L.orientation),
          duration: 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: nativeDriver,
        }).start();
    },
    [pos],
  );
  /** Vừa gửi nước đi: 400ms sau thế cờ vẫn như cũ (nước không được nhận) thì quân về chỗ cũ */
  const revertIfUnchanged = useCallback(
    (before: string, from: string) => {
      setTimeout(() => {
        if (committed.current?.fen !== before) return;
        dropped.current = null;
        snapBack(from);
      }, 400);
    },
    [snapBack],
  );

  const valueOf = (sp: Sprite) => {
    let v = pos.get(sp.id);
    if (!v) {
      v = new Animated.ValueXY(squareXY(sp.sq, cell, orientation));
      pos.set(sp.id, v);
    }
    return v;
  };
  useLayoutEffect(() => {
    const prev = committed.current;
    committed.current = layout;
    if (prev === layout) return;
    const drop = dropped.current;
    dropped.current = null;
    const anims: Animated.CompositeAnimation[] = [];
    const movedIds = new Set(layout.moved.map((m) => m.id));
    for (const sp of layout.sprites) {
      const v = valueOf(sp);
      const target = squareXY(sp.sq, cell, orientation);
      const m = movedIds.has(sp.id) ? layout.moved.find((x) => x.id === sp.id) : null;
      const skip = !m || !animate || reduce.current || (drop && drop.from === m.from && drop.to === m.to);
      if (skip) v.setValue(target);
      else anims.push(Animated.timing(v, { toValue: target, duration: layout.ms, easing: Easing.bezier(0.25, 0.8, 0.35, 1), useNativeDriver: nativeDriver }));
    }
    // Quân không còn trên bàn: bỏ giá trị vị trí
    const alive = new Set(layout.sprites.map((x) => x.id));
    for (const id of [...pos.keys()]) if (!alive.has(id)) pos.delete(id);
    if (anims.length) Animated.parallel(anims).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  /* ---------------- Chạm, kéo thả ---------------- */
  // Góc trên trái của bàn cờ trên màn hình (đo lại mỗi lần chạm, vì bàn cờ có thể dịch chỗ)
  const boardRef = useRef<View>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const remeasure = useCallback(() => {
    boardRef.current?.measure((_x, _y, _w, _h, px, py) => {
      if (Number.isFinite(px) && Number.isFinite(py)) origin.current = { x: px, y: py };
    });
  }, []);
  /** Chỗ ngón tay chạm xuống (tọa độ màn hình) của lần chạm này */
  const start = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ from: Square; id: number; moves: Move[] } | null>(null);
  const state = useRef({ selected, targets, canMove, chess, movable, onMove, onIllegal, layout, cell, orientation });
  state.current = { selected, targets, canMove, chess, movable, onMove, onIllegal, layout, cell, orientation };

  const press = useCallback((sq: Square) => {
    const { selected: sel, targets: tg, canMove: can, chess: ch, movable: mv, onMove: done, onIllegal: bad } = state.current;
    if (!can) return;
    const moves = sel ? tg.get(sq) : undefined;
    if (sel && moves?.length) {
      if (moves.some((m) => m.promotion)) {
        setPromo({ from: sel, to: sq, fen: state.current.layout.fen });
        return;
      }
      setSelected(null);
      done?.(`${sel}${sq}`);
      return;
    }
    const p = ch.get(sq);
    if (p && p.color === mv) setSelected(sel === sq ? null : sq);
    else {
      if (sel) bad?.(); // đang chọn quân mà chạm ô không đi được
      setSelected(null);
    }
  }, []);

  /** Ô dưới ngón tay (tọa độ màn hình) */
  const squareOf = (pageX: number, pageY: number) => {
    const o = origin.current;
    const { cell: c, orientation: or } = state.current;
    if (!o) return null;
    return squareAt(pageX - o.x, pageY - o.y, c, or) as Square | null;
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Chạm xuống: nhớ chỗ chạm, đo lại vị trí bàn cờ (không giành quyền: chạm nhẹ vẫn là chọn quân)
        onStartShouldSetPanResponderCapture: (e) => {
          start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          remeasure();
          return false;
        },
        // Kéo quá 6 điểm ảnh từ một quân của mình: bắt đầu kéo quân
        onMoveShouldSetPanResponderCapture: (_e, g) => {
          const st = state.current;
          const s0 = start.current;
          if (!st.canMove || !s0 || Math.hypot(g.dx, g.dy) < 6) return false;
          const sq = squareOf(s0.x, s0.y);
          const p = sq ? st.chess.get(sq) : null;
          return Boolean(p && p.color === st.movable);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const st = state.current;
          const s0 = start.current;
          const from = s0 ? squareOf(s0.x, s0.y) : null;
          const sp = from ? st.layout.sprites.find((x) => x.sq === from) : null;
          if (!from || !sp) return;
          drag.current = { from, id: sp.id, moves: st.chess.moves({ square: from, verbose: true }) as Move[] };
          setSelected(from);
          setDragId(sp.id);
          setHover(from);
        },
        onPanResponderMove: (_e, g) => {
          const d = drag.current;
          const o = origin.current;
          if (!d || !o) return;
          const c = state.current.cell;
          pos.get(d.id)?.setValue({ x: g.moveX - o.x - c / 2, y: g.moveY - o.y - c / 2 });
          const sq = squareOf(g.moveX, g.moveY);
          setHover((h) => (h === sq ? h : sq));
        },
        onPanResponderRelease: (_e, g) => {
          const d = drag.current;
          drag.current = null;
          setDragId(null);
          setHover(null);
          if (!d) return;
          const { cell: c, orientation: o, onMove: done, onIllegal: bad } = state.current;
          const to = squareOf(g.moveX, g.moveY);
          const moves = to ? d.moves.filter((m) => m.to === to) : [];
          const v = pos.get(d.id);
          if (to && moves.length) {
            v?.setValue(squareXY(to, c, o)); // thả đúng ô: quân nằm luôn ở đó, không trượt lại
            const before = state.current.layout.fen;
            if (moves.some((m) => m.promotion)) {
              setPromo({ from: d.from, to, fen: before });
              return;
            }
            dropped.current = { from: d.from, to };
            setSelected(null);
            done?.(`${d.from}${to}`);
            revertIfUnchanged(before, d.from); // nước không được nhận (đang gửi nước trước…): quân trượt về chỗ cũ
            return;
          }
          // Thả ra ngoài / ô không đi được: quân trượt về chỗ cũ, vẫn đang chọn để chạm ô đích
          if (v)
            Animated.timing(v, { toValue: squareXY(d.from, c, o), duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
          if (to && to !== d.from) bad?.();
          setSelected(d.from);
        },
        onPanResponderTerminate: () => {
          const d = drag.current;
          drag.current = null;
          setDragId(null);
          setHover(null);
          const { cell: c, orientation: o } = state.current;
          if (d) pos.get(d.id)?.setValue(squareXY(d.from, c, o));
        },
      }),
    [pos, remeasure, revertIfUnchanged],
  );

  const [lf, lt] = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [null, null];
  const order = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cur = squares(fen);

  return (
    <View
      ref={boardRef}
      collapsable={false}
      onLayout={remeasure}
      style={{ width: cell * 8, height: cell * 8 }}
      accessibilityLabel="Bàn cờ"
      {...pan.panHandlers}
    >
      {order.map((r, ri) => (
        <View key={r} style={styles.row}>
          {order.map((f, fi) => {
            const sq = `${FILES[f]}${8 - r}` as Square;
            const code = cur.get(sq) || null;
            const mark = sq === selected ? "sel" : sq === checkSq ? "check" : showLast && (sq === lf || sq === lt) ? "last" : null;
            // Trình đọc màn hình vẫn báo ô đi được kể cả khi tắt chấm chỉ dẫn
            const label = `${sq}${code ? `, ${NAMES[code[1].toLowerCase()]} ${code[0] === "w" ? "trắng" : "đen"}` : ""}${targets.has(sq) ? ", đi được" : ""}`;
            return (
              <SquareView
                key={sq}
                sq={sq}
                light={(r + f) % 2 === 0}
                colors={colors}
                size={cell}
                mark={mark}
                hover={dragId != null && hover === sq}
                fileLabel={coords && ri === 7 ? FILES[f] : null}
                rankLabel={coords && fi === 0 ? String(8 - r) : null}
                label={label}
                onPress={press}
              />
            );
          })}
        </View>
      ))}
      {highlight && /^[a-h][1-8]$/.test(highlight) ? (
        <View
          pointerEvents="none"
          style={[
            styles.sprite,
            styles.focus,
            {
              width: cell,
              height: cell,
              borderWidth: Math.max(3, cell * 0.09),
              transform: [{ translateX: squareXY(highlight, cell, orientation).x }, { translateY: squareXY(highlight, cell, orientation).y }],
            },
          ]}
        />
      ) : null}
      {/* Lớp quân cờ */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {animate
          ? layout.gone.map((g) => {
              const { x, y } = squareXY(g.sq, cell, orientation);
              return <GoneSprite key={g.key} code={g.code} size={cell} x={x} y={y} ms={layout.ms || 180} />;
            })
          : null}
        {layout.sprites.map((sp) => (
          <PieceSprite key={sp.id} code={sp.code} size={cell} pos={valueOf(sp)} lifted={sp.id === dragId} />
        ))}
        {/* Chấm chỉ dẫn nằm trên quân (vòng tròn quanh quân có thể ăn) */}
        {[...targets.keys()].map((sq) => {
          if (!hints) return null;
          const { x, y } = squareXY(sq, cell, orientation);
          return (
            <View key={sq} style={[styles.sprite, { transform: [{ translateX: x }, { translateY: y }] }]} pointerEvents="none">
              <HintView kind={cur.has(sq) ? "ring" : "dot"} size={cell} />
            </View>
          );
        })}
      </View>
      {arrow && /^[a-h][1-8][a-h][1-8]/.test(arrow) ? <Arrow uci={arrow} cell={cell} orientation={orientation} /> : null}
      {badge && /^[a-h][1-8]$/.test(badge.sq) ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: center(badge.sq, cell, orientation).x + cell / 2 - Math.max(16, cell * 0.4) - 1,
            top: center(badge.sq, cell, orientation).y - cell / 2 + 1,
          }}
        >
          <ClassBadge cls={badge.cls} size={Math.max(16, Math.round(cell * 0.4))} />
        </View>
      ) : null}
      {promo ? (
        <View style={[StyleSheet.absoluteFill, styles.promoWrap]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              // Hủy phong cấp: quân về chỗ cũ
              snapBack(promo.from);
              setPromo(null);
            }}
            accessibilityLabel="Hủy phong cấp"
          />
          <View style={styles.promoBox}>
            <Text style={styles.promoTitle}>Phong cấp thành</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {(["q", "r", "b", "n"] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => {
                    const pr = promo;
                    setPromo(null);
                    setSelected(null);
                    onMove?.(`${pr.from}${pr.to}${t}`);
                    revertIfUnchanged(pr.fen, pr.from);
                  }}
                  style={({ pressed }) => [styles.promoItem, { width: cell * 1.1, height: cell * 1.1, opacity: pressed ? 0.7 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={NAMES[t]}
                >
                  <PieceImage code={`${movable || "w"}${t.toUpperCase()}`} size={cell} />
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Bàn cờ nhỏ chỉ để xem (thẻ ván cờ trong bảng tin, bảng chia sẻ). Đọc thẳng FEN, không cần chess.js. */
export const MiniBoard = memo(function MiniBoard({ fen, size, orientation = "w" }: { fen: string; size: number; orientation?: Color }) {
  const cell = Math.floor(size / 8);
  const rows = useMemo(() => {
    const out: (string | null)[][] = [];
    for (const rank of String(fen || "")
      .split(" ")[0]
      .split("/")
      .slice(0, 8)) {
      const row: (string | null)[] = [];
      for (const ch of rank) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) row.push(null);
        else row.push(ch === ch.toUpperCase() ? `w${ch}` : `b${ch.toUpperCase()}`);
      }
      out.push(row.slice(0, 8));
    }
    while (out.length < 8) out.push([]);
    return out;
  }, [fen]);
  const order = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  return (
    <View style={{ width: cell * 8, height: cell * 8, borderRadius: 6, overflow: "hidden" }} pointerEvents="none" accessible={false}>
      {order.map((r) => (
        <View key={r} style={styles.row}>
          {order.map((f) => {
            const code = rows[r][f];
            return (
              <View key={f} style={{ width: cell, height: cell, backgroundColor: (r + f) % 2 === 0 ? BOARD_COLORS.light : BOARD_COLORS.dark }}>
                {code ? <PieceImage code={code} size={cell} /> : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
});

/** Biểu tượng quân mã (tô được màu) cho thanh điều hướng */
export function KnightIcon({ size = 24, color, hole }: { size?: number; color: string; hole: string }) {
  const xml = useMemo(
    () =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 6 38 36"><g fill="none" fill-rule="evenodd" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path fill="${color}" d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/><path fill="${color}" d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-1-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-2 2.5-3c1 0 1 3 1 3"/><path fill="${hole}" stroke="${hole}" d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.43-9.75a.5 1.5 30 1 1-.86-.5.5 1.5 30 1 1 .86.5"/></g></svg>`,
    [color, hole],
  );
  return <SvgXml xml={xml} width={size} height={size} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  sprite: { position: "absolute", left: 0, top: 0 },
  focus: { borderColor: "rgba(30,170,140,0.95)", backgroundColor: "rgba(76,201,170,0.3)" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  rank: { position: "absolute", left: 2, top: 1, fontWeight: "700" },
  file: { position: "absolute", right: 3, bottom: 0, fontWeight: "700" },
  promoWrap: { backgroundColor: "rgba(10,20,16,0.55)", alignItems: "center", justifyContent: "center" },
  promoBox: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12, gap: 8, alignItems: "center" },
  promoTitle: { color: "#14201C", fontWeight: "800", fontSize: 15 },
  promoItem: { alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#EEF2EF" },
});
