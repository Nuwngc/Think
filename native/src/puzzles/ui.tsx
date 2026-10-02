import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Block } from "../blocks/parts";
import { MarkIcon } from "../caro/Board";
import { KnightIcon } from "../chess/Board";
import { openPuzzles, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Icon, useStyles } from "../ui";
import { GAMES, goalText, NAMES, type GameId } from "./core";
import { nextLevel, shortGoal, starText, sumStars, timeText } from "./logic";
import { dailyInfo, levelStarsOf, loadPuzzles, usePuzzles, type DailyInfo } from "./store";

// Lối vào câu đố: khung "Quiz hôm nay" + "Thử thách nhanh" ở trang Trò chơi (QuizPanel), hai nút trong trang
// Cờ vua / Cờ caro (PuzzleEntry) và trong game Xếp Khối (PuzzleButtons). Sao, hình nhỏ của từng game.

/** Màu nhấn của từng game (giống thẻ game ở trang Trò chơi) */
export const GAME_COLOR: Record<GameId, { main: string; deep: string }> = {
  chess: { main: "#14967A", deep: "#0A5E4E" },
  blocks: { main: "#3B4FC0", deep: "#1B2568" },
  caro: { main: "#D9583A", deep: "#9A2B1E" },
};

export const STAR = "#F5B300";

/** Hình nhỏ của game trên nền màu */
export function GameGlyph({ game, size = 34 }: { game: GameId; size?: number }) {
  const col = GAME_COLOR[game].main;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: col, alignItems: "center", justifyContent: "center" }}>
      {game === "chess" ? (
        <KnightIcon size={size * 0.68} color="#FFFFFF" hole={col} />
      ) : game === "caro" ? (
        <MarkIcon side="x" size={size * 0.5} color="#FFFFFF" stroke={Math.max(2.5, size * 0.1)} />
      ) : (
        <View style={{ width: size * 0.56, flexDirection: "row", flexWrap: "wrap", gap: size * 0.04 }}>
          {[3, 5, 1, 4].map((v, i) => (
            <Block key={i} color={v} size={size * 0.26} radius={size * 0.06} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Ba ngôi sao (đã đạt tô vàng) */
export function Stars({ n, size = 14, dim }: { n: number; size?: number; dim?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row" }} accessible={false}>
      {[0, 1, 2].map((k) => (
        <Icon key={k} name={k < n ? "star" : "star-border"} size={size} color={k < n ? STAR : dim || c.muted} />
      ))}
    </View>
  );
}

/** Chữ trạng thái quiz hôm nay của mình */
export function dailyStatusText(info: DailyInfo) {
  if (info.solved) return `✓ ${timeText(info.solved.ms)} · ${starText(info.solved.stars)}`;
  if (info.revealed) return "Đã xem lời giải";
  return "Chưa giải";
}

const solversText = (n: number) => (n ? `${n} người đã giải` : "Chưa ai giải");

/** Lời đọc cho trình đọc màn hình */
function dailySpeech(info: DailyInfo) {
  if (info.solved) return `đã giải, ${timeText(info.solved.ms)}, ${info.solved.stars} sao`;
  if (info.revealed) return "đã xem lời giải";
  return `chưa giải, ${solversText(info.solvers.length).toLowerCase()}`;
}

/** Số liệu câu đố của mọi game (dùng chung cho các lối vào) */
function usePuzzleRows() {
  const meId = useStore((st) => st.me?.id ?? 0);
  const local = usePuzzles((st) => st.local);
  const summary = usePuzzles((st) => st.summary);
  return useMemo(
    () =>
      Object.fromEntries(
        GAMES.map((g) => {
          const stars = levelStarsOf({ local, summary }, g);
          const info = dailyInfo({ local, summary }, g, meId);
          return [g, { info, stars, total: sumStars(stars), solved: stars.filter(Boolean).length, count: stars.length, next: nextLevel(stars) }];
        }),
      ) as Record<GameId, { info: DailyInfo; stars: number[]; total: number; solved: number; count: number; next: number | null }>,
    [local, summary, meId],
  );
}

/* ---------------- Trang Trò chơi ---------------- */

/** Khung "Quiz hôm nay" (mỗi game một dòng) + hàng nút "Thử thách nhanh" */
export function QuizPanel() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const rows = usePuzzleRows();
  const done = GAMES.filter((g) => rows[g].info.solved).length;
  return (
    <View style={s.panel}>
      <View style={s.panelHead}>
        <View style={s.panelIcon}>
          <Icon name="today" size={18} color={c.scheme === "dark" ? "#14201C" : "#FFFFFF"} />
        </View>
        <Text style={s.panelTitle} accessibilityRole="header">
          Quiz hôm nay
        </Text>
        <Text style={[s.panelMeta, done === GAMES.length && { color: c.accent }]}>
          {done === GAMES.length ? "Đã giải hết ✓" : `${done}/${GAMES.length} đã giải`}
        </Text>
      </View>
      {GAMES.map((g) => {
        const { info } = rows[g];
        const goal = info.puzzle ? shortGoal(goalText(g, info.puzzle)) : "";
        return (
          <Pressable
            key={g}
            onPress={() => openPuzzles(g, "daily")}
            style={({ pressed }) => [s.dailyRow, pressed && { backgroundColor: c.field }]}
            accessibilityRole="button"
            accessibilityLabel={`Quiz hôm nay ${NAMES[g]}, ${dailySpeech(info)}. ${goal}`}
          >
            <GameGlyph game={g} size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.dailyName} numberOfLines={1}>
                {NAMES[g]}
              </Text>
              <Text style={s.dailyGoal} numberOfLines={1}>
                {goal}
              </Text>
            </View>
            {info.solved ? (
              <View style={s.dailyRight}>
                <Text style={s.solvedTime}>✓ {timeText(info.solved.ms)}</Text>
                <Stars n={info.solved.stars} size={13} />
              </View>
            ) : (
              <View style={s.dailyRight}>
                <Text style={[s.todo, info.revealed && { color: c.muted }]}>{info.revealed ? "Đã xem lời giải" : "Chưa giải"}</Text>
                <Text style={s.dailyGoal}>{solversText(info.solvers.length)}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
      <View style={s.levelHead}>
        <Icon name="extension" size={15} color={c.muted} />
        <Text style={s.levelTitle}>THỬ THÁCH NHANH</Text>
      </View>
      <View style={s.levelRow}>
        {GAMES.map((g) => {
          const r = rows[g];
          return (
            <Pressable
              key={g}
              onPress={() => openPuzzles(g, "map")}
              style={({ pressed }) => [s.levelChip, { borderColor: GAME_COLOR[g].main }, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
              accessibilityRole="button"
              accessibilityLabel={`Thử thách nhanh ${NAMES[g]}: ${r.total} trên ${r.count * 3} sao, đã giải ${r.solved} trên ${r.count} màn`}
            >
              <Text style={[s.levelName, { color: c.scheme === "dark" ? c.text : GAME_COLOR[g].deep }]} numberOfLines={1}>
                {NAMES[g]}
              </Text>
              <Text style={s.levelStars} numberOfLines={1}>
                <Text style={{ color: STAR }}>★</Text> {r.total}/{r.count * 3}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ---------------- Trong từng game ---------------- */

/** Hai nút "Quiz hôm nay" và "Thử thách nhanh" trong trang Cờ vua / Cờ caro */
export function PuzzleEntry({ game }: { game: GameId }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const r = usePuzzleRows()[game];
  useEffect(() => {
    loadPuzzles();
  }, []);
  const col = GAME_COLOR[game];
  const tint = c.scheme === "dark" ? "#E3EBE7" : col.deep;
  return (
    <View style={s.entry}>
      <Pressable
        onPress={() => openPuzzles(game, "daily")}
        style={({ pressed }) => [s.entryTile, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
        accessibilityRole="button"
        accessibilityLabel="Quiz hôm nay"
        accessibilityHint={`${dailySpeech(r.info)}. Mỗi ngày một câu, cả nhóm cùng giải`}
      >
        <View style={[s.entryIcon, { backgroundColor: col.main }]}>
          <Icon name="today" size={20} color="#FFFFFF" />
        </View>
        <Text style={[s.entryTitle, { color: tint }]} numberOfLines={1}>
          Quiz hôm nay
        </Text>
        <Text style={[s.entrySub, r.info.solved && { color: c.accent, fontWeight: "800" }]} numberOfLines={1}>
          {r.info.solved ? dailyStatusText(r.info) : r.info.revealed ? "Đã xem lời giải" : `Chưa giải · ${solversText(r.info.solvers.length).toLowerCase()}`}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => openPuzzles(game, "map")}
        style={({ pressed }) => [s.entryTile, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
        accessibilityRole="button"
        accessibilityLabel="Thử thách nhanh"
        accessibilityHint={`${r.total} trên ${r.count * 3} sao, đã giải ${r.solved} trên ${r.count} màn`}
      >
        <View style={[s.entryIcon, { backgroundColor: col.main }]}>
          <Icon name="extension" size={20} color="#FFFFFF" />
        </View>
        <Text style={[s.entryTitle, { color: tint }]} numberOfLines={1}>
          Thử thách nhanh
        </Text>
        <Text style={s.entrySub} numberOfLines={1}>
          <Text style={{ color: STAR }}>★</Text> {r.total}/{r.count * 3}
          {r.next ? ` · màn ${r.next}` : r.count ? " · xong hết!" : ""}
        </Text>
      </Pressable>
    </View>
  );
}

/** Hai nút câu đố trong game Xếp Khối (nền xanh đậm) */
export function PuzzleButtons({ game }: { game: GameId }) {
  const r = usePuzzleRows()[game];
  useEffect(() => {
    loadPuzzles();
  }, []);
  return (
    <View style={styles.darkRow}>
      <Pressable
        onPress={() => openPuzzles(game, "daily")}
        style={({ pressed }) => [styles.darkBtn, pressed && { transform: [{ scale: 0.96 }], backgroundColor: "rgba(255,255,255,0.2)" }]}
        accessibilityRole="button"
        accessibilityLabel="Quiz hôm nay"
        accessibilityHint={dailySpeech(r.info)}
      >
        <Icon name={r.info.solved ? "check-circle" : "today"} size={18} color={r.info.solved ? "#7CF0B5" : "#FFFFFF"} />
        <Text style={styles.darkText} numberOfLines={1}>
          Quiz hôm nay
        </Text>
      </Pressable>
      <Pressable
        onPress={() => openPuzzles(game, "map")}
        style={({ pressed }) => [styles.darkBtn, pressed && { transform: [{ scale: 0.96 }], backgroundColor: "rgba(255,255,255,0.2)" }]}
        accessibilityRole="button"
        accessibilityLabel="Thử thách nhanh"
        accessibilityHint={`${r.total} trên ${r.count * 3} sao`}
      >
        <Icon name="extension" size={18} color="#FFFFFF" />
        <Text style={styles.darkText} numberOfLines={1}>
          Thử thách nhanh
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  darkRow: { flexDirection: "row", gap: 8, width: "100%", maxWidth: 520, paddingHorizontal: 12, marginTop: 10 },
  darkBtn: {
    flex: 1,
    height: 40,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  darkText: { color: "#FFFFFF", fontSize: 13.5, fontWeight: "800", flexShrink: 1 },
});

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    panel: { backgroundColor: c.surface, borderRadius: 20, paddingTop: 12, paddingBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    panelHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, marginBottom: 4 },
    panelIcon: {
      width: 28,
      height: 28,
      borderRadius: 9,
      backgroundColor: c.scheme === "dark" ? c.turmeric : c.jade,
      alignItems: "center",
      justifyContent: "center",
    },
    panelTitle: { flex: 1, color: c.text, fontSize: 16, fontWeight: "800" },
    panelMeta: { color: c.muted, fontSize: 12.5, fontWeight: "800" },
    dailyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 6 },
    dailyName: { color: c.text, fontSize: 14.5, fontWeight: "800" },
    dailyGoal: { color: c.muted, fontSize: 12.5 },
    dailyRight: { alignItems: "flex-end", gap: 1 },
    solvedTime: { color: c.accent, fontSize: 13.5, fontWeight: "900", fontVariant: ["tabular-nums"] },
    todo: { color: c.scheme === "dark" ? "#F2C04E" : "#9A6A00", fontSize: 13, fontWeight: "800" },
    levelHead: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, marginTop: 8, marginBottom: 6 },
    levelTitle: { color: c.muted, fontSize: 11.5, fontWeight: "800", letterSpacing: 0.6 },
    levelRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12 },
    levelChip: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 7,
      paddingHorizontal: 8,
      borderRadius: 14,
      backgroundColor: c.field,
      borderLeftWidth: 4,
      gap: 1,
    },
    levelName: { fontSize: 13, fontWeight: "800" },
    levelStars: { color: c.text, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
    entry: { flexDirection: "row", gap: 10 },
    entryTile: {
      flex: 1,
      minWidth: 0,
      padding: 12,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      gap: 2,
    },
    entryIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 6 },
    entryTitle: { fontSize: 15.5, fontWeight: "900" },
    entrySub: { color: c.muted, fontSize: 12.5, fontWeight: "600" },
  });
