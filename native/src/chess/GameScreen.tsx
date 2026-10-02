import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { shareGame } from "../social/store";
import { hideToast, leaveGame, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, confirm, Icon, IconButton, useStyles } from "../ui";
import { AnalysisPanel, EvalBar, EvalGraph, ReviewCoach } from "./Analysis";
import { Board, PieceImage } from "./Board";
import { clockText, material, MOVE_CLASS, myColor, NOTABLE, opponentColor, outcomeFor, reasonText, replay, resultTitle, tcLabel } from "./format";
import { SideAvatar, useNow, useSide } from "./parts";
import { loadPrefs, usePrefs } from "./prefs";
import { PrefsSheet } from "./Sheets";
import { playSound, preloadSounds, soundForSan } from "./sound";
import { abort, answerChallenge, closeGame, draw, loadGameFresh, playMove, rematch, resign, useChess } from "./store";
import type { ChessGame, Color } from "./types";

// Màn hình một ván cờ: bàn cờ, đồng hồ hai bên, danh sách nước đi, mời hòa / đầu hàng, kết quả.

export function GameScreen({ id }: { id: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const g = useChess((st) => st.games[id]);

  // Đã mở ván: ẩn thông báo nhỏ về chính ván này
  useEffect(() => {
    if (useStore.getState().toast?.chessGameId === id) hideToast();
  }, [id]);

  if (!g) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header title="Cờ vua" />
        <View style={s.fill}>
          <ActivityIndicator color={c.accent} />
        </View>
      </View>
    );
  }
  if (g.status !== "active" && g.status !== "finished" && g.status !== "aborted") return <ChallengeView g={g} />;
  return <Game g={g} />;
}

function Header({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={s.header}>
      <IconButton name="arrow-back" label="Quay lại" onPress={leaveGame} color={c.text} />
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={s.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const modeText = (g: ChessGame) => `${tcLabel(g)} · ${g.bot ? "Chơi với máy" : g.rated ? "Tính điểm ELO" : "Giao hữu"}`;

/* =========================================================
   Ván cờ
   ========================================================= */

function Game({ g }: { g: ChessGame }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const meId = useStore((st) => st.me?.id ?? 0);
  const receivedAt = useChess((st) => st.receivedAt[g.id] || Date.now());
  const sending = useChess((st) => Boolean(st.sending[g.id]));
  const [flip, setFlip] = useState(false);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [bestView, setBestView] = useState(false);
  const prefs = usePrefs();
  const analysis = useChess((st) => st.analyses[g.id]);
  const result = analysis?.status === "done" ? analysis.result : undefined;

  useEffect(() => {
    loadPrefs();
    preloadSounds();
  }, []);

  const mine = myColor(g, meId);
  const appActive = useStore((st) => st.appActive);
  // Người xem ván của người khác không nhận realtime: hỏi lại máy chủ mỗi 3 giây khi ván còn đang chơi
  useEffect(() => {
    if (mine || g.status !== "active" || !appActive) return;
    const t = setInterval(() => loadGameFresh(g.id), 3000);
    return () => clearInterval(t);
  }, [mine, g.status, g.id, appActive]);
  const bottom: Color = flip ? opponentColor(mine ?? "w") : (mine ?? "w");
  const top = opponentColor(bottom);
  const active = g.status === "active";
  const running = active && (g.clocks != null || g.firstMoveDeadline != null);
  const now = useNow(running, 200);
  const elapsed = Math.max(0, now - receivedAt);

  const { san, fens } = useMemo(() => replay(g.moves), [g.moves]);
  const total = g.moves.length;
  const ply = viewPly == null ? total : Math.min(viewPly, total);
  const live = ply === total;
  // Xem lại ván đã phân tích (kiểu "Game Review"): thanh đánh giá, huy hiệu trên ô, nhận xét từng nước
  const review = !active && result && Array.isArray(result.moves) ? result : undefined;
  const reviewMove = review && ply > 0 ? review.moves[ply - 1] : undefined;
  const beforePos = review && ply > 0 ? review.positions[ply - 1] : undefined;
  // "Xem nước tốt nhất": thế cờ trước nước vừa đi, mũi tên nước máy chọn
  const showBest = Boolean(bestView && reviewMove && beforePos?.best && beforePos.best !== reviewMove.uci);
  const fen = showBest ? fens[ply - 1] : live ? g.fen : fens[ply] || g.fen;
  const lastMove = !showBest && ply > 0 ? g.moves[ply - 1] : null;
  const movable = live && active && mine && g.turn === mine && !sending ? mine : null;
  const mat = useMemo(() => material(fen), [fen]);
  useEffect(() => setBestView(false), [ply]);

  // Cỡ bàn cờ: vừa chiều ngang, chừa chỗ cho hai thanh người chơi và nút bên dưới (và thanh đánh giá khi xem lại)
  const size = Math.floor(Math.min(width - (review ? 18 : 0), 560, Math.max(240, height - insets.top - insets.bottom - 300)) / 8) * 8;

  // Tự cuộn danh sách nước đi tới nước mới nhất; khi xem lại thì tới nước đang xem
  const movesRef = useRef<ScrollView>(null);
  const moveX = useRef<Record<number, number>>({});
  useEffect(() => {
    if (live) setTimeout(() => movesRef.current?.scrollToEnd({ animated: true }), 50);
    else if (ply > 0 && moveX.current[ply] != null) movesRef.current?.scrollTo({ x: Math.max(0, moveX.current[ply] - 120), animated: true });
  }, [total, live, ply]);

  // Còn 10 giây: tiếng tích tắc (một lần mỗi ván)
  const myMs = mine && g.clocks ? Math.max(0, g.clocks[mine] - (g.turn === mine && g.moves.length >= 2 ? elapsed : 0)) : null;
  const lowWarned = useRef(false);
  useEffect(() => {
    if (!active || !mine || g.turn !== mine || g.base < 30000 || myMs == null || myMs <= 0 || myMs > 10000 || lowWarned.current) return;
    lowWarned.current = true;
    playSound("lowtime");
  }, [active, mine, g.turn, g.base, myMs]);

  // Âm thanh: mỗi khi bàn cờ tiến thêm đúng một nước (đi quân, đối thủ đi, xem lại từng nước)
  const lastPly = useRef(ply);
  useEffect(() => {
    const before = lastPly.current;
    lastPly.current = ply;
    if (ply === before + 1) {
      // Nước của mình và của đối thủ có tiếng khác nhau (người xem: Trắng là "mình")
      const mover = ply % 2 === 1 ? "w" : "b";
      playSound(soundForSan(san[ply - 1], mine ? mover === mine : mover === "w"));
    }
  }, [ply, san, mine]);
  // Bắt đầu / kết thúc ván
  const lastStatus = useRef(g.status);
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = g.status;
    if (before === "active" && g.status !== "active") playSound("end");
  }, [g.status]);
  useEffect(() => {
    // Chỉ khi vừa mở ván; chờ đọc xong tùy chọn (có thể đã tắt âm thanh)
    if (g.status === "active" && g.moves.length === 0) loadPrefs().then(() => playSound("start"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tự chạy lại ván: mỗi giây một nước, tới nước cuối thì dừng
  useEffect(() => {
    if (!playing) return;
    if (ply >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setViewPly(ply + 1 >= total ? null : ply + 1), 1000);
    return () => clearTimeout(t);
  }, [playing, ply, total]);
  const jump = (p: number | null) => {
    setPlaying(false);
    setViewPly(p == null || p >= total ? null : p);
  };

  const opp = useSide(g, mine ? opponentColor(mine) : "b");
  const white = useSide(g, "w");
  // Người xem ván được chia sẻ: tiêu đề là tên hai bên
  const title = mine ? `Với ${opp.name}` : `${white.name} vs ${opp.name}`;

  // Trình đọc màn hình: báo nước đối thủ vừa đi
  const lastTotal = useRef(total);
  useEffect(() => {
    const before = lastTotal.current;
    lastTotal.current = total;
    if (total > before && active && mine && g.turn === mine && san[total - 1]) {
      AccessibilityInfo.announceForAccessibility(`${opp.name} đi ${san[total - 1]}. Đến lượt bạn.`);
    }
  }, [total, active, mine, g.turn, san, opp.name]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const canAbort = active && mine && total < 2;
  const offerFromOpp = active && mine && g.drawOffer === opponentColor(mine);
  const offerFromMe = active && mine && g.drawOffer === mine;
  const firstLeft = g.firstMoveDeadline ? g.firstMoveDeadline - g.serverNow - elapsed : null;

  let status = "";
  if (active) {
    if (firstLeft != null && firstLeft > 0) {
      const who = g.turn === mine ? "Bạn" : g.turn === "w" ? "Bên Trắng" : "Bên Đen";
      status = `${who} cần đi nước đầu trong ${Math.ceil(firstLeft / 1000)} giây, không thì ván bị hủy.`;
    } else if (g.turn === mine) status = sending ? "Đang gửi nước đi…" : "Đến lượt bạn.";
    else if (g.bot && g.botColor === g.turn) status = `${g.bot.name} đang nghĩ…`;
    else if (mine) status = `Chờ ${opp.name} đi…`;
    else status = g.turn === "w" ? "Trắng đi." : "Đen đi.";
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header
        title={title}
        sub={modeText(g)}
        right={
          <>
            {!active || total > 0 ? <IconButton name="ios-share" label="Chia sẻ ván cờ" onPress={() => shareGame(g)} color={c.text2} /> : null}
            <IconButton name="tune" label="Tùy chọn bàn cờ" onPress={() => setPrefsOpen(true)} color={c.text2} />
            <IconButton name="swap-vert" label="Xoay bàn cờ" onPress={() => setFlip((v) => !v)} color={c.text2} />
          </>
        }
      />

      <PlayerBar g={g} color={top} elapsed={elapsed} captured={mat.captured[top]} lead={mat.lead[top]} />
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 4 }}>
        {review ? <EvalBar pos={showBest ? beforePos : review.positions[ply]} height={size} orientation={bottom} /> : null}
        <Board
          fen={fen}
          size={size}
          orientation={bottom}
          movable={movable}
          lastMove={lastMove}
          onMove={(uci) => playMove(g.id, uci)}
          onIllegal={() => playSound("illegal")}
          hints={prefs.hints}
          showLast={prefs.lastMove}
          coords={prefs.coords}
          animate={prefs.anim}
          arrow={review && prefs.arrows ? (showBest ? beforePos?.best : ply < total ? review.positions[ply]?.best : null) : null}
          badge={showBest && beforePos?.best ? { sq: beforePos.best.slice(2, 4), cls: "best" } : reviewMove ? { sq: reviewMove.uci.slice(2, 4), cls: reviewMove.cls } : null}
        />
      </View>
      <PlayerBar g={g} color={bottom} elapsed={elapsed} captured={mat.captured[bottom]} lead={mat.lead[bottom]} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}>
        {/* Danh sách nước đi + nút xem lại */}
        <View style={s.movesRow}>
          <IconButton name="first-page" label="Về đầu ván" onPress={() => jump(0)} disabled={ply === 0} size={22} />
          <IconButton name="chevron-left" label="Nước trước" onPress={() => jump(Math.max(0, ply - 1))} disabled={ply === 0} size={24} />
          <ScrollView ref={movesRef} horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={s.moves}>
            {san.length === 0 ? <Text style={s.muted}>Chưa có nước đi nào</Text> : null}
            {san.map((m, i) => {
              const cls = result?.moves[i]?.cls;
              const mark = cls && NOTABLE.has(cls) ? MOVE_CLASS[cls] : null;
              return (
                <View
                  key={i}
                  style={s.moveItem}
                  onLayout={(e) => {
                    moveX.current[i + 1] = e.nativeEvent.layout.x;
                  }}
                >
                  {i % 2 === 0 ? <Text style={s.moveNo}>{i / 2 + 1}.</Text> : null}
                  <Pressable
                    onPress={() => jump(i + 1)}
                    style={[s.move, ply === i + 1 && { backgroundColor: c.jadeWash }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Xem nước ${m}${cls ? `, ${MOVE_CLASS[cls].label}` : ""}`}
                  >
                    <Text style={[s.moveText, ply === i + 1 && { color: c.accent }, mark && { color: mark.color }]}>
                      {m}
                      {mark ? mark.symbol : ""}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          <IconButton name="chevron-right" label="Nước sau" onPress={() => jump(ply + 1)} disabled={live} size={24} />
          <IconButton name="last-page" label="Nước mới nhất" onPress={() => jump(null)} disabled={live} size={22} />
        </View>

        <View style={s.body}>
          {review ? (
            <>
              <ReviewCoach r={review} ply={ply} total={total} onJump={(p) => jump(p)} bestView={showBest} onToggleBest={() => setBestView((v) => !v)} />
              <EvalGraph r={review} ply={ply} onJump={(p) => jump(p)} />
            </>
          ) : null}
          {!live && active ? (
            <Pressable onPress={() => jump(null)} style={[s.banner, { backgroundColor: c.turmericWash }]} accessibilityRole="button">
              <Icon name="history" size={18} color={c.text2} />
              <Text style={s.bannerText}>
                Đang xem lại nước {ply}/{total}. <Text style={{ color: c.accent, fontWeight: "800" }}>Về thế cờ hiện tại</Text>
              </Text>
            </Pressable>
          ) : null}

          {status ? (
            <Text style={[s.status, g.turn === mine && { color: c.accent }]} accessibilityLiveRegion="polite">
              {status}
            </Text>
          ) : null}

          {offerFromOpp ? (
            <View style={[s.offer, { backgroundColor: c.jadeWash }]}>
              <Icon name="handshake" size={22} color={c.accent} />
              <Text style={[s.bannerText, { color: c.text }]}>{opp.name} mời bạn hòa.</Text>
              <Button title="Hòa" small busy={busy === "accept"} onPress={() => run("accept", () => draw(g.id, "accept"))} />
              <Button title="Không" small kind="secondary" busy={busy === "decline"} onPress={() => run("decline", () => draw(g.id, "decline"))} />
            </View>
          ) : offerFromMe ? (
            <Text style={s.muted}>Bạn đã mời hòa, chờ {opp.name} trả lời.</Text>
          ) : null}

          {!active ? <Result g={g} mine={mine} /> : null}

          {!active && total > 0 ? (
            <View style={s.actions}>
              <Button
                title={playing ? "Dừng" : ply >= total ? "Xem lại từ đầu" : "Tự chạy tiếp"}
                icon={playing ? "pause" : "play-arrow"}
                kind="secondary"
                small
                style={{ flex: 1 }}
                onPress={() => {
                  if (playing) {
                    setPlaying(false);
                    return;
                  }
                  if (ply >= total) setViewPly(0);
                  setPlaying(true);
                }}
              />
              <Text style={[s.muted, { alignSelf: "center" }]}>
                Nước {ply}/{total}
              </Text>
            </View>
          ) : null}

          {!active ? <AnalysisPanel g={g} ply={ply} onJump={(p) => jump(p)} viewer={!mine} /> : null}

          {active && mine ? (
            <View style={s.actions}>
              {!g.bot && !canAbort ? (
                <Button
                  title="Mời hòa"
                  icon="handshake"
                  kind="secondary"
                  small
                  style={{ flex: 1 }}
                  disabled={Boolean(offerFromMe) || Boolean(offerFromOpp)}
                  busy={busy === "offer"}
                  onPress={async () => {
                    if (await confirm("Mời hòa?", `Gửi lời mời hòa tới ${opp.name}.`, "Mời hòa", false)) run("offer", () => draw(g.id, "offer"));
                  }}
                />
              ) : null}
              {canAbort ? (
                <Button
                  title="Hủy ván"
                  icon="close"
                  kind="danger"
                  small
                  style={{ flex: 1 }}
                  busy={busy === "abort"}
                  onPress={async () => {
                    if (await confirm("Hủy ván cờ?", "Chưa ai mất điểm vì ván chưa bắt đầu.", "Hủy ván")) run("abort", () => abort(g.id));
                  }}
                />
              ) : (
                <Button
                  title="Đầu hàng"
                  icon="flag"
                  kind="danger"
                  small
                  style={{ flex: 1 }}
                  busy={busy === "resign"}
                  onPress={async () => {
                    if (await confirm("Đầu hàng?", g.rated ? "Bạn sẽ thua ván này và bị trừ điểm ELO." : "Bạn sẽ thua ván này.", "Đầu hàng"))
                      run("resign", () => resign(g.id));
                  }}
                />
              )}
            </View>
          ) : null}

          {!active && mine ? (
            <View style={s.actions}>
              <Button
                title={g.bot ? "Chơi lại" : "Đấu lại"}
                icon="replay"
                small
                style={{ flex: 1 }}
                busy={busy === "rematch"}
                onPress={() => run("rematch", () => rematch(g.id))}
              />
              <Button title="Về danh sách" icon="grid-view" kind="secondary" small style={{ flex: 1 }} onPress={closeGame} />
            </View>
          ) : null}
        </View>
      </ScrollView>
      <PrefsSheet visible={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </View>
  );
}

/* ---------------- Thanh người chơi: ảnh, tên, điểm, quân đã ăn, đồng hồ ---------------- */

function PlayerBar({ g, color, elapsed, captured, lead }: { g: ChessGame; color: Color; elapsed: number; captured: string[]; lead: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const side = useSide(g, color);
  const meId = useStore((st) => st.me?.id ?? 0);
  const active = g.status === "active";
  const turn = active && g.turn === color;
  const ticking = turn && g.clocks != null && g.moves.length >= 2;
  const ms = g.clocks ? Math.max(0, g.clocks[color] - (ticking ? elapsed : 0)) : null;
  const low = ms != null && ms < 20000 && g.base >= 60000;
  const rating = g.status === "finished" && g.rated ? g.ratings[color] : g.live[color];
  const delta = g.deltas[color];
  const isMe = side.uid === meId && !side.isBot;

  return (
    <View style={s.player}>
      <SideAvatar g={g} color={color} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.nameRow}>
          <Text style={s.playerName} numberOfLines={1}>
            {side.name}
            {isMe ? " (bạn)" : ""}
          </Text>
          {rating != null ? <Text style={s.rating}>{side.isBot ? `~${rating}` : rating}</Text> : null}
          {delta != null ? (
            <Text style={[s.delta, { color: delta >= 0 ? c.accent : c.danger }]}>{delta >= 0 ? `+${delta}` : delta}</Text>
          ) : null}
        </View>
        <View style={s.captured}>
          {captured.map((p, i) => (
            <View key={i} style={{ marginRight: -5 }}>
              <PieceImage code={p} size={17} />
            </View>
          ))}
          {lead > 0 ? <Text style={s.lead}>+{lead}</Text> : null}
          {captured.length === 0 && lead === 0 ? <Text style={s.lead}> </Text> : null}
        </View>
      </View>
      {ms != null ? (
        <View
          style={[
            s.clock,
            { backgroundColor: turn ? (low ? c.danger : c.text) : c.field },
          ]}
          accessibilityLabel={`Đồng hồ ${side.name}: ${clockText(ms)}`}
        >
          {turn ? <View style={[s.tick, { backgroundColor: low ? "#fff" : c.online }]} /> : null}
          <Text style={[s.clockText, { color: turn ? c.bg : c.text2 }]}>{clockText(ms)}</Text>
        </View>
      ) : turn ? (
        <View style={[s.turnDot, { backgroundColor: c.online }]} accessibilityLabel="Đang tới lượt" />
      ) : null}
    </View>
  );
}

/* ---------------- Kết quả ---------------- */

function Result({ g, mine }: { g: ChessGame; mine: Color | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const o = outcomeFor(g, mine);
  const tint = o === "win" ? c.accent : o === "loss" ? c.danger : c.text2;
  const delta = mine ? g.deltas[mine] : null;
  return (
    <View style={[s.result, { backgroundColor: o === "win" ? c.jadeWash : o === "loss" ? c.dangerWash : c.field }]} accessibilityLiveRegion="polite">
      <Icon
        name={o === "loss" ? "sentiment-dissatisfied" : o === "draw" ? "handshake" : o === "aborted" ? "block" : "emoji-events"}
        size={30}
        color={tint}
      />
      <View style={{ flex: 1 }}>
        <Text style={[s.resultTitle, { color: tint }]}>{resultTitle(g, mine)}</Text>
        <Text style={s.resultSub}>
          {g.result && g.result !== "1/2-1/2" ? `${g.result === "1-0" ? "Trắng" : "Đen"} thắng do ${reasonText(g.reason)}` : reasonText(g.reason)}
          {g.result ? ` · ${g.result.replace("1/2", "½").replace("1/2", "½")}` : ""}
        </Text>
      </View>
      {delta != null ? (
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.resultDelta, { color: delta >= 0 ? c.accent : c.danger }]}>{delta >= 0 ? `+${delta}` : delta}</Text>
          <Text style={s.muted}>ELO {mine && g.ratings[mine] != null ? (g.ratings[mine] as number) + delta : ""}</Text>
        </View>
      ) : null}
    </View>
  );
}

/* =========================================================
   Lời thách đấu (chưa bắt đầu)
   ========================================================= */

function ChallengeView({ g }: { g: ChessGame }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const meId = useStore((st) => st.me?.id ?? 0);
  const users = useStore((st) => st.users);
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow(g.status === "challenge", 1000);
  const challenger = g.challengerId != null ? users[g.challengerId] : undefined;
  const opponent = g.opponentId != null ? users[g.opponentId] : undefined;
  const incoming = g.opponentId === meId;
  const left = g.expiresAt ? g.expiresAt - g.serverNow - (now - (useChess.getState().receivedAt[g.id] || now)) : 0;

  const colorText =
    g.colorPref === "random"
      ? "Màu quân chọn ngẫu nhiên"
      : (g.colorPref === "white") === !incoming
        ? "Bạn cầm quân Trắng"
        : "Bạn cầm quân Đen";

  const statusText =
    g.status === "declined"
      ? "Lời thách đấu đã bị từ chối."
      : g.status === "cancelled"
        ? "Lời thách đấu đã được hủy."
        : g.status === "expired"
          ? "Lời thách đấu đã hết hạn."
          : incoming
            ? `${challenger?.displayName || "Ai đó"} thách bạn một ván cờ.`
            : `Đang chờ ${opponent?.displayName || "đối thủ"} nhận lời…`;

  async function answer(action: "accept" | "decline" | "cancel") {
    setBusy(action);
    try {
      await answerChallenge(g.id, action);
      if (action !== "accept") closeGame();
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header title="Lời thách đấu" sub={modeText(g)} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 20 }}>
        <View style={s.vs}>
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
        <Text style={s.challengeStatus}>{statusText}</Text>
        <View style={[s.infoCard, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Info icon="timer" text={g.base ? `${tcLabel(g)}: mỗi bên ${Math.round(g.base / 60000)} phút, cộng ${Math.round(g.inc / 1000)} giây mỗi nước` : "Không giới hạn thời gian"} />
          <Info icon="military-tech" text={g.rated ? "Có tính điểm ELO" : "Giao hữu, không tính điểm"} />
          <Info icon="palette" text={colorText} />
          {g.status === "challenge" ? <Info icon="hourglass-top" text={`Hết hạn sau ${clockText(Math.max(0, left))}`} /> : null}
        </View>
        {g.status === "challenge" ? (
          incoming ? (
            <View style={s.actions}>
              <Button title="Nhận lời" icon="check" style={{ flex: 1 }} busy={busy === "accept"} onPress={() => answer("accept")} />
              <Button title="Từ chối" icon="close" kind="secondary" style={{ flex: 1 }} busy={busy === "decline"} onPress={() => answer("decline")} />
            </View>
          ) : (
            <Button title="Hủy lời thách đấu" icon="close" kind="danger" busy={busy === "cancel"} onPress={() => answer("cancel")} />
          )
        ) : (
          <Button title="Về danh sách" kind="secondary" onPress={closeGame} />
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
      <Text style={{ flex: 1, color: c.text2, fontSize: 14.5 }}>{text}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 },
    title: { color: c.text, fontSize: 17, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5 },
    player: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    playerName: { color: c.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
    rating: { color: c.muted, fontSize: 13, fontWeight: "700" },
    delta: { fontSize: 13, fontWeight: "800" },
    captured: { flexDirection: "row", alignItems: "center", height: 18, marginTop: 1 },
    lead: { color: c.muted, fontSize: 12, fontWeight: "700", marginLeft: 8 },
    clock: { minWidth: 86, height: 40, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
    tick: { width: 7, height: 7, borderRadius: 4 },
    clockText: { fontSize: 21, fontWeight: "800", fontVariant: ["tabular-nums"] },
    turnDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
    movesRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.line, backgroundColor: c.surface },
    moves: { alignItems: "center", paddingHorizontal: 4, gap: 2 },
    moveItem: { flexDirection: "row", alignItems: "center" },
    moveNo: { color: c.muted, fontSize: 13, marginLeft: 6, marginRight: 2 },
    move: { paddingHorizontal: 6, paddingVertical: 5, borderRadius: 6 },
    moveText: { color: c.text, fontSize: 14.5, fontWeight: "700" },
    body: { padding: 14, gap: 12 },
    banner: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12 },
    bannerText: { flex: 1, color: c.text2, fontSize: 13.5, lineHeight: 19 },
    status: { color: c.text2, fontSize: 15, fontWeight: "700", textAlign: "center" },
    offer: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12 },
    actions: { flexDirection: "row", gap: 10 },
    muted: { color: c.muted, fontSize: 13, textAlign: "center" },
    result: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16 },
    resultTitle: { fontSize: 20, fontWeight: "800" },
    resultSub: { color: c.text2, fontSize: 13.5, marginTop: 2 },
    resultDelta: { fontSize: 22, fontWeight: "800" },
    vs: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 10 },
    vsSide: { alignItems: "center", gap: 8, width: 110 },
    vsName: { color: c.text, fontSize: 15, fontWeight: "700" },
    vsText: { color: c.muted, fontSize: 18, fontWeight: "900" },
    challengeStatus: { color: c.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
    infoCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 8 },
  });
