import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";

import { canPlace, fitsAnywhere, shapeOf, SIZE, type Piece } from "../blocks/engine";
import { Appear, GAP, GOLD, GridCells, gridStyles, gridWidth, PAD, PieceView, previewOf, Shard, useTrayDrag, type Burst, type Preview } from "../blocks/parts";
import { holdBlockSounds, playBlock } from "../blocks/sound";
import { loadBlocks } from "../blocks/store";
import type { BlocksPuzzle, BlocksState } from "./core";
import { puzzleBlocks, puzzleSolutionNext, usePuzzles } from "./store";

// Bàn của câu đố Xếp Khối: dùng lại viên khối, hiệu ứng nổ, kéo thả và âm thanh của game Xếp Khối.
// Khay 3 khối theo đúng thứ tự của câu đố (đặt hết 3 khối thì hiện 3 khối tiếp). Gợi ý: tô khối cần đặt và chỗ đặt.

const BORDER = 2;
const TRAY_PAD = 10;

/** Cỡ một ô sao cho cả bàn + khay vừa khung (rộng w, cao h) */
export function blocksCell(w: number, h: number) {
  const byW = Math.floor((Math.min(w, 520) - TRAY_PAD * 2 - PAD * 2 - BORDER * 2 - GAP * (SIZE - 1)) / SIZE);
  const byH = Math.floor((h - TRAY_PAD * 3 - PAD * 2 - BORDER * 2 - GAP * (SIZE - 1) - 24) / (SIZE + 2.5));
  return Math.max(16, Math.min(byW, byH, 52));
}

export function BlocksPuzzleBoard({ width, height, locked }: { width: number; height: number; locked: boolean }) {
  const session = usePuzzles((s) => s.session);
  const st = session?.state as BlocksState | undefined;
  const p = session?.puzzle as BlocksPuzzle | undefined;
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [placed, setPlaced] = useState<{ key: number; cells: Set<number> } | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [refilled, setRefilled] = useState(0);
  const keyRef = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };

  useEffect(() => {
    loadBlocks(); // bật / tắt âm thanh theo lựa chọn của game Xếp Khối
    const release = holdBlockSounds();
    const list = timers.current;
    return () => {
      release();
      for (const t of list) clearTimeout(t);
      list.clear();
    };
  }, []);

  const cell = blocksCell(width, height);
  const pitch = cell + GAP;
  const mini = Math.max(12, Math.min(26, Math.floor(cell * 0.5)));
  const canPlay = Boolean(session && !locked && !session.finished && !session.revealed && st && !st.lost && !st.won);
  const canPlayRef = useRef(canPlay);
  canPlayRef.current = canPlay;

  // Làm lại / xem lời giải: bỏ khối đang chọn, khay hiện lại
  const used = st?.used ?? 0;
  const prevUsed = useRef(used);
  useEffect(() => {
    if (used < prevUsed.current) {
      setSelected(null);
      setPreview(null);
      setPlaced(null);
      setRefilled(keyRef.current++);
    }
    prevUsed.current = used;
  }, [used]);

  const showPreview = useCallback((piece: Piece | null, r: number, c: number) => {
    const board = (usePuzzles.getState().session?.state as BlocksState | undefined)?.board;
    setPreview((prev) => {
      if (!board || !piece || !canPlace(board, piece.shape, r, c)) return prev ? null : prev;
      if (prev && prev.r === r && prev.c === c && prev.color === piece.color) return prev;
      return previewOf(board, piece, r, c);
    });
  }, []);

  const commit = useCallback((slot: number, r: number, c: number) => {
    const res = puzzleBlocks(slot, r, c);
    setPreview(null);
    setSelected(null);
    if (!res) {
      playBlock("invalid", 0.5);
      return;
    }
    playBlock("place", 0.9);
    if (res.lines) playBlock(res.lines >= 3 ? "clear3" : res.lines === 2 ? "clear2" : "clear1", 0.8);
    const key = keyRef.current++;
    setPlaced({ key, cells: new Set(res.placed) });
    if (res.clearedCells.length) {
      const rs = res.placed.map((i) => Math.floor(i / SIZE));
      const cs = res.placed.map((i) => i % SIZE);
      const center = { r: (Math.min(...rs) + Math.max(...rs)) / 2, c: (Math.min(...cs) + Math.max(...cs)) / 2 };
      setBursts((b) => [...b, { key, cells: res.clearedCells, center }]);
      later(() => setBursts((b) => b.filter((x) => x.key !== key)), 1000);
    }
    if (res.refilled) setRefilled(key);
    if (res.won) later(() => playBlock("allclear", 0.9), 260);
    else if (res.lost) later(() => playBlock("gameover", 0.7), 450);
    AccessibilityInfo.announceForAccessibility(
      res.won ? "Sạch bàn!" : res.lost ? "Chưa dọn sạch bàn" : `Đã đặt khối${res.lines ? `, ăn ${res.lines} hàng` : ""}`,
    );
  }, []);

  const { rootRef, gridRef, slotRefs, measure, responders, ghost, ghostScale, dragSlot, cellAt } = useTrayDrag({
    pitch,
    pieceAt: (k) => (canPlayRef.current ? ((usePuzzles.getState().session?.state as BlocksState | undefined)?.tray[k] ?? null) : null),
    boardNow: () => (usePuzzles.getState().session?.state as BlocksState | undefined)?.board ?? null,
    onPick: () => {
      setSelected(null);
      playBlock("pick", 0.6);
    },
    onHover: showPreview,
    onTap: (k) => {
      setPreview(null);
      setSelected((sel) => (sel === k ? null : k));
    },
    onDrop: commit,
    onMiss: () => {
      setPreview(null);
      playBlock("invalid", 0.5);
    },
  });

  // Xem lời giải: máy tự đặt từng khối
  const auto = Boolean(session?.revealed && !session.finished);
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => {
      const m = puzzleSolutionNext();
      if (m && "slot" in m) commit(m.slot, m.r, m.c);
    }, 900);
    return () => clearTimeout(t);
  }, [auto, used, commit]);

  if (!session || session.game !== "blocks" || !st || !p) return null;

  const onBoardPress = (e: GestureResponderEvent) => {
    if (selected == null || !canPlay) return;
    const { r, c } = cellAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
    const piece = st.tray[selected];
    if (!piece) return;
    if (canPlace(st.board, piece.shape, r, c)) commit(selected, r, c);
    else playBlock("invalid", 0.5);
  };

  const hint = session.hint?.kind === "blocks" ? session.hint : null;
  const hintPiece = hint ? st.tray[hint.slot] : null;
  const dragPiece = dragSlot != null ? st.tray[dragSlot] : null;
  const left = p.pieces.length - st.used;

  return (
    <View ref={rootRef} collapsable={false} onLayout={measure} style={[styles.console, { width: gridWidth(cell) + TRAY_PAD * 2 }]}>
      <Pressable
        ref={gridRef}
        onPress={onBoardPress}
        onLayout={measure}
        collapsable={false}
        style={[gridStyles.grid, { width: gridWidth(cell) }]}
        accessibilityLabel={
          selected != null
            ? "Bàn 8 × 8. Chạm vào ô để đặt góc trên bên trái của khối đang chọn."
            : `Bàn 8 × 8, còn ${left} khối. Chọn một khối ở khay bên dưới trước.`
        }
      >
        <GridCells
          board={st.board}
          cell={cell}
          preview={preview}
          placed={placed}
          marked={hint && hintPiece ? { cells: hint.cells, color: hintPiece.color } : null}
        />
        <View style={gridStyles.fx} pointerEvents="none">
          {bursts.flatMap((b) => b.cells.map((x) => <Shard key={`${b.key}-${x.i}`} i={x.i} color={x.color} cell={cell} center={b.center} />))}
        </View>
      </Pressable>

      <View style={[styles.tray, { height: mini * 5 + 24 }]}>
        {[0, 1, 2].map((k) => {
          const piece = st.tray[k] ?? null;
          const fits = piece ? fitsAnywhere(st.board, piece.shape) : false;
          const hinted = hint?.slot === k;
          return (
            <View
              key={k}
              ref={(v) => {
                slotRefs.current[k] = v;
              }}
              collapsable={false}
              style={[styles.slot, selected === k && styles.slotSelected, hinted && styles.slotHint]}
              {...responders[k].panHandlers}
              accessible
              accessibilityRole="button"
              accessibilityLabel={
                piece
                  ? `Khối ${shapeOf(piece.shape)?.cells.length} ô${fits ? "" : ", không còn chỗ đặt"}${hinted ? ", khối gợi ý" : ""}${selected === k ? ", đang chọn" : ""}`
                  : "Đã đặt"
              }
              accessibilityState={{ selected: selected === k, disabled: !piece || !canPlay }}
            >
              {piece ? (
                <Appear key={`${refilled}-${k}`} delay={k * 60} animate={refilled > 0}>
                  <View style={{ opacity: dragSlot === k ? 0 : fits ? 1 : 0.35 }}>
                    <PieceView piece={piece} cell={mini} />
                  </View>
                </Appear>
              ) : null}
            </View>
          );
        })}
      </View>

      {dragPiece ? (
        <Animated.View pointerEvents="none" style={[styles.ghost, { transform: [{ translateX: ghost.x }, { translateY: ghost.y }, { scale: ghostScale }] }]}>
          <PieceView piece={dragPiece} cell={cell} gap={GAP} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  console: { padding: TRAY_PAD, paddingBottom: 6, borderRadius: 24, backgroundColor: "#22307F", alignItems: "center", overflow: "visible" },
  tray: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", alignSelf: "stretch", marginTop: TRAY_PAD },
  slot: { flex: 1, height: "100%", alignItems: "center", justifyContent: "center", borderRadius: 16 },
  slotSelected: { backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 2, borderColor: GOLD },
  slotHint: { backgroundColor: "rgba(255,213,74,0.16)", borderWidth: 2, borderColor: GOLD, borderStyle: "dashed" },
  ghost: { position: "absolute", left: 0, top: 0, zIndex: 20, elevation: 20 },
});
