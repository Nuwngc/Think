import { Chess, type Move, type Square } from "chess.js";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Polygon, SvgXml } from "react-native-svg";

import { PIECES } from "./pieces";
import type { Color } from "./types";

// Bàn cờ: chạm quân để chọn (hiện chấm ở các ô đi được), chạm ô đích để đi. Phong cấp thì chọn quân.

export const BOARD_COLORS = { light: "#EEEED2", dark: "#6E9C84" };
const LAST = "rgba(242,176,30,0.42)";
const SELECTED = "rgba(242,176,30,0.75)";
const CHECK = "rgba(214,48,32,0.7)";
const HINT = "rgba(20,32,28,0.28)";

const FILES = "abcdefgh";
const NAMES: Record<string, string> = { k: "Vua", q: "Hậu", r: "Xe", b: "Tượng", n: "Mã", p: "Tốt" };

type Piece = { type: string; color: Color } | null;

export function PieceImage({ code, size }: { code: string; size: number }) {
  const xml = PIECES[code];
  if (!xml) return null;
  return <SvgXml xml={xml} width={size} height={size} />;
}

type SquareProps = {
  sq: Square;
  piece: string | null;
  light: boolean;
  size: number;
  mark: "last" | "sel" | "check" | null;
  hint: "dot" | "ring" | null;
  fileLabel: string | null;
  rankLabel: string | null;
  label: string;
  onPress: (sq: Square) => void;
};

const SquareView = memo(function SquareView({ sq, piece, light, size, mark, hint, fileLabel, rankLabel, label, onPress }: SquareProps) {
  const coordColor = light ? BOARD_COLORS.dark : BOARD_COLORS.light;
  return (
    <Pressable
      onPress={() => onPress(sq)}
      style={{ width: size, height: size, backgroundColor: light ? BOARD_COLORS.light : BOARD_COLORS.dark }}
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
      {rankLabel ? <Text style={[styles.rank, { color: coordColor, fontSize: Math.max(9, size * 0.2) }]}>{rankLabel}</Text> : null}
      {fileLabel ? <Text style={[styles.file, { color: coordColor, fontSize: Math.max(9, size * 0.2) }]}>{fileLabel}</Text> : null}
      {piece ? (
        // Đặt tuyệt đối để luôn nằm trên lớp tô màu ô (trên web, lớp tuyệt đối vẽ đè lên phần tử thường)
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <PieceImage code={piece} size={size} />
        </View>
      ) : null}
      {hint === "dot" ? (
        <View style={[styles.center]} pointerEvents="none">
          <View style={{ width: size * 0.3, height: size * 0.3, borderRadius: size, backgroundColor: HINT }} />
        </View>
      ) : hint === "ring" ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: Math.max(3, size * 0.08), borderColor: HINT }]}
        />
      ) : null}
    </Pressable>
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
  /** Mũi tên gợi ý (dạng e2e4), vd nước tốt nhất máy tìm được */
  arrow?: string | null;
};

const ARROW = "rgba(21,120,90,0.78)";

/** Tâm của một ô trên bàn cờ (theo chiều đang xem) */
function center(sq: string, cell: number, orientation: Color) {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  const x = (orientation === "w" ? f : 7 - f) * cell + cell / 2;
  const y = (orientation === "w" ? 7 - r : r) * cell + cell / 2;
  return { x, y };
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
  const pts = [
    `${b.x},${b.y}`,
    `${ex + px * head * 0.6},${ey + py * head * 0.6}`,
    `${ex - px * head * 0.6},${ey - py * head * 0.6}`,
  ].join(" ");
  return (
    <Svg width={cell * 8} height={cell * 8} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Line x1={a.x + ux * cell * 0.15} y1={a.y + uy * cell * 0.15} x2={ex} y2={ey} stroke={ARROW} strokeWidth={w} strokeLinecap="round" />
      <Polygon points={pts} fill={ARROW} />
    </Svg>
  );
}

export function Board({ fen, size, orientation, movable, lastMove, onMove, hints = true, showLast = true, coords = true, arrow }: BoardProps) {
  const cell = Math.floor(size / 8);
  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);

  // Bàn cờ đổi (đối thủ vừa đi, xem lại nước cũ…): bỏ chọn
  useEffect(() => {
    setSelected(null);
    setPromo(null);
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

  const state = useRef({ selected, targets, canMove, chess, movable, onMove });
  state.current = { selected, targets, canMove, chess, movable, onMove };

  const press = useCallback((sq: Square) => {
    const { selected: sel, targets: tg, canMove: can, chess: ch, movable: mv, onMove: done } = state.current;
    if (!can) return;
    const moves = sel ? tg.get(sq) : undefined;
    if (sel && moves?.length) {
      if (moves.some((m) => m.promotion)) {
        setPromo({ from: sel, to: sq });
        return;
      }
      setSelected(null);
      done?.(`${sel}${sq}`);
      return;
    }
    const p = ch.get(sq);
    if (p && p.color === mv) setSelected(sel === sq ? null : sq);
    else setSelected(null);
  }, []);

  const board = chess.board();
  const [lf, lt] = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [null, null];
  const rows: Piece[][] = board.map((r) => r.map((p) => (p ? { type: p.type, color: p.color as Color } : null)));
  const order = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <View style={{ width: cell * 8, height: cell * 8 }} accessibilityLabel="Bàn cờ">
      {order.map((r, ri) => (
        <View key={r} style={styles.row}>
          {order.map((f, fi) => {
            const sq = `${FILES[f]}${8 - r}` as Square;
            const p = rows[r][f];
            const code = p ? `${p.color}${p.type.toUpperCase()}` : null;
            const mark = sq === selected ? "sel" : sq === checkSq ? "check" : showLast && (sq === lf || sq === lt) ? "last" : null;
            const hint = hints && targets.has(sq) ? (p ? "ring" : "dot") : null;
            // Trình đọc màn hình vẫn báo ô đi được kể cả khi tắt chấm chỉ dẫn
            const label = `${sq}${p ? `, ${NAMES[p.type]} ${p.color === "w" ? "trắng" : "đen"}` : ""}${targets.has(sq) ? ", đi được" : ""}`;
            return (
              <SquareView
                key={sq}
                sq={sq}
                piece={code}
                light={(r + f) % 2 === 0}
                size={cell}
                mark={mark}
                hint={hint}
                fileLabel={coords && ri === 7 ? FILES[f] : null}
                rankLabel={coords && fi === 0 ? String(8 - r) : null}
                label={label}
                onPress={press}
              />
            );
          })}
        </View>
      ))}
      {arrow && /^[a-h][1-8][a-h][1-8]/.test(arrow) ? <Arrow uci={arrow} cell={cell} orientation={orientation} /> : null}
      {promo ? (
        <View style={[StyleSheet.absoluteFill, styles.promoWrap]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPromo(null)} accessibilityLabel="Hủy phong cấp" />
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
    for (const rank of String(fen || "").split(" ")[0].split("/").slice(0, 8)) {
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
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  rank: { position: "absolute", left: 2, top: 1, fontWeight: "700" },
  file: { position: "absolute", right: 3, bottom: 0, fontWeight: "700" },
  promoWrap: { backgroundColor: "rgba(10,20,16,0.55)", alignItems: "center", justifyContent: "center" },
  promoBox: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12, gap: 8, alignItems: "center" },
  promoTitle: { color: "#14201C", fontWeight: "800", fontSize: 15 },
  promoItem: { alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#EEF2EF" },
});
