import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { useShallow } from "zustand/react/shallow";

import { shortTime } from "../format";
import { openCaro, showGamesHub, useStore } from "../store";
import { PuzzleEntry } from "../puzzles/ui";
import { StreakBadge } from "../streaks/ui";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, Icon, IconButton, useStyles, type IconName } from "../ui";
import { MiniBoard } from "./Board";
import { fromMoves, LEVELS, SIZE } from "./engine";
import { deltaOf, LEVEL_INFO, markName, otherSide, outcomeFor, playerOf, reasonText, ruleLabel, sideOf, turnLabel } from "./format";
import { SideAvatar, useNow } from "./parts";
import { BotSheet, ChallengeSheet, LeaderboardSheet, RankRow, RulesSheet } from "./Sheets";
import { answerChallenge, botStatsOf, isMyBotTurn, loadCaro, loadLocal, openGame, useCaro } from "./store";
import type { BotGame, CaroGame } from "./types";

// Trang Cờ caro: điểm ELO, chơi với máy, thách đấu, câu đố (quiz hôm nay, thử thách nhanh), lời thách đấu, ván đang chơi, bảng xếp hạng, ván gần đây.

const CHALLENGE_TTL = 15 * 60 * 1000;

export function CaroHome() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const meId = useStore((st) => st.me?.id ?? 0);
  const { loaded, loading, error, me, games, leaderboard, bot, stats } = useCaro(
    useShallow((st) => ({ loaded: st.loaded, loading: st.loading, error: st.error, me: st.me, games: st.games, leaderboard: st.leaderboard, bot: st.bot, stats: st.stats })),
  );
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    loadLocal();
    if (!useCaro.getState().loading) loadCaro();
  }, []);

  const { incoming, outgoing, active, recent } = useMemo(() => {
    const list = Object.values(games);
    return {
      incoming: list.filter((g) => g.status === "challenge" && g.opponentId === meId).sort((a, b) => b.createdAt - a.createdAt),
      outgoing: list.filter((g) => g.status === "challenge" && g.challengerId === meId).sort((a, b) => b.createdAt - a.createdAt),
      active: list
        .filter((g) => g.status === "active" && sideOf(g, meId))
        // Ván tới lượt mình lên trước
        .sort((a, b) => Number(sideOf(b, meId) === b.turn) - Number(sideOf(a, meId) === a.turn) || b.updatedAt - a.updatedAt),
      recent: list
        .filter((g) => (g.status === "finished" || g.status === "aborted") && sideOf(g, meId))
        .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
        .slice(0, 12),
    };
  }, [games, meId]);

  const rating = me && me.userId === meId ? me : null;
  const myRank = leaderboard ? leaderboard.findIndex((r) => r.userId === meId) + 1 : 0;
  const botStats = botStatsOf({ stats }, meId || null);
  const resume = bot && !bot.result && bot.moves.length > 0 ? bot : null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <IconButton name="arrow-back" label="Về trang Trò chơi" onPress={showGamesHub} color={c.text} />
        <View style={{ flex: 1 }}>
          <Text style={s.brand} accessibilityRole="header">
            Cờ caro
          </Text>
          <Text style={s.kicker}>Năm quân liền nhau là thắng</Text>
        </View>
        <IconButton name="info-outline" label="Luật chơi" onPress={() => setRulesOpen(true)} color={c.text} />
        <IconButton name="leaderboard" label="Bảng xếp hạng" onPress={() => setBoardOpen(true)} color={c.text} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading && loaded} onRefresh={loadCaro} tintColor={c.accent} colors={[c.jade]} />}
      >
        {/* Điểm của tôi + hai nút chính */}
        <View style={s.hero}>
          <HeroBg />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={s.heroBadge}>
              <Icon name="emoji-events" size={30} color="#3A2A00" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroLabel}>Điểm ELO cờ caro</Text>
              <Text style={s.heroRating}>{rating ? rating.rating : loaded ? 1200 : "—"}</Text>
            </View>
            {myRank ? (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.heroLabel}>Hạng</Text>
                <Text style={s.heroRank}>#{myRank}</Text>
              </View>
            ) : null}
            <StreakBadge game="caro" onDark />
          </View>
          <Text style={s.heroStats}>
            {rating && rating.games
              ? `${rating.games} ván tính điểm · ${rating.wins} thắng · ${rating.draws} hòa · ${rating.losses} thua · cao nhất ${rating.peak}`
              : "Chưa chơi ván tính điểm nào. Mọi người bắt đầu từ 1200 điểm."}
          </Text>
          <View style={s.heroActions}>
            <HeroButton title="Chơi với máy" sub="Dễ · Vừa · Khó" icon="smart-toy" solid onPress={() => setBotOpen(true)} />
            <HeroButton title="Thách đấu" sub="Tính điểm với bạn bè" icon="sports-kabaddi" onPress={() => setChallengeOpen(true)} />
          </View>
        </View>

        {resume ? <ResumeCard g={resume} /> : null}

        {/* Câu đố caro: quiz hôm nay + thử thách nhanh (chơi được khi mất mạng) */}
        <PuzzleEntry game="caro" />

        {error && !loaded ? (
          <View style={[s.banner, { backgroundColor: c.dangerWash }]}>
            <Icon name="error-outline" size={18} color={c.danger} />
            <Text style={[s.bannerText, { color: c.danger }]}>{error} Chơi với máy vẫn được khi mất mạng.</Text>
            <Button title="Thử lại" small kind="secondary" onPress={loadCaro} />
          </View>
        ) : null}

        {incoming.length ? (
          <Section title="Lời thách đấu gửi tới bạn">
            {incoming.map((g) => (
              <ChallengeRow key={g.id} g={g} incoming />
            ))}
          </Section>
        ) : null}

        {active.length ? (
          <Section title="Đang chơi">
            {active.map((g) => (
              <GameRow key={g.id} g={g} meId={meId} />
            ))}
          </Section>
        ) : null}

        {outgoing.length ? (
          <Section title="Đang chờ nhận lời">
            {outgoing.map((g) => (
              <ChallengeRow key={g.id} g={g} />
            ))}
          </Section>
        ) : null}

        {!loaded && loading ? <Text style={s.empty}>Đang tải…</Text> : null}

        <Section title="Bảng xếp hạng" action={leaderboard && leaderboard.length > 5 ? { label: "Xem tất cả", onPress: () => setBoardOpen(true) } : undefined}>
          {leaderboard == null ? (
            <Text style={s.empty}>{error ? "Chưa tải được bảng xếp hạng." : "Đang tải…"}</Text>
          ) : leaderboard.length === 0 ? (
            <Text style={s.empty}>Chưa ai chơi ván caro tính điểm. Thách đấu một người để mở màn!</Text>
          ) : (
            leaderboard.slice(0, 5).map((r, i) => <RankRow key={r.userId} r={r} rank={i + 1} meId={meId} />)
          )}
        </Section>

        <View style={{ gap: 8, marginTop: 6 }}>
          <Text style={s.section}>THÀNH TÍCH VỚI MÁY</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {LEVELS.map((k) => {
              const r = botStats[k];
              return (
                <View
                  key={k}
                  style={s.tile}
                  accessible
                  accessibilityLabel={`Máy ${LEVEL_INFO[k].label.toLowerCase()}: ${r.win} thắng, ${r.loss} thua${r.draw ? `, ${r.draw} hòa` : ""}`}
                >
                  <Text style={[s.tileLabel, { color: LEVEL_INFO[k].color }]}>{LEVEL_INFO[k].label}</Text>
                  <Text style={s.tileValue}>{r.win}</Text>
                  <Text style={s.tileSub}>
                    thắng · {r.loss} thua{r.draw ? ` · ${r.draw} hòa` : ""}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={s.note}>Ván với máy chơi ngay trên điện thoại, không cần mạng và không tính điểm ELO.</Text>
        </View>

        {recent.length ? (
          <Section title="Ván gần đây">
            {recent.map((g) => (
              <RecentRow key={g.id} g={g} meId={meId} />
            ))}
          </Section>
        ) : null}

        <Text style={s.credit}>Cờ caro 15 × 15: ai có 5 quân liền nhau trước là thắng. Máy chơi và âm thanh là của riêng Think.</Text>
      </ScrollView>

      <ChallengeSheet visible={challengeOpen} onClose={() => setChallengeOpen(false)} />
      <BotSheet visible={botOpen} onClose={() => setBotOpen(false)} />
      <LeaderboardSheet visible={boardOpen} onClose={() => setBoardOpen(false)} />
      <RulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />
    </View>
  );
}

/** Nền thẻ điểm: đỏ gạch, có lưới ô vuông mờ như giấy kẻ caro */
function HeroBg() {
  let d = "";
  for (let k = 0; k <= 40; k++) d += `M${k * 22} 0V600M0 ${k * 22}H900`;
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id="caroHero" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#E0603A" />
          <Stop offset="0.55" stopColor="#C8432C" />
          <Stop offset="1" stopColor="#962B20" />
        </LinearGradient>
        <RadialGradient id="caroHeroGlow" cx="100%" cy="0%" r="80%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.18" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#caroHero)" />
      <Path d={d} stroke="#FFFFFF" strokeOpacity={0.06} strokeWidth={1} />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#caroHeroGlow)" />
    </Svg>
  );
}

function HeroButton({ title, sub, icon, solid, onPress }: { title: string; sub: string; icon: IconName; solid?: boolean; onPress: () => void }) {
  const s = useStyles(makeStyles);
  const fg = solid ? "#9A2B1E" : "#FFFFFF";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={sub}
      style={({ pressed }) => [
        s.heroButton,
        solid ? s.heroButtonSolid : s.heroButtonGhost,
        pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
      ]}
    >
      <Icon name={icon} size={24} color={fg} />
      <Text style={[s.heroButtonText, { color: fg }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[s.heroButtonSub, { color: solid ? "#B4533C" : "rgba(255,255,255,0.85)" }]} numberOfLines={1}>
        {sub}
      </Text>
    </Pressable>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: { label: string; onPress: () => void } }) {
  const s = useStyles(makeStyles);
  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={s.section}>{title.toUpperCase()}</Text>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button">
            <Text style={s.sectionAction}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={s.card}>{children}</View>
    </View>
  );
}

/* ---------------- Ván dở với máy ---------------- */

/** Cắt một khung k×k quanh chỗ có quân (ảnh nhỏ dễ nhìn hơn cả bàn 15×15) */
function cropBoard(board: number[], k = 9) {
  let r0 = SIZE;
  let r1 = -1;
  let c0 = SIZE;
  let c1 = -1;
  for (let i = 0; i < board.length; i++) {
    if (!board[i]) continue;
    const r = Math.floor(i / SIZE);
    const col = i % SIZE;
    r0 = Math.min(r0, r);
    r1 = Math.max(r1, r);
    c0 = Math.min(c0, col);
    c1 = Math.max(c1, col);
  }
  const mid = (a: number, b: number) => (b < 0 ? Math.floor(SIZE / 2) : Math.round((a + b) / 2));
  const clamp = (v: number) => Math.max(0, Math.min(SIZE - k, v));
  const top = clamp(mid(r0, r1) - Math.floor(k / 2));
  const left = clamp(mid(c0, c1) - Math.floor(k / 2));
  const out: number[] = [];
  for (let r = 0; r < k; r++) for (let col = 0; col < k; col++) out.push(board[(top + r) * SIZE + left + col]);
  return out;
}

function ResumeCard({ g }: { g: BotGame }) {
  const s = useStyles(makeStyles);
  const art = useMemo(() => cropBoard(fromMoves(g.moves, g.rule).board), [g.moves, g.rule]);
  const myTurn = isMyBotTurn(g);
  return (
    <Pressable
      onPress={() => openCaro(null, true)}
      style={({ pressed }) => [s.resume, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={`Ván dở với máy ${LEVEL_INFO[g.level].label.toLowerCase()}, ${g.moves.length} nước. Chạm để chơi tiếp`}
    >
      <View style={s.resumeArt}>
        <MiniBoard board={art} n={9} size={78} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.resumeKicker}>VÁN DỞ VỚI MÁY</Text>
        <Text style={s.rowTitle} numberOfLines={1}>
          Máy {LEVEL_INFO[g.level].label.toLowerCase()} · {ruleLabel(g.rule)}
        </Text>
        <Text style={s.rowSub} numberOfLines={2}>
          {g.moves.length} nước · bạn cầm {markName(g.side)} · {myTurn ? "tới lượt bạn" : "máy đang nghĩ"}
        </Text>
      </View>
      <View style={s.resumeBtn}>
        <Icon name="play-arrow" size={20} color="#FFFFFF" />
        <Text style={s.resumeBtnText}>Chơi tiếp</Text>
      </View>
    </Pressable>
  );
}

/* ---------------- Các dòng ---------------- */

function sidePrefText(g: CaroGame, incoming: boolean) {
  if (g.sidePref === "random") return "Bên ngẫu nhiên";
  const mine = incoming ? otherSide(g.sidePref) : g.sidePref;
  return `Bạn cầm ${markName(mine)}${mine === "x" ? " (đi trước)" : " (đi sau)"}`;
}

function ChallengeRow({ g, incoming }: { g: CaroGame; incoming?: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const users = useStore((st) => st.users);
  const now = useNow(true, 15000);
  const offset = useCaro((st) => st.offsets[g.id] ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const other = users[(incoming ? g.challengerId : g.opponentId) ?? -1];
  const mins = Math.max(1, Math.ceil((g.createdAt + CHALLENGE_TTL - (now + offset)) / 60000));

  async function answer(action: "accept" | "decline" | "cancel") {
    setBusy(action);
    try {
      await answerChallenge(g.id, action);
    } finally {
      setBusy(null);
    }
  }

  const who = other?.displayName || (incoming ? "Ai đó" : "đối thủ");
  return (
    <View>
      <Pressable
        onPress={() => openGame(g.id)}
        style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]}
        accessibilityRole="button"
        accessibilityLabel={`${incoming ? `${who} thách bạn` : `Chờ ${who} nhận lời`}: ${turnLabel(g.turnMs)}, luật ${ruleLabel(g.rule).toLowerCase()}, ${g.rated ? "tính điểm" : "giao hữu"}. ${sidePrefText(g, Boolean(incoming))}. Còn ${mins} phút. Chạm để xem`}
      >
        <Avatar user={other} size={44} dot />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.rowTitle} numberOfLines={1}>
            {incoming ? `${who} thách bạn` : `Chờ ${who}`}
          </Text>
          <Text style={s.rowSub} numberOfLines={2}>
            {turnLabel(g.turnMs)} · {ruleLabel(g.rule)} · {g.rated ? "tính điểm" : "giao hữu"}
          </Text>
          <Text style={s.rowSub} numberOfLines={2}>
            {sidePrefText(g, Boolean(incoming))} · còn {mins} phút
          </Text>
        </View>
        {incoming ? null : <Button title="Hủy" small kind="secondary" busy={busy === "cancel"} onPress={() => answer("cancel")} />}
      </Pressable>
      {/* Lời thách đấu gửi tới mình: hai nút lớn bên dưới, chữ ở trên không bị cắt */}
      {incoming ? (
        <View style={s.challengeActions}>
          <Button title="Nhận lời" icon="check" small style={{ flex: 1 }} busy={busy === "accept"} disabled={busy != null} onPress={() => answer("accept")} />
          <Button title="Từ chối" icon="close" small kind="secondary" style={{ flex: 1 }} busy={busy === "decline"} disabled={busy != null} onPress={() => answer("decline")} />
        </View>
      ) : null}
    </View>
  );
}

function GameRow({ g, meId }: { g: CaroGame; meId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const mine = sideOf(g, meId)!;
  const oppSide = otherSide(mine);
  const opp = useStore((st) => st.users[playerOf(g, oppSide) ?? -1]);
  const myTurn = g.turn === mine;
  const oppRating = oppSide === "x" ? g.xRating : g.oRating;
  return (
    <Pressable
      onPress={() => openGame(g.id)}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]}
      accessibilityRole="button"
      accessibilityLabel={`Ván với ${opp?.displayName || "đối thủ"}, ${g.moves.length} nước, ${myTurn ? "tới lượt bạn" : "chờ đối thủ"}`}
    >
      <SideAvatar side={oppSide} size={44}>
        <Avatar user={opp} size={44} dot={false} />
      </SideAvatar>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {opp?.displayName || "Người dùng"}
          {oppRating != null ? <Text style={s.rowSub}>{`  ${oppRating}`}</Text> : null}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {turnLabel(g.turnMs)} · {g.rated ? "tính điểm" : "giao hữu"} · bạn cầm {markName(mine)} · {g.moves.length} nước
        </Text>
      </View>
      <View style={[s.pill, { backgroundColor: myTurn ? c.jade : c.field }]}>
        <Text style={[s.pillText, { color: myTurn ? c.onJade : c.muted }]}>{myTurn ? "Tới lượt bạn" : "Chờ"}</Text>
      </View>
    </Pressable>
  );
}

function RecentRow({ g, meId }: { g: CaroGame; meId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const mine = sideOf(g, meId)!;
  const oppSide = otherSide(mine);
  const opp = useStore((st) => st.users[playerOf(g, oppSide) ?? -1]);
  const o = outcomeFor(g, mine);
  const delta = deltaOf(g, mine);
  const label = o === "win" ? "Thắng" : o === "loss" ? "Thua" : o === "draw" ? "Hòa" : "Hủy";
  const tint = o === "win" ? c.accent : o === "loss" ? c.danger : c.muted;
  return (
    <Pressable
      onPress={() => openGame(g.id)}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${opp?.displayName || "đối thủ"}: ${reasonText(g, mine, opp?.displayName)}${delta != null ? `, ${delta >= 0 ? "cộng" : "trừ"} ${Math.abs(delta)} điểm` : ""}`}
    >
      <SideAvatar side={oppSide} size={40}>
        <Avatar user={opp} size={40} dot={false} />
      </SideAvatar>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {opp?.displayName || "Người dùng"}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {reasonText(g, mine, opp?.displayName)} · {shortTime(g.endedAt || g.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.outcome, { color: tint }]}>{label}</Text>
        {delta != null ? <Text style={[s.rowSub, { color: tint, fontWeight: "800" }]}>{delta >= 0 ? `+${delta}` : `−${Math.abs(delta)}`}</Text> : null}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 12, paddingTop: 12, paddingBottom: 10 },
    brand: { color: c.text, fontSize: 30, fontWeight: "800", letterSpacing: -1.2 },
    kicker: { color: c.muted, fontSize: 13, marginTop: 1 },
    hero: { borderRadius: 24, padding: 18, gap: 10, overflow: "hidden", backgroundColor: "#C8432C" },
    heroBadge: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: "#F2B01E",
      alignItems: "center",
      justifyContent: "center",
      borderBottomWidth: 3,
      borderBottomColor: "#B77F0A",
    },
    heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 12.5, fontWeight: "700" },
    heroRating: { color: "#fff", fontSize: 40, fontWeight: "900", letterSpacing: -1 },
    heroRank: { color: "#fff", fontSize: 26, fontWeight: "900" },
    heroStats: { color: "rgba(255,255,255,0.94)", fontSize: 13.5, lineHeight: 19 },
    heroActions: { flexDirection: "row", gap: 10, marginTop: 4 },
    heroButton: { flex: 1, minHeight: 92, borderRadius: 18, padding: 12, justifyContent: "center", gap: 2 },
    heroButtonSolid: { backgroundColor: "#FFFFFF", borderBottomWidth: 3, borderBottomColor: "rgba(0,0,0,0.12)" },
    heroButtonGhost: { backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)" },
    heroButtonText: { fontSize: 17, fontWeight: "900", marginTop: 4 },
    heroButtonSub: { fontSize: 12.5, fontWeight: "700" },
    resume: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderColor: c.scheme === "dark" ? "#5A3A1A" : "#F3C9A0",
    },
    resumeArt: { transform: [{ rotate: "-4deg" }] },
    resumeKicker: { color: "#D0612F", fontSize: 11.5, fontWeight: "900", letterSpacing: 0.6 },
    resumeBtn: { flexDirection: "row", alignItems: "center", gap: 2, height: 38, paddingLeft: 8, paddingRight: 12, borderRadius: 19, backgroundColor: "#C8432C" },
    resumeBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
    banner: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12 },
    bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
    section: { flex: 1, color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginHorizontal: 4 },
    sectionAction: { color: c.accent, fontSize: 13, fontWeight: "800" },
    card: { backgroundColor: c.surface, borderRadius: 18, overflow: "hidden", paddingVertical: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
    rowTitle: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    rowSub: { color: c.muted, fontSize: 12.5 },
    challengeActions: { flexDirection: "row", gap: 8, paddingLeft: 68, paddingRight: 12, paddingBottom: 10 },
    pill: { paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    pillText: { fontSize: 12, fontWeight: "800" },
    outcome: { fontSize: 15, fontWeight: "800" },
    tile: { flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    tileLabel: { fontSize: 14, fontWeight: "900" },
    tileValue: { color: c.text, fontSize: 30, fontWeight: "900", marginVertical: 1 },
    tileSub: { color: c.muted, fontSize: 12, fontWeight: "600", textAlign: "center" },
    note: { color: c.muted, fontSize: 12.5, lineHeight: 18, marginHorizontal: 4 },
    empty: { color: c.muted, textAlign: "center", padding: 16, fontSize: 14 },
    credit: { color: c.muted, fontSize: 11.5, lineHeight: 16, textAlign: "center", marginTop: 12, paddingHorizontal: 8 },
  });
