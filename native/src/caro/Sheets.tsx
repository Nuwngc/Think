import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { fold } from "../format";
import { openCaro, showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, FormError, Icon, Sheet, useStyles } from "../ui";
import { MarkIcon, MiniBoard } from "./Board";
import { LEVELS, RULES, type Level, type Rule } from "./engine";
import { LEVEL_INFO, RULE_INFO, secondsLabel, TURN_SUB } from "./format";
import { loadCaro, loadLocal, newBotGame, sendChallenge, useCaro } from "./store";
import type { CaroRating, Side } from "./types";

/* =========================================================
   Ô chọn (mức máy, bên, luật, thời gian)
   ========================================================= */

function Choice({ on, title, sub, onPress, left, label }: { on: boolean; title: string; sub?: string; onPress: () => void; left?: ReactNode; label?: string }) {
  const s = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.choice, on && s.choiceOn, pressed && !on && { opacity: 0.8 }]}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label || (sub ? `${title}, ${sub}` : title)}
    >
      {left}
      <Text style={[s.choiceTitle, on && s.choiceTitleOn]} numberOfLines={1}>
        {title}
      </Text>
      {sub ? (
        <Text style={s.choiceSub} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

function LevelPicker({ value, onChange }: { value: Level; onChange: (v: Level) => void }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.row}>
      {LEVELS.map((k) => (
        <Choice
          key={k}
          on={value === k}
          title={LEVEL_INFO[k].label}
          sub={LEVEL_INFO[k].about}
          onPress={() => onChange(k)}
          left={<View style={[s.dot, { backgroundColor: LEVEL_INFO[k].color }]} />}
          label={`Máy ${LEVEL_INFO[k].label.toLowerCase()}: ${LEVEL_INFO[k].about}`}
        />
      ))}
    </View>
  );
}

function SidePicker({ value, onChange }: { value: Side | "random"; onChange: (v: Side | "random") => void }) {
  const s = useStyles(makeStyles);
  const items: { key: Side | "random"; title: string; sub: string; icon: ReactNode }[] = [
    { key: "x", title: "Đi trước", sub: "Cầm X", icon: <MarkIcon side="x" size={22} /> },
    { key: "o", title: "Đi sau", sub: "Cầm O", icon: <MarkIcon side="o" size={22} /> },
    {
      key: "random",
      title: "Ngẫu nhiên",
      sub: "X hoặc O",
      icon: (
        <View style={{ flexDirection: "row", gap: 2 }}>
          <MarkIcon side="x" size={18} />
          <MarkIcon side="o" size={18} />
        </View>
      ),
    },
  ];
  return (
    <View style={s.row}>
      {items.map((it) => (
        <Choice key={it.key} on={value === it.key} title={it.title} sub={it.sub} left={<View style={s.iconBox}>{it.icon}</View>} onPress={() => onChange(it.key)} />
      ))}
    </View>
  );
}

function RulePicker({ value, onChange }: { value: Rule; onChange: (v: Rule) => void }) {
  const s = useStyles(makeStyles);
  return (
    <>
      <View style={s.row}>
        {RULES.map((k) => (
          <Choice key={k} on={value === k} title={RULE_INFO[k].label} sub={RULE_INFO[k].sub} onPress={() => onChange(k)} />
        ))}
      </View>
      <Text style={s.hint}>{RULE_INFO[value].about}</Text>
    </>
  );
}

/* =========================================================
   Chơi với máy
   ========================================================= */

export function BotSheet({ visible, onClose, onStarted }: { visible: boolean; onClose: () => void; onStarted?: () => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const saved = useCaro((st) => st.prefs);
  const playing = useCaro((st) => Boolean(st.bot && !st.bot.result && st.bot.moves.length > 0));
  const [level, setLevel] = useState<Level>(saved.level);
  const [side, setSide] = useState<Side | "random">(saved.side);
  const [rule, setRule] = useState<Rule>(saved.rule);

  useEffect(() => {
    if (!visible) return;
    loadLocal().then(() => {
      const p = useCaro.getState().prefs;
      setLevel(p.level);
      setSide(p.side);
      setRule(p.rule);
    });
  }, [visible]);

  function start() {
    newBotGame({ level, side, rule });
    onClose();
    if (onStarted) onStarted();
    else openCaro(null, true);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Chơi với máy" footer={<Button title="Bắt đầu" icon="play-arrow" onPress={start} />}>
      <Text style={s.hint}>Chơi ngay trên máy này: không cần mạng, không tính điểm ELO.</Text>
      <Text style={s.label}>Mức máy</Text>
      <LevelPicker value={level} onChange={setLevel} />
      <Text style={s.label}>Bạn</Text>
      <SidePicker value={side} onChange={setSide} />
      <Text style={s.label}>Luật</Text>
      <RulePicker value={rule} onChange={setRule} />
      {playing ? (
        <View style={s.note}>
          <Icon name="info-outline" size={18} color={c.text2} />
          <Text style={s.noteText}>Ván dở với máy sẽ được thay bằng ván mới.</Text>
        </View>
      ) : null}
    </Sheet>
  );
}

/* =========================================================
   Thách đấu một người
   ========================================================= */

export function ChallengeSheet({ visible, onClose, opponentId }: { visible: boolean; onClose: () => void; opponentId?: number | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { users, meId } = useStore(useShallow((st) => ({ users: st.users, meId: st.me?.id ?? 0 })));
  const leaderboard = useCaro((st) => st.leaderboard);
  const options = useCaro((st) => st.options);
  const [pick, setPick] = useState<number | null>(opponentId ?? null);
  const [seconds, setSeconds] = useState(30);
  const [rule, setRule] = useState<Rule>("free");
  const [side, setSide] = useState<Side | "random">("random");
  const [rated, setRated] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPick(opponentId ?? null);
    setError(null);
    setQuery("");
    if (!useCaro.getState().loaded) loadCaro();
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
      await sendChallenge({ opponentId: pick, turnSeconds: seconds, rule, side, rated });
      onClose();
      showToast(`Đã gửi lời thách đấu cờ caro tới ${chosen?.displayName || "đối thủ"}. Họ nhận là vào ván ngay.`, { caroGameId: 0 });
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
      title="Thách đấu cờ caro"
      footer={<Button title="Gửi lời thách đấu" icon="send" busy={busy} disabled={pick == null} onPress={submit} />}
    >
      <Text style={s.label}>Đối thủ</Text>
      {fixed && chosen ? (
        <View style={[s.person, s.personOn]}>
          <Avatar user={chosen} size={40} meId={meId} />
          <View style={{ flex: 1 }}>
            <Text style={s.personName}>{chosen.displayName}</Text>
            <Text style={s.personSub}>ELO caro {ratingOf(chosen.id)}</Text>
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
                accessibilityLabel="Tìm người"
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
                  accessibilityLabel={`${u.displayName}, ELO caro ${ratingOf(u.id)}${u.online ? ", đang hoạt động" : ""}`}
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

      <Text style={s.label}>Thời gian mỗi nước</Text>
      <View style={s.grid}>
        {[...options.turnSeconds.filter(Boolean), ...options.turnSeconds.filter((x) => !x)].map((sec) => (
          <Choice
            key={sec}
            on={seconds === sec}
            title={secondsLabel(sec)}
            sub={TURN_SUB[sec]}
            onPress={() => setSeconds(sec)}
            label={sec ? `${secondsLabel(sec)} mỗi nước` : "Không giới hạn thời gian"}
          />
        ))}
      </View>
      <Text style={s.hint}>
        {seconds ? `Mỗi nước phải đi trong ${secondsLabel(seconds).toLowerCase()}, quá giờ là thua.` : "Không tính giờ: đi lúc nào cũng được (3 ngày không đi thì thua)."}
      </Text>

      <Text style={s.label}>Luật</Text>
      <RulePicker value={rule} onChange={setRule} />

      <Text style={s.label}>Bạn</Text>
      <SidePicker value={side} onChange={setSide} />

      <Pressable onPress={() => setRated((v) => !v)} style={s.switchRow} accessibilityRole="switch" accessibilityState={{ checked: rated }} accessibilityLabel="Tính điểm ELO">
        <View style={{ flex: 1 }}>
          <Text style={s.switchTitle}>Tính điểm ELO</Text>
          <Text style={s.hint}>{rated ? "Thắng được cộng điểm, thua bị trừ điểm trên bảng xếp hạng caro." : "Ván giao hữu, không ảnh hưởng điểm."}</Text>
        </View>
        <Switch value={rated} onValueChange={setRated} trackColor={{ true: c.jade, false: c.line }} thumbColor="#fff" />
      </Pressable>

      <FormError text={error} />
    </Sheet>
  );
}

/* =========================================================
   Luật chơi
   ========================================================= */

// Hình minh họa 7×7: năm X liền nhau; bên phải bị O chặn cả hai đầu
const ART_N = 7;
const artFree = (() => {
  const b = new Array(ART_N * ART_N).fill(0);
  for (let k = 0; k < 5; k++) b[(k + 1) * ART_N + k + 1] = 1;
  b[1 * ART_N + 4] = 2;
  b[2 * ART_N + 5] = 2;
  b[4 * ART_N + 2] = 2;
  return b;
})();
const artBlocked = (() => {
  const b = new Array(ART_N * ART_N).fill(0);
  for (let k = 1; k <= 5; k++) b[3 * ART_N + k] = 1;
  b[3 * ART_N] = 2;
  b[3 * ART_N + 6] = 2;
  b[1 * ART_N + 3] = 2;
  return b;
})();

export function RulesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const points = [
    "Bàn 15 × 15 ô. X đi trước, hai bên lần lượt đánh vào một ô trống.",
    "Ai có 5 quân liền nhau trước (ngang, dọc hoặc chéo) là thắng. Kín bàn mà chưa ai thắng thì hòa.",
    `Luật tự do: ${RULE_INFO.free.about.charAt(0).toLowerCase()}${RULE_INFO.free.about.slice(1)}`,
    `Luật chặn hai đầu: ${RULE_INFO.block2.about.charAt(0).toLowerCase()}${RULE_INFO.block2.about.slice(1)}`,
    "Đánh: chạm một ô để hiện quân mờ, chạm lại đúng ô đó để đánh.",
    "Thách đấu bạn bè: mỗi nước có giới hạn thời gian (nếu chọn), quá giờ là thua. Ván tính điểm thì cộng / trừ ELO. Ván chưa đủ 2 nước mà hủy thì không tính.",
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title="Luật chơi cờ caro">
      <View style={s.arts}>
        <View style={s.art}>
          <MiniBoard board={artFree} n={ART_N} size={118} line={[8, 16, 24, 32, 40]} />
          <Text style={s.artText}>5 quân liền: thắng</Text>
        </View>
        <View style={s.art}>
          <MiniBoard board={artBlocked} n={ART_N} size={118} />
          <Text style={s.artText}>Bị chặn hai đầu: không tính (luật chặn hai đầu)</Text>
        </View>
      </View>
      {points.map((p, i) => (
        <View key={i} style={s.point}>
          <View style={s.bullet} />
          <Text style={s.pointText}>{p}</Text>
        </View>
      ))}
    </Sheet>
  );
}

/* =========================================================
   Bảng xếp hạng
   ========================================================= */

export function RankRow({ r, rank, meId }: { r: CaroRating; rank: number; meId: number }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const user = useStore((st) => st.users[r.userId]);
  const medal = rank === 1 ? "#E3B21A" : rank === 2 ? "#A9B4BA" : rank === 3 ? "#C07A3E" : null;
  return (
    <View
      style={[s.rankRow, r.userId === meId && { backgroundColor: c.jadeWash }]}
      accessible
      accessibilityLabel={`Hạng ${rank}: ${user?.displayName || "Người dùng"}${r.userId === meId ? " (bạn)" : ""}, ${r.rating} điểm, ${r.wins} thắng, ${r.draws} hòa, ${r.losses} thua`}
    >
      <View style={[s.rank, medal ? { backgroundColor: medal } : null]}>
        <Text style={[s.rankText, medal ? { color: "#fff" } : null]}>{rank}</Text>
      </View>
      <Avatar user={user} size={36} dot={false} />
      <View style={{ flex: 1 }}>
        <Text style={s.personName} numberOfLines={1}>
          {user?.displayName || "Người dùng"}
          {r.userId === meId ? " (bạn)" : ""}
        </Text>
        <Text style={s.personSub}>
          {r.wins} thắng · {r.draws} hòa · {r.losses} thua
        </Text>
      </View>
      <Text style={s.rankRating}>{r.rating}</Text>
    </View>
  );
}

export function LeaderboardSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const meId = useStore((st) => st.me?.id ?? 0);
  const leaderboard = useCaro((st) => st.leaderboard);
  useEffect(() => {
    if (visible) loadCaro();
  }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Bảng xếp hạng cờ caro">
      <Text style={s.hint}>Xếp theo điểm ELO từ các ván caro tính điểm giữa người với người. Mọi người bắt đầu từ 1200.</Text>
      <View style={{ marginHorizontal: -8 }}>
        {(leaderboard || []).map((r, i) => (
          <RankRow key={r.userId} r={r} rank={i + 1} meId={meId} />
        ))}
        {leaderboard && leaderboard.length === 0 ? <Text style={s.empty}>Chưa ai chơi ván caro tính điểm.</Text> : null}
        {leaderboard == null ? <Text style={s.empty}>Đang tải…</Text> : null}
      </View>
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    label: { color: c.text2, fontSize: 13, fontWeight: "800", marginTop: 6 },
    hint: { color: c.muted, fontSize: 13, lineHeight: 18 },
    row: { flexDirection: "row", gap: 8 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choice: {
      flex: 1,
      minWidth: "30%",
      minHeight: 58,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: "transparent",
      backgroundColor: c.field,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 9,
      paddingHorizontal: 6,
      gap: 3,
    },
    choiceOn: { backgroundColor: c.jadeWash, borderColor: c.accent },
    choiceTitle: { color: c.text, fontSize: 15, fontWeight: "800", textAlign: "center" },
    choiceTitleOn: { color: c.accent },
    choiceSub: { color: c.muted, fontSize: 11.5, fontWeight: "600", textAlign: "center", lineHeight: 15 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    iconBox: { height: 24, alignItems: "center", justifyContent: "center" },
    note: { flexDirection: "row", gap: 8, alignItems: "center", padding: 10, borderRadius: 12, backgroundColor: c.turmericWash },
    noteText: { flex: 1, color: c.text2, fontSize: 13, lineHeight: 18 },
    person: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: "transparent" },
    personOn: { backgroundColor: c.jadeWash, borderColor: c.accent },
    personName: { color: c.text, fontSize: 15.5, fontWeight: "700" },
    personSub: { color: c.muted, fontSize: 13 },
    search: { height: 42, borderRadius: 12, backgroundColor: c.field, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
    searchInput: { flex: 1, color: c.text, fontSize: 15, paddingVertical: 0 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
    switchTitle: { color: c.text, fontSize: 15, fontWeight: "700" },
    arts: { flexDirection: "row", gap: 12, justifyContent: "center" },
    art: { flex: 1, alignItems: "center", gap: 8, maxWidth: 170 },
    artText: { color: c.text2, fontSize: 12.5, textAlign: "center", lineHeight: 17 },
    point: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent, marginTop: 8 },
    pointText: { flex: 1, color: c.text2, fontSize: 14.5, lineHeight: 21 },
    rankRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
    rank: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: c.field },
    rankText: { color: c.text2, fontSize: 13, fontWeight: "800" },
    rankRating: { color: c.text, fontSize: 17, fontWeight: "800" },
    empty: { color: c.muted, textAlign: "center", padding: 16, fontSize: 14 },
  });
