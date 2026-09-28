import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";

import { shortTime } from "../format";
import { useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, Icon, IconButton, Sheet, useStyles, type IconName } from "../ui";
import { clockText, myColor, opponentColor, outcomeFor, reasonText, tcLabel } from "./format";
import { SideAvatar, useNow, useSide } from "./parts";
import { BotSheet, ChallengeSheet } from "./Sheets";
import { answerChallenge, loadChess, loadLeaderboard, openGame, useChess } from "./store";
import type { ChessGame, ChessRating } from "./types";

// Tab Cờ vua: điểm của tôi, lời thách đấu, ván đang chơi, bảng xếp hạng, ván gần đây.

export function ChessHome() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const meId = useStore((st) => st.me?.id ?? 0);
  const { loaded, loading, error, rating, games, leaderboard } = useChess(
    useShallow((st) => ({ loaded: st.loaded, loading: st.loading, error: st.error, rating: st.rating, games: st.games, leaderboard: st.leaderboard })),
  );
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);

  useEffect(() => {
    if (!useChess.getState().loaded) loadChess();
    loadLeaderboard();
  }, []);

  const { incoming, outgoing, active, recent } = useMemo(() => {
    const list = Object.values(games);
    return {
      incoming: list.filter((g) => g.status === "challenge" && g.opponentId === meId).sort((a, b) => b.createdAt - a.createdAt),
      outgoing: list.filter((g) => g.status === "challenge" && g.challengerId === meId).sort((a, b) => b.createdAt - a.createdAt),
      active: list
        .filter((g) => g.status === "active" && myColor(g, meId))
        // Ván tới lượt mình lên trước
        .sort((a, b) => Number(myColor(b, meId) === b.turn) - Number(myColor(a, meId) === a.turn) || b.id - a.id),
      recent: list
        .filter((g) => (g.status === "finished" || g.status === "aborted") && myColor(g, meId))
        .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
        .slice(0, 20),
    };
  }, [games, meId]);

  const myRank = leaderboard ? leaderboard.findIndex((r) => r.userId === meId) + 1 : 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>Cờ vua</Text>
          <Text style={s.kicker}>Thách đấu bạn bè, leo bảng xếp hạng</Text>
        </View>
        <IconButton name="leaderboard" label="Bảng xếp hạng" onPress={() => setBoardOpen(true)} color={c.text} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading && loaded} onRefresh={() => (loadChess(), loadLeaderboard())} tintColor={c.accent} colors={[c.jade]} />}
      >
        {/* Điểm của tôi */}
        <View style={s.hero}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={s.heroBadge}>
              <Icon name="military-tech" size={30} color="#14201C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroLabel}>Điểm ELO của bạn</Text>
              <Text style={s.heroRating}>
                {rating ? rating.rating : "—"}
                {rating?.provisional ? <Text style={s.heroProv}> ?</Text> : null}
              </Text>
            </View>
            {myRank ? (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.heroLabel}>Hạng</Text>
                <Text style={s.heroRank}>#{myRank}</Text>
              </View>
            ) : null}
          </View>
          <Text style={s.heroStats}>
            {rating && rating.games
              ? `${rating.games} ván xếp hạng · ${rating.wins} thắng · ${rating.draws} hòa · ${rating.losses} thua · cao nhất ${rating.peak}`
              : "Chưa chơi ván xếp hạng nào. Mọi người bắt đầu từ 1200 điểm."}
          </Text>
          {rating?.provisional && rating.games ? <Text style={s.heroHint}>Dấu ? : điểm tạm tính, sau 10 ván sẽ ổn định hơn.</Text> : null}
          <View style={s.heroActions}>
            <HeroButton title="Thách đấu" icon="sports-kabaddi" solid onPress={() => setChallengeOpen(true)} />
            <HeroButton title="Chơi với máy" icon="smart-toy" onPress={() => setBotOpen(true)} />
          </View>
        </View>

        {error && !loaded ? (
          <View style={[s.banner, { backgroundColor: c.dangerWash }]}>
            <Icon name="error-outline" size={18} color={c.danger} />
            <Text style={[s.bannerText, { color: c.danger }]}>{error}</Text>
            <Button title="Thử lại" small kind="secondary" onPress={loadChess} />
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
            <Text style={s.empty}>Đang tải…</Text>
          ) : leaderboard.length === 0 ? (
            <Text style={s.empty}>Chưa ai chơi ván xếp hạng. Thách đấu một người để mở màn!</Text>
          ) : (
            leaderboard.slice(0, 5).map((r, i) => <RankRow key={r.userId} r={r} rank={i + 1} meId={meId} />)
          )}
        </Section>

        {recent.length ? (
          <Section title="Ván gần đây">
            {recent.map((g) => (
              <RecentRow key={g.id} g={g} meId={meId} />
            ))}
          </Section>
        ) : null}

        <Text style={s.credit}>
          Luật cờ: chess.js (BSD-2). Máy cờ: js-chess-engine (MIT), GarboChess-JS (BSD), Stockfish 11 (GPL-3.0). Quân cờ: bộ cburnett của Colin M.L.
          Burnett (GPLv2+).
        </Text>
      </ScrollView>

      <ChallengeSheet visible={challengeOpen} onClose={() => setChallengeOpen(false)} />
      <BotSheet visible={botOpen} onClose={() => setBotOpen(false)} />
      <LeaderboardSheet visible={boardOpen} onClose={() => setBoardOpen(false)} />
    </View>
  );
}

function HeroButton({ title, icon, solid, onPress }: { title: string; icon: IconName; solid?: boolean; onPress: () => void }) {
  const s = useStyles(makeStyles);
  const fg = solid ? "#0B5E4E" : "#FFFFFF";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [s.heroButton, { backgroundColor: solid ? "#FFFFFF" : "rgba(255,255,255,0.16)", opacity: pressed ? 0.85 : 1 }]}
    >
      <Icon name={icon} size={20} color={fg} />
      <Text style={[s.heroButtonText, { color: fg }]}>{title}</Text>
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

/* ---------------- Các dòng ---------------- */

function ChallengeRow({ g, incoming }: { g: ChessGame; incoming?: boolean }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const users = useStore((st) => st.users);
  const now = useNow(true, 1000);
  const receivedAt = useChess((st) => st.receivedAt[g.id] || now);
  const [busy, setBusy] = useState<string | null>(null);
  const other = users[(incoming ? g.challengerId : g.opponentId) ?? -1];
  const left = g.expiresAt ? Math.max(0, g.expiresAt - g.serverNow - (now - receivedAt)) : 0;
  const color = g.colorPref === "random" ? "màu ngẫu nhiên" : (g.colorPref === "white") === !incoming ? "bạn cầm Trắng" : "bạn cầm Đen";

  async function answer(action: "accept" | "decline" | "cancel") {
    setBusy(action);
    try {
      await answerChallenge(g.id, action);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Pressable onPress={() => openGame(g.id)} style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]} accessibilityRole="button">
      <Avatar user={other} size={44} dot />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {incoming ? `${other?.displayName || "Ai đó"} thách bạn` : `Chờ ${other?.displayName || "đối thủ"}`}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {tcLabel(g)} · {g.rated ? "tính điểm" : "giao hữu"} · {color} · còn {clockText(left).replace(/\.\d$/, "")}
        </Text>
      </View>
      {incoming ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Button title="Nhận" small busy={busy === "accept"} onPress={() => answer("accept")} />
          <IconButton name="close" label="Từ chối" onPress={() => answer("decline")} disabled={busy != null} color={c.muted} />
        </View>
      ) : (
        <Button title="Hủy" small kind="secondary" busy={busy === "cancel"} onPress={() => answer("cancel")} />
      )}
    </Pressable>
  );
}

function GameRow({ g, meId }: { g: ChessGame; meId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const mine = myColor(g, meId)!;
  const oppColor = opponentColor(mine);
  const opp = useSide(g, oppColor);
  const myTurn = g.turn === mine;
  const rating = g.live[oppColor];
  return (
    <Pressable onPress={() => openGame(g.id)} style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]} accessibilityRole="button">
      <SideAvatar g={g} color={oppColor} size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {opp.name}
          {rating != null ? <Text style={s.rowSub}>{`  ${opp.isBot ? "~" : ""}${rating}`}</Text> : null}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {tcLabel(g)} · {g.bot ? "với máy" : g.rated ? "tính điểm" : "giao hữu"} · bạn cầm {mine === "w" ? "Trắng" : "Đen"} · {g.moves.length} nước
        </Text>
      </View>
      <View style={[s.pill, { backgroundColor: myTurn ? c.jade : c.field }]}>
        <Text style={[s.pillText, { color: myTurn ? c.onJade : c.muted }]}>{myTurn ? "Lượt bạn" : "Chờ"}</Text>
      </View>
    </Pressable>
  );
}

function RecentRow({ g, meId }: { g: ChessGame; meId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const mine = myColor(g, meId)!;
  const oppColor = opponentColor(mine);
  const opp = useSide(g, oppColor);
  const o = outcomeFor(g, mine);
  const delta = g.deltas[mine];
  const label = o === "win" ? "Thắng" : o === "loss" ? "Thua" : o === "draw" ? "Hòa" : "Hủy";
  const tint = o === "win" ? c.accent : o === "loss" ? c.danger : c.muted;
  return (
    <Pressable onPress={() => openGame(g.id)} style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]} accessibilityRole="button">
      <SideAvatar g={g} color={oppColor} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {opp.name}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {reasonText(g.reason)} · {tcLabel(g)} · {shortTime(g.endedAt || g.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.outcome, { color: tint }]}>{label}</Text>
        {delta != null ? <Text style={[s.rowSub, { color: tint, fontWeight: "800" }]}>{delta >= 0 ? `+${delta}` : delta}</Text> : null}
      </View>
    </Pressable>
  );
}

function RankRow({ r, rank, meId }: { r: ChessRating; rank: number; meId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const user = useStore((st) => st.users[r.userId]);
  const medal = rank === 1 ? "#E3B21A" : rank === 2 ? "#A9B4BA" : rank === 3 ? "#C07A3E" : null;
  return (
    <View style={[s.row, r.userId === meId && { backgroundColor: c.jadeWash }]}>
      <View style={[s.rank, medal ? { backgroundColor: medal } : null]}>
        <Text style={[s.rankText, medal ? { color: "#fff" } : null]}>{rank}</Text>
      </View>
      <Avatar user={user} size={36} dot={false} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {user?.displayName || "Người dùng"}
          {r.userId === meId ? " (bạn)" : ""}
        </Text>
        <Text style={s.rowSub}>
          {r.wins} thắng · {r.draws} hòa · {r.losses} thua
        </Text>
      </View>
      <Text style={s.rankRating}>
        {r.rating}
        {r.provisional ? <Text style={s.rowSub}>?</Text> : null}
      </Text>
    </View>
  );
}

function LeaderboardSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const meId = useStore((st) => st.me?.id ?? 0);
  const leaderboard = useChess((st) => st.leaderboard);
  useEffect(() => {
    if (visible) loadLeaderboard();
  }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Bảng xếp hạng">
      <Text style={s.rowSub}>Xếp theo điểm ELO từ các ván tính điểm giữa người với người. Dấu ? là điểm tạm (dưới 10 ván).</Text>
      <View style={{ marginHorizontal: -8 }}>
        {(leaderboard || []).map((r, i) => (
          <RankRow key={r.userId} r={r} rank={i + 1} meId={meId} />
        ))}
        {leaderboard && leaderboard.length === 0 ? <Text style={s.empty}>Chưa ai chơi ván xếp hạng.</Text> : null}
        {leaderboard == null ? <Text style={s.empty}>Đang tải…</Text> : null}
      </View>
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
    brand: { color: c.text, fontSize: 30, fontWeight: "800", letterSpacing: -1.2 },
    kicker: { color: c.muted, fontSize: 13, marginTop: 1 },
    hero: { backgroundColor: c.jade, borderRadius: 22, padding: 18, gap: 10 },
    heroBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.turmeric, alignItems: "center", justifyContent: "center" },
    heroLabel: { color: "rgba(255,255,255,0.8)", fontSize: 12.5, fontWeight: "700" },
    heroRating: { color: "#fff", fontSize: 38, fontWeight: "900", letterSpacing: -1 },
    heroProv: { color: "rgba(255,255,255,0.7)", fontSize: 24 },
    heroRank: { color: "#fff", fontSize: 26, fontWeight: "900" },
    heroStats: { color: "rgba(255,255,255,0.92)", fontSize: 13.5, lineHeight: 19 },
    heroHint: { color: "rgba(255,255,255,0.75)", fontSize: 12 },
    heroActions: { flexDirection: "row", gap: 10, marginTop: 4 },
    heroButton: { flex: 1, minHeight: 46, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10 },
    heroButtonText: { fontSize: 15, fontWeight: "800" },
    banner: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12 },
    bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
    section: { flex: 1, color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginHorizontal: 4 },
    sectionAction: { color: c.accent, fontSize: 13, fontWeight: "800" },
    card: { backgroundColor: c.surface, borderRadius: 18, overflow: "hidden", paddingVertical: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
    rowTitle: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    rowSub: { color: c.muted, fontSize: 12.5 },
    pill: { paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    pillText: { fontSize: 12, fontWeight: "800" },
    outcome: { fontSize: 15, fontWeight: "800" },
    rank: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: c.field },
    rankText: { color: c.text2, fontSize: 13, fontWeight: "800" },
    rankRating: { color: c.text, fontSize: 17, fontWeight: "800" },
    empty: { color: c.muted, textAlign: "center", padding: 16, fontSize: 14 },
    credit: { color: c.muted, fontSize: 11.5, lineHeight: 16, textAlign: "center", marginTop: 12, paddingHorizontal: 8 },
  });
