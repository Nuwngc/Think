import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "../api";
import { showToast } from "../store";
import { useColors, type Colors } from "../theme";
import { Button, confirm, FormError, IconButton, Sheet, useStyles } from "../ui";
import { EvalBar } from "./Analysis";
import { playAt, pvText } from "./analysisBoard";
import { Board } from "./Board";
import { evalSpeech, evalText, replay } from "./format";
import { movesFromPgn, pgnOf } from "./pgn";
import { usePrefs } from "./prefs";
import { PrefsSheet } from "./Sheets";
import { holdSounds, playSound, soundForSan } from "./sound";
import { closeAnalysis, useChess } from "./store";
import type { Color, EvalResult } from "./types";

// Bàn phân tích: đi quân cho cả hai bên, Stockfish trên máy chủ chấm từng thế cờ (POST /api/chess/eval):
// thanh đánh giá, mũi tên nước tốt nhất, 3 dòng nước hay nhất (chạm để đi). Bàn lưu trên máy, mở lại vẫn còn.

const KEY = "think.chess.analysis.v1";
type Saved = { moves: string[]; ply: number; bottom: Color; engine: boolean };
type Result = { eval?: EvalResult; opening?: { eco: string; name: string } | null; cached?: boolean; error?: string };

/** Kết quả đã chấm (dùng lại khi bấm qua lại các nước) */
const results = new Map<string, Result>();

export function AnalysisBoard() {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const prefs = usePrefs();
  const opened = useChess((st) => st.analysis);
  const [b, setB] = useState<Saved | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => holdSounds(), []);
  // Mở từ một ván: dùng ván đó; mở từ trang Cờ vua: đọc bàn đã lưu
  useEffect(() => {
    if (opened && opened.ply >= 0) {
      setB({ moves: opened.moves, ply: opened.ply, bottom: opened.bottom, engine: true });
      return;
    }
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        const v = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
        const moves = Array.isArray(v?.moves) ? v.moves.filter((m) => typeof m === "string").slice(0, 600) : [];
        setB({ moves, ply: Math.max(0, Math.min(moves.length, Number(v?.ply) || 0)), bottom: v?.bottom === "b" ? "b" : "w", engine: v?.engine !== false });
      })
      .catch(() => setB({ moves: [], ply: 0, bottom: "w", engine: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = (next: Saved) => {
    setB(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  };

  const { san, fens } = useMemo(() => replay(b?.moves || []), [b?.moves]);
  const ply = b ? Math.min(b.ply, san.length) : 0;
  const fen = fens[ply] || fens[0];
  const turn: Color = fen.split(" ")[1] === "b" ? "b" : "w";
  const key = (b?.moves || []).slice(0, ply).join(" ");
  const res = results.get(key);
  const ev = res?.eval;

  // Xin máy chủ chấm thế cờ đang xem (đợi 300 ms để bấm qua nhiều nước liền không gửi dồn)
  const busy = useRef<string | null>(null);
  useEffect(() => {
    if (!b || !b.engine || results.has(key)) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      if (busy.current) {
        retry = setTimeout(ask, 400);
        return;
      }
      busy.current = key;
      api
        .chessEval(b.moves.slice(0, ply))
        .then((r) => {
          results.set(key, r);
          if (results.size > 300) results.delete(results.keys().next().value as string);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 429) {
            busy.current = null;
            if (alive) retry = setTimeout(ask, 1500);
            return;
          }
          results.set(key, { error: err instanceof Error ? err.message : "Chưa phân tích được." });
        })
        .finally(() => {
          if (busy.current === key) busy.current = null;
          if (alive) setTick((t) => t + 1);
        });
    };
    const t = setTimeout(ask, 300);
    return () => {
      alive = false;
      clearTimeout(t);
      clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, b?.engine]);

  const movesRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (b && ply >= san.length) setTimeout(() => movesRef.current?.scrollToEnd({ animated: true }), 50);
  }, [b, ply, san.length]);

  if (!b) return <View style={[s.root, { paddingTop: insets.top }]} />;

  const go = (p: number) => save({ ...b, ply: Math.max(0, Math.min(b.moves.length, p)) });
  const play = (uci: string) => {
    const r = playAt(b.moves, ply, uci);
    if (!r) return;
    playSound(soundForSan(r.san, true));
    save({ ...b, moves: r.moves, ply: r.ply });
  };
  const over = ev?.end != null;
  const bar = 12;
  const size = Math.floor(Math.min(width - bar - 10, 560, Math.max(240, height - insets.top - insets.bottom - 330)) / 8) * 8;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <IconButton name="arrow-back" label="Quay lại" onPress={closeAnalysis} color={c.text} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Bàn phân tích</Text>
          <Text style={s.sub} numberOfLines={1}>
            {res?.opening ? `${res.opening.name} (${res.opening.eco})` : "Đi quân cho cả hai bên"}
          </Text>
        </View>
        <IconButton name="tune" label="Tùy chọn bàn cờ" onPress={() => setPrefsOpen(true)} color={c.text2} />
        <IconButton name="swap-vert" label="Xoay bàn cờ" onPress={() => save({ ...b, bottom: b.bottom === "w" ? "b" : "w" })} color={c.text2} />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 4 }}>
        {b.engine ? <EvalBar pos={ev} height={size} orientation={b.bottom} width={bar} /> : null}
        <Board
          fen={fen}
          size={size}
          orientation={b.bottom}
          movable={over ? null : turn}
          lastMove={ply ? b.moves[ply - 1] : null}
          onMove={play}
          onIllegal={() => playSound("illegal")}
          hints={prefs.hints}
          showLast={prefs.lastMove}
          coords={prefs.coords}
          animate={prefs.anim}
          arrow={b.engine && prefs.arrows && ev?.best ? ev.best : null}
        />
      </View>

      <View style={s.movesRow}>
        <IconButton name="first-page" label="Về đầu" onPress={() => go(0)} disabled={ply === 0} size={22} />
        <IconButton name="chevron-left" label="Nước trước" onPress={() => go(ply - 1)} disabled={ply === 0} size={24} />
        <ScrollView ref={movesRef} horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={s.moves}>
          {san.length === 0 ? <Text style={s.muted}>Đi một nước bất kỳ để bắt đầu</Text> : null}
          {san.map((m, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center" }}>
              {i % 2 === 0 ? <Text style={s.moveNo}>{i / 2 + 1}.</Text> : null}
              <Pressable
                onPress={() => go(i + 1)}
                style={[s.move, ply === i + 1 && { backgroundColor: c.jadeWash }]}
                accessibilityRole="button"
                accessibilityLabel={`Xem nước ${m}`}
              >
                <Text style={[s.moveText, ply === i + 1 && { color: c.accent }]}>{m}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <IconButton name="chevron-right" label="Nước sau" onPress={() => go(ply + 1)} disabled={ply >= san.length} size={24} />
        <IconButton name="last-page" label="Nước cuối" onPress={() => go(san.length)} disabled={ply >= san.length} size={22} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: Math.max(insets.bottom, 12) + 8 }}>
        <View style={[s.card, { backgroundColor: c.surface, borderColor: c.line }]}>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Stockfish 11</Text>
              <Text style={s.muted}>
                {!b.engine
                  ? "Máy phân tích đang tắt"
                  : ev?.depth
                    ? `Độ sâu ${ev.depth}${res?.cached ? " · đã tính trước" : ""}`
                    : "Máy chạy trên máy chủ, mỗi thế cờ khoảng 1 giây"}
              </Text>
            </View>
            <Switch
              value={b.engine}
              onValueChange={(v) => save({ ...b, engine: v })}
              trackColor={{ true: c.jade, false: c.line }}
              thumbColor="#fff"
              accessibilityLabel="Bật máy phân tích"
            />
          </View>
          {!b.engine ? null : res?.error ? (
            <Text style={[s.muted, { color: c.danger }]}>{res.error}</Text>
          ) : !ev ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <ActivityIndicator size="small" color={c.accent} />
              <Text style={s.muted}>Stockfish đang tính…</Text>
            </View>
          ) : ev.end ? (
            <Text style={s.muted}>{ev.end === "checkmate" ? "Chiếu hết." : "Hòa: hết nước đi hoặc không đủ quân."}</Text>
          ) : (
            ev.lines.map((l) => (
              <Pressable
                key={l.move}
                onPress={() => play(l.move)}
                style={({ pressed }) => [s.line, { backgroundColor: pressed ? c.jadeWash : c.field }]}
                accessibilityRole="button"
                accessibilityLabel={`Đi ${l.pv[0]}, đánh giá ${evalSpeech(l)}`}
              >
                <View style={[s.evalChip, l.wp >= 50 ? s.evalWhite : s.evalBlack]}>
                  <Text style={[s.evalText, { color: l.wp >= 50 ? "#14201C" : "#fff" }]}>{evalText(l)}</Text>
                </View>
                <Text style={s.lineText} numberOfLines={1}>
                  {pvText(l.pv, ply, turn)}
                </Text>
              </Pressable>
            ))
          )}
        </View>
        <View style={s.actions}>
          <Button title="Lùi một nước" icon="undo" kind="secondary" small style={{ flex: 1 }} disabled={ply === 0} onPress={() => go(ply - 1)} />
          <Button
            title="Bàn mới"
            icon="restart-alt"
            kind="secondary"
            small
            style={{ flex: 1 }}
            disabled={b.moves.length === 0}
            onPress={async () => {
              if (await confirm("Bàn mới?", "Xóa hết các nước để bắt đầu lại.", "Bàn mới")) save({ ...b, moves: [], ply: 0 });
            }}
          />
        </View>
        <View style={s.actions}>
          <Button title="Dán PGN" icon="content-paste" kind="secondary" small style={{ flex: 1 }} onPress={() => setPasteOpen(true)} />
          <Button
            title="Chép PGN"
            icon="content-copy"
            kind="secondary"
            small
            style={{ flex: 1 }}
            disabled={b.moves.length === 0}
            onPress={async () => {
              await Clipboard.setStringAsync(pgnOf(b.moves));
              showToast("Đã chép PGN.");
            }}
          />
        </View>
        <Text style={s.note}>Ván đang chơi thì không phân tích được thế cờ hiện tại. Mũi tên xanh là nước máy chọn (tắt ở Tùy chọn → Mũi tên gợi ý).</Text>
      </ScrollView>
      <PrefsSheet visible={prefsOpen} onClose={() => setPrefsOpen(false)} />
      <PastePgnSheet
        visible={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onLoad={(moves) => {
          save({ ...b, moves, ply: moves.length });
          showToast(`Đã mở ván ${Math.ceil(moves.length / 2)} nước.`);
        }}
      />
    </View>
  );
}

/** Dán PGN (từ Think hoặc trang cờ khác) để mở trên bàn phân tích */
function PastePgnSheet({ visible, onClose, onLoad }: { visible: boolean; onClose: () => void; onLoad: (moves: string[]) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);
  function open() {
    try {
      const moves = movesFromPgn(text);
      onLoad(moves);
      setText("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được PGN này.");
    }
  }
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Dán PGN"
      footer={<Button title="Mở trên bàn phân tích" icon="insights" disabled={!text.trim()} onPress={open} />}
    >
      <Text style={s.muted}>Dán PGN của một ván (chép từ Think hoặc trang cờ khác). Bình luận và nhánh phụ sẽ được bỏ qua.</Text>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          setError(null);
        }}
        multiline
        placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 …"
        placeholderTextColor={c.muted}
        style={s.pgnInput}
        accessibilityLabel="PGN"
        autoCorrect={false}
        autoCapitalize="none"
        textAlignVertical="top"
      />
      <Button
        title="Dán từ bộ nhớ tạm"
        icon="content-paste"
        kind="secondary"
        small
        onPress={async () => {
          const v = await Clipboard.getStringAsync().catch(() => "");
          if (v) {
            setText(v);
            setError(null);
          } else setError("Bộ nhớ tạm đang trống.");
        }}
      />
      <FormError text={error} />
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 },
    title: { color: c.text, fontSize: 17, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5 },
    movesRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      marginTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.surface,
    },
    moves: { alignItems: "center", paddingHorizontal: 4, gap: 2 },
    moveNo: { color: c.muted, fontSize: 13, marginLeft: 6, marginRight: 2 },
    move: { paddingHorizontal: 6, paddingVertical: 5, borderRadius: 6 },
    moveText: { color: c.text, fontSize: 14.5, fontWeight: "700" },
    card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
    cardTitle: { color: c.text, fontSize: 15, fontWeight: "800" },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    line: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 10 },
    evalChip: {
      minWidth: 52,
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderRadius: 8,
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    evalWhite: { backgroundColor: "#F4F4F0" },
    evalBlack: { backgroundColor: "#26302C" },
    evalText: { fontSize: 13.5, fontWeight: "800", fontVariant: ["tabular-nums"] },
    lineText: { flex: 1, color: c.text, fontSize: 13.5 },
    actions: { flexDirection: "row", gap: 10 },
    muted: { color: c.muted, fontSize: 13 },
    note: { color: c.muted, fontSize: 12, textAlign: "center", lineHeight: 17 },
    pgnInput: {
      minHeight: 140,
      maxHeight: 260,
      borderRadius: 12,
      backgroundColor: c.field,
      padding: 12,
      color: c.text,
      fontSize: 14,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
  });
