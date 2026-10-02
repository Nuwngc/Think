import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { leaveCaroBot, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, confirm, Icon, IconButton, useStyles } from "../ui";
import { Board } from "./Board";
import { cellName, fromMoves } from "./engine";
import { LEVEL_INFO, markName, otherSide, ruleLabel, sideNum } from "./format";
import { ActionButton, BotAvatar, Header, PlayerCard, ResultCard, SoundButton, useEndEffects, useMoveSounds } from "./parts";
import { BotSheet, RulesSheet } from "./Sheets";
import { holdCaroSounds, playCaro } from "./sound";
import { botStatsOf, canUndo, isMyBotTurn, playBot, swapBot, undoBot, useCaro } from "./store";

// Chơi cờ caro với máy: chạy hẳn trên điện thoại, không cần mạng. Ván được lưu, thoát ra vào lại chơi tiếp.

const EMPTY = fromMoves([]);

export function BotGame() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const g = useCaro((st) => st.bot);
  const thinking = useCaro((st) => st.thinking);
  const me = useStore((st) => st.me);
  const allStats = useCaro((st) => st.stats);
  const stats = botStatsOf({ stats: allStats }, me?.id ?? null);
  const [ghost, setGhost] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => holdCaroSounds(), []); // rời màn: trả lại luồng âm thanh cho máy

  const st = useMemo(() => (g ? fromMoves(g.moves, g.rule) : null), [g]);
  const n = g?.moves.length ?? 0;
  const over = Boolean(g && (g.result || st?.winner));
  const myTurn = Boolean(g && !over && !thinking && isMyBotTurn(g));

  useEffect(() => setGhost(null), [n, myTurn, g?.id]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // Ván mới: tiếng bắt đầu
  const lastId = useRef<number | null>(null);
  useEffect(() => {
    if (!g) return;
    const before = lastId.current;
    lastId.current = g.id;
    if (g.id !== before && g.moves.length === 0) playCaro("start", 0.8);
  }, [g]);

  useMoveSounds(st ?? EMPTY, g?.side ?? null, {
    active: !over,
    announce: (i) => (g && st && st.board[i] !== sideNum(g.side) && !st.winner ? `Máy đi ${cellName(i)}. Tới lượt bạn.` : null),
  });
  const result = g?.result ?? null;
  const confetti = useEndEffects(result, g?.side ?? null, result === "win" ? "Bạn thắng!" : result === "loss" ? "Máy thắng." : result === "draw" ? "Hòa, kín bàn." : undefined);

  // Hàm cho bàn cờ giữ nguyên giữa các lần vẽ
  const overRef = useRef(over);
  overRef.current = over;
  const onPlace = useCallback((i: number) => {
    setGhost(null);
    playBot(i);
  }, []);
  const onBlocked = useCallback((_: number, why: "occupied" | "turn") => {
    if (overRef.current) return;
    playCaro("invalid", 0.6);
    setFlash(why === "occupied" ? "Ô này đã có quân" : "Máy đang nghĩ, chờ chút nhé");
  }, []);

  if (!g || !st) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header title="Chơi với máy" onBack={leaveCaroBot} />
        <View style={s.fill}>
          <ActivityIndicator color={c.accent} />
        </View>
      </View>
    );
  }

  const level = LEVEL_INFO[g.level];
  const mine = g.side;
  const botSide = otherSide(mine);
  const turn = st.moves.length % 2 === 0 ? "x" : "o";
  const record = stats[g.level];
  const size = Math.min(width - 12, 560, Math.max(250, height - insets.top - insets.bottom - 290));
  const last = n ? g.moves[n - 1] : null;

  let status = "";
  let statusColor = c.text2;
  if (!over) {
    if (flash) {
      status = flash;
      statusColor = c.danger;
    } else if (thinking || turn !== mine) status = "Máy đang nghĩ…";
    else if (ghost != null && !st.board[ghost]) {
      status = `Chạm lần nữa vào ${cellName(ghost)} để đánh`;
      statusColor = c.scheme === "dark" ? "#F2C04E" : "#8A5A00";
    } else {
      status = n === 0 ? "Tới lượt bạn: đi nước đầu tiên" : "Tới lượt bạn";
      statusColor = c.accent;
    }
  }

  const boardLabel = `Bàn cờ caro 15 × 15, chơi với máy ${level.label.toLowerCase()}. Bạn cầm ${markName(mine)}. ${n} nước${last != null ? `, nước vừa đi ${cellName(last)}` : ""}. ${status}`;

  const swap = async () => {
    const inProgress = !g.result && g.moves.length >= 2;
    if (inProgress && !(await confirm("Đổi bên?", "Bỏ ván này và chơi ván mới, đổi bên với máy.", "Đổi bên", false))) return;
    swapBot();
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header
        title="Chơi với máy"
        sub={`Máy ${level.label.toLowerCase()} · ${ruleLabel(g.rule)} · Bạn cầm ${markName(mine)}`}
        onBack={leaveCaroBot}
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
            side={mine}
            avatar={me ? <Avatar user={me} size={36} dot={false} /> : <GuestAvatar />}
            name="Bạn"
            sub={mine === "x" ? "Đi trước" : "Đi sau"}
            turn={!over && turn === mine}
          />
          <View style={s.center}>
            <Text style={s.vs}>{over && result === "draw" ? "HÒA" : "VS"}</Text>
          </View>
          <PlayerCard side={botSide} right avatar={<BotAvatar size={36} />} name="Máy" sub={`Mức ${level.label.toLowerCase()}`} turn={!over && turn === botSide} />
        </View>
        <View style={{ height: 5 }} />

        <Board
          board={st.board}
          size={size}
          last={last}
          line={st.line}
          playable={myTurn}
          mine={mine}
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

        {over ? (
          <ResultCard
            outcome={result === "win" ? "win" : result === "loss" ? "loss" : "draw"}
            title={result === "win" ? "Bạn thắng!" : result === "loss" ? "Máy thắng" : "Hòa"}
            reason={result === "draw" ? "Kín bàn, không ai có 5 quân liền" : `${result === "win" ? "Bạn" : "Máy"} có 5 quân liền · ${n} nước`}
          />
        ) : null}

        <View style={s.actions}>
          <ActionButton
            icon="undo"
            title="Đi lại"
            disabled={!canUndo(g)}
            onPress={() => {
              if (undoBot()) playCaro(mine === "x" ? "place-x" : "place-o", 0.3);
            }}
          />
          <ActionButton icon="replay" title="Ván mới" kind={over ? "primary" : "plain"} onPress={() => setSheet(true)} />
          <ActionButton icon="swap-horiz" title="Đổi bên" onPress={swap} />
        </View>
        <Text style={s.foot}>
          Với máy <Text style={{ fontWeight: "800", color: level.color }}>{level.label.toLowerCase()}</Text>: {record.win} thắng · {record.loss} thua
          {record.draw ? ` · ${record.draw} hòa` : ""} · {n} nước
        </Text>
      </ScrollView>
      <BotSheet visible={sheet} onClose={() => setSheet(false)} onStarted={() => undefined} />
      <RulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />
    </View>
  );
}

/** Chưa đăng nhập: ảnh chung */
function GuestAvatar() {
  const c = useColors();
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.jade, alignItems: "center", justifyContent: "center" }}>
      <Icon name="person" size={22} color="#fff" />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1, alignItems: "center", justifyContent: "center" },
    body: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 6, paddingTop: 4, gap: 10 },
    players: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
    center: { width: 44, alignItems: "center" },
    vs: { color: c.muted, fontSize: 17, fontWeight: "900" },
    status: { fontSize: 16, fontWeight: "800", textAlign: "center", marginTop: 2 },
    actions: { flexDirection: "row", gap: 8, paddingHorizontal: 8 },
    foot: { color: c.muted, fontSize: 13, textAlign: "center", marginTop: 2 },
  });
