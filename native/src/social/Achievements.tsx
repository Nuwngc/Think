import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors, type Colors } from "../theme";
import type { Achievement } from "../types";
import { useStyles } from "../ui";

// Thành tựu trên trang cá nhân (giống bản web: public/social-ui.js). Máy chủ tính: src/achievements.js.

const SHOW = 8;
const RING = { light: ["#D3DAD7", "#C2783A", "#8E9DA8", "#E0A100"], dark: ["#3A4743", "#C2783A", "#A9B6BF", "#F2B81C"] };
const FILL = { light: ["", "#F8E6D6", "#E9EEF2", "#FFF1C2"], dark: ["", "#3B2618", "#2A3238", "#3A2F0E"] };

const fmt = (n: number) => n.toLocaleString("vi-VN");

function detailOf(a: Achievement) {
  if (!a.tier) return `${a.icon} ${a.name}: ${a.text} (${fmt(a.value)}/${fmt(a.next || 0)}).`;
  return `${a.icon} ${a.name} · ${a.tierName}: ${a.done}.${a.next ? ` Tiếp theo: ${a.text} (${fmt(a.value)}/${fmt(a.next)}).` : " Đã đạt bậc cao nhất!"}`;
}

export function Achievements({ data }: { data: { list: Achievement[]; earned: number; total: number } }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  if (!data.list.length) return null;
  const scheme = c.scheme === "dark" ? "dark" : "light";
  const list = all ? data.list : data.list.slice(0, SHOW);
  const sel = data.list.find((a) => a.id === picked) || null;
  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.title}>
          Thành tựu{" "}
          <Text style={s.count}>
            {data.earned}/{data.total}
          </Text>
        </Text>
        {data.list.length > SHOW ? (
          <Pressable onPress={() => setAll(!all)} hitSlop={8} accessibilityRole="button">
            <Text style={[s.more, { color: c.accent }]}>{all ? "Thu gọn" : "Xem tất cả"}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={s.grid}>
        {list.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => setPicked(a.id)}
            style={[s.item, picked === a.id && { backgroundColor: c.field }]}
            accessibilityRole="button"
            accessibilityLabel={`${a.name}${a.tier ? `, bậc ${a.tierName}` : ", chưa đạt"}. ${a.tier ? a.done : a.text}`}
          >
            <View style={[s.medal, { borderColor: RING[scheme][a.tier], backgroundColor: a.tier ? FILL[scheme][a.tier] : c.field }, a.tier === 3 && s.gold]}>
              <Text style={[s.icon, !a.tier && { opacity: 0.35 }]}>{a.icon}</Text>
              {a.isNew ? (
                <View style={[s.new, { backgroundColor: c.danger }]}>
                  <Text style={s.newText}>Mới</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.name} numberOfLines={2}>
              {a.name}
            </Text>
            {a.next ? (
              <View style={[s.bar, { backgroundColor: c.field }]}>
                <View style={[s.barFill, { width: `${Math.round(a.progress * 100)}%`, backgroundColor: c.jade }]} />
              </View>
            ) : (
              <Text style={[s.tier, { color: scheme === "dark" ? "#F2C04E" : "#9A6B00" }]}>{a.tierName}</Text>
            )}
          </Pressable>
        ))}
      </View>
      <Text style={[s.detail, !sel && { color: c.muted }]} accessibilityLiveRegion="polite">
        {sel ? detailOf(sel) : "Chạm vào huy hiệu để xem cách đạt được."}
      </Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { marginTop: 14 },
    head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 },
    title: { color: c.text, fontSize: 16, fontWeight: "800" },
    count: { color: c.muted, fontSize: 14, fontWeight: "700" },
    more: { fontSize: 14, fontWeight: "800" },
    grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 10 },
    item: { width: "25%", alignItems: "center", gap: 5, paddingVertical: 4, paddingHorizontal: 2, borderRadius: 14 },
    medal: { width: 54, height: 54, borderRadius: 27, borderWidth: 3, alignItems: "center", justifyContent: "center" },
    gold: { shadowColor: "#E0A100", shadowOpacity: 0.45, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 3 },
    icon: { fontSize: 25, lineHeight: 30 },
    new: { position: "absolute", top: -7, right: -12, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 },
    newText: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "800" },
    name: { color: c.text, fontSize: 12, fontWeight: "700", textAlign: "center", lineHeight: 15, minHeight: 30 },
    bar: { width: "70%", height: 4, borderRadius: 2, overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 2 },
    tier: { fontSize: 11, fontWeight: "800" },
    detail: { marginTop: 8, color: c.text2, fontSize: 13.5, lineHeight: 19 },
  });
