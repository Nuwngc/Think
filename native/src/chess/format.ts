// Chữ hiển thị cho cờ vua (dùng chung ý với bản web)
import { Chess } from "chess.js";

import type { ChessGame, Color } from "./types";

/** Các mức thời gian hay dùng: phút + giây cộng thêm mỗi nước */
export const TIME_CONTROLS: { base: number; inc: number; label: string; kind: string }[] = [
  { base: 1, inc: 0, label: "1+0", kind: "Chớp nhoáng" },
  { base: 2, inc: 1, label: "2+1", kind: "Chớp nhoáng" },
  { base: 3, inc: 0, label: "3+0", kind: "Cờ chớp" },
  { base: 3, inc: 2, label: "3+2", kind: "Cờ chớp" },
  { base: 5, inc: 0, label: "5+0", kind: "Cờ chớp" },
  { base: 5, inc: 3, label: "5+3", kind: "Cờ chớp" },
  { base: 10, inc: 0, label: "10+0", kind: "Cờ nhanh" },
  { base: 15, inc: 10, label: "15+10", kind: "Cờ nhanh" },
  { base: 30, inc: 0, label: "30+0", kind: "Cờ chậm" },
  { base: 0, inc: 0, label: "∞", kind: "Không giới hạn" },
];

export function tcLabel(g: Pick<ChessGame, "base" | "inc">) {
  if (!g.base) return "Không giới hạn";
  const min = Math.round(g.base / 60000);
  return `${min}+${Math.round(g.inc / 1000)}`;
}

/** Đồng hồ: 4:05, 0:09.3 (dưới 10 giây hiện phần mười giây) */
export function clockText(ms: number) {
  const t = Math.max(0, ms);
  if (t < 10000) return `0:0${(t / 1000).toFixed(1)}`.replace(/^0:0(\d\d)/, "0:$1");
  const s = Math.ceil(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const REASONS: Record<string, string> = {
  checkmate: "chiếu hết",
  resign: "đầu hàng",
  timeout: "hết giờ",
  stalemate: "hết nước đi (hòa pat)",
  insufficient: "không đủ quân chiếu hết",
  repetition: "lặp lại 3 lần",
  fifty: "luật 50 nước",
  agreement: "hai bên đồng ý hòa",
  aborted: "ván bị hủy",
  "no-start": "không ai đi nước đầu",
};

export const reasonText = (reason: string | null) => (reason ? REASONS[reason] || reason : "");

/** Kết quả nhìn từ phía mình: thắng / thua / hòa */
export function outcomeFor(g: ChessGame, color: Color | null): "win" | "loss" | "draw" | "aborted" | null {
  if (g.status === "aborted") return "aborted";
  if (!g.result) return null;
  if (g.result === "1/2-1/2") return "draw";
  if (!color) return null;
  return (g.result === "1-0") === (color === "w") ? "win" : "loss";
}

export function resultTitle(g: ChessGame, color: Color | null) {
  const o = outcomeFor(g, color);
  if (o === "aborted") return "Ván cờ đã bị hủy";
  if (o === "draw") return "Hòa";
  if (o === "win") return "Bạn thắng!";
  if (o === "loss") return "Bạn thua";
  if (g.result === "1-0") return "Trắng thắng";
  if (g.result === "0-1") return "Đen thắng";
  return "";
}

/** Danh sách nước đi dạng ký hiệu cờ (e4, Nf3, O-O…) và bàn cờ sau từng nước */
export function replay(moves: string[]) {
  const chess = new Chess();
  const san: string[] = [];
  const fens: string[] = [chess.fen()];
  for (const m of moves) {
    try {
      const r = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined });
      san.push(r.san);
      fens.push(chess.fen());
    } catch {
      break;
    }
  }
  return { san, fens };
}

/** Người chơi màu nào trong ván (null nếu không chơi) */
export const myColor = (g: ChessGame, meId: number): Color | null => (g.whiteId === meId ? "w" : g.blackId === meId ? "b" : null);

export const opponentColor = (c: Color): Color => (c === "w" ? "b" : "w");

/* ---------------- Quân đã ăn được, chênh lệch lực lượng ---------------- */

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

/** Quân mỗi bên đã ăn được (theo thế cờ hiện tại) và điểm hơn */
export function material(fen: string) {
  const count: Record<Color, Record<string, number>> = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const ch of fen.split(" ")[0]) {
    const lower = ch.toLowerCase();
    if (!(lower in START)) continue;
    count[ch === lower ? "b" : "w"][lower]++;
  }
  const captured: Record<Color, string[]> = { w: [], b: [] };
  let score = 0;
  for (const t of ["q", "r", "b", "n", "p"]) {
    // Trắng ăn quân đen
    for (let i = count.b[t]; i < START[t]; i++) captured.w.push(`b${t.toUpperCase()}`);
    for (let i = count.w[t]; i < START[t]; i++) captured.b.push(`w${t.toUpperCase()}`);
    score += (count.w[t] - count.b[t]) * VALUE[t];
  }
  return { captured, lead: { w: Math.max(0, score), b: Math.max(0, -score) } };
}
