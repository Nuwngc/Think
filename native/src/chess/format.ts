// Chữ hiển thị cho cờ vua (dùng chung ý với bản web)
import { Chess } from "chess.js";

import type { AnalysedMove, AnalysedPosition, AnalysisResult, ChessGame, Color, MoveClass } from "./types";

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

/** Cờ theo ngày: số ngày mỗi nước */
export const DAILY_DAYS = [1, 2, 3, 7];
export const DAY_MS = 86400000;

export function tcLabel(g: Pick<ChessGame, "base" | "inc"> & { daily?: number }) {
  if (g.daily) return `${Math.round(g.daily / DAY_MS)} ngày/nước`;
  if (!g.base) return "Không giới hạn";
  const min = Math.round(g.base / 60000);
  return `${min}+${Math.round(g.inc / 1000)}`;
}

/** Đồng hồ: 4:05, 0:09.3 (dưới 10 giây hiện phần mười giây) */
export function clockText(ms: number) {
  const t = Math.max(0, ms);
  // Cờ theo ngày: "2 ngày 3 giờ"
  if (t >= DAY_MS) return `${Math.floor(t / DAY_MS)} ngày ${Math.floor((t % DAY_MS) / 3600000)} giờ`;
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

/* ---------------- Phân tích ván ---------------- */

/** Ký hiệu, tên, màu của từng loại nước đi (giống bản web: MOVE_CLASS trong public/chess-ui.js) */
export const MOVE_CLASS: Record<MoveClass, { symbol: string; label: string; color: string; title: string; icon?: string }> = {
  brilliant: { symbol: "!!", label: "Thiên tài", color: "#1FB3A9", title: "là nước thiên tài!" },
  great: { symbol: "!", label: "Tuyệt vời", color: "#4F8FD9", title: "là nước tuyệt vời!" },
  best: { symbol: "★", label: "Tốt nhất", color: "#7DB24A", title: "là nước tốt nhất", icon: "star" },
  excellent: { symbol: "👍", label: "Rất tốt", color: "#93BD4F", title: "là nước rất tốt", icon: "thumb-up" },
  good: { symbol: "✓", label: "Tốt", color: "#8FAE8A", title: "là nước tốt", icon: "check" },
  book: { symbol: "📖", label: "Theo sách", color: "#A8845F", title: "là nước theo sách khai cuộc", icon: "menu-book" },
  inaccuracy: { symbol: "?!", label: "Thiếu chính xác", color: "#E9B83E", title: "thiếu chính xác" },
  mistake: { symbol: "?", label: "Sai lầm", color: "#E58A2B", title: "là sai lầm" },
  miss: { symbol: "✕", label: "Bỏ lỡ", color: "#F06A5B", title: "là nước bỏ lỡ", icon: "close" },
  blunder: { symbol: "??", label: "Sai lầm nghiêm trọng", color: "#D1373B", title: "là sai lầm nghiêm trọng" },
  forced: { symbol: "→", label: "Bắt buộc", color: "#96A39E", title: "là nước bắt buộc", icon: "arrow-forward" },
};

/** Thứ tự các loại trong bảng tổng kết */
export const CLASS_ORDER: MoveClass[] = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder"];
/** Loại nước đáng chú ý: có dấu trong danh sách nước đi, chấm màu trên biểu đồ */
export const NOTABLE = new Set<MoveClass>(["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"]);

/** Điểm đánh giá dễ đọc: +1.3 (Trắng hơn), −0.5, M3 (chiếu hết sau 3 nước), 1-0 khi đã chiếu hết */
export function evalText(p: Pick<AnalysedPosition, "cp" | "mate" | "wp" | "end"> | undefined) {
  if (!p) return "";
  if (p.end === "checkmate") return p.wp >= 50 ? "1-0" : "0-1";
  if (p.end === "draw") return "½-½";
  if (p.mate != null) return `M${Math.abs(p.mate)}`;
  const v = (p.cp || 0) / 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
}

/** Đọc điểm cho trình đọc màn hình: nói rõ bên nào chiếu hết được */
export function evalSpeech(p: Pick<AnalysedPosition, "cp" | "mate" | "wp" | "end"> | undefined) {
  if (!p) return "";
  if (p.end === "checkmate") return p.wp >= 50 ? "Trắng đã chiếu hết" : "Đen đã chiếu hết";
  if (p.end === "draw") return "Hòa";
  if (p.mate != null) return `${p.mate > 0 ? "Trắng" : "Đen"} chiếu hết được sau ${Math.abs(p.mate)} nước`;
  return evalText(p);
}

const PIECE_OBJ: Record<string, string> = { n: "Mã", b: "Tượng", r: "Xe", q: "Hậu", p: "Tốt" };

/** Nhận xét một nước kiểu huấn luyện viên: tiêu đề ("Nf3 là nước tốt nhất") + giải thích ngắn */
export function coachText(m: AnalysedMove, before: AnalysedPosition | undefined, result?: Pick<AnalysisResult, "opening"> | null) {
  const info = MOVE_CLASS[m.cls] || MOVE_CLASS.good;
  const best = before?.bestSan && before.best !== m.uci ? before.bestSan : null;
  const title = `${m.san} ${info.title}`;
  let detail = "";
  switch (m.cls) {
    case "brilliant":
      detail = `Thí ${(m.sac && PIECE_OBJ[m.sac]) || "quân"} rất đẹp mà thế cờ vẫn tốt nhất. Không dễ nhìn ra đâu!`;
      break;
    case "great":
      detail = "Nước duy nhất giữ được thế cờ, các nước khác đều kém hẳn.";
      break;
    case "best":
      detail = /#$/.test(m.san) ? "Chiếu hết!" : "Đúng nước máy chọn.";
      break;
    case "excellent":
    case "good":
      detail = best ? `Máy thích ${best} hơn một chút.` : "";
      break;
    case "book":
      detail = result?.opening && m.ply <= result.opening.ply ? `Khai cuộc: ${result.opening.name}.` : "Nước quen thuộc trong lý thuyết khai cuộc.";
      break;
    case "miss":
      detail =
        m.missedMate && best
          ? `Bạn đã có đường chiếu hết sau ${m.missedMate} nước, bắt đầu bằng ${best}.`
          : `Đối thủ vừa đi sai mà chưa tận dụng được.${best ? ` Nên đi ${best}.` : ""}`;
      break;
    case "forced":
      detail = "Chỉ có một nước đi hợp lệ.";
      break;
    default:
      detail = best ? `Nước tốt nhất là ${best}.` : "";
  }
  if (m.allowsMate && m.cls !== "forced") detail += ` Đối thủ có thể chiếu hết sau ${m.allowsMate} nước.`;
  return { title, detail: detail.trim() };
}

/** Nhận xét một dòng (dùng cho trình đọc màn hình / chỗ chật) */
export function moveComment(m: AnalysedMove | undefined, before: AnalysedPosition | undefined) {
  if (!m) return "";
  const t = coachText(m, before);
  return `${Math.ceil(m.ply / 2)}${m.color === "w" ? "." : "…"} ${t.title}.${t.detail ? ` ${t.detail}` : ""}`;
}

/** Tiêu đề và dòng mô tả một ván để chia sẻ (giống bản web: describe trong public/chess-ui.js) */
export function describeGame(g: ChessGame, nameOf: (id: number | null | undefined) => string) {
  const side = (c: Color) => (g.bot && g.botColor === c ? g.bot.name : nameOf(c === "w" ? g.whiteId : g.blackId));
  const title = `${side("w")} (Trắng) vs ${side("b")} (Đen)`;
  let state: string;
  if (g.status === "active") state = "Đang chơi";
  else if (g.status === "aborted") state = "Ván bị hủy";
  else if (g.result === "1/2-1/2") state = `Hòa (${reasonText(g.reason)})`;
  else state = `${g.result === "1-0" ? side("w") : side("b")} thắng do ${reasonText(g.reason)}`;
  return { title, sub: `${state} · ${tcLabel(g)} · ${g.moves.length} nước` };
}
