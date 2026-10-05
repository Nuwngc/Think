import { Chess } from "chess.js";
import { create } from "zustand";

import { api, ApiError } from "../api";
import { myColor, tcLabel } from "./format";
import type { ChessAnalysis, ChessBot, ChessGame, ChessRating } from "./types";

// Dữ liệu cờ vua trong app. Kết nối realtime và thông báo nhỏ nằm ở src/store.ts, gắn vào qua bindChess().

type State = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  rating: ChessRating | null;
  bots: ChessBot[];
  /** Nhóm máy theo sức cờ */
  botTiers: { id: string; name: string }[];
  /** Máy tự chọn sức: khoảng ELO (null = máy chủ cũ chưa có) */
  customElo: { min: number; max: number; step: number } | null;
  /** Các máy đã thắng không cần gợi ý / đi lại (vương miện) */
  beaten: string[];
  /** Gợi ý vừa xin (mũi tên trên bàn cờ) */
  hint: { gameId: number; ply: number; move: string } | null;
  /** Đang xin gợi ý / đi lại */
  helping: Record<number, boolean>;
  /** Đang mở ván hai người một máy */
  localOpen: boolean;
  games: Record<number, ChessGame>;
  /** Giờ trên máy lúc nhận trạng thái ván (để chạy đồng hồ) */
  receivedAt: Record<number, number>;
  leaderboard: ChessRating[] | null;
  /** Ván đang mở toàn màn hình */
  openId: number | null;
  /** Đang gửi nước đi của ván nào */
  sending: Record<number, boolean>;
  /** Phân tích của từng ván (Stockfish trên máy chủ) */
  analyses: Record<number, ChessAnalysis>;
  /** Lịch sử ván đã xong (tải dần) */
  history: { ids: number[]; hasMore: boolean; loading: boolean; loaded: boolean };
};

const emptyHistory = () => ({ ids: [] as number[], hasMore: false, loading: false, loaded: false });

export const useChess = create<State>(() => ({
  loaded: false,
  loading: false,
  error: null,
  rating: null,
  bots: [],
  botTiers: [],
  customElo: null,
  beaten: [],
  hint: null,
  helping: {},
  localOpen: false,
  games: {},
  receivedAt: {},
  leaderboard: null,
  openId: null,
  sending: {},
  analyses: {},
  history: emptyHistory(),
}));

const get = useChess.getState;
const set = useChess.setState;

type Bridge = {
  /** Đã đóng ván đang mở (để màn chính quên chỗ quay về) */
  closed?: () => void;
  meId: () => number;
  nameOf: (id: number | null | undefined) => string;
  toast: (text: string, extra?: { title?: string; senderId?: number; chessGameId?: number }) => void;
  onTab: () => boolean;
  showChess: () => void;
};

let bridge: Bridge = {
  meId: () => 0,
  nameOf: () => "Người dùng",
  toast: () => undefined,
  onTab: () => false,
  showChess: () => undefined,
};

export function bindChess(b: Bridge) {
  bridge = b;
}

export function resetChess() {
  loadAgain = false;
  set({
    loaded: false,
    loading: false,
    error: null,
    rating: null,
    bots: [],
    botTiers: [],
    customElo: null,
    beaten: [],
    hint: null,
    helping: {},
    localOpen: false,
    games: {},
    receivedAt: {},
    leaderboard: null,
    openId: null,
    sending: {},
    analyses: {},
    history: emptyHistory(),
  });
}

/** Thứ tự trạng thái của một ván: lời thách đấu → đang chơi → đã xong. Không bao giờ lùi lại. */
const stageOf = (g: ChessGame) => (g.status === "challenge" ? 0 : g.status === "active" ? 1 : 2);

function upsert(list: ChessGame[]) {
  const now = Date.now();
  set((s) => {
    const games = { ...s.games };
    const receivedAt = { ...s.receivedAt };
    for (const g of list) {
      const prev = games[g.id];
      if (prev) {
        // Bản cũ đến trễ (phản hồi của lần tải đang dở, sự kiện đến không theo thứ tự): bỏ qua
        if (!isNewer(prev, g)) continue;
      }
      games[g.id] = g;
      receivedAt[g.id] = now;
    }
    return { games, receivedAt };
  });
}

/**
 * Bản `g` có mới hơn bản đang có không. Ván đi lại nước (takebacks tăng) thì ít nước hơn mà vẫn mới hơn;
 * bản đến trễ của trước lần đi lại thì bỏ.
 */
export function isNewer(prev: ChessGame, g: ChessGame) {
  if (stageOf(g) < stageOf(prev)) return false;
  if (g.status === "active" && prev.status === "active") {
    const a = prev.takebacks || 0;
    const b = g.takebacks || 0;
    if (b !== a) return b > a;
    if (prev.moves.length > g.moves.length) return false;
  }
  return true;
}

let loadAgain = false;

/** Tải tổng quan: điểm, lời thách đấu, ván đang chơi, ván gần đây */
export async function loadChess() {
  if (get().loading) {
    loadAgain = true; // có thay đổi trong lúc đang tải: tải thêm một lần nữa cho chắc
    return;
  }
  set({ loading: true });
  try {
    const data = await api.chess();
    const list = [...data.challenges, ...data.active, ...data.recent];
    const fresh = new Set(list.map((g) => g.id));
    set((s) => {
      // Bỏ các ván không còn trong danh sách (trừ ván đang mở và ván trong lịch sử đã tải)
      const keep = new Set(s.history.ids);
      const games: Record<number, ChessGame> = {};
      for (const g of Object.values(s.games)) if (fresh.has(g.id) || g.id === s.openId || keep.has(g.id)) games[g.id] = g;
      return {
        games,
        rating: data.rating,
        bots: data.bots,
        botTiers: data.botTiers || [],
        customElo: data.customElo || null,
        beaten: data.beaten || [],
        loaded: true,
        error: null,
      };
    });
    upsert(list);
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Không tải được cờ vua." });
  } finally {
    set({ loading: false });
    if (loadAgain) {
      loadAgain = false;
      loadChess();
    }
  }
}

export async function loadLeaderboard() {
  try {
    const data = await api.chessLeaderboard();
    set({ leaderboard: data.players, rating: data.me });
  } catch (err) {
    bridge.toast(err instanceof Error ? err.message : "Không tải được bảng xếp hạng.");
  }
}

export async function openGame(id: number) {
  set({ openId: id });
  const cached = get().games[id];
  // Ván của người khác (được chia sẻ): luôn lấy bản mới (máy chủ chỉ gửi realtime cho hai người chơi)
  if (cached && !myColor(cached, bridge.meId())) {
    loadGameFresh(id);
    return;
  }
  if (!cached) {
    try {
      const { game } = await api.chessGame(id);
      upsert([game]);
    } catch (err) {
      set({ openId: null });
      bridge.toast(err instanceof Error ? err.message : "Không mở được ván cờ.");
    }
  }
}

/** Tải lại một ván (người xem ván của người khác tự gọi định kỳ khi ván còn đang chơi) */
export async function loadGameFresh(id: number) {
  try {
    const { game } = await api.chessGame(id);
    upsert([game]);
  } catch {
    /* thôi */
  }
}

export function closeGame() {
  set({ openId: null });
  bridge.closed?.();
}

/* ---------------- Thách đấu, chơi với máy ---------------- */

export async function sendChallenge(body: { opponentId: number; base: number; inc: number; color: string; rated: boolean }) {
  const { game } = await api.chessChallenge(body);
  upsert([game]);
  return game;
}

export async function answerChallenge(id: number, action: "accept" | "decline" | "cancel") {
  try {
    const { game } = await api.chessAnswer(id, action);
    upsert([game]);
    if (action === "accept" && game.status === "active") openGame(game.id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) loadChess();
    bridge.toast(err instanceof Error ? err.message : "Chưa làm được.");
  }
}

export async function startBotGame(body: { bot: string; base: number; inc: number; color: string }) {
  const { game } = await api.chessBot(body);
  upsert([game]);
  openGame(game.id);
  return game;
}

/* ---------------- Trong ván ---------------- */

/** Đi một nước: hiện ngay trên bàn cờ, máy chủ từ chối thì trả lại như cũ */
export async function playMove(id: number, uci: string) {
  const g = get().games[id];
  if (!g || g.status !== "active" || get().sending[id]) return false;
  const chess = new Chess(g.fen);
  let fen: string;
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    fen = chess.fen();
  } catch {
    return false;
  }
  const ply = g.moves.length;
  const now = Date.now();
  // Đồng hồ của mình dừng lại (cộng thêm giây nếu có) như máy chủ sẽ làm, để không bị nhảy số
  let clocks = g.clocks;
  if (clocks && ply >= 2) {
    const used = now - (get().receivedAt[id] || now);
    clocks = { ...clocks, [g.turn]: Math.max(0, clocks[g.turn] - used) + g.inc };
  }
  const optimistic: ChessGame = {
    ...g,
    moves: [...g.moves, uci],
    fen,
    clocks,
    turn: g.turn === "w" ? "b" : "w",
    drawOffer: g.drawOffer && g.drawOffer !== g.turn ? null : g.drawOffer,
  };
  set((s) => ({
    games: { ...s.games, [id]: optimistic },
    receivedAt: { ...s.receivedAt, [id]: now },
    sending: { ...s.sending, [id]: true },
  }));
  try {
    const res = await api.chessMove(id, uci, ply);
    upsert([res.game]);
    return true;
  } catch (err) {
    const fresh = err instanceof ApiError && err.data?.game ? (err.data.game as ChessGame) : null;
    // Trả bàn cờ về như trước rồi mới lấy bản của máy chủ (bản đó có thể ít nước hơn bản tạm)
    set((s) => ({ games: { ...s.games, [id]: g } }));
    if (fresh) upsert([fresh]);
    else loadGameFresh(id);
    bridge.toast(err instanceof Error ? err.message : "Chưa đi được nước này.");
    return false;
  } finally {
    set((s) => ({ sending: { ...s.sending, [id]: false } }));
  }
}

/** Ván với máy: xin gợi ý (mũi tên nước tốt nhất). Ván dùng gợi ý không được tính vương miện. */
export async function askHint(id: number) {
  const g = get().games[id];
  if (!g || get().helping[id]) return;
  set((s) => ({ helping: { ...s.helping, [id]: true } }));
  try {
    const res = await api.chessHint(id);
    upsert([res.game]);
    set({ hint: { gameId: id, ply: res.game.moves.length, move: res.move } });
  } catch (err) {
    if (err instanceof ApiError && err.data?.game) upsert([err.data.game as ChessGame]);
    bridge.toast(err instanceof Error ? err.message : "Chưa lấy được gợi ý.");
  } finally {
    set((s) => ({ helping: { ...s.helping, [id]: false } }));
  }
}

/** Ván với máy: đi lại nước vừa đi */
export async function takeBack(id: number) {
  if (get().helping[id] || get().sending[id]) return;
  set((s) => ({ helping: { ...s.helping, [id]: true } }));
  try {
    const res = await api.chessTakeback(id);
    upsert([res.game]);
    set({ hint: null });
  } catch (err) {
    if (err instanceof ApiError && err.data?.game) upsert([err.data.game as ChessGame]);
    bridge.toast(err instanceof Error ? err.message : "Chưa đi lại được.");
  } finally {
    set((s) => ({ helping: { ...s.helping, [id]: false } }));
  }
}

/** Mở / đóng ván hai người một máy (LocalGame.tsx) */
export function openLocal() {
  set({ localOpen: true, openId: null });
}
export function closeLocal() {
  set({ localOpen: false });
}

async function act(fn: () => Promise<{ game: ChessGame }>) {
  try {
    const { game } = await fn();
    upsert([game]);
    return game;
  } catch (err) {
    if (err instanceof ApiError && err.data?.game) upsert([err.data.game]);
    bridge.toast(err instanceof Error ? err.message : "Chưa làm được.");
    return null;
  }
}

export const resign = (id: number) => act(() => api.chessResign(id));
export const abort = (id: number) => act(() => api.chessAbort(id));
export const draw = (id: number, action: "offer" | "accept" | "decline") => act(() => api.chessDraw(id, action));

export async function rematch(id: number) {
  const game = await act(() => api.chessRematch(id));
  if (!game) return;
  if (game.status === "active") openGame(game.id);
  else {
    closeGame();
    bridge.toast(`Đã gửi lời mời đấu lại cho ${bridge.nameOf(game.opponentId)}.`);
  }
}

/* ---------------- Lịch sử ván, phân tích ---------------- */

/** Tải lịch sử ván đã xong; more = tải thêm trang cũ hơn */
export async function loadHistory(more = false) {
  const h = get().history;
  if (h.loading || (more && !h.hasMore)) return;
  set({ history: { ...h, loading: true } });
  try {
    const last = more ? get().games[h.ids[h.ids.length - 1]] : null;
    const data = await api.chessHistory(last?.endedAt || undefined, last?.id);
    upsert(data.games);
    const ids = more ? [...h.ids, ...data.games.map((g) => g.id).filter((id) => !h.ids.includes(id))] : data.games.map((g) => g.id);
    set({ history: { ids, hasMore: data.hasMore, loading: false, loaded: true } });
  } catch (err) {
    set((s) => ({ history: { ...s.history, loading: false, loaded: true } }));
    bridge.toast(err instanceof Error ? err.message : "Không tải được lịch sử ván.");
  }
}

function setAnalysis(id: number, a: ChessAnalysis) {
  set((s) => {
    const prev = s.analyses[id];
    // Đã có kết quả thì không để tin tiến độ cũ đến trễ đè lên
    if (prev?.status === "done" && a.status !== "done" && a.status !== "error") return {};
    return { analyses: { ...s.analyses, [id]: a } };
  });
}

export async function loadAnalysis(id: number) {
  try {
    const { analysis } = await api.chessAnalysis(id);
    setAnalysis(id, analysis);
  } catch {
    // Không tải được (mất mạng…): hiện nút để bấm phân tích / thử lại
    if (!get().analyses[id]) setAnalysis(id, { status: "none", progress: 0, total: 0 });
  }
}

export async function requestAnalysis(id: number) {
  try {
    const { analysis } = await api.chessAnalyze(id);
    setAnalysis(id, analysis);
  } catch (err) {
    bridge.toast(err instanceof Error ? err.message : "Chưa phân tích được ván này.");
  }
}

export function onAnalysisEvent(data: { gameId: number; analysis: ChessAnalysis }) {
  if (!data || !data.analysis) return;
  const id = Number(data.gameId);
  const before = get().analyses[id];
  setAnalysis(id, data.analysis);
  if (data.analysis.status === "done" && before && before.status !== "done" && get().openId !== id) {
    bridge.toast("Đã phân tích xong ván cờ. Chạm để xem.", { title: "♟ Phân tích ván đấu", chessGameId: id });
  }
}

/* ---------------- Sự kiện realtime ---------------- */

export function onChessEvent(event: "chess:game" | "chess:challenge", data: { game: ChessGame }) {
  const g = data?.game;
  if (!g) return;
  const me = bridge.meId();
  const prev = get().games[g.id];
  upsert([g]);
  const open = get().openId === g.id;

  if (event === "chess:challenge") {
    if (g.status === "challenge" && g.opponentId === me && !prev) {
      bridge.toast(`${bridge.nameOf(g.challengerId)} thách bạn một ván ${tcLabel(g)}${g.rated ? " (tính điểm)" : ""}. Chạm để xem.`, {
        title: "♟ Thách đấu cờ vua",
        senderId: g.challengerId ?? undefined,
        chessGameId: g.id,
      });
    } else if (g.status === "declined" && g.challengerId === me && prev?.status === "challenge") {
      bridge.toast(`${bridge.nameOf(g.opponentId)} đã từ chối lời thách đấu.`);
    }
    return;
  }

  // Lời thách đấu mình gửi vừa được nhận: vào ván luôn nếu đang ở tab Cờ vua
  if (g.status === "active" && prev?.status === "challenge" && g.challengerId === me) {
    if (bridge.onTab() && get().openId == null) openGame(g.id);
    else bridge.toast(`${bridge.nameOf(g.opponentId)} đã nhận lời. Chạm để vào chơi!`, { title: "♟ Vào ván thôi", chessGameId: g.id });
  }
  // Ván vừa kết thúc: cập nhật điểm
  if ((g.status === "finished" || g.status === "aborted") && prev?.status === "active") {
    loadChess();
    if (get().leaderboard) loadLeaderboard();
    if (!open && myColor(g, me)) bridge.toast("Một ván cờ của bạn vừa kết thúc. Chạm để xem.", { chessGameId: g.id });
  }
  // Đối thủ vừa đi mà mình đang ở chỗ khác
  if (g.status === "active" && prev && prev.moves.length < g.moves.length && !open && myColor(g, me) === g.turn && !g.bot) {
    bridge.toast(`${bridge.nameOf(myColor(g, me) === "w" ? g.blackId : g.whiteId)} vừa đi. Đến lượt bạn!`, { title: "♟ Cờ vua", chessGameId: g.id });
  }
}

/** Số việc cần làm ở tab Cờ vua: lời thách đấu gửi tới mình + ván đang tới lượt mình */
export function chessBadge(s: State, meId: number) {
  let n = 0;
  for (const g of Object.values(s.games)) {
    if (g.status === "challenge" && g.opponentId === meId) n++;
    else if (g.status === "active" && myColor(g, meId) === g.turn) n++;
  }
  return n;
}
