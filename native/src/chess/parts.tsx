import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStore } from "../store";
import { useColors } from "../theme";
import { Avatar, Icon } from "../ui";
import { TIME_CONTROLS } from "./format";
import type { ChessBot, ChessGame, Color } from "./types";

/** Giờ hiện tại, tự cập nhật (để chạy đồng hồ, đếm ngược) */
export function useNow(active: boolean, every = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

/** Màu ảnh đại diện của máy theo sức mạnh */
export function botTint(elo: number) {
  if (elo < 900) return "#5DA271";
  if (elo < 1500) return "#3E8FB0";
  if (elo < 2000) return "#8A5CC2";
  if (elo < 2600) return "#C7612B";
  return "#B3372A";
}

export function BotAvatar({ bot, size = 40 }: { bot: Pick<ChessBot, "elo">; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: botTint(bot.elo), alignItems: "center", justifyContent: "center" }}>
      <Icon name="smart-toy" size={size * 0.56} color="#fff" />
    </View>
  );
}

/** Ảnh và tên của một bên trong ván (người hoặc máy) */
export function useSide(g: ChessGame, color: Color) {
  const users = useStore((s) => s.users);
  const isBot = g.bot != null && g.botColor === color;
  const uid = color === "w" ? g.whiteId : g.blackId;
  const user = uid != null ? users[uid] : undefined;
  return {
    isBot,
    uid,
    user,
    name: isBot ? g.bot!.name : user?.displayName || "Người dùng",
  };
}

export function SideAvatar({ g, color, size = 40 }: { g: ChessGame; color: Color; size?: number }) {
  const side = useSide(g, color);
  if (side.isBot && g.bot) return <BotAvatar bot={g.bot} size={size} />;
  return <Avatar user={side.user} size={size} dot={false} />;
}

/* ---------------- Chọn thời gian, màu quân ---------------- */

export function TimePicker({ value, onChange }: { value: { base: number; inc: number }; onChange: (v: { base: number; inc: number }) => void }) {
  const c = useColors();
  return (
    <View style={styles.grid}>
      {TIME_CONTROLS.map((t) => {
        const on = t.base === value.base && t.inc === value.inc;
        return (
          <Pressable
            key={t.label}
            onPress={() => onChange({ base: t.base, inc: t.inc })}
            style={[styles.tc, { backgroundColor: on ? c.jade : c.field }]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${t.label === "∞" ? "Không giới hạn thời gian" : `${t.base} phút, cộng ${t.inc} giây mỗi nước`}`}
          >
            <Text style={[styles.tcLabel, { color: on ? c.onJade : c.text }]}>{t.label}</Text>
            <Text style={[styles.tcKind, { color: on ? c.onJade : c.muted }]} numberOfLines={1}>
              {t.kind}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type ColorPref = "random" | "white" | "black";

export function ColorPicker({ value, onChange }: { value: ColorPref; onChange: (v: ColorPref) => void }) {
  const c = useColors();
  const items: { key: ColorPref; label: string; swatch: string[] }[] = [
    { key: "random", label: "Ngẫu nhiên", swatch: ["#FFFFFF", "#222"] },
    { key: "white", label: "Quân trắng", swatch: ["#FFFFFF"] },
    { key: "black", label: "Quân đen", swatch: ["#222"] },
  ];
  return (
    <View style={styles.row}>
      {items.map((it) => {
        const on = value === it.key;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            style={[styles.color, { backgroundColor: on ? c.jadeWash : c.field, borderColor: on ? c.accent : "transparent" }]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
          >
            <View style={styles.swatches}>
              {it.swatch.map((col, i) => (
                <View key={i} style={[styles.swatch, { backgroundColor: col, borderColor: c.line, marginLeft: i ? -6 : 0 }]} />
              ))}
            </View>
            <Text style={[styles.colorText, { color: on ? c.accent : c.text2 }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tc: { width: "31.5%", flexGrow: 1, minHeight: 58, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingVertical: 8 },
  tcLabel: { fontSize: 18, fontWeight: "800" },
  tcKind: { fontSize: 11.5, fontWeight: "600", marginTop: 1 },
  row: { flexDirection: "row", gap: 8 },
  color: { flex: 1, borderRadius: 12, borderWidth: 1.5, alignItems: "center", paddingVertical: 10, gap: 6 },
  swatches: { flexDirection: "row" },
  swatch: { width: 20, height: 20, borderRadius: 10, borderWidth: 1 },
  colorText: { fontSize: 13, fontWeight: "700" },
});
