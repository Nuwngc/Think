import { useCallback, useEffect, useRef, useState } from "react";

import { Board } from "../caro/Board";
import { cellName, winLine } from "../caro/engine";
import { makesThreat } from "../caro/format";
import { playCaro, preloadCaroSounds } from "../caro/sound";
import { loadLocal as loadCaroLocal } from "../caro/store";
import type { CaroState } from "./core";
import { puzzleCaro, puzzleSolutionNext, usePuzzles } from "./store";

// Bàn cờ của câu đố caro: dùng lại bàn caro của game (chạm một ô để xem trước, chạm lại để đánh; âm thanh; pháo giấy).
// Bạn cầm X; đánh đúng thì máy (O) chặn sau một nhịp. Gợi ý = ô được tô sẵn, chạm vào là đánh.

export function CaroPuzzleBoard({ width, height, locked, status }: { width: number; height: number; locked: boolean; status: string }) {
  const session = usePuzzles((s) => s.session);
  const [ghost, setGhost] = useState<number | null>(null);
  const [shown, setShown] = useState<{ board: number[]; last: number } | null>(null);
  const [confetti, setConfetti] = useState<{ side: "x"; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadCaroLocal(); // bật / tắt âm thanh theo lựa chọn của game caro
    preloadCaroSounds();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Gợi ý: tô sẵn ô cần đánh (chạm vào là đánh)
  const hint = session?.hint;
  useEffect(() => {
    if (hint?.kind === "cell") setGhost(hint.i);
  }, [hint]);

  const play = useCallback((i: number) => {
    setGhost(null);
    const r = puzzleCaro(i);
    if (!r) return;
    if (!r.ok) {
      playCaro("invalid", 0.6);
      return;
    }
    playCaro("place-x", 0.9);
    if (r.won) {
      // Tự giải được thì có pháo giấy (xem lời giải thì thôi)
      if (!usePuzzles.getState().session?.revealed) {
        setConfetti({ side: "x", key: Date.now() });
        playCaro("win", 0.9, 300);
      }
      return;
    }
    // Hiện quân X trước, quân O chặn sau một nhịp
    const b = r.state.board.slice();
    if (r.reply != null) b[r.reply] = 0;
    setShown({ board: b, last: i });
    if (makesThreat(b, i)) playCaro("threat", 0.8, 150);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(null);
      playCaro("place-o", 0.9);
    }, 600);
  }, []);

  const st = session?.state as CaroState | undefined;
  const auto = Boolean(session?.revealed && !session.finished);
  useEffect(() => {
    if (!auto || shown) return;
    const t = setTimeout(() => {
      const m = puzzleSolutionNext();
      if (m && "cell" in m) play(m.cell);
    }, 900);
    return () => clearTimeout(t);
  }, [auto, shown, st?.history.length, play]);

  // Làm lại / xem lời giải: bỏ ô đang xem trước
  const n = st?.history.length ?? 0;
  useEffect(() => {
    if (n === 0) setConfetti(null);
  }, [n]);

  const onBlocked = useCallback(
    (i: number, why: "occupied" | "turn") => {
      if (why === "occupied") play(i);
    },
    [play],
  );

  if (!session || session.game !== "caro" || !st) return null;
  const playable = !locked && !session.finished && !session.revealed && !shown;
  const board = shown?.board ?? st.board;
  const last = shown?.last ?? st.last;
  const line = st.won && st.last != null ? winLine(st.board, st.last) : null;
  const size = Math.min(width, height, 560);
  return (
    <Board
      board={board}
      size={size}
      last={last}
      line={line}
      playable={playable}
      mine="x"
      ghost={playable ? ghost : null}
      onGhost={setGhost}
      onPlace={play}
      onBlocked={onBlocked}
      confetti={confetti}
      label={`Bàn cờ caro 15 × 15, câu đố. Bạn cầm X.${last != null ? ` Nước vừa đi ${cellName(last)}.` : ""} ${status}`}
    />
  );
}
