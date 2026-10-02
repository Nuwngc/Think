import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStore } from "../store";
import type { Colors } from "../theme";
import { Avatar, Loading, useStyles } from "../ui";
import { Emo } from "./Emo";
import { ago, fmt, logEmoji, logText } from "./logic";
import { Chip, FButton, H2, Note, Panel } from "./parts";
import { loadSocial, openVisit, setBoardTab, useFarm } from "./store";
import type { Farm } from "./types";

// Bạn bè: bảng xếp hạng (cấp độ / xu tuần này), ghé vườn bạn bè, nhật ký vườn của mình

function Segmented({ value, onChange }: { value: "level" | "week"; onChange: (v: "level" | "week") => void }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {(
        [
          ["level", "Cấp độ"],
          ["week", "Xu tuần này"],
        ] as const
      ).map(([k, label]) => (
        <Pressable
          key={k}
          onPress={() => onChange(k)}
          style={[s.segBtn, value === k && s.segOn]}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === k }}
        >
          <Text style={[s.segText, value === k && s.segTextOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function FriendsView({ t }: { t: number }) {
  const s = useStyles(makeStyles);
  const farm = useFarm((st) => st.farm) as Farm;
  const cat = useFarm((st) => st.cat);
  const items = useFarm((st) => st.items);
  const friends = useFarm((st) => st.friends);
  const board = useFarm((st) => st.board);
  const boardTab = useFarm((st) => st.boardTab);
  const users = useStore((st) => st.users);
  const meId = useStore((st) => st.me?.id ?? 0);
  // Mở lại mục Bạn bè (vd lần trước thoát game ở mục này): tải danh sách
  useEffect(() => {
    if (!friends && !useFarm.getState().socialLoading) loadSocial();
  }, [friends]);
  if (!cat) return null;
  if (!friends) return <Loading text="Đang xem vườn của mọi người…" />;
  const R = cat.rules;
  const nameOf = (id: number) => users[id]?.displayName || "Người dùng";
  const rows = board ? (boardTab === "level" ? board.level : board.week).slice(0, 10) : [];
  return (
    <View style={{ gap: 14 }}>
      <H2 emoji="🏆" right={<Segmented value={boardTab} onChange={setBoardTab} />}>
        Xếp hạng
      </H2>
      {rows.length ? (
        <Panel>
          {rows.map((r, i) => {
            const me = r.userId === meId;
            return (
              <View key={r.userId} style={[s.rank, i > 0 && s.line, me && s.rankMe]}>
                {i < 3 ? <Emo ch={["🥇", "🥈", "🥉"][i]} size={24} label={`Hạng ${i + 1}`} /> : <Text style={s.rankN}>{i + 1}</Text>}
                <Avatar user={users[r.userId]} size={30} dot={false} />
                <Text style={s.rankName} numberOfLines={1}>
                  {me ? `${nameOf(r.userId)} (bạn)` : nameOf(r.userId)}
                </Text>
                <Text style={s.rankValue}>{"level" in r ? `Cấp ${r.level}` : `${fmt(r.coins)} xu`}</Text>
              </View>
            );
          })}
        </Panel>
      ) : (
        <Note>{boardTab === "week" ? "Tuần này chưa ai bán được hàng. Giao đơn hoặc bán ở chợ để lên bảng." : "Chưa có ai."}</Note>
      )}

      <H2 emoji="👥">Ghé vườn bạn bè</H2>
      <Note>
        Bắt sâu giúp bạn được {R.helpCoins} xu mỗi con. Cây chín chưa hái thì hái trộm được 1 sản phẩm mỗi ô (mỗi ngày tối đa {R.stealsPerDay} lần,{" "}
        {R.stealsPerFarmPerDay} lần mỗi vườn). Hôm nay bạn đã giúp {farm.helps}/{R.helpsPerDay} lần, hái trộm {farm.steals}/{R.stealsPerDay} lần.
      </Note>
      {friends.length ? (
        <View style={{ gap: 8 }}>
          {friends.map((x) => (
            <View key={x.userId} style={s.friend}>
              <Avatar user={users[x.userId]} size={40} dot={false} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.friendName} numberOfLines={1}>
                  {nameOf(x.userId)}
                </Text>
                <View style={s.chips}>
                  <Chip text={`Cấp ${x.level}`} />
                  {x.stealable ? <Chip hot emoji="🧺" text={`${x.stealable} ô hái được`} /> : null}
                  {x.bugs ? <Chip hot emoji="🐛" text={`${x.bugs} con sâu`} /> : null}
                  {x.dog ? <Chip emoji="🐕" text="Có chó" /> : null}
                </View>
              </View>
              <FButton kind="soft" small title="Ghé vườn" label={`Ghé vườn của ${nameOf(x.userId)}`} onPress={() => openVisit(x.userId)} />
            </View>
          ))}
        </View>
      ) : (
        <Note>Chưa ai khác có nông trại. Rủ cả nhóm vào chơi nhé!</Note>
      )}

      <H2 emoji="📒">Nhật ký vườn</H2>
      {farm.log?.length ? (
        <Panel>
          {farm.log.slice(0, 15).map((e, i) => (
            <View key={`${e.t}-${i}`} style={[s.log, i > 0 && s.line]}>
              <Emo ch={logEmoji(e.type)} size={22} />
              <Text style={s.logText}>{logText(e, nameOf(e.by), e.c ? items[e.c]?.name || null : null)}</Text>
              <Text style={s.logTime}>{ago(e.t, t)}</Text>
            </View>
          ))}
        </Panel>
      ) : (
        <Note>Chưa ai ghé vườn của bạn.</Note>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    seg: { flexDirection: "row", backgroundColor: c.field, borderRadius: 12, padding: 3, gap: 2 },
    segBtn: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9 },
    segOn: { backgroundColor: c.surface, elevation: 1, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
    segText: { color: c.muted, fontSize: 13, fontWeight: "700" },
    segTextOn: { color: c.text },
    rank: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9 },
    rankMe: { backgroundColor: c.jadeWash },
    line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    rankN: { width: 24, textAlign: "center", color: c.muted, fontWeight: "800" },
    rankName: { flex: 1, color: c.text, fontSize: 14.5, fontWeight: "700" },
    rankValue: { color: c.text, fontSize: 14.5, fontWeight: "800", fontVariant: ["tabular-nums"] },
    friend: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    friendName: { color: c.text, fontSize: 15, fontWeight: "800" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    log: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9 },
    logText: { flex: 1, color: c.text, fontSize: 14, lineHeight: 19 },
    logTime: { color: c.muted, fontSize: 12 },
  });
