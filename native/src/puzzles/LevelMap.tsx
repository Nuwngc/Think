import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mix } from "../blocks/parts";
import { puzzleBack, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Icon, IconButton, useStyles } from "../ui";
import { NAMES, type GameId } from "./core";
import { chaptersOf, puzzleData } from "./data";
import { isUnlocked, nextLevel, sumStars } from "./logic";
import { levelStarsOf, loadPuzzles, playLevel, usePuzzles } from "./store";
import { GAME_COLOR, GameGlyph, Stars, STAR } from "./ui";

// Bản đồ màn "Thử thách nhanh" của một game: tổng sao, bảng xếp hạng (10 người nhiều sao nhất), các chương,
// mỗi chương một lưới nút màn (5 nút mỗi hàng). Màn chưa mở có khóa; màn tiếp theo được tô nổi. Mở ra tự cuộn tới màn tiếp theo.

const COLS = 5;
const GAP = 8;

type LevelProps = { n: number; stars: number; locked: boolean; next: boolean; size: number; game: GameId; onPress: (n: number) => void };

const LevelButton = memo(function LevelButton({ n, stars, locked, next, size, game, onPress }: LevelProps) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const col = GAME_COLOR[game];
  const dark = c.scheme === "dark";
  const solvedBg = dark ? mix(col.main, "#16211D", 0.72) : mix(col.main, "#FFFFFF", 0.86);
  const bg = next ? col.main : stars ? solvedBg : c.field;
  const fg = next ? "#FFFFFF" : locked ? c.muted : dark ? c.text : stars ? col.deep : c.text;
  const label = locked ? `Màn ${n}, chưa mở` : stars ? `Màn ${n}, ${stars} sao` : `Màn ${n}, chưa giải`;
  return (
    <Pressable
      onPress={locked ? undefined : () => onPress(n)}
      disabled={locked}
      style={({ pressed }) => [
        s.level,
        { width: size, height: size + 6, backgroundColor: bg, opacity: locked ? 0.55 : 1 },
        next && s.levelNext,
        pressed && !locked && { transform: [{ scale: 0.94 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: locked }}
    >
      {locked ? <Icon name="lock" size={13} color={c.muted} style={s.lock} /> : null}
      <Text style={[s.levelNum, { color: fg }, size < 56 && { fontSize: 17 }]}>{n}</Text>
      {locked ? null : <Stars n={stars} size={Math.min(13, Math.floor(size / 5))} dim={next ? "rgba(255,255,255,0.7)" : dark ? "#5C6B65" : "#B4C0BA"} />}
    </Pressable>
  );
});

export function LevelMap({ game }: { game: GameId }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const meId = useStore((st) => st.me?.id ?? 0);
  const users = useStore((st) => st.users);
  const local = usePuzzles((st) => st.local);
  const summary = usePuzzles((st) => st.summary);
  const loading = usePuzzles((st) => st.loading);
  const [allRanks, setAllRanks] = useState(false);

  useEffect(() => {
    loadPuzzles();
  }, []);

  const stars = useMemo(() => levelStarsOf({ local, summary }, game), [local, summary, game]);
  const chapters = useMemo(() => chaptersOf(puzzleData(game)), [game]);
  const next = nextLevel(stars);
  const total = sumStars(stars);
  const solved = stars.filter(Boolean).length;
  const board = summary?.games[game]?.board ?? null;
  const col = GAME_COLOR[game];

  const inner = Math.min(width, 600) - 32 - 24;
  const size = Math.max(44, Math.floor((inner - GAP * (COLS - 1)) / COLS));

  // Mở ra: cuộn tới màn tiếp theo (một lần)
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  const viewH = useRef(0);
  const target = next ? chapters.findIndex((ch) => next >= ch.start && next < ch.start + ch.size) : -1;
  const onChapterLayout = useCallback(
    (k: number, y: number) => {
      if (scrolled.current || k !== target || !next) return;
      scrolled.current = true;
      // Hàng có màn tiếp theo nằm khuất dưới mép màn hình thì cuộn cho nó lên khoảng 1/3 màn hình
      const row = Math.floor((next - chapters[k].start) / COLS);
      const top = y + 52 + row * (size + 6 + GAP);
      const h = viewH.current || height - 64;
      if (top + size + 24 > h) setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, top - h * 0.35), animated: true }), 120);
    },
    [target, next, chapters, size, height],
  );

  const open = useCallback((n: number) => playLevel(n), []);
  const ranks = board ? (allRanks ? board : board.slice(0, 3)) : null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <IconButton name="arrow-back" label="Quay lại" onPress={puzzleBack} color={c.text} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1} accessibilityRole="header">
            Thử thách nhanh · {NAMES[game]}
          </Text>
          <Text style={s.sub} numberOfLines={1}>
            ★ {total}/{stars.length * 3} · đã giải {solved}/{stars.length} màn
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        onLayout={(e) => (viewH.current = e.nativeEvent.layout.height)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 16) + 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading && summary != null} onRefresh={loadPuzzles} tintColor={c.accent} colors={[c.jade]} />}
      >
        <View style={[s.hero, { backgroundColor: col.main }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <GameGlyph game={game} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={s.heroBig} accessibilityLabel={`${total} trên ${stars.length * 3} sao`}>
                <Text style={{ color: "#FFD54A" }}>★</Text> {total}
                <Text style={s.heroOf}> / {stars.length * 3}</Text>
              </Text>
              <Text style={s.heroSub}>
                Đã giải {solved}/{stars.length} màn{next ? ` · tiếp theo: màn ${next}` : ""}
              </Text>
            </View>
          </View>
          <View style={s.bar} accessible={false}>
            <View style={[s.barFill, { width: `${stars.length ? (solved / stars.length) * 100 : 0}%` }]} />
          </View>
          {next ? (
            <Pressable
              onPress={() => open(next)}
              style={({ pressed }) => [s.heroBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`Chơi tiếp màn ${next}`}
            >
              <Icon name="play-arrow" size={22} color={col.deep} />
              <Text style={[s.heroBtnText, { color: col.deep }]}>Chơi tiếp · Màn {next}</Text>
            </Pressable>
          ) : stars.length ? (
            <Text style={s.heroDone}>Bạn đã giải hết các màn! Giải lại để lấy đủ 3 sao.</Text>
          ) : null}
        </View>

        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>BẢNG XẾP HẠNG</Text>
            {board && board.length > 3 ? (
              <Pressable
                onPress={() => setAllRanks((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={allRanks ? "Thu gọn bảng xếp hạng" : "Xem cả bảng xếp hạng"}
              >
                <Text style={s.cardAction}>{allRanks ? "Thu gọn" : `Xem cả ${board.length}`}</Text>
              </Pressable>
            ) : null}
          </View>
          {ranks == null ? (
            <Text style={s.empty}>{loading ? "Đang tải…" : "Chưa tải được bảng xếp hạng (mất mạng?). Các màn vẫn chơi được."}</Text>
          ) : ranks.length === 0 ? (
            <Text style={s.empty}>Chưa ai giải màn nào. Mở màn đi!</Text>
          ) : (
            ranks.map((r, i) => (
              <View
                key={r.userId}
                style={[s.rank, r.userId === meId && { backgroundColor: c.jadeWash }]}
                accessible
                accessibilityLabel={`Hạng ${i + 1}: ${users[r.userId]?.displayName || "Người dùng"}${r.userId === meId ? " (bạn)" : ""}, ${r.stars} sao, ${r.solved} màn`}
              >
                <View style={[s.medal, { backgroundColor: ["#F5B300", "#B7C1CE", "#C97834"][i] || c.field }]}>
                  <Text style={[s.medalText, i > 2 && { color: c.text2 }]}>{i + 1}</Text>
                </View>
                <Avatar user={users[r.userId]} size={30} dot={false} />
                <Text style={[s.rankName, r.userId === meId && { color: c.accent }]} numberOfLines={1}>
                  {users[r.userId]?.displayName || "Người dùng"}
                  {r.userId === meId ? " (bạn)" : ""}
                </Text>
                <Text style={s.rankSolved}>{r.solved} màn</Text>
                <Text style={s.rankStars}>
                  <Text style={{ color: STAR }}>★</Text> {r.stars}
                </Text>
              </View>
            ))
          )}
        </View>

        {chapters.map((ch, k) => {
          const done = stars.slice(ch.start - 1, ch.start - 1 + ch.size).filter(Boolean).length;
          return (
            <View key={ch.start} style={s.card} onLayout={(e) => onChapterLayout(k, e.nativeEvent.layout.y)}>
              <View style={s.cardHead}>
                <Text style={s.chapter} numberOfLines={1}>
                  {k + 1}. {ch.name}
                </Text>
                <Text style={[s.chapterCount, done === ch.size && { color: c.accent }]}>
                  {done}/{ch.size} màn{done === ch.size ? " ✓" : ""}
                </Text>
              </View>
              <View style={[s.grid, { width: size * COLS + GAP * (COLS - 1) }]}>
                {Array.from({ length: ch.size }, (_, j) => {
                  const n = ch.start + j;
                  return (
                    <LevelButton key={n} n={n} stars={stars[n - 1]} locked={!isUnlocked(stars, n)} next={n === next} size={size} game={game} onPress={open} />
                  );
                })}
              </View>
            </View>
          );
        })}
        <Text style={s.foot}>Giải màn trước để mở màn sau. Không sai, không gợi ý: 3 sao · sai hoặc gợi ý tối đa 2 lần: 2 sao · còn lại: 1 sao.</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 },
    title: { color: c.text, fontSize: 17, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5, fontWeight: "600" },
    hero: { borderRadius: 22, padding: 16, gap: 10 },
    heroBig: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", fontVariant: ["tabular-nums"] },
    heroOf: { color: "rgba(255,255,255,0.75)", fontSize: 18, fontWeight: "800" },
    heroSub: { color: "rgba(255,255,255,0.9)", fontSize: 12.5, fontWeight: "600" },
    bar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.22)", overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 3, backgroundColor: "#FFD54A" },
    heroBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 44, borderRadius: 14, backgroundColor: "#FFFFFF" },
    heroBtnText: { fontSize: 15.5, fontWeight: "900" },
    heroDone: { color: "#FFFFFF", fontSize: 13.5, fontWeight: "700" },
    card: { backgroundColor: c.surface, borderRadius: 20, padding: 12, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24, paddingHorizontal: 2 },
    cardTitle: { flex: 1, color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
    cardAction: { color: c.accent, fontSize: 13, fontWeight: "800" },
    empty: { color: c.muted, fontSize: 13.5, textAlign: "center", paddingVertical: 8 },
    rank: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, paddingHorizontal: 4, borderRadius: 12 },
    medal: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    medalText: { color: "#2A1A00", fontSize: 12, fontWeight: "800" },
    rankName: { flex: 1, color: c.text, fontSize: 14.5, fontWeight: "700" },
    rankSolved: { color: c.muted, fontSize: 12, fontWeight: "600" },
    rankStars: { color: c.text, fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"], minWidth: 48, textAlign: "right" },
    chapter: { flex: 1, color: c.text, fontSize: 15, fontWeight: "800" },
    chapterCount: { color: c.muted, fontSize: 12.5, fontWeight: "800" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, alignSelf: "center" },
    level: { borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 2 },
    levelNext: {
      borderWidth: 2.5,
      borderColor: "#FFD54A",
      elevation: 4,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
    },
    levelNum: { fontSize: 19, fontWeight: "900", fontVariant: ["tabular-nums"] },
    lock: { position: "absolute", top: 5, right: 5 },
    foot: { color: c.muted, fontSize: 12, lineHeight: 17, textAlign: "center", paddingHorizontal: 8 },
  });
