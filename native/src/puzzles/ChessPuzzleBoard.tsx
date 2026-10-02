import { Chess } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { Board } from "../chess/Board";
import { loadPrefs, usePrefs } from "../chess/prefs";
import { holdSounds, playSound, soundForSan, type SoundName } from "../chess/sound";
import { chessSide, type ChessPuzzle, type ChessState } from "./core";
import { puzzleChess, puzzleSolutionNext, usePuzzles } from "./store";

// Bàn cờ của câu đố cờ vua: dùng lại bàn cờ của game (quân trượt, kéo thả, phong cấp, tùy chọn bàn cờ, âm thanh).
// Đi đúng: quân trượt tới, rồi máy đáp lại (trượt sau một nhịp). Đi sai: quân về chỗ cũ, tiếng báo sai.

/** Tiếng hợp với nước đi (theo ký hiệu nước đi) */
function soundOf(fen: string, uci: string, byMe: boolean): SoundName {
  try {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    return soundForSan(m.san, byMe);
  } catch {
    return byMe ? "move" : "move-opp";
  }
}

export function ChessPuzzleBoard({ width, height, locked }: { width: number; height: number; locked: boolean }) {
  const session = usePuzzles((s) => s.session);
  const prefs = usePrefs();
  const [shown, setShown] = useState<{ fen: string; last: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadPrefs();
    const release = holdSounds();
    return () => {
      release();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const play = useCallback((uci: string) => {
    const before = usePuzzles.getState().session?.state as ChessState | undefined;
    const r = puzzleChess(uci);
    if (!r || !before) return;
    if (!r.ok) {
      playSound("illegal");
      return;
    }
    playSound(soundOf(before.fen, r.played!, true));
    if (r.reply && r.midFen) {
      // Máy đáp lại sau một nhịp (để thấy quân của mình tới nơi trước)
      const mid = r.midFen;
      const reply = r.reply;
      setShown({ fen: mid, last: r.played! });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setShown(null);
        playSound(soundOf(mid, reply, false));
      }, 600);
    }
    if (r.done) setTimeout(() => playSound("end"), 450);
  }, []);

  const st = session?.state as ChessState | undefined;
  const auto = Boolean(session?.revealed && !session.finished);
  // Xem lời giải: máy tự đi từng nước
  useEffect(() => {
    if (!auto || shown) return;
    const t = setTimeout(() => {
      const m = puzzleSolutionNext();
      if (m && "uci" in m) play(m.uci);
    }, 900);
    return () => clearTimeout(t);
  }, [auto, shown, st?.ply, play]);

  if (!session || session.game !== "chess" || !st) return null;
  const p = session.puzzle as ChessPuzzle;
  const side = chessSide(p);
  const size = Math.floor(Math.min(width, height, 560) / 8) * 8;
  const hint = session.hint;
  const movable = !locked && !session.finished && !session.revealed && !shown ? side : null;
  return (
    <View style={{ width: size, height: size, borderRadius: 6, overflow: "hidden" }}>
      <Board
        fen={shown?.fen ?? st.fen}
        lastMove={shown?.last ?? st.last}
        size={size}
        orientation={side}
        movable={movable}
        onMove={play}
        onIllegal={() => playSound("illegal")}
        hints={prefs.hints}
        showLast={prefs.lastMove}
        coords={prefs.coords}
        animate={prefs.anim}
        arrow={hint?.kind === "move" ? hint.uci : null}
        highlight={hint?.kind === "square" ? hint.sq : null}
      />
    </View>
  );
}
