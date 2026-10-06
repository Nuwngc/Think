import { useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { Avatar, Icon, type IconName } from "../ui";
import { acceptCall, flipCamera, hangup, toggleCamera, toggleMute, toggleSpeaker, useCall, type CallView } from "./engine";
import { StreamView } from "./rtc";

// Màn hình cuộc gọi (gọi đi, cuộc gọi đến, đang gọi). Bản web: public/calls-ui.js — cùng chữ, cùng cách sắp xếp.

const INK = "#F2F6F4";
const DIM = "rgba(242,246,244,0.75)";

export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function statusText(v: CallView, now: number) {
  if (v.phase === "ended") return v.connectedAt ? `${v.endedText} · ${clock((now - v.connectedAt) / 1000)}` : v.endedText || "";
  if (v.reconnecting) return "Đang kết nối lại…";
  switch (v.phase) {
    case "preparing":
      return v.video ? "Đang mở máy ảnh…" : "Đang mở micro…";
    case "ringing":
      return "Đang đổ chuông…";
    case "incoming":
      return `Cuộc gọi ${v.video ? "video" : "thoại"} đến`;
    case "connecting":
      return "Đang kết nối…";
    case "active":
      return clock((now - (v.connectedAt || now)) / 1000);
    default:
      return "";
  }
}

function CallButton({
  icon,
  label,
  onPress,
  kind,
  pressed: on,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  kind?: "end" | "accept";
  pressed?: boolean;
}) {
  const bg = kind === "end" ? "#E5484D" : kind === "accept" ? "#1FA971" : on ? INK : "rgba(255,255,255,0.16)";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      hitSlop={6}
      style={({ pressed }) => [s.btn, pressed && { opacity: 0.75 }]}
    >
      <View style={[s.btnIc, { backgroundColor: bg }]}>
        <Icon name={icon} size={28} color={on && !kind ? "#0D2620" : INK} />
      </View>
      <Text style={s.btnLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Đặt ở gốc app: có cuộc gọi thì phủ cả màn hình */
export function CallScreen() {
  const v = useCall((st) => st.view);
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now());
  const ticking = v?.phase === "active";
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  const open = Boolean(v);
  useEffect(() => {
    if (!open) return;
    // Nút Back của Android không làm mất cuộc gọi
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [open]);
  if (!v) return null;

  const showRemote = v.video && v.phase === "active" && v.remoteVideo && v.remoteCam && Boolean(v.remote);
  const showLocal = v.video && v.camOn && v.phase !== "ended" && Boolean(v.local?.getVideoTracks().length);
  const hasCam = Boolean(v.local?.getVideoTracks().length);
  const ringing = v.phase === "ringing" || v.phase === "incoming";
  const status = statusText(v, Math.max(now, Date.now()));

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="callbg" cx="50%" cy="0%" rx="130%" ry="70%" fx="50%" fy="0%">
            <Stop offset="0" stopColor="#1F5A4C" />
            <Stop offset="0.5" stopColor="#0D2620" />
            <Stop offset="1" stopColor="#060F0C" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#callbg)" />
      </Svg>
      {v.remote ? <StreamView stream={v.remote} fit="cover" style={showRemote ? StyleSheet.absoluteFill : s.hiddenVideo} zOrder={0} /> : null}

      <View style={[s.peer, showRemote ? [s.peerTop, { paddingTop: insets.top + 16 }] : { paddingTop: insets.top + 32 }]}>
        {showRemote ? null : (
          <View style={[s.avatarWrap, ringing && s.ringing]}>
            <Avatar user={{ ...v.peer, online: false }} size={116} dot={false} />
          </View>
        )}
        <Text style={[s.name, showRemote && { fontSize: 19 }]} numberOfLines={2}>
          {v.peer.displayName}
        </Text>
        <Text style={s.status} accessibilityLiveRegion="polite" testID="call-status">
          {status}
        </Text>
        {v.phase === "active" && v.remoteMuted ? (
          <View style={s.note}>
            <Icon name="mic-off" size={16} color={INK} />
            <Text style={s.noteText}>{v.peer.displayName} đang tắt micro</Text>
          </View>
        ) : null}
        {v.phase === "active" && v.video && !v.remoteCam ? (
          <View style={s.note}>
            <Icon name="videocam-off" size={16} color={INK} />
            <Text style={s.noteText}>Máy ảnh bên kia đang tắt</Text>
          </View>
        ) : null}
      </View>

      {showLocal ? (
        <View style={[s.local, { top: insets.top + 14 }]}>
          <StreamView stream={v.local} mirror={v.facing === "user"} muted fit="cover" style={StyleSheet.absoluteFill} zOrder={1} />
        </View>
      ) : null}

      <View style={[s.actions, { paddingBottom: insets.bottom + 34 }, v.phase === "incoming" && { gap: 96 }]}>
        {v.phase === "ended" ? null : v.phase === "incoming" ? (
          <>
            <CallButton icon="call-end" label="Từ chối" kind="end" onPress={() => hangup()} />
            <CallButton icon={v.video ? "videocam" : "call"} label="Trả lời" kind="accept" onPress={() => acceptCall()} />
          </>
        ) : (
          <>
            <CallButton icon={v.muted ? "mic-off" : "mic"} label={v.muted ? "Bật micro" : "Tắt micro"} pressed={v.muted} onPress={toggleMute} />
            {v.video && hasCam ? (
              <CallButton
                icon={v.camOn ? "videocam" : "videocam-off"}
                label={v.camOn ? "Tắt máy ảnh" : "Bật máy ảnh"}
                pressed={!v.camOn}
                onPress={toggleCamera}
              />
            ) : null}
            {v.video && hasCam && Platform.OS !== "web" ? <CallButton icon="flip-camera-android" label="Đổi máy ảnh" onPress={flipCamera} /> : null}
            {Platform.OS !== "web" ? <CallButton icon="volume-up" label="Loa ngoài" pressed={v.speaker} onPress={toggleSpeaker} /> : null}
            <CallButton icon="call-end" label="Kết thúc" kind="end" onPress={() => hangup()} />
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  hiddenVideo: { position: "absolute", width: 1, height: 1, opacity: 0 },
  peer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  peerTop: {
    flex: 0,
    alignItems: "flex-start",
    justifyContent: "flex-start",
    paddingLeft: 20,
    paddingRight: 140,
    paddingBottom: 24,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  avatarWrap: { marginBottom: 14, padding: 8, borderRadius: 80, borderWidth: 2, borderColor: "transparent" },
  ringing: { borderColor: "rgba(242,246,244,0.35)" },
  name: { color: INK, fontSize: 26, fontWeight: "800", textAlign: "center" },
  status: { color: DIM, fontSize: 15, fontVariant: ["tabular-nums"] },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  noteText: { color: INK, fontSize: 13 },
  local: { position: "absolute", right: 14, width: 108, height: 144, borderRadius: 16, overflow: "hidden", backgroundColor: "#111" },
  actions: { flexDirection: "row", justifyContent: "center", alignItems: "flex-start", gap: 18, paddingTop: 20, paddingHorizontal: 12, marginTop: "auto" },
  btn: { alignItems: "center", gap: 8, minWidth: 62 },
  btnIc: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center" },
  btnLabel: { color: INK, fontSize: 12.5, fontWeight: "600" },
});
