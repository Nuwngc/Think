import { Chess } from "chess.js";

// PGN cho bàn phân tích: đọc ván dán vào, ghi các nước ra PGN. Giống bản web (movesFromPgn, abPgn trong public/chess-ui.js).

/** Đọc PGN: trả về danh sách nước dạng e2e4, hoặc ném lỗi tiếng Việt */
export function movesFromPgn(text: string): string[] {
  const src = String(text || "").trim();
  if (!src) throw new Error("Chưa có PGN để dán.");
  const chess = new Chess();
  try {
    chess.loadPgn(src);
  } catch (err) {
    const bad = /Invalid move in PGN: (.+)$/.exec(err instanceof Error ? err.message : "");
    throw new Error(bad ? `Nước "${bad[1]}" không hợp lệ. Kiểm tra lại PGN.` : "Không đọc được PGN này.");
  }
  const headers = chess.getHeaders();
  if (headers.FEN && headers.FEN !== new Chess().fen()) throw new Error("Ván này bắt đầu từ một thế cờ riêng, bàn phân tích chỉ mở được ván bắt đầu từ đầu.");
  const moves = chess.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ""}`);
  if (!moves.length) throw new Error("PGN không có nước đi nào.");
  return moves.slice(0, 600);
}

/** PGN các nước trên bàn phân tích */
export function pgnOf(moves: string[], date = new Date()) {
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined });
  const pad = (n: number) => String(n).padStart(2, "0");
  chess.setHeader("Event", "Bàn phân tích");
  chess.setHeader("Site", "Think");
  chess.setHeader("Date", `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`);
  return chess.pgn();
}
