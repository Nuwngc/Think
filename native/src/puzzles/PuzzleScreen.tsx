import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { setSound as setBlocksSound, useBlocks } from "../blocks/store";
import { ActionButton } from "../caro/parts";
import { setSound as setCaroSound, useCaro } from "../caro/store";
import { setPref, usePrefs } from "../chess/prefs";
import { leavePuzzles, puzzleBack, showGamesHub, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, confirm, IconButton, Sheet, useStyles } from "../ui";
import { BlocksPuzzleBoard } from "./BlocksPuzzleBoard";
import { CaroPuzzleBoard } from "./CaroPuzzleBoard";
import { ChessPuzzleBoard } from "./ChessPuzzleBoard";
import { dayKey, goalText, NAMES, type GameId } from "./core";
import { puzzleData } from "./data";
import { LevelMap } from "./LevelMap";
import { isUnlocked, TEXT, timeSpeech, timeText } from "./logic";
import {
  closePlay,
  dailyInfo,
  levelStarsOf,
  loadPuzzles,
  playLevel,
  puzzleHint,
  puzzleRestart,
  puzzleReveal,
  replaySession,
  sessionKey,
  startSession,
  usePuzzles,
  type DailyInfo,
} from "./store";
import type { Finished, Play, Session } from "./types";
import { GameGlyph, Stars, STAR } from "./ui";

// Màn giải câu đố (giống nhau cho cả ba game): tiêu đề, mục tiêu, bàn cờ / bàn khối, dòng trạng thái,
// nút Gợi ý / Làm lại, "Xem lời giải" (hỏi lại trước), bảng kết quả khi giải xong.
// Không có đồng hồ chạy từng giây trên màn hình: thời gian chỉ hiện trong kết quả.

const native = Platform.OS !== "web";
/** Chỗ cho dòng trạng thái dưới bàn (tối đa 2 dòng) */
const STATUS_H = 56;

/** Phần câu đố trong tab Trò chơi: bản đồ màn hoặc câu đang giải */
export function PuzzleHost() {
  const route = usePuzzles((s) => s.route);
  useEffect(() => {
    if (!route) showGamesHub();
  }, [route]);
  if (!route) return null;
  if (route.play) {
    const k = route.play.kind === "level" ? `${route.game}-level-${route.play.level}` : `${route.game}-daily`;
    return <PuzzleScreen key={k} game={route.game} play={route.play} />;
  }
  return <LevelMap game={route.game} />;
}

/** Nút bật / tắt âm thanh (theo đúng lựa chọn âm thanh của từng game) */
function SoundToggle({ game }: { game: GameId }) {
  const c = useColors();
  const chessOn = usePrefs((s) => s.sound);
  const caroOn = useCaro((s) => s.sound);
  const blocksOn = useBlocks((s) => s.sound);
  const on = game === "chess" ? chessOn : game === "caro" ? caroOn : blocksOn;
  const toggle = () => {
    if (game === "chess") setPref("sound", !on);
    else if (game === "caro") setCaroSound(!on);
    else setBlocksSound(!on);
  };
  return <IconButton name={on ? "volume-up" : "volume-off"} label={on ? "Tắt âm thanh" : "Bật âm thanh"} onPress={toggle} color={c.text2} />;
}

function PuzzleScreen({ game, play }: { game: GameId; play: Play }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const meId = useStore((st) => st.me?.id ?? 0);
  const [day] = useState(() => dayKey());
  const key = sessionKey(game, play, day);
  const session = usePuzzles((st) => (st.session?.key === key ? st.session : null));
  const local = usePuzzles((st) => st.local);
  const summary = usePuzzles((st) => st.summary);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [sheet, setSheet] = useState(false);

  // Mở màn: bắt đầu lượt giải (rời đi một lúc rồi quay lại thì giữ nguyên lượt đang giải)
  useEffect(() => {
    if (usePuzzles.getState().session?.key !== key) startSession(game, play, day);
    if (play.kind === "daily") loadPuzzles();
  }, [key, game, play, day]);

  const info: DailyInfo | null = useMemo(
    () => (play.kind === "daily" ? dailyInfo({ local, summary }, game, meId, day) : null),
    [play.kind, local, summary, game, meId, day],
  );

  // Giải xong: hiện bảng kết quả sau khi nước cuối kịp hiện ra
  const finished = session?.finished ?? null;
  const wasFinished = useRef(Boolean(finished));
  useEffect(() => {
    if (finished && !wasFinished.current) {
      const t = setTimeout(() => setSheet(true), finished.revealed ? 500 : 900);
      AccessibilityInfo.announceForAccessibility(finished.revealed ? TEXT.revealedDone : `Giải xong! ${finished.stars} sao, ${timeSpeech(finished.ms)}`);
      wasFinished.current = true;
      return () => clearTimeout(t);
    }
    if (!finished) wasFinished.current = false;
  }, [finished]);

  const data = puzzleData(game);
  const count = data.levels.length;
  const level = play.kind === "level" ? play.level : null;
  const title = level ? `Màn ${level}` : `Quiz hôm nay · ${NAMES[game]}`;
  const sub = session?.chapter ?? (level ? "" : "Mỗi ngày một câu · cả nhóm cùng giải");

  // Quiz hôm nay đã giải (máy này / máy khác) hoặc đã xem lời giải: chỉ xem, không giải được nữa
  const lockedBy = info && session && !session.finished && !session.revealed ? (info.solved ? "solved" : info.revealed ? "revealed" : null) : null;
  const locked = lockedBy != null;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((a) => (a && Math.abs(a.w - width) < 1 && Math.abs(a.h - height) < 1 ? a : { w: width, h: height }));
  };

  const reveal = async () => {
    const msg =
      play.kind === "daily"
        ? "Máy sẽ tự đi lời giải. Lần này không tính sao, và hôm nay bạn không giải quiz này được nữa trên máy này."
        : "Máy sẽ tự đi lời giải. Lần này không tính; tự giải lại sau đó chỉ được 1 sao.";
    if (!(await confirm("Xem lời giải?", msg, "Xem lời giải", false))) return;
    puzzleReveal();
  };

  if (!session) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header title={title} sub={sub} game={game} />
        <View style={s.fill}>
          <Text style={s.note}>{play.kind === "level" && (level! < 1 || level! > count) ? "Không có màn này." : "Đang mở câu đố…"}</Text>
        </View>
      </View>
    );
  }

  const status = lockedBy === "solved" ? TEXT.dailySolved : lockedBy === "revealed" ? TEXT.dailyRevealed : session.status;
  const tone = lockedBy ? "info" : session.tone;
  const statusColor = tone === "good" ? c.accent : tone === "bad" ? c.danger : c.text2;
  // Màn tiếp chỉ khi màn sau đã mở (xem lời giải thì màn này chưa tính là giải)
  const hasNext = level != null && level < count && !session.finished?.revealed && isUnlocked(levelStarsOf(usePuzzles.getState(), game), level + 1);
  const boardW = area ? area.w - 24 : 0;
  const boardH = area ? area.h - 8 - STATUS_H : 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header title={title} sub={sub} game={game} />
      <View style={s.goal}>
        <GameGlyph game={game} size={26} />
        <Text style={s.goalText} numberOfLines={2}>
          {goalText(game, session.puzzle)}
        </Text>
      </View>

      <View style={s.boardArea} onLayout={onLayout}>
        {area && boardW > 100 ? (
          game === "chess" ? (
            <ChessPuzzleBoard width={boardW} height={boardH} locked={locked} />
          ) : game === "caro" ? (
            <CaroPuzzleBoard width={boardW + 12} height={boardH} locked={locked} status={status} />
          ) : (
            <BlocksPuzzleBoard width={boardW} height={boardH} locked={locked} />
          )
        ) : null}
        <Text style={[s.status, { color: statusColor }]} accessibilityLiveRegion="polite" numberOfLines={2}>
          {status}
          {lockedBy === "solved" && info?.solved ? ` · ✓ ${timeText(info.solved.ms)}` : ""}
        </Text>
      </View>

      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {locked ? (
          <View style={s.actions}>
            <ActionButton icon="leaderboard" title="Xem bảng hôm nay" onPress={() => setSheet(true)} />
            <ActionButton icon="check" title="Xong" kind="primary" onPress={leavePuzzles} />
          </View>
        ) : session.finished ? (
          <View style={s.actions}>
            <ActionButton icon={play.kind === "daily" ? "leaderboard" : "emoji-events"} title="Xem kết quả" onPress={() => setSheet(true)} />
            {play.kind === "daily" ? (
              <ActionButton icon="check" title="Xong" kind="primary" onPress={leavePuzzles} />
            ) : hasNext ? (
              <ActionButton icon="skip-next" title="Màn tiếp" kind="primary" onPress={() => playLevel(level! + 1)} />
            ) : (
              <ActionButton icon="grid-view" title="Về bản đồ" kind="primary" onPress={closePlay} />
            )}
          </View>
        ) : (
          <>
            <View style={s.actions}>
              <ActionButton icon="lightbulb-outline" title="Gợi ý" onPress={puzzleHint} disabled={session.revealed} />
              <ActionButton icon="replay" title="Làm lại" onPress={puzzleRestart} disabled={session.revealed} />
            </View>
            <Pressable
              onPress={reveal}
              disabled={session.revealed}
              hitSlop={6}
              style={({ pressed }) => [s.reveal, (pressed || session.revealed) && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel="Xem lời giải"
              accessibilityState={{ disabled: session.revealed }}
            >
              <Text style={s.revealText}>{session.revealed ? "Đang xem lời giải…" : "Xem lời giải"}</Text>
            </Pressable>
          </>
        )}
      </View>

      <ResultSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        session={session}
        finished={session.finished}
        info={info}
        lockedBy={lockedBy}
        hasNext={hasNext}
        onNext={() => {
          setSheet(false);
          playLevel(level! + 1);
        }}
        onMap={() => {
          setSheet(false);
          closePlay();
        }}
        onReplay={() => {
          setSheet(false);
          replaySession();
        }}
        onDone={() => {
          setSheet(false);
          leavePuzzles();
        }}
      />
    </View>
  );
}

function Header({ title, sub, game }: { title: string; sub: string; game: GameId }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={s.header}>
      <IconButton name="arrow-back" label="Quay lại" onPress={puzzleBack} color={c.text} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {sub ? (
          <Text style={s.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <SoundToggle game={game} />
    </View>
  );
}

/* ---------------- Bảng kết quả ---------------- */

/** Ba ngôi sao lần lượt bật lên */
function BigStars({ n }: { n: number }) {
  const c = useColors();
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(
      160,
      vals.map((v) => Animated.spring(v, { toValue: 1, friction: 4, tension: 120, useNativeDriver: native })),
    ).start();
  }, [vals]);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6 }} accessible accessibilityLabel={`${n} sao`}>
      {vals.map((v, k) => (
        <Animated.Text
          key={k}
          style={{
            fontSize: k === 1 ? 54 : 42,
            lineHeight: k === 1 ? 62 : 50,
            color: k < n ? STAR : c.line,
            opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
            transform: [
              { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
              { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-40deg", "0deg"] }) },
            ],
          }}
        >
          ★
        </Animated.Text>
      ))}
    </View>
  );
}

function ResultSheet({
  visible,
  onClose,
  session,
  finished,
  info,
  lockedBy,
  hasNext,
  onNext,
  onMap,
  onReplay,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  session: Session;
  finished: Finished | null;
  info: DailyInfo | null;
  lockedBy: "solved" | "revealed" | null;
  hasNext: boolean;
  onNext: () => void;
  onMap: () => void;
  onReplay: () => void;
  onDone: () => void;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const users = useStore((st) => st.users);
  const meId = useStore((st) => st.me?.id ?? 0);
  const daily = session.kind === "daily";
  const mine =
    finished && !finished.revealed ? finished : lockedBy === "solved" && info?.solved ? { ...info.solved, ms: info.solved.ms ?? 0, revealed: false } : null;
  const revealed = Boolean(finished?.revealed) || lockedBy === "revealed";
  const title = revealed ? "Lời giải" : daily ? (finished ? "Quiz hôm nay — giải xong!" : "Quiz hôm nay") : `Màn ${session.level} — giải xong!`;

  const footer = daily ? (
    <Button title="Xong" onPress={onDone} />
  ) : revealed ? (
    <View style={s.footRow}>
      <Button title="Giải lại" kind="secondary" icon="replay" onPress={onReplay} style={{ flex: 1 }} />
      <Button title="Về bản đồ" icon="grid-view" onPress={onMap} style={{ flex: 1 }} />
    </View>
  ) : (
    <View style={s.footRow}>
      <Button title="Về bản đồ" kind="secondary" icon="grid-view" onPress={onMap} style={{ flex: 1 }} />
      {hasNext ? <Button title="Màn tiếp" icon="skip-next" onPress={onNext} style={{ flex: 1 }} /> : null}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={title} footer={footer}>
      {mine ? (
        <View style={s.result}>
          <BigStars n={mine.stars} />
          <Text style={s.resultTitle}>{mine.stars === 3 ? "Hoàn hảo!" : mine.stars === 2 ? "Giỏi lắm!" : "Giải được rồi!"}</Text>
          <View style={s.stats}>
            <Stat value={timeText(mine.ms)} label="thời gian" />
            <Stat value={String(mine.mistakes)} label="lần sai" />
            <Stat value={String(mine.hints)} label="gợi ý" />
          </View>
          {!daily && !hasNext ? <Text style={s.note}>Bạn đã tới màn cuối cùng. Giỏi quá!</Text> : null}
          {daily && info?.solved?.pending ? <Text style={s.note}>Kết quả sẽ tự gửi lên khi có mạng.</Text> : null}
        </View>
      ) : revealed ? (
        <Text style={s.note}>
          {daily
            ? "Bạn đã xem lời giải nên quiz hôm nay không được tính. Mai có quiz mới nhé!"
            : "Bạn đã xem lời giải nên lần này không được tính sao. Bấm Giải lại để tự giải và nhận sao."}
        </Text>
      ) : null}

      {daily && info ? (
        <View style={{ gap: 6 }}>
          <Text style={s.listTitle}>AI ĐÃ GIẢI HÔM NAY ({info.solvers.length})</Text>
          {info.solvers.length === 0 ? (
            <Text style={s.note}>Chưa ai giải. Bạn sẽ là người đầu tiên!</Text>
          ) : (
            info.solvers.map((r, i) => {
              const name = users[r.userId]?.displayName || "Người dùng";
              return (
                <View
                  key={r.userId}
                  style={[s.solver, r.userId === meId && { backgroundColor: c.jadeWash }]}
                  accessible
                  accessibilityLabel={`Hạng ${i + 1}: ${name}${r.userId === meId ? " (bạn)" : ""}, ${r.stars} sao, ${timeSpeech(r.ms)}`}
                >
                  <View style={[s.medal, { backgroundColor: ["#F5B300", "#B7C1CE", "#C97834"][i] || c.field }]}>
                    <Text style={[s.medalText, i > 2 && { color: c.text2 }]}>{i + 1}</Text>
                  </View>
                  <Avatar user={users[r.userId]} size={30} dot={false} />
                  <Text style={[s.solverName, r.userId === meId && { color: c.accent }]} numberOfLines={1}>
                    {name}
                    {r.userId === meId ? " (bạn)" : ""}
                  </Text>
                  <Stars n={r.stars} size={13} />
                  <Text style={s.solverTime}>{timeText(r.ms)}</Text>
                </View>
              );
            })
          )}
          <Text style={s.small}>Xếp theo số sao, rồi ai giải nhanh hơn.</Text>
        </View>
      ) : null}
    </Sheet>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 },
    title: { color: c.text, fontSize: 17, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5, fontWeight: "600" },
    goal: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginHorizontal: 12,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    goalText: { flex: 1, color: c.text, fontSize: 15, fontWeight: "800" },
    boardArea: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 4, gap: 12 },
    status: { fontSize: 15.5, fontWeight: "800", textAlign: "center", paddingHorizontal: 16, minHeight: 22, maxWidth: 560 },
    bottom: { paddingHorizontal: 12, paddingTop: 8, gap: 4 },
    actions: { flexDirection: "row", gap: 10 },
    reveal: { alignSelf: "center", paddingVertical: 6, paddingHorizontal: 12 },
    revealText: { color: c.muted, fontSize: 13.5, fontWeight: "700", textDecorationLine: "underline" },
    note: { color: c.muted, fontSize: 13.5, lineHeight: 19, textAlign: "center" },
    small: { color: c.muted, fontSize: 12, textAlign: "center" },
    result: { alignItems: "center", gap: 8 },
    resultTitle: { color: c.text, fontSize: 20, fontWeight: "900" },
    stats: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
    stat: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 14, backgroundColor: c.field },
    statValue: { color: c.text, fontSize: 19, fontWeight: "900", fontVariant: ["tabular-nums"] },
    statLabel: { color: c.muted, fontSize: 12, fontWeight: "600" },
    listTitle: { color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 4 },
    solver: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 12 },
    medal: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    medalText: { color: "#2A1A00", fontSize: 12, fontWeight: "800" },
    solverName: { flex: 1, color: c.text, fontSize: 14.5, fontWeight: "700" },
    solverTime: { color: c.text, fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"], minWidth: 40, textAlign: "right" },
    footRow: { flexDirection: "row", gap: 10 },
  });
