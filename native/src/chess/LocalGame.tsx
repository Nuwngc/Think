import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors, type Colors } from "../theme";
import { Button, confirm, Icon, IconButton, useStyles } from "../ui";
import { Board, PieceImage } from "./Board";
import { material, opponentColor } from "./format";
import { localState, localStatusText } from "./local";
import { usePrefs } from "./prefs";
import { PrefsSheet } from "./Sheets";
import { holdSounds, playSound, soundForSan } from "./sound";
import { closeLocal } from "./store";
import type { Color } from "./types";

// Hai người một máy: hai bạn ngồi cạnh nhau, đưa máy cho nhau sau mỗi nước. Chơi được khi mất mạng, không tính điểm.
// Ván lưu trên máy (AsyncStorage), thoát ra vào lại vẫn chơi tiếp.

const KEY = "think.chess.local.v1";
type Saved = { moves: string[]; resigned: Color | null; autoFlip: boolean };

export function LocalGame() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const prefs = usePrefs();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [flip, setFlip] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  useEffect(() => holdSounds(), []);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        const v = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
        setSaved({
          moves: Array.isArray(v?.moves) ? v.moves.filter((m) => typeof m === "string") : [],
          resigned: v?.resigned === "w" || v?.resigned === "b" ? v.resigned : null,
          autoFlip: Boolean(v?.autoFlip),
        });
      })
      .catch(() => setSaved({ moves: [], resigned: null, autoFlip: false }));
  }, []);
  const save = (next: Saved) => {
    setSaved(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  };

  const st = useMemo(() => localState(saved?.moves || [], saved?.resigned || null), [saved?.moves, saved?.resigned]);
  const over = st.outcome != null;
  // Tự xoay: người đang tới lượt luôn ở phía dưới
  const bottom: Color = saved?.autoFlip && !over ? st.turn : flip ? "b" : "w";
  const top = opponentColor(bottom);
  const mat = material(st.fen);
  const total = st.moves.length;
  const size = Math.floor(Math.min(width, 560, Math.max(240, height - insets.top - insets.bottom - 300)) / 8) * 8;

  // Tiếng quân cờ khi ván tiến thêm một nước; tiếng kết thúc khi ván vừa xong (không kêu lúc mới mở lại ván cũ)
  const last = useRef<{ total: number; over: boolean } | null>(null);
  useEffect(() => {
    if (!saved) return;
    const before = last.current;
    last.current = { total, over };
    if (!before) return;
    if (total === before.total + 1) playSound(soundForSan(st.san[total - 1], total % 2 === 1));
    if (over && !before.over) playSound("end");
  }, [saved, total, over, st.san]);

  const movesRef = useRef<ScrollView>(null);
  useEffect(() => {
    setTimeout(() => movesRef.current?.scrollToEnd({ animated: true }), 50);
  }, [total]);

  if (!saved) return <View style={[s.root, { paddingTop: insets.top }]} />;

  const play = (uci: string) => {
    if (over) return;
    const next = localState([...st.moves, uci]);
    if (next.moves.length !== total + 1) return; // nước không hợp lệ
    save({ ...saved, moves: next.moves, resigned: null });
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <IconButton name="arrow-back" label="Quay lại" onPress={closeLocal} color={c.text} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Hai người một máy</Text>
          <Text style={s.sub} numberOfLines={1}>
            Không cần mạng · không tính điểm
          </Text>
        </View>
        <IconButton name="tune" label="Tùy chọn bàn cờ" onPress={() => setPrefsOpen(true)} color={c.text2} />
        <IconButton name="swap-vert" label="Xoay bàn cờ" onPress={() => setFlip((v) => !v)} color={c.text2} disabled={saved.autoFlip && !over} />
      </View>

      <Side color={top} turn={!over && st.turn === top} captured={mat.captured[top]} lead={mat.lead[top]} />
      <View style={{ alignItems: "center" }}>
        <Board
          fen={st.fen}
          size={size}
          orientation={bottom}
          movable={over ? null : st.turn}
          lastMove={total ? st.moves[total - 1] : null}
          onMove={play}
          onIllegal={() => playSound("illegal")}
          hints={prefs.hints}
          showLast={prefs.lastMove}
          coords={prefs.coords}
          animate={prefs.anim}
        />
      </View>
      <Side color={bottom} turn={!over && st.turn === bottom} captured={mat.captured[bottom]} lead={mat.lead[bottom]} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}>
        <ScrollView ref={movesRef} horizontal showsHorizontalScrollIndicator={false} style={s.movesRow} contentContainerStyle={s.moves}>
          {st.san.length === 0 ? <Text style={s.muted}>Trắng đi trước. Đưa máy cho nhau sau mỗi nước nhé!</Text> : null}
          {st.san.map((m, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center" }}>
              {i % 2 === 0 ? <Text style={s.moveNo}>{i / 2 + 1}.</Text> : null}
              <Text style={[s.moveText, i === total - 1 && { color: c.accent }]}>{m}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={s.body}>
          <Text style={[s.status, over && { color: c.accent, fontSize: 17 }]} accessibilityLiveRegion="polite">
            {localStatusText(st)}
          </Text>
          <View style={s.actions}>
            <Button
              title="Đi lại"
              icon="undo"
              kind="secondary"
              small
              style={{ flex: 1 }}
              disabled={total === 0 && !saved.resigned}
              onPress={() => save({ ...saved, moves: saved.resigned ? st.moves : st.moves.slice(0, -1), resigned: null })}
            />
            {over ? (
              <Button title="Ván mới" icon="replay" small style={{ flex: 1 }} onPress={() => save({ ...saved, moves: [], resigned: null })} />
            ) : (
              <Button
                title={`${st.turn === "w" ? "Trắng" : "Đen"} đầu hàng`}
                icon="flag"
                kind="danger"
                small
                style={{ flex: 1 }}
                disabled={total < 2}
                onPress={async () => {
                  if (await confirm("Đầu hàng?", `Bên ${st.turn === "w" ? "Trắng" : "Đen"} chịu thua ván này.`, "Đầu hàng"))
                    save({ ...saved, resigned: st.turn });
                }}
              />
            )}
          </View>
          {!over && total > 0 ? (
            <Button
              title="Ván mới"
              icon="restart-alt"
              kind="secondary"
              small
              onPress={async () => {
                if (await confirm("Bắt đầu ván mới?", "Ván đang chơi sẽ bị xóa.", "Ván mới")) save({ ...saved, moves: [], resigned: null });
              }}
            />
          ) : null}
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchTitle}>Tự xoay bàn cờ</Text>
              <Text style={s.muted}>Bên tới lượt luôn ngồi phía dưới, hợp khi đặt máy giữa hai người.</Text>
            </View>
            <Switch value={saved.autoFlip} onValueChange={(v) => save({ ...saved, autoFlip: v })} accessibilityLabel="Tự xoay bàn cờ" />
          </View>
        </View>
      </ScrollView>
      <PrefsSheet visible={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </View>
  );
}

function Side({ color, turn, captured, lead }: { color: Color; turn: boolean; captured: string[]; lead: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <View style={s.player}>
      <View style={[s.chip, { backgroundColor: color === "w" ? "#F4F4F0" : "#26302C", borderColor: c.line }]}>
        <Icon name="person" size={22} color={color === "w" ? "#26302C" : "#F4F4F0"} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.playerName}>{color === "w" ? "Trắng" : "Đen"}</Text>
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
      {turn ? <View style={[s.turnDot, { backgroundColor: c.online }]} accessibilityLabel="Đang tới lượt" /> : null}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 },
    title: { color: c.text, fontSize: 17, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5 },
    player: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
    chip: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
    playerName: { color: c.text, fontSize: 15, fontWeight: "700" },
    captured: { flexDirection: "row", alignItems: "center", height: 18, marginTop: 1 },
    lead: { color: c.muted, fontSize: 12, fontWeight: "700", marginLeft: 8 },
    turnDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
    movesRow: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.line, backgroundColor: c.surface },
    moves: { alignItems: "center", paddingHorizontal: 10, paddingVertical: 10, gap: 6 },
    moveNo: { color: c.muted, fontSize: 13, marginRight: 3 },
    moveText: { color: c.text, fontSize: 14.5, fontWeight: "700" },
    body: { padding: 14, gap: 12 },
    status: { color: c.text2, fontSize: 15, fontWeight: "700", textAlign: "center" },
    actions: { flexDirection: "row", gap: 10 },
    muted: { color: c.muted, fontSize: 13 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
    switchTitle: { color: c.text, fontSize: 15, fontWeight: "700" },
  });
