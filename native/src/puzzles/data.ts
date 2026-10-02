import AsyncStorage from "@react-native-async-storage/async-storage";

import { api } from "../api";
import { dailyIndex, GAMES, type GameId, type Puzzle, type PuzzleData } from "./core";

// Dữ liệu câu đố đóng gói trong app (bản sao của public/puzzles/<game>.json): chỉ đọc khi cần tới game đó,
// để mở app không phải đọc cả ba file. Số màn lấy theo dữ liệu (thêm màn sau này không phải sửa code).
// Máy chủ có bộ câu đố mới hơn (đã thêm màn): app tự tải về và lưu lại, không cần cài bản app mới.

const cache: Partial<Record<GameId, PuzzleData>> = {};
const KEY = (game: GameId) => `think.puzzles.data.${game}`;

const bundled = (game: GameId) =>
  (game === "chess" ? require("./data/chess.json") : game === "blocks" ? require("./data/blocks.json") : require("./data/caro.json")) as PuzzleData;

export function puzzleData(game: GameId): PuzzleData {
  let d = cache[game];
  if (!d) {
    d = bundled(game);
    cache[game] = d;
  }
  return d;
}

const validData = (game: GameId, d: unknown): d is PuzzleData => {
  const x = d as PuzzleData;
  return Boolean(x && x.game === game && Number.isInteger(x.version) && Array.isArray(x.levels) && Array.isArray(x.daily) && Array.isArray(x.chapters));
};
/** Chỉ nhận bản thêm màn vào cuối (các màn cũ giữ nguyên), để tiến độ đã có không bị lệch */
const extends_ = (a: PuzzleData, b: PuzzleData) =>
  b.version > a.version && b.levels.length >= a.levels.length && a.levels.every((p, i) => b.levels[i]?.id === p.id);

/** Mở app: dùng bộ câu đố mới hơn đã tải từ máy chủ lần trước (nếu có) */
export async function restoreRemoteData() {
  for (const game of GAMES) {
    try {
      const raw = await AsyncStorage.getItem(KEY(game));
      const d = raw ? JSON.parse(raw) : null;
      if (validData(game, d) && extends_(puzzleData(game), d)) cache[game] = d;
    } catch {
      /* dùng bản đóng gói */
    }
  }
}

const fetching: Partial<Record<GameId, Promise<boolean>>> = {};
/** Máy chủ báo bộ câu đố bản `version` mới hơn bản đang có: tải về (true nếu đã đổi sang bản mới) */
export function syncRemoteData(game: GameId, version: number): Promise<boolean> {
  if (!(Number.isInteger(version) && version > puzzleData(game).version)) return Promise.resolve(false);
  if (!fetching[game]) {
    fetching[game] = (async () => {
      const d = await api.puzzleData(game);
      if (!validData(game, d) || d.version !== version || !extends_(puzzleData(game), d)) return false;
      cache[game] = d;
      AsyncStorage.setItem(KEY(game), JSON.stringify(d)).catch(() => undefined);
      return true;
    })()
      .catch(() => false)
      .finally(() => {
        delete fetching[game];
      });
  }
  return fetching[game]!;
}

export type Chapter = { name: string; start: number; size: number };

/** Các chương (màn tính từ 1); số màn trong các chương luôn khớp đúng số màn có trong dữ liệu */
export function chaptersOf(data: Pick<PuzzleData, "chapters" | "levels">): Chapter[] {
  const total = data.levels.length;
  const out: Chapter[] = [];
  let start = 1;
  for (const ch of data.chapters || []) {
    if (start > total) break;
    const size = Math.min(Math.max(0, Math.floor(ch.size) || 0), total - start + 1);
    if (!size) continue;
    out.push({ name: ch.name, start, size });
    start += size;
  }
  if (start <= total) out.push({ name: out.length ? "Màn mới" : "Thử thách", start, size: total - start + 1 });
  return out;
}

export function chapterOf(data: Pick<PuzzleData, "chapters" | "levels">, level: number) {
  return chaptersOf(data).find((ch) => level >= ch.start && level < ch.start + ch.size) ?? null;
}

/** Câu quiz của một ngày. Máy chủ báo mã câu (serverId) thì ưu tiên đúng câu đó (dữ liệu hai bên lệch nhau) */
export function dailyPuzzle(game: GameId, day: string, serverId?: string | null): Puzzle | null {
  const d = puzzleData(game);
  if (serverId) {
    const found = d.daily.find((p) => p.id === serverId);
    if (found) return found;
  }
  const i = dailyIndex(day, d.daily.length);
  return i >= 0 ? d.daily[i] : null;
}
