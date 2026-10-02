import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { fold } from "../format";
import { showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, FormError, Icon, Sheet, useStyles } from "../ui";
import { BotAvatar, ColorPicker, TimePicker, type ColorPref } from "./parts";
import { setPref, usePrefs, type ChessPrefs } from "./prefs";
import { loadHistory, loadLeaderboard, sendChallenge, startBotGame, useChess } from "./store";
import type { ChessGame } from "./types";

/* =========================================================
   Thách đấu một người
   ========================================================= */

export function ChallengeSheet({ visible, onClose, opponentId }: { visible: boolean; onClose: () => void; opponentId?: number | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { users, meId } = useStore(useShallow((st) => ({ users: st.users, meId: st.me?.id ?? 0 })));
  const leaderboard = useChess((st) => st.leaderboard);
  const [pick, setPick] = useState<number | null>(opponentId ?? null);
  const [tc, setTc] = useState({ base: 10, inc: 0 });
  const [color, setColor] = useState<ColorPref>("random");
  const [rated, setRated] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPick(opponentId ?? null);
    setError(null);
    setQuery("");
    if (!useChess.getState().leaderboard) loadLeaderboard();
  }, [visible, opponentId]);

  const ratingOf = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of leaderboard || []) map.set(r.userId, r.rating);
    return (id: number) => map.get(id) ?? 1200;
  }, [leaderboard]);

  const people = useMemo(() => {
    const q = fold(query);
    return Object.values(users)
      .filter((u) => u.id !== meId && !u.disabled)
      .filter((u) => !q || fold(u.displayName).includes(q) || fold(u.username).includes(q))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName, "vi"));
  }, [users, meId, query]);

  const fixed = opponentId != null;
  const chosen = pick != null ? users[pick] : undefined;

  async function submit() {
    if (pick == null) {
      setError("Chọn một người để thách đấu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendChallenge({ opponentId: pick, base: tc.base, inc: tc.inc, color, rated });
      onClose();
      showToast(`Đã gửi lời thách đấu tới ${chosen?.displayName || "đối thủ"}. Họ nhận là vào ván ngay.`, { chessGameId: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa gửi được lời thách đấu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Thách đấu cờ vua"
      footer={<Button title="Gửi lời thách đấu" icon="send" busy={busy} disabled={pick == null} onPress={submit} />}
    >
      <Text style={s.label}>Đối thủ</Text>
      {fixed && chosen ? (
        <View style={[s.person, s.personOn]}>
          <Avatar user={chosen} size={40} meId={meId} />
          <View style={{ flex: 1 }}>
            <Text style={s.personName}>{chosen.displayName}</Text>
            <Text style={s.personSub}>ELO {ratingOf(chosen.id)}</Text>
          </View>
        </View>
      ) : (
        <>
          {people.length > 6 || query ? (
            <View style={s.search}>
              <Icon name="search" size={19} color={c.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Tìm người"
                placeholderTextColor={c.muted}
                style={s.searchInput}
                autoCorrect={false}
              />
            </View>
          ) : null}
          <View style={{ gap: 4 }}>
            {people.slice(0, 40).map((u) => {
              const on = pick === u.id;
              return (
                <Pressable
                  key={u.id}
                  onPress={() => setPick(u.id)}
                  style={[s.person, on && s.personOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${u.displayName}, ELO ${ratingOf(u.id)}${u.online ? ", đang hoạt động" : ""}`}
                >
                  <Avatar user={u} size={40} meId={meId} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.personName} numberOfLines={1}>
                      {u.displayName}
                    </Text>
                    <Text style={s.personSub}>
                      ELO {ratingOf(u.id)}
                      {u.online ? " · đang hoạt động" : ""}
                    </Text>
                  </View>
                  <Icon name={on ? "radio-button-checked" : "radio-button-unchecked"} size={22} color={on ? c.accent : c.muted} />
                </Pressable>
              );
            })}
            {people.length === 0 ? <Text style={s.hint}>{query ? "Không tìm thấy ai." : "Chưa có ai khác để thách đấu."}</Text> : null}
          </View>
        </>
      )}

      <Text style={s.label}>Thời gian mỗi bên</Text>
      <TimePicker value={tc} onChange={setTc} />
      <Text style={s.hint}>
        {tc.base
          ? `Mỗi bên ${tc.base} phút${tc.inc ? `, đi xong mỗi nước được cộng ${tc.inc} giây` : ""}. Hết giờ là thua.`
          : "Không tính giờ: đi lúc nào cũng được, hợp để chơi thong thả cả ngày."}
      </Text>

      <Text style={s.label}>Bạn cầm quân</Text>
      <ColorPicker value={color} onChange={setColor} />

      <Pressable onPress={() => setRated((v) => !v)} style={s.switchRow} accessibilityRole="switch" accessibilityState={{ checked: rated }}>
        <View style={{ flex: 1 }}>
          <Text style={s.switchTitle}>Tính điểm ELO</Text>
          <Text style={s.hint}>{rated ? "Thắng được cộng điểm, thua bị trừ điểm trên bảng xếp hạng." : "Ván giao hữu, không ảnh hưởng điểm."}</Text>
        </View>
        <Switch value={rated} onValueChange={setRated} trackColor={{ true: c.jade, false: c.line }} thumbColor="#fff" />
      </Pressable>

      <FormError text={error} />
    </Sheet>
  );
}

/* =========================================================
   Chơi với máy
   ========================================================= */

export function BotSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const bots = useChess((st) => st.bots);
  const [pick, setPick] = useState<string | null>(null);
  const [tc, setTc] = useState({ base: 0, inc: 0 });
  const [color, setColor] = useState<ColorPref>("white");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);
  useEffect(() => {
    if (!pick && bots.length) setPick(bots[Math.min(2, bots.length - 1)].id);
  }, [bots, pick]);

  async function start() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      await startBotGame({ bot: pick, base: tc.base, inc: tc.inc, color });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa bắt đầu được ván cờ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Chơi với máy"
      footer={<Button title="Bắt đầu" icon="play-arrow" busy={busy} disabled={!pick} onPress={start} />}
    >
      <Text style={s.hint}>Luyện tập với các máy cờ mã nguồn mở. Ván với máy không tính điểm ELO.</Text>
      <View style={{ gap: 6 }}>
        {bots.map((b) => {
          const on = pick === b.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => setPick(b.id)}
              style={[s.person, on && s.personOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${b.name}, khoảng ${b.elo} ELO. ${b.about}`}
            >
              <BotAvatar bot={b} size={42} />
              <View style={{ flex: 1, gap: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[s.personName, { flexShrink: 1 }]} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={s.elo}>~{b.elo}</Text>
                </View>
                <Text style={s.personSub} numberOfLines={2}>
                  {b.about}
                </Text>
                <Text
                  style={s.source}
                  onPress={() => Linking.openURL(b.source.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`Mã nguồn ${b.source.name}, giấy phép ${b.source.license}`}
                >
                  {b.source.name} · {b.source.license} ↗
                </Text>
              </View>
              <Icon name={on ? "radio-button-checked" : "radio-button-unchecked"} size={22} color={on ? c.accent : c.muted} />
            </Pressable>
          );
        })}
        {bots.length === 0 ? <Text style={s.hint}>Đang tải danh sách máy…</Text> : null}
      </View>

      <Text style={s.label}>Thời gian mỗi bên</Text>
      <TimePicker value={tc} onChange={setTc} />

      <Text style={s.label}>Bạn cầm quân</Text>
      <ColorPicker value={color} onChange={setColor} />

      <FormError text={error} />
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    label: { color: c.text2, fontSize: 13, fontWeight: "800", marginTop: 6 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 18 },
    person: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: "transparent" },
    personOn: { backgroundColor: c.jadeWash, borderColor: c.accent },
    personName: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    personSub: { color: c.muted, fontSize: 13 },
    elo: { color: c.accent, fontSize: 13, fontWeight: "800" },
    source: { color: c.accent, fontSize: 12, fontWeight: "600", marginTop: 2, alignSelf: "flex-start" },
    search: { height: 42, borderRadius: 12, backgroundColor: c.field, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
    searchInput: { flex: 1, color: c.text, fontSize: 15, paddingVertical: 0 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
    switchTitle: { color: c.text, fontSize: 15, fontWeight: "700" },
  });

/* =========================================================
   Tùy chọn bàn cờ: chỉ dẫn, tô nước vừa đi, tọa độ, mũi tên gợi ý, quân trượt, âm thanh
   ========================================================= */

const PREF_ROWS: { key: keyof ChessPrefs; title: string; hint: string }[] = [
  { key: "hints", title: "Chỉ dẫn nước đi", hint: "Chạm vào quân thì hiện chấm ở các ô đi được." },
  { key: "lastMove", title: "Tô màu nước vừa đi", hint: "Tô vàng ô đi và ô đến của nước gần nhất." },
  { key: "coords", title: "Tọa độ bàn cờ", hint: "Chữ a–h và số 1–8 ở mép bàn cờ." },
  { key: "arrows", title: "Mũi tên gợi ý khi phân tích", hint: "Khi xem lại ván đã phân tích, vẽ mũi tên nước tốt nhất của máy." },
  { key: "anim", title: "Quân trượt khi đi", hint: "Quân cờ trượt mượt từ ô đi tới ô đến (nước của bạn, của đối thủ, khi xem lại ván), quân bị ăn mờ dần." },
  { key: "sound", title: "Âm thanh", hint: "Tiếng quân cờ khi đi, ăn quân, chiếu tướng, bắt đầu và kết thúc ván." },
];

export function PrefsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const prefs = usePrefs();
  return (
    <Sheet visible={visible} onClose={onClose} title="Tùy chọn bàn cờ">
      {PREF_ROWS.map((row) => (
        <Pressable
          key={row.key}
          onPress={() => setPref(row.key, !prefs[row.key])}
          style={s.switchRow}
          accessibilityRole="switch"
          accessibilityState={{ checked: prefs[row.key] }}
          accessibilityLabel={row.title}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.switchTitle}>{row.title}</Text>
            <Text style={s.hint}>{row.hint}</Text>
          </View>
          <Switch
            value={prefs[row.key]}
            onValueChange={(v) => setPref(row.key, v)}
            trackColor={{ true: c.jade, false: c.line }}
            thumbColor="#fff"
          />
        </Pressable>
      ))}
    </Sheet>
  );
}

/* =========================================================
   Lịch sử ván đấu (tất cả ván đã xong, tải dần)
   ========================================================= */

export function HistorySheet({ visible, onClose, renderRow }: { visible: boolean; onClose: () => void; renderRow: (g: ChessGame) => ReactNode }) {
  const s = useStyles(makeStyles);
  const history = useChess((st) => st.history);
  const games = useChess((st) => st.games);
  useEffect(() => {
    if (visible) loadHistory();
  }, [visible]);
  const list = history.ids.map((id) => games[id]).filter((g): g is ChessGame => Boolean(g));
  return (
    <Sheet visible={visible} onClose={onClose} title="Lịch sử ván đấu">
      <Text style={s.hint}>Chạm vào một ván để xem lại từng nước và nhờ Stockfish phân tích.</Text>
      <View style={{ marginHorizontal: -12 }}>{list.map((g) => <View key={g.id}>{renderRow(g)}</View>)}</View>
      {history.loaded && list.length === 0 ? <Text style={s.hint}>Bạn chưa chơi xong ván nào.</Text> : null}
      {!history.loaded || history.loading ? <Text style={s.hint}>Đang tải…</Text> : null}
      {history.hasMore && !history.loading ? <Button title="Tải thêm" kind="secondary" onPress={() => loadHistory(true)} /> : null}
    </Sheet>
  );
}
