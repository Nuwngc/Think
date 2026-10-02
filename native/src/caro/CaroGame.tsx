import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hideToast, leaveCaroGame, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, confirm, Icon, IconButton, useStyles } from "../ui";
import { Board } from "./Board";
import { cellName, fromMoves } from "./engine";
import {
  countdownText,
  deltaOf,
  markName,
  otherSide,
  outcomeFor,
  playerOf,
  ratingOf,
  reasonText,
  resultTitle,
  RULE_INFO,
  ruleLabel,
  sideOf,
  turnLabel,
} from "./format";
import { ActionButton, cellText, ClockBar, ClockFace, Header, PlayerCard, ResultCard, SoundButton, useEndEffects, useMoveSounds, useNow, type Outcome } from "./parts";
import { RulesSheet } from "./Sheets";
import { holdCaroSounds, playCaro } from "./sound";
import { answerChallenge, closeGame, loadLocal, playMove, rematch, resign, useCaro } from "./store";
import type { CaroGame as Game, Side } from "./types";

// Màn một ván caro với bạn bè: hai thẻ người chơi, đồng hồ mỗi nước, bàn cờ, đầu hàng, kết quả, đấu lại.

const CHALLENGE_TTL = 15 * 60 * 1000;

export function CaroGame({ id }: { id: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const g = useCaro((st) => st.games[id]);

  // Đã mở ván: ẩn thông báo nhỏ về chính ván này (hay "đã gửi lời thách đấu" khi họ vừa nhận lời)
  useEffect(() => {
    const t = useStore.getState().toast?.caroGameId;
    if (t === id || t === 0) hideToast();
  }, [id]);
  useEffect(() => {
    loadLocal();
    return holdCaroSounds(); // rời màn: trả lại luồng âm thanh cho máy
  }, []);

  if (!g) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header title="Cờ caro" onBack={leaveCaroGame} />
        <View style={s.fill}>
          <ActivityIndicator color={c.accent} />
        </View>
      </View>
    );
  }
  if (g.status !== "active" && g.status !== "finished" && g.status !== "aborted") return <ChallengeView g={g} />;
  return <OnlineGame g={g} />;
}

const modeText = (g: Game) => `${turnLabel(g.turnMs)} · ${ruleLabel(g.rule)} · ${g.rated ? "Tính điểm" : "Giao hữu"}`;

function OnlineGame({ g }: { g: Game }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const meId = useStore((st) => st.me?.id ?? 0);
  const users = useStore((st) => st.users);
  const offset = useCaro((st) => st.offsets[g.id] ?? 0);
  const sending = useCaro((st) => Boolean(st.sending[g.id]));
  const leaderboard = useCaro((st) => st.leaderboard);
  const meRating = useCaro((st) => st.me);
  const liveRating = (uid: number | null) =>
    leaderboard?.find((r) => r.userId === uid)?.rating ?? (meRating && meRating.userId === uid ? meRating.rating : 1200);
  const [ghost, setGhost] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const mine = sideOf(g, meId);
  const left: Side = mine ?? "x";
  const right = otherSide(left);
  const leftUser = users[playerOf(g, left) ?? -1];
  const rightUser = users[playerOf(g, right) ?? -1];
  const oppName = rightUser?.displayName || "Đối thủ";

  const st = useMemo(() => fromMoves(g.moves, g.rule), [g.moves, g.rule]);
  const n = g.moves.length;
  const last = n ? g.moves[n - 1] : null;
  const line = g.winLine && g.winLine.length ? g.winLine : st.line;
  const active = g.status === "active";
  const over = !active || st.winner !== 0;
  const myTurn = active && !over && mine != null && g.turn === mine && !sending;

  // Bàn đổi (có nước mới) hay hết lượt: bỏ quân xem trước
  useEffect(() => setGhost(null), [n, myTurn]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  // Có giới hạn giờ mỗi nước: đồng hồ là thành phần riêng (ClockFace / ClockBar), màn này không vẽ lại mỗi giây
  const timed = active && g.turnMs > 0;

  // Âm thanh + trình đọc màn hình
  useMoveSounds(st, mine, {
    online: true,
    active,
    announce: (i) => (mine && st.board[i] !== (mine === "x" ? 1 : 2) && active ? `${oppName} đi ${cellName(i)}. Tới lượt bạn.` : null),
  });
  const outcome = outcomeFor(g, mine) as Outcome | null;
  const endOutcome = g.status === "active" ? null : outcome;
  const confetti = useEndEffects(endOutcome, mine, endOutcome ? `${resultTitle(g, mine)} ${reasonText(g, mine, oppName)}.` : undefined);
  const [startStatus] = useState(g.status);
  useEffect(() => {
    // Vừa mở ván chưa ai đi: tiếng bắt đầu (chờ đọc xong lựa chọn âm thanh)
    if (startStatus === "active" && n === 0) loadLocal().then(() => playCaro("start", 0.8));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cỡ bàn: vừa chiều ngang, chừa chỗ cho thẻ người chơi và nút bên dưới
  const size = Math.min(width - 12, 560, Math.max(250, height - insets.top - insets.bottom - 300));

  // Hàm cho bàn cờ giữ nguyên giữa các lần vẽ (bàn cờ chỉ vẽ lại khi có nước mới / quân xem trước đổi)
  const live = useRef({ id: g.id, over, mine, sending, oppName });
  live.current = { id: g.id, over, mine, sending, oppName };
  const onPlace = useCallback((i: number) => {
    setGhost(null);
    playMove(live.current.id, i);
  }, []);
  const onBlocked = useCallback((_: number, why: "occupied" | "turn") => {
    const cur = live.current;
    if (cur.over || !cur.mine) return;
    playCaro("invalid", 0.6);
    setFlash(why === "occupied" ? "Ô này đã có quân" : cur.sending ? "Đang gửi nước đi…" : `Chưa tới lượt bạn: chờ ${cur.oppName} đi`);
  }, []);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  let status = "";
  let statusColor = c.text2;
  if (!over && mine) {
    if (flash) {
      status = flash;
      statusColor = c.danger;
    } else if (sending) status = "Đang gửi nước đi…";
    else if (g.turn === mine) {
      statusColor = c.accent;
      status = ghost != null ? `Chạm lần nữa vào ${cellName(ghost)} để đánh` : n === 0 ? "Tới lượt bạn: đi nước đầu tiên" : "Tới lượt bạn";
      if (ghost != null) statusColor = c.scheme === "dark" ? "#F2C04E" : "#8A5A00";
    } else status = `Chờ ${oppName} đi…`;
  } else if (!over) status = g.turn === "x" ? "X đang đi" : "O đang đi";

  const canAbort = active && mine && n < 2;
  const myDelta = mine ? deltaOf(g, mine) : null;
  const myBefore = mine ? ratingOf(g, mine) : null;
  const boardLabel = `Bàn cờ caro 15 × 15, ${n} nước${last != null ? `, nước vừa đi ${cellName(last)}` : ""}. ${status || resultTitle(g, mine)}`;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header
        title={mine ? `Với ${oppName}` : `${leftUser?.displayName || "X"} vs ${oppName}`}
        sub={modeText(g)}
        onBack={leaveCaroGame}
        right={
          <>
            <IconButton name="info-outline" label="Luật chơi" onPress={() => setRulesOpen(true)} color={c.text2} />
            <SoundButton />
          </>
        }
      />
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <View style={s.players}>
          <PlayerCard
            side={left}
            avatar={<Avatar user={leftUser} size={36} dot={false} />}
            name={mine ? "Bạn" : leftUser?.displayName || "Người dùng"}
            sub={ratingText(g, left, liveRating)}
            delta={g.status === "finished" && g.rated ? deltaOf(g, left) : null}
            turn={active && !over && g.turn === left}
          />
          <View style={s.center}>{timed && !over ? <ClockFace g={g} offset={offset} /> : <Text style={s.vs}>{over && g.result === "draw" ? "HÒA" : "VS"}</Text>}</View>
          <PlayerCard
            side={right}
            right
            avatar={<Avatar user={rightUser} size={36} dot={false} />}
            name={rightUser?.displayName || "Người dùng"}
            sub={ratingText(g, right, liveRating)}
            delta={g.status === "finished" && g.rated ? deltaOf(g, right) : null}
            turn={active && !over && g.turn === right}
          />
        </View>
        {timed && !over ? <ClockBar g={g} offset={offset} /> : <View style={{ height: 5 }} />}

        <Board
          board={st.board}
          size={size}
          last={last}
          line={line}
          playable={myTurn}
          mine={mine ?? "x"}
          ghost={ghost}
          onGhost={setGhost}
          onPlace={onPlace}
          onBlocked={onBlocked}
          label={boardLabel}
          confetti={confetti}
        />

        {status ? (
          <Text style={[s.status, { color: statusColor }]} accessibilityLiveRegion="polite">
            {status}
          </Text>
        ) : null}
        {active && !over && mine && n < 2 && g.turnMs > 0 ? <Text style={s.muted}>Chưa đủ 2 nước: hết giờ thì ván bị hủy, không ai mất điểm.</Text> : null}

        {over && g.status !== "active" ? (
          <ResultCard
            outcome={outcome ?? "none"}
            title={resultTitle(g, mine, users[playerOf(g, (g.result as Side) || "x") ?? -1]?.displayName)}
            reason={reasonText(g, mine, oppName)}
            delta={g.rated ? myDelta : null}
            after={myDelta != null && myBefore != null ? myBefore + myDelta : null}
          />
        ) : null}

        {active && mine ? (
          <View style={s.actions}>
            {canAbort ? (
              <ActionButton
                icon="close"
                title="Hủy ván"
                kind="danger"
                busy={busy === "resign"}
                onPress={async () => {
                  if (await confirm("Hủy ván caro?", "Ván chưa bắt đầu nên không ai mất điểm.", "Hủy ván")) run("resign", () => resign(g.id));
                }}
              />
            ) : (
              <ActionButton
                icon="flag"
                title="Đầu hàng"
                kind="danger"
                busy={busy === "resign"}
                disabled={over}
                onPress={async () => {
                  if (await confirm("Đầu hàng?", g.rated ? "Bạn sẽ thua ván này và bị trừ điểm ELO." : "Bạn sẽ thua ván này.", "Đầu hàng")) run("resign", () => resign(g.id));
                }}
              />
            )}
          </View>
        ) : null}

        {!active && mine ? (
          <View style={s.actions}>
            <ActionButton icon="replay" title="Đấu lại" kind="primary" busy={busy === "rematch"} onPress={() => run("rematch", () => rematch(g.id))} />
            <ActionButton icon="grid-view" title="Về trang caro" onPress={closeGame} />
          </View>
        ) : null}

        <Text style={s.foot}>
          {n} nước{last != null ? ` · nước vừa đi ${cellText(last)}` : ""}
          {mine ? ` · bạn cầm ${markName(mine)}` : ""}
        </Text>
      </ScrollView>
      <RulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />
    </View>
  );
}

/** Điểm ghi trên thẻ: ván đã xong thì điểm trước ván (kèm điểm cộng / trừ), đang chơi thì điểm hiện tại */
function ratingText(g: Game, side: Side, live: (uid: number | null) => number) {
  const r = g.status === "finished" ? ratingOf(g, side) : null;
  return `ELO ${r ?? live(playerOf(g, side))}`;
}

/* =========================================================
   Lời thách đấu (chưa bắt đầu)
   ========================================================= */

function ChallengeView({ g }: { g: Game }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const meId = useStore((st) => st.me?.id ?? 0);
  const users = useStore((st) => st.users);
  const offset = useCaro((st) => st.offsets[g.id] ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow(g.status === "challenge", 1000);
  const challenger = g.challengerId != null ? users[g.challengerId] : undefined;
  const opponent = g.opponentId != null ? users[g.opponentId] : undefined;
  const incoming = g.opponentId === meId;
  const leftMs = Math.max(0, g.createdAt + CHALLENGE_TTL - (now + offset));

  const sideText =
    g.sidePref === "random" ? "Bên đi trước chọn ngẫu nhiên" : `Bạn cầm quân ${markName(incoming ? otherSide(g.sidePref) : g.sidePref)}${(incoming ? otherSide(g.sidePref) : g.sidePref) === "x" ? " (đi trước)" : " (đi sau)"}`;

  const statusText =
    g.status === "declined"
      ? incoming
        ? "Bạn đã từ chối lời thách đấu."
        : `${opponent?.displayName || "Đối thủ"} đã từ chối lời thách đấu.`
      : g.status === "cancelled"
        ? "Lời thách đấu đã được hủy."
        : g.status === "expired"
          ? "Lời thách đấu đã hết hạn."
          : incoming
            ? `${challenger?.displayName || "Ai đó"} thách bạn một ván caro.`
            : `Đang chờ ${opponent?.displayName || "đối thủ"} nhận lời…`;

  async function answer(action: "accept" | "decline" | "cancel") {
    setBusy(action);
    try {
      const res = await answerChallenge(g.id, action);
      if (res && action !== "accept") closeGame();
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header title="Thách đấu cờ caro" sub={`${turnLabel(g.turnMs)} · ${g.rated ? "Tính điểm ELO" : "Giao hữu"}`} onBack={leaveCaroGame} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 20 }}>
        <View style={s.vsRow}>
          <View style={s.vsSide}>
            <Avatar user={challenger} size={64} dot={false} />
            <Text style={s.vsName} numberOfLines={1}>
              {challenger?.displayName || "Người dùng"}
            </Text>
          </View>
          <Text style={s.vsText}>VS</Text>
          <View style={s.vsSide}>
            <Avatar user={opponent} size={64} dot={false} />
            <Text style={s.vsName} numberOfLines={1}>
              {opponent?.displayName || "Người dùng"}
            </Text>
          </View>
        </View>
        <Text style={s.challengeStatus} accessibilityLiveRegion="polite">
          {statusText}
        </Text>
        <View style={[s.infoCard, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Info icon="timer" text={g.turnMs ? `Mỗi nước ${turnLabel(g.turnMs).replace("/nước", "")}, quá giờ là thua` : "Không giới hạn thời gian mỗi nước"} />
          <Info icon="rule" text={`Luật ${ruleLabel(g.rule).toLowerCase()}: ${RULE_INFO[g.rule].about.charAt(0).toLowerCase()}${RULE_INFO[g.rule].about.slice(1)}`} />
          <Info icon="military-tech" text={g.rated ? "Có tính điểm ELO" : "Giao hữu, không tính điểm"} />
          <Info icon="person-outline" text={sideText} />
          {g.status === "challenge" ? <Info icon="hourglass-top" text={`Hết hạn sau ${countdownText(leftMs)}`} /> : null}
        </View>
        {g.status === "challenge" ? (
          incoming ? (
            <View style={s.actions}>
              <Button title="Nhận lời" icon="check" style={{ flex: 1 }} busy={busy === "accept"} disabled={busy != null} onPress={() => answer("accept")} />
              <Button title="Từ chối" icon="close" kind="secondary" style={{ flex: 1 }} busy={busy === "decline"} disabled={busy != null} onPress={() => answer("decline")} />
            </View>
          ) : (
            <Button title="Hủy lời thách đấu" icon="close" kind="danger" busy={busy === "cancel"} onPress={() => answer("cancel")} />
          )
        ) : (
          <Button title="Về trang caro" kind="secondary" onPress={closeGame} />
        )}
      </ScrollView>
    </View>
  );
}

function Info({ icon, text }: { icon: ComponentProps<typeof Icon>["name"]; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 6 }}>
      <Icon name={icon} size={20} color={c.accent} />
      <Text style={{ flex: 1, color: c.text2, fontSize: 14.5, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1, alignItems: "center", justifyContent: "center" },
    body: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 6, paddingTop: 4, gap: 10 },
    players: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
    center: { width: 52, alignItems: "center" },
    vs: { color: c.muted, fontSize: 17, fontWeight: "900" },
    status: { fontSize: 16, fontWeight: "800", textAlign: "center", marginTop: 2 },
    muted: { color: c.muted, fontSize: 13, textAlign: "center", paddingHorizontal: 12 },
    actions: { flexDirection: "row", gap: 10, paddingHorizontal: 8 },
    foot: { color: c.muted, fontSize: 13, textAlign: "center", marginTop: 2 },
    vsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 10 },
    vsSide: { alignItems: "center", gap: 8, width: 110 },
    vsName: { color: c.text, fontSize: 15, fontWeight: "700" },
    vsText: { color: c.muted, fontSize: 18, fontWeight: "900" },
    challengeStatus: { color: c.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
    infoCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 8 },
  });
