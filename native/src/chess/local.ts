import { Chess } from "chess.js";

import type { Color } from "./types";

// Ván hai người một máy: luật chạy ngay trên máy (chess.js), không cần mạng, không tính điểm.

export type LocalOutcome = {
  result: "1-0" | "0-1" | "1/2-1/2";
  reason: "checkmate" | "stalemate" | "insufficient" | "repetition" | "fifty" | "resign";
} | null;

export type LocalState = {
  /** Các nước hợp lệ đã đi (bỏ nước hỏng nếu dữ liệu lưu bị lỗi) */
  moves: string[];
  san: string[];
  fens: string[];
  fen: string;
  turn: Color;
  check: boolean;
  outcome: LocalOutcome;
};

/** Dựng lại ván từ danh sách nước đi (dạng e2e4, e7e8q). resigned: bên đã đầu hàng */
export function localState(moves: string[], resigned: Color | null = null): LocalState {
  const chess = new Chess();
  const ok: string[] = [];
  const san: string[] = [];
  const fens = [chess.fen()];
  for (const m of moves) {
    try {
      const r = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined });
      ok.push(`${r.from}${r.to}${r.promotion || ""}`);
      san.push(r.san);
      fens.push(chess.fen());
    } catch {
      break;
    }
  }
  let outcome: LocalOutcome = null;
  if (chess.isCheckmate()) outcome = { result: chess.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  else if (chess.isStalemate()) outcome = { result: "1/2-1/2", reason: "stalemate" };
  else if (chess.isInsufficientMaterial()) outcome = { result: "1/2-1/2", reason: "insufficient" };
  else if (chess.isThreefoldRepetition()) outcome = { result: "1/2-1/2", reason: "repetition" };
  else if (chess.isDrawByFiftyMoves()) outcome = { result: "1/2-1/2", reason: "fifty" };
  else if (resigned) outcome = { result: resigned === "w" ? "0-1" : "1-0", reason: "resign" };
  return { moves: ok, san, fens, fen: chess.fen(), turn: chess.turn(), check: chess.inCheck(), outcome };
}

/** Dòng trạng thái dưới bàn cờ */
export function localStatusText(st: LocalState) {
  const side = (c: Color) => (c === "w" ? "Trắng" : "Đen");
  const o = st.outcome;
  if (!o) return `${side(st.turn)} đi${st.check ? " — đang bị chiếu!" : "."}`;
  if (o.reason === "checkmate") return `Chiếu hết! ${o.result === "1-0" ? "Trắng" : "Đen"} thắng.`;
  if (o.reason === "resign") return `${o.result === "1-0" ? "Đen" : "Trắng"} đầu hàng. ${o.result === "1-0" ? "Trắng" : "Đen"} thắng.`;
  const why = {
    stalemate: "hết nước đi (pat)",
    insufficient: "không đủ quân chiếu hết",
    repetition: "lặp lại thế cờ 3 lần",
    fifty: "50 nước không ăn quân, không đi tốt",
  }[o.reason];
  return `Hòa do ${why}.`;
}
