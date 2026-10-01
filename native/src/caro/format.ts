// Chữ hiển thị cho cờ caro (cùng cách nói với bản web)
import { O, SIZE, threatsAt, X, type Level, type Rule } from "./engine";
import type { CaroGame, Side } from "./types";

export const LEVEL_INFO: Record<Level, { label: string; about: string; color: string }> = {
  easy: { label: "Dễ", about: "Mới tập chơi, hay đi lung tung", color: "#2E9D5B" },
  medium: { label: "Vừa", about: "Biết tấn công và chặn đường 4", color: "#C98A0B" },
  hard: { label: "Khó", about: "Tính trước vài nước, khó thắng", color: "#C4412F" },
};

export const RULE_INFO: Record<Rule, { label: string; sub: string; about: string }> = {
  free: { label: "Tự do", sub: "Phổ biến nhất", about: "Có 5 quân liền nhau là thắng, kể cả khi bị chặn hai đầu." },
  block2: {
    label: "Chặn hai đầu",
    sub: "Kiểu Việt Nam",
    about: "5 quân mà bị quân đối phương chặn cả hai đầu thì không tính thắng (mép bàn không tính là chặn).",
  },
};

/** Tên gọi từng mức thời gian mỗi nước */
export const TURN_SUB: Record<number, string> = { 15: "Chớp nhoáng", 30: "Nhanh", 60: "Thong thả", 120: "Chậm rãi", 0: "Đi lúc nào cũng được" };

export const markName = (s: Side) => (s === "x" ? "X" : "O");
export const otherSide = (s: Side): Side => (s === "x" ? "o" : "x");
export const sideNum = (s: Side) => (s === "x" ? X : O);
export const numSide = (v: number): Side | null => (v === X ? "x" : v === O ? "o" : null);
export const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function secondsLabel(s: number) {
  if (!s) return "Không giới hạn";
  return s >= 60 && s % 60 === 0 ? `${s / 60} phút` : `${s} giây`;
}

/** "30 giây/nước", "2 phút/nước", "Không giới hạn giờ" */
export function turnLabel(ms: number) {
  if (!ms) return "Không giới hạn giờ";
  const s = Math.round(ms / 1000);
  return s >= 60 && s % 60 === 0 ? `${s / 60} phút/nước` : `${s} giây/nước`;
}

export const ruleLabel = (r: Rule) => RULE_INFO[r]?.label || r;

/** Đồng hồ đếm ngược mỗi nước: 0:30, 1:05 */
export function countdownText(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Bên của mình trong ván (null = không chơi ván này) */
export const sideOf = (g: Pick<CaroGame, "xId" | "oId">, meId: number): Side | null => (g.xId === meId ? "x" : g.oId === meId ? "o" : null);
export const playerOf = (g: Pick<CaroGame, "xId" | "oId">, side: Side) => (side === "x" ? g.xId : g.oId);

/** Người kia trong ván / lời thách đấu */
export function opponentOf(g: CaroGame, meId: number) {
  const mine = sideOf(g, meId);
  if (mine) return playerOf(g, otherSide(mine));
  return g.challengerId === meId ? g.opponentId : g.challengerId;
}

export type Outcome = "win" | "loss" | "draw" | "aborted" | "none" | null;

export function outcomeFor(g: Pick<CaroGame, "status" | "result">, mine: Side | null): Outcome {
  if (g.status === "aborted") return "aborted";
  if (!g.result) return null;
  if (g.result === "draw") return "draw";
  if (!mine) return "none";
  return g.result === mine ? "win" : "loss";
}

/** Lý do kết thúc, nhìn từ phía mình */
export function reasonText(g: Pick<CaroGame, "status" | "result" | "reason">, mine: Side | null, oppName = "Đối thủ") {
  const o = outcomeFor(g, mine);
  switch (g.reason) {
    case "five":
      return o === "loss" ? `${oppName} có 5 quân liền` : "5 quân liền";
    case "resign":
      return o === "win" ? "Đối thủ đầu hàng" : o === "loss" ? "Bạn đã đầu hàng" : "Đầu hàng";
    case "timeout":
      return o === "win" ? "Đối thủ hết giờ" : o === "loss" ? "Bạn hết giờ" : "Hết giờ";
    case "full":
      return "Kín bàn, không ai có 5 quân liền";
    case "no-start":
      return "Không ai đi nước đầu nên ván bị hủy";
    case "aborted":
      return "Ván bị hủy trước khi bắt đầu, không tính điểm";
    default:
      return "";
  }
}

export function resultTitle(g: Pick<CaroGame, "status" | "result">, mine: Side | null, winnerName = "") {
  const o = outcomeFor(g, mine);
  if (o === "aborted") return "Ván đã hủy";
  if (o === "draw") return "Hòa";
  if (o === "win") return "Bạn thắng!";
  if (o === "loss") return "Bạn thua";
  return g.result ? `${winnerName || markName(g.result as Side)} thắng` : "";
}

export function ratingOf(g: Pick<CaroGame, "xRating" | "oRating">, side: Side) {
  return side === "x" ? g.xRating : g.oRating;
}
export function deltaOf(g: Pick<CaroGame, "xDelta" | "oDelta">, side: Side) {
  return side === "x" ? g.xDelta : g.oDelta;
}

/** Nước vừa đi ở ô i có tạo thế "4" (còn một nước nữa là đủ 5) không */
export function makesThreat(board: number[], i: number) {
  const p = board[i];
  if (!p) return false;
  const t = threatsAt(board, i, p);
  return t.openFour > 0 || t.four > 0;
}

/** Hàng, cột (tính từ 1, hàng 1 ở trên cùng) cho trình đọc màn hình */
export function cellSpeech(i: number) {
  return `hàng ${Math.floor(i / SIZE) + 1}, cột ${(i % SIZE) + 1}`;
}
