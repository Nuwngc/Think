import { useEffect, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { Block } from "../blocks/BlocksScreen";
import { blocksSummary, loadBlocks, sync, useBlocks } from "../blocks/store";
import { MiniBoard as CaroMiniBoard } from "../caro/Board";
import { caroSummary, loadCaro, loadLocal as loadCaroLocal, useCaro } from "../caro/store";
import { MiniBoard } from "../chess/Board";
import { chessBadge, loadChess, loadLeaderboard, useChess } from "../chess/store";
import { openBlocks, openCaro, openChess, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Icon, useStyles, type IconName } from "../ui";

// Tab Trò chơi: chọn game (Xếp Khối, Cờ vua, Cờ caro) + bảng xếp hạng của cả nhóm

const fmt = (n: number) => Number(n || 0).toLocaleString("vi-VN");
const ART = [1, 1, 0, 5, 0, 1, 0, 5, 3, 3, 3, 5, 0, 7, 7, 0];
const ART_FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
// Hình bàn caro nhỏ 6×6 trên thẻ: năm X chéo thắng, vài quân O
const CARO_N = 6;
const CARO_LINE = [0, 7, 14, 21, 28];
const CARO_ART = (() => {
  const b = new Array(CARO_N * CARO_N).fill(0);
  for (const i of CARO_LINE) b[i] = 1;
  for (const i of [2, 3, 9, 16, 20]) b[i] = 2;
  return b;
})();

function CardBg({ id, from, to, mid }: { id: string; from: string; mid: string; to: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="0.55" stopColor={mid} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
        <RadialGradient id={`${id}-glow`} cx="100%" cy="0%" r="80%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.2" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}-bg)`} />
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}-glow)`} />
    </Svg>
  );
}

function Chip({ text, icon, alert }: { text: string; icon?: IconName; alert?: boolean }) {
  const s = useStyles(makeStyles);
  return (
    <View style={[s.chip, alert && { backgroundColor: "#FFD54A" }]}>
      {icon ? <Icon name={icon} size={14} color={alert ? "#3A2A00" : "#FFFFFF"} /> : null}
      <Text style={[s.chipText, alert && { color: "#3A2A00" }]}>{text}</Text>
    </View>
  );
}

function GameCard({
  id,
  colors,
  title,
  sub,
  chips,
  cta,
  ctaColor,
  art,
  onPress,
  label,
}: {
  id: string;
  colors: [string, string, string];
  title: string;
  sub: string;
  chips: ReactNode;
  cta: string;
  ctaColor: string;
  art: ReactNode;
  onPress: () => void;
  label: string;
}) {
  const s = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.985 }] }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <CardBg id={id} from={colors[0]} mid={colors[1]} to={colors[2]} />
      <View style={s.cardMain}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.cardSub}>{sub}</Text>
        <View style={s.chips}>{chips}</View>
        <View style={s.cta}>
          <Icon name="play-arrow" size={20} color={ctaColor} />
          <Text style={[s.ctaText, { color: ctaColor }]}>{cta}</Text>
        </View>
      </View>
      {art}
    </Pressable>
  );
}

export function GamesHome() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const meId = useStore((st) => st.me?.id ?? 0);
  const users = useStore((st) => st.users);
  const blocks = useBlocks();
  const bs = blocksSummary(blocks, meId);
  const rating = useChess((st) => st.rating);
  const leaderboard = useChess((st) => st.leaderboard);
  const todo = useChess((st) => chessBadge(st, meId));
  const activeGames = useChess((st) => Object.values(st.games).filter((g) => g.status === "active" && (g.whiteId === meId || g.blackId === meId)).length);
  const loading = useChess((st) => st.loading);
  const rank = leaderboard ? leaderboard.findIndex((r) => r.userId === meId) + 1 : 0;
  const caro = useCaro(useShallow((st) => caroSummary(st, meId)));
  const caroTurn = useCaro((st) => Object.values(st.games).filter((g) => g.status === "active" && ((g.xId === meId && g.turn === "x") || (g.oId === meId && g.turn === "o"))).length);
  const caroBoard = useCaro((st) => st.leaderboard);

  useEffect(() => {
    loadBlocks().then(() => sync());
    loadCaroLocal();
    if (!useChess.getState().loaded) loadChess();
    if (!useChess.getState().leaderboard) loadLeaderboard();
    if (!useCaro.getState().loaded && !useCaro.getState().loading) loadCaro();
  }, []);

  const board = (title: string, rows: { userId: number; value: string }[]) => (
    <View style={s.board}>
      <Text style={s.boardTitle}>{title}</Text>
      {rows.map((r, i) => (
        <View key={r.userId} style={s.boardRow}>
          <View style={[s.medal, { backgroundColor: ["#F5B300", "#B7C1CE", "#C97834"][i] || c.field }]}>
            <Text style={s.medalText}>{i + 1}</Text>
          </View>
          <Avatar user={users[r.userId]} size={30} dot={false} />
          <Text style={[s.boardName, r.userId === meId && { color: c.accent }]} numberOfLines={1}>
            {users[r.userId]?.displayName || "Người dùng"}
          </Text>
          <Text style={s.boardValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.brand}>Trò chơi</Text>
        <Text style={s.kicker}>Chơi cùng cả nhóm: thách đấu cờ vua, cờ caro, đua điểm Xếp Khối mỗi tuần</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              loadChess();
              loadLeaderboard();
              loadCaro();
              sync();
            }}
            tintColor={c.accent}
            colors={[c.jade]}
          />
        }
      >
        <GameCard
          id="blocks"
          colors={["#3B4FC0", "#25338A", "#1C2566"]}
          title="Xếp Khối"
          sub={bs.best ? `Kỷ lục ${fmt(bs.best)}${bs.weekRank ? ` · hạng #${bs.weekRank} tuần này` : ""}` : "Xếp khối, xóa hàng, lập kỷ lục"}
          chips={
            <>
              {bs.playing != null ? <Chip text={`Đang chơi dở · ${fmt(bs.playing)} điểm`} alert /> : null}
              <Chip icon="wifi-off" text="Chơi được khi mất mạng" />
              {bs.pending ? <Chip text={`${bs.pending} ván chờ gửi`} /> : null}
            </>
          }
          cta={bs.playing != null ? "Chơi tiếp" : "Chơi ngay"}
          ctaColor="#1B2568"
          art={
            <View style={s.blocksArt}>
              {ART.map((v, i) => (
                <View key={i} style={{ width: 22, height: 22 }}>
                  {v ? <Block color={v} size={22} radius={5} /> : <View style={s.artEmpty} />}
                </View>
              ))}
            </View>
          }
          onPress={openBlocks}
          label={`Xếp Khối. ${bs.best ? `Kỷ lục ${bs.best}.` : ""} Chạm để chơi`}
        />
        <GameCard
          id="chess"
          colors={["#14967A", "#0E7C66", "#0A5746"]}
          title="Cờ vua"
          sub={rating ? `ELO ${rating.rating}${rating.provisional ? "?" : ""}${rank ? ` · hạng #${rank}` : ""}` : "Thách đấu bạn bè, leo bảng ELO"}
          chips={
            <>
              {todo ? <Chip text={`${todo} việc cần làm`} alert /> : null}
              {activeGames ? <Chip text={`${activeGames} ván đang chơi`} /> : null}
              {!todo && !activeGames ? <Chip text="Có máy Stockfish phân tích ván" /> : null}
            </>
          }
          cta={todo ? "Vào xem" : "Vào chơi"}
          ctaColor="#0A5E4E"
          art={
            <View style={s.chessArt}>
              <MiniBoard fen={ART_FEN} size={104} />
            </View>
          }
          onPress={() => openChess()}
          label={`Cờ vua. ${todo ? `${todo} việc cần làm.` : ""} Chạm để vào`}
        />
        <GameCard
          id="caro"
          colors={["#E0603A", "#C8432C", "#8E2A1F"]}
          title="Cờ caro"
          sub={caro.rating && caro.rating.games ? `ELO ${caro.rating.rating}${caro.rank ? ` · hạng #${caro.rank}` : ""}` : "Năm quân liền nhau là thắng"}
          chips={
            <>
              {caroTurn ? <Chip text={`Tới lượt bạn: ${caroTurn}`} alert /> : null}
              {caro.todo - caroTurn > 0 ? <Chip text={`${caro.todo - caroTurn} lời thách đấu`} alert /> : null}
              {caro.botPlaying ? <Chip icon="smart-toy" text="Ván dở với máy" /> : null}
              {!caro.todo && !caro.botPlaying ? <Chip icon="smart-toy" text="Chơi với máy · Thách bạn bè" /> : null}
            </>
          }
          cta={caro.todo ? "Vào xem" : "Vào chơi"}
          ctaColor="#9A2B1E"
          art={
            <View style={s.caroArt}>
              <CaroMiniBoard board={CARO_ART} n={CARO_N} size={100} line={CARO_LINE} scheme="light" />
            </View>
          }
          onPress={() => openCaro()}
          label={`Cờ caro. ${caroTurn ? `Tới lượt bạn ở ${caroTurn} ván.` : ""}${caro.todo - caroTurn > 0 ? ` ${caro.todo - caroTurn} lời thách đấu.` : ""} Chạm để vào`}
        />
        {bs.top.length ? board("XẾP KHỐI · TUẦN NÀY", bs.top.map((r) => ({ userId: r.userId, value: fmt(r.score) }))) : null}
        {leaderboard && leaderboard.length ? board("CỜ VUA · ĐIỂM ELO", leaderboard.slice(0, 3).map((r) => ({ userId: r.userId, value: String(r.rating) }))) : null}
        {caroBoard && caroBoard.length ? board("CỜ CARO · ĐIỂM ELO", caroBoard.slice(0, 3).map((r) => ({ userId: r.userId, value: String(r.rating) }))) : null}
        <Text style={s.credit}>Âm thanh tự tổng hợp cho Think. Xếp Khối lấy cảm hứng từ các game xếp khối 8×8; hình và tiếng là của riêng Think.</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
    brand: { color: c.text, fontSize: 30, fontWeight: "800", letterSpacing: -1.2 },
    kicker: { color: c.muted, fontSize: 13, marginTop: 1 },
    card: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 170, padding: 18, paddingRight: 14, borderRadius: 24, overflow: "hidden", elevation: 3 },
    cardMain: { flex: 1, gap: 6, alignItems: "flex-start" },
    cardTitle: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", letterSpacing: -0.8 },
    cardSub: { color: "rgba(255,255,255,0.92)", fontSize: 14.5, fontWeight: "600" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.16)" },
    chipText: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "700" },
    cta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, height: 40, paddingLeft: 10, paddingRight: 16, borderRadius: 20, backgroundColor: "#FFFFFF" },
    ctaText: { fontSize: 15, fontWeight: "800" },
    blocksArt: {
      width: 22 * 4 + 4 * 3 + 12,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
      padding: 6,
      borderRadius: 14,
      backgroundColor: "rgba(8,12,50,0.45)",
      transform: [{ rotate: "6deg" }],
    },
    artEmpty: { flex: 1, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.08)" },
    chessArt: { transform: [{ rotate: "-5deg" }], borderRadius: 8, overflow: "hidden", elevation: 4 },
    caroArt: { transform: [{ rotate: "6deg" }], borderRadius: 10, elevation: 4, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    board: { backgroundColor: c.surface, borderRadius: 18, padding: 14, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    boardTitle: { color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
    boardRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    medal: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    medalText: { color: "#2A1A00", fontSize: 12, fontWeight: "800" },
    boardName: { flex: 1, color: c.text, fontSize: 14.5, fontWeight: "700" },
    boardValue: { color: c.text, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
    credit: { color: c.muted, fontSize: 12, textAlign: "center", lineHeight: 17, marginTop: 4 },
  });
