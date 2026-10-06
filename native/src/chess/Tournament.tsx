import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";

import { useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, confirm, FormError, Icon, IconButton, Sheet, useStyles } from "../ui";
import { reasonText } from "./format";
import { closeTournament, createTournament, loadTournament, openGame, tLabel, tournamentAct, useChess } from "./store";
import type { ChessTournament } from "./types";

// Giải đấu vòng tròn giữa bạn bè (máy chủ: src/chess-tournaments.js; bản web: renderTournament trong public/chess-ui.js).
// Ai cũng gặp mọi người còn lại, cờ theo ngày; thắng 1 điểm, hòa ½; bằng điểm xét hệ số Sonneborn-Berger.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysText = (ms: number) => `${Math.round(ms / DAY_MS)} ngày/nước`;
const STATUS: Record<ChessTournament["status"], string> = { open: "Đang mời", active: "Đang đấu", finished: "Đã xong", cancelled: "Đã hủy" };
/** 1.5 → "1½", 0.5 → "½" */
const pts = (n: number) => (n % 1 ? `${Math.floor(n) || ""}½` : String(n));

/* =========================================================
   Trang một giải
   ========================================================= */

export function TournamentScreen({ id }: { id: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const meId = useStore((st) => st.me?.id ?? 0);
  const users = useStore((st) => st.users);
  const nameOf = (uid: number) => users[uid]?.displayName || "Người dùng";
  const t = useChess((st) => st.tournaments[id]);
  const error = useChess((st) => st.tournamentError);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function act(action: "join" | "decline" | "start" | "cancel") {
    setBusy(action);
    try {
      await tournamentAct(id, action);
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <View style={s.header}>
      <IconButton name="arrow-back" label="Quay lại" onPress={closeTournament} color={c.text} />
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={1}>
          {t ? `🏆 ${t.name}` : "Giải đấu"}
        </Text>
        {t ? (
          <Text style={s.sub} numberOfLines={1}>
            {STATUS[t.status]} · {daysText(t.daily)} · {t.rounds === 2 ? "mỗi cặp 2 ván" : "mỗi cặp 1 ván"}
            {t.rated ? " · tính ELO" : ""}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!t) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        {header}
        <View style={s.fill}>{error ? <Text style={s.hint}>{error}</Text> : <ActivityIndicator color={c.accent} />}</View>
      </View>
    );
  }

  const meP = t.players.find((p) => p.userId === meId);
  const joined = t.players.filter((p) => p.status === "joined").length;
  const myGames = t.games.filter((g) => g.whiteId === meId || g.blackId === meId);
  const others = t.games.filter((g) => g.whiteId !== meId && g.blackId !== meId);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadTournament(id);
              setRefreshing(false);
            }}
            tintColor={c.accent}
            colors={[c.jade]}
          />
        }
      >
        {t.status === "finished" && t.winners.length ? (
          <View
            style={[s.champion, { backgroundColor: c.turmericWash }]}
            accessibilityLabel={`${t.winners.length > 1 ? "Đồng vô địch" : "Vô địch"}: ${t.winners.map(nameOf).join(", ")}`}
          >
            <Text style={{ fontSize: 34 }}>🏆</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.championLabel, { color: c.text2 }]}>{t.winners.length > 1 ? "Đồng vô địch" : "Vô địch"}</Text>
              <Text style={s.championName}>{t.winners.map(nameOf).join(", ")}</Text>
            </View>
          </View>
        ) : null}

        {t.status === "open" ? (
          <>
            <Text style={s.section}>NGƯỜI CHƠI</Text>
            <View style={s.card}>
              {t.players.map((p) => (
                <View key={p.userId} style={s.row}>
                  <Avatar user={users[p.userId]} size={36} dot={false} />
                  <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>
                    {nameOf(p.userId)}
                    {p.userId === t.creatorId ? " (người tạo)" : ""}
                  </Text>
                  <View style={[s.pill, { backgroundColor: p.status === "joined" ? c.jade : c.field }]}>
                    <Text style={[s.pillText, { color: p.status === "joined" ? c.onJade : c.muted }]}>
                      {p.status === "joined" ? "Đã nhận lời" : p.status === "declined" ? "Từ chối" : "Đang chờ"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            {meP?.status === "invited" ? (
              <View style={s.actions}>
                <Button title="Nhận lời" icon="check" style={{ flex: 1 }} busy={busy === "join"} onPress={() => act("join")} />
                <Button title="Từ chối" icon="close" kind="secondary" style={{ flex: 1 }} busy={busy === "decline"} onPress={() => act("decline")} />
              </View>
            ) : null}
            {t.creatorId === meId ? (
              <>
                <Text style={s.hint}>
                  Giải tự bắt đầu khi mọi người đã trả lời. Có {joined} người nhận lời; bấm Bắt đầu ngay để đấu luôn (cần ít nhất 3 người, ai chưa trả lời sẽ
                  không vào giải).
                </Text>
                <View style={s.actions}>
                  <Button
                    title="Bắt đầu ngay"
                    icon="play-arrow"
                    style={{ flex: 1 }}
                    disabled={joined < 3}
                    busy={busy === "start"}
                    onPress={() => act("start")}
                  />
                  <Button
                    title="Hủy giải"
                    icon="close"
                    kind="danger"
                    style={{ flex: 1 }}
                    busy={busy === "cancel"}
                    onPress={async () => {
                      if (await confirm("Hủy giải đấu?", "Mọi lời mời sẽ bị hủy.", "Hủy giải")) act("cancel");
                    }}
                  />
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {t.status === "active" || t.status === "finished" ? (
          <>
            <Text style={s.section}>BẢNG XẾP HẠNG</Text>
            <View style={s.card} accessibilityRole="list">
              <View style={[s.stRow, s.stHead]}>
                <Text style={[s.stRank, s.stHeadText]}>#</Text>
                <Text style={[s.stHeadText, { flex: 1 }]}>Người chơi</Text>
                <Text style={[s.stNum, s.stHeadText]}>Điểm</Text>
                <Text style={[s.stWdl, s.stHeadText]}>T-H-B</Text>
                <Text style={[s.stNum, s.stHeadText]}>SB</Text>
              </View>
              {t.standings.map((r) => (
                <View
                  key={r.userId}
                  style={[s.stRow, r.userId === meId && { backgroundColor: c.jadeWash }]}
                  accessible
                  accessibilityLabel={`Hạng ${r.rank}: ${nameOf(r.userId)}, ${pts(r.points)} điểm, ${r.wins} thắng ${r.draws} hòa ${r.losses} thua, còn ${r.left} ván`}
                >
                  <Text style={[s.stRank, { color: c.muted, fontWeight: "800" }]}>{r.rank}</Text>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Avatar user={users[r.userId]} size={28} dot={false} />
                    <Text style={s.stName} numberOfLines={1}>
                      {nameOf(r.userId)}
                    </Text>
                  </View>
                  <Text style={[s.stNum, s.stPts]}>{pts(r.points)}</Text>
                  <Text style={[s.stWdl, s.stCell]}>
                    {r.wins}-{r.draws}-{r.losses}
                  </Text>
                  <Text style={[s.stNum, s.stCell]}>{r.sb % 1 ? r.sb.toFixed(2) : r.sb}</Text>
                </View>
              ))}
            </View>
            <Text style={s.hint}>
              Thắng 1 điểm, hòa ½, thua 0. Bằng điểm thì xét hệ số SB (tổng điểm của những người mình thắng, cộng nửa điểm người mình hòa), rồi số ván thắng.
            </Text>
            {myGames.length ? <GameList title="VÁN CỦA BẠN" games={myGames} meId={meId} nameOf={nameOf} /> : null}
            {others.length ? <GameList title={myGames.length ? "CÁC VÁN KHÁC" : "CÁC VÁN"} games={others} meId={meId} nameOf={nameOf} /> : null}
          </>
        ) : null}

        {t.status === "cancelled" ? <Text style={s.hint}>Giải đã bị hủy.</Text> : null}
      </ScrollView>
    </View>
  );
}

function GameList({ title, games, meId, nameOf }: { title: string; games: ChessTournament["games"]; meId: number; nameOf: (id: number) => string }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  return (
    <>
      <Text style={s.section}>{title}</Text>
      <View style={s.card}>
        {games.map((g) => {
          const myTurn = g.status === "active" && ((g.turn === "w" && g.whiteId === meId) || (g.turn === "b" && g.blackId === meId));
          const res = g.status === "finished" ? (g.result || "").replace(/1\/2/g, "½") : g.status === "aborted" ? "Hủy" : `${g.plies} nước`;
          return (
            <Pressable
              key={g.id}
              onPress={() => openGame(g.id)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]}
              accessibilityRole="button"
              accessibilityLabel={`${nameOf(g.whiteId)} cầm Trắng, ${nameOf(g.blackId)} cầm Đen, ${myTurn ? "tới lượt bạn" : res}`}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {nameOf(g.whiteId)} – {nameOf(g.blackId)}
                </Text>
                <Text style={s.rowSub} numberOfLines={1}>
                  {g.status === "active" ? `Đang chơi · ${g.turn === "w" ? "Trắng" : "Đen"} đi` : reasonText(g.reason)}
                </Text>
              </View>
              {myTurn ? (
                <View style={[s.pill, { backgroundColor: c.jade }]}>
                  <Text style={[s.pillText, { color: c.onJade }]}>Lượt bạn</Text>
                </View>
              ) : (
                <Text style={s.result}>{res}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

/* =========================================================
   Dòng giải đấu ở trang Cờ vua
   ========================================================= */

export function TournamentRow({ t, meId, onOpen }: { t: ChessTournament; meId: number; onOpen: (id: number) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const users = useStore((st) => st.users);
  const nameOf = (uid: number) => users[uid]?.displayName || "Người dùng";
  const [busy, setBusy] = useState<string | null>(null);
  const meP = t.players.find((p) => p.userId === meId);
  const joined = t.players.filter((p) => p.status === "joined").length;
  const myRow = t.standings.find((r) => r.userId === meId);
  const sub =
    t.status === "open"
      ? `${joined}/${t.players.length} người nhận lời · ${daysText(t.daily)}`
      : t.status === "active"
        ? `${myRow ? `Hạng ${myRow.rank} · ${pts(myRow.points)} điểm · còn ${myRow.left} ván` : `${joined} người`} · ${daysText(t.daily)}`
        : t.winners.length
          ? `Vô địch: ${t.winners.map(nameOf).join(", ")}`
          : "Đã xong";
  const invited = meP?.status === "invited" && t.status === "open";
  async function act(action: "join" | "decline") {
    setBusy(action);
    try {
      await tournamentAct(t.id, action);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Pressable
      onPress={() => onOpen(t.id)}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.field }]}
      accessibilityRole="button"
      accessibilityLabel={`${tLabel(t.name)}. ${sub}`}
    >
      <View style={[s.cup, { backgroundColor: c.turmericWash }]}>
        <Text style={{ fontSize: 20 }}>🏆</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {t.name}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {invited ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Button title="Nhận lời" small busy={busy === "join"} onPress={() => act("join")} />
          <IconButton name="close" label="Từ chối" onPress={() => act("decline")} disabled={busy != null} color={c.muted} />
        </View>
      ) : (
        <View style={[s.pill, { backgroundColor: t.status === "active" ? c.jade : c.field }]}>
          <Text style={[s.pillText, { color: t.status === "active" ? c.onJade : c.muted }]}>{STATUS[t.status]}</Text>
        </View>
      )}
    </Pressable>
  );
}

/* =========================================================
   Tạo giải: tên, mời 2–7 người, số ngày mỗi nước, số ván mỗi cặp, tính ELO
   ========================================================= */

const DAY_CHOICES = [1, 2, 3, 7];

export function CreateTournamentSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { users, meId, myName } = useStore(useShallow((st) => ({ users: st.users, meId: st.me?.id ?? 0, myName: st.me?.displayName || "" })));
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [days, setDays] = useState(1);
  const [rounds, setRounds] = useState(1);
  const [rated, setRated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setPicked([]);
    setName("");
  }, [visible]);

  const people = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.id !== meId && !u.disabled)
        .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName, "vi")),
    [users, meId],
  );
  const n = picked.length + 1;
  const toggle = (id: number) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < 7 ? [...list, id] : list));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createTournament({ name: name.trim(), players: picked, days, rounds, rated });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa tạo được giải.");
    } finally {
      setBusy(false);
    }
  }

  const chips = (items: [number, string][], value: number, set: (v: number) => void, label: string) => (
    <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {items.map(([v, text]) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            onPress={() => set(v)}
            style={[s.chip, { backgroundColor: on ? c.jade : c.field }]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={text}
          >
            <Text style={[s.chipText, { color: on ? c.onJade : c.text }]}>{text}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Tạo giải đấu"
      footer={<Button title="Tạo giải và gửi lời mời" icon="emoji-events" busy={busy} disabled={n < 3} onPress={submit} />}
    >
      <Text style={s.hint}>
        Giải vòng tròn: ai cũng đấu với mọi người còn lại. Cờ theo ngày nên ai rảnh lúc nào đi lúc đó. Giải bắt đầu khi mọi người trả lời lời mời.
      </Text>
      <Text style={s.label}>Tên giải</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={40}
        placeholder={`Giải của ${myName}`}
        placeholderTextColor={c.muted}
        style={s.input}
        accessibilityLabel="Tên giải"
      />
      <Text style={s.label}>Mời người chơi</Text>
      <View style={{ gap: 4 }}>
        {people.slice(0, 60).map((u) => {
          const on = picked.includes(u.id);
          return (
            <Pressable
              key={u.id}
              onPress={() => toggle(u.id)}
              style={[s.person, on && { backgroundColor: c.jadeWash, borderColor: c.accent }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Mời ${u.displayName}`}
            >
              <Avatar user={u} size={38} meId={meId} />
              <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>
                {u.displayName}
              </Text>
              <Icon name={on ? "check-box" : "check-box-outline-blank"} size={22} color={on ? c.accent : c.muted} />
            </Pressable>
          );
        })}
        {people.length === 0 ? <Text style={s.hint}>Chưa có ai khác để mời.</Text> : null}
      </View>
      <Text style={s.hint}>
        {n} người (cả bạn) · mỗi người {(n - 1) * rounds} ván · tổng {((n * (n - 1)) / 2) * rounds} ván. Cần 3–8 người.
      </Text>
      <Text style={s.label}>Thời gian mỗi nước</Text>
      {chips(
        DAY_CHOICES.map((d) => [d, `${d} ngày`]),
        days,
        setDays,
        "Thời gian mỗi nước",
      )}
      <Text style={s.label}>Số ván mỗi cặp</Text>
      {chips(
        [
          [1, "1 ván"],
          [2, "2 ván (đổi màu)"],
        ],
        rounds,
        setRounds,
        "Số ván mỗi cặp",
      )}
      <Pressable onPress={() => setRated((v) => !v)} style={s.switchRow} accessibilityRole="switch" accessibilityState={{ checked: rated }}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>Tính điểm ELO</Text>
          <Text style={s.hint}>Các ván trong giải cộng / trừ điểm như ván xếp hạng.</Text>
        </View>
        <Switch value={rated} onValueChange={setRated} trackColor={{ true: c.jade, false: c.line }} thumbColor="#fff" />
      </Pressable>
      <FormError text={error} />
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 },
    title: { color: c.text, fontSize: 17, fontWeight: "800" },
    sub: { color: c.muted, fontSize: 12.5 },
    section: { color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginHorizontal: 4, marginTop: 6 },
    card: { backgroundColor: c.surface, borderRadius: 18, overflow: "hidden", paddingVertical: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
    rowTitle: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    rowSub: { color: c.muted, fontSize: 12.5 },
    result: { color: c.text, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
    pill: { paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    pillText: { fontSize: 12, fontWeight: "800" },
    cup: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    hint: { color: c.muted, fontSize: 13, lineHeight: 18 },
    label: { color: c.text2, fontSize: 13, fontWeight: "800", marginTop: 6 },
    actions: { flexDirection: "row", gap: 10 },
    champion: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 18 },
    championLabel: { fontSize: 12.5, fontWeight: "800" },
    championName: { color: c.text, fontSize: 19, fontWeight: "900" },
    stRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
    stHead: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    stHeadText: { color: c.muted, fontSize: 12, fontWeight: "700" },
    stRank: { width: 20, textAlign: "center" },
    stName: { color: c.text, fontSize: 15, fontWeight: "600", flexShrink: 1 },
    stNum: { width: 40, textAlign: "right" },
    stWdl: { width: 52, textAlign: "right" },
    stPts: { color: c.text, fontSize: 16, fontWeight: "900", fontVariant: ["tabular-nums"] },
    stCell: { color: c.text2, fontSize: 13.5, fontVariant: ["tabular-nums"] },
    input: { height: 46, borderRadius: 12, backgroundColor: c.field, paddingHorizontal: 14, color: c.text, fontSize: 16 },
    person: { flexDirection: "row", alignItems: "center", gap: 12, padding: 8, borderRadius: 14, borderWidth: 1.5, borderColor: "transparent" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    chipText: { fontSize: 14, fontWeight: "700" },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  });
