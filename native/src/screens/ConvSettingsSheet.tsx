import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { useShallow } from "zustand/react/shallow";

import { emojiOf, isMuted, MUTE_OPTIONS, QUICK_EMOJIS, THEMES, themeOf } from "../chatThemes";
import { convTitle, dayKey, dayLabel, hm } from "../format";
import { namesOf, setAppearance, setConvPrefs, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { Conversation } from "../types";
import { Button, ConvAvatar, Icon, type IconName, SectionLabel, Sheet, SheetItem, useStyles } from "../ui";
import { MediaGrid, NO_PINS, useMedia } from "./ChatExtras";

/** Chữ mô tả trạng thái thông báo */
export function muteText(c: Conversation) {
  if (!isMuted(c)) return "Đang bật thông báo";
  if (c.mutedUntil === -1) return "Đã tắt thông báo cho đến khi bật lại";
  const until = c.mutedUntil || 0;
  return `Đã tắt thông báo đến ${hm(until)}${dayKey(until) !== dayKey(Date.now()) ? ` ${dayLabel(until).toLowerCase()}` : ""}`;
}

/** Chọn thời gian tắt thông báo (dùng chung cho danh sách cuộc trò chuyện và bảng tùy chỉnh) */
export function MuteSheet({ conv, visible, onClose }: { conv: Conversation; visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={isMuted(conv) ? "Thông báo" : "Tắt thông báo"}>
      {isMuted(conv) ? (
        <SheetItem
          icon="notifications-active"
          label="Bật lại thông báo"
          hint={muteText(conv)}
          onPress={() => {
            onClose();
            setConvPrefs(conv.id, { mutedUntil: 0 });
          }}
        />
      ) : (
        MUTE_OPTIONS.map((o) => (
          <SheetItem
            key={o.label}
            icon="notifications-off"
            label={o.label}
            hint={o.ms === -1 ? "Vẫn nhận thông báo khi có người @nhắc tên bạn" : undefined}
            onPress={() => {
              onClose();
              setConvPrefs(conv.id, { mutedUntil: o.ms === -1 ? -1 : Date.now() + o.ms });
            }}
          />
        ))
      )}
    </Sheet>
  );
}

/** "Tùy chỉnh đoạn chat": chủ đề, biểu tượng gửi nhanh, tắt thông báo, ghim, tin đã ghim, ảnh đã gửi */
export function ConvSettingsSheet({
  conv,
  visible,
  onClose,
  onSearch,
  onMembers,
  onPins,
  onOpenImage,
}: {
  conv: Conversation;
  visible: boolean;
  onClose: () => void;
  onSearch: () => void;
  onMembers: () => void;
  onPins: () => void;
  onOpenImage: (image: string) => void;
}) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const { users, me, pinsRaw } = useStore(useShallow((st) => ({ users: st.users, me: st.me, pinsRaw: st.pins[conv.id] })));
  // Không tạo mảng mới trong bộ chọn của store (sẽ làm React vẽ lại mãi không dừng)
  const pins = pinsRaw || NO_PINS;
  const names = useMemo(() => namesOf({ me, users }), [me, users]);
  const [muteOpen, setMuteOpen] = useState(false);
  const [allMedia, setAllMedia] = useState(false);
  const media = useMedia(conv.id, visible);
  const theme = themeOf(conv);
  const emoji = emojiOf(conv);
  const thumb = Math.floor((Math.min(width, 560) - 40 - 8) / 3);

  const quick = (icon: IconName, label: string, onPress: () => void, on = false) => (
    <Pressable onPress={onPress} style={({ pressed }) => [s.quick, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[s.quickIc, { backgroundColor: on ? c.jadeWash : c.field }]}>
        <Icon name={icon} size={22} color={on ? c.accent : c.text} />
      </View>
      <Text style={s.quickText} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <>
      <Sheet visible={visible && !muteOpen} onClose={onClose} title="Tùy chỉnh đoạn chat">
        <View style={s.profile}>
          <ConvAvatar conv={conv} users={users} meId={names.meId} size={72} dot={false} />
          <Text style={[s.title, { color: c.text }]}>{convTitle(conv, names.nameOf)}</Text>
          <Text style={s.hint}>{muteText(conv)}</Text>
        </View>
        <View style={s.quickRow}>
          {quick("search", "Tìm tin nhắn", () => {
            onClose();
            setTimeout(onSearch, 250);
          })}
          {quick(isMuted(conv) ? "notifications-active" : "notifications-off", isMuted(conv) ? "Bật thông báo" : "Tắt thông báo", () => setMuteOpen(true), isMuted(conv))}
          {quick("push-pin", conv.pinnedAt ? "Bỏ ghim" : "Ghim lên đầu", () => setConvPrefs(conv.id, { pinned: !conv.pinnedAt }), Boolean(conv.pinnedAt))}
          {quick(conv.type === "group" ? "group" : "info-outline", conv.type === "group" ? "Thành viên" : "Thông tin", () => {
            onClose();
            setTimeout(onMembers, 250);
          })}
        </View>

        <SectionLabel>Chủ đề: {theme.name}</SectionLabel>
        <View style={s.themeGrid} accessibilityRole="radiogroup" accessibilityLabel="Chủ đề">
          {THEMES.map((t) => {
            const on = theme.id === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => !on && setAppearance(conv.id, { theme: t.id })}
                style={[s.theme, on && { backgroundColor: c.field }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={t.name}
              >
                <Svg width={46} height={46}>
                  <Defs>
                    <LinearGradient id={`th-${t.id}`} x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor={t.a} />
                      <Stop offset="1" stopColor={t.b} />
                    </LinearGradient>
                  </Defs>
                  {on ? <Circle cx={23} cy={23} r={22} stroke={t.a} strokeWidth={2.5} fill="none" /> : null}
                  <Circle cx={23} cy={23} r={on ? 17 : 20} fill={`url(#th-${t.id})`} />
                </Svg>
                <Text style={[s.themeName, on && { color: c.text, fontWeight: "800" }]} numberOfLines={1}>
                  {t.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>Biểu tượng gửi nhanh: {emoji}</SectionLabel>
        <Text style={s.hint}>Khi ô nhập trống, nút gửi thành biểu tượng này, bấm là gửi ngay.</Text>
        <View style={s.emojiGrid}>
          {QUICK_EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => e !== emoji && setAppearance(conv.id, { emoji: e })}
              style={[s.emoji, e === emoji && { backgroundColor: c.jadeWash, borderColor: c.accent }]}
              accessibilityRole="button"
              accessibilityState={{ selected: e === emoji }}
              accessibilityLabel={`Chọn ${e}`}
            >
              <Text style={s.emojiText}>{e}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.rowBetween}>
          <SectionLabel>Tin nhắn đã ghim ({pins.length})</SectionLabel>
          {pins.length ? (
            <Button
              title="Xem"
              small
              kind="secondary"
              onPress={() => {
                onClose();
                setTimeout(onPins, 250);
              }}
            />
          ) : null}
        </View>
        {!pins.length ? <Text style={s.hint}>Chạm giữ một tin nhắn rồi chọn Ghim để giữ nó ở đầu cuộc trò chuyện.</Text> : null}

        <View style={s.rowBetween}>
          <SectionLabel>Ảnh đã gửi</SectionLabel>
          {media.list.length > 9 && !allMedia ? <Button title="Xem tất cả" small kind="secondary" onPress={() => setAllMedia(true)} /> : null}
        </View>
        {media.list.length ? (
          <MediaGrid
            items={allMedia ? media.list : media.list.slice(0, 9)}
            size={thumb}
            onOpen={(img) => {
              onClose();
              setTimeout(() => onOpenImage(img), 250);
            }}
          />
        ) : (
          <Text style={s.hint}>{media.loading ? "Đang tải…" : "Chưa có ảnh nào."}</Text>
        )}
        {allMedia && media.hasMore ? <Button title={media.loading ? "Đang tải…" : "Tải thêm"} small kind="secondary" onPress={media.more} /> : null}
      </Sheet>
      <MuteSheet conv={conv} visible={visible && muteOpen} onClose={() => setMuteOpen(false)} />
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    profile: { alignItems: "center", gap: 4, paddingVertical: 6 },
    title: { fontSize: 19, fontWeight: "800", marginTop: 4 },
    hint: { color: c.muted, fontSize: 13.5, lineHeight: 19 },
    quickRow: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 8 },
    quick: { alignItems: "center", gap: 6, width: 78 },
    quickIc: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
    quickText: { color: c.text2, fontSize: 12.5, fontWeight: "700", textAlign: "center" },
    themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    theme: { width: "24%", alignItems: "center", gap: 4, paddingVertical: 8, borderRadius: 14 },
    themeName: { color: c.text2, fontSize: 12, fontWeight: "600" },
    emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    emoji: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "transparent" },
    emojiText: { fontSize: 24 },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  });
