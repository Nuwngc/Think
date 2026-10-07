import { useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useShallow } from "zustand/react/shallow";

import { useStore } from "../store";
import { Avatar, ConvAvatar, Icon, type IconName } from "../ui";
import { acceptCall, flipCamera, hangup, toggleCamera, toggleMute, toggleSpeaker, useCall, type CallView, type PeerView } from "./engine";
import { StreamView } from "./rtc";
import type { CallPeer, Stream } from "./types";

// Màn hình cuộc gọi: gọi 1-1 (gọi đi, cuộc gọi đến, đang gọi) và gọi nhóm (lưới ô, mỗi người một ô).
// Bản web: public/calls-ui.js — cùng chữ, cùng cách sắp xếp.

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
  if (v.phase === "ended") {
    const text = v.endedText || "";
    return v.connectedAt && text.length < 40 ? `${text} · ${clock((now - v.connectedAt) / 1000)}` : text;
  }
  if (v.kind === "group") {
    if (v.phase === "preparing") return v.video ? "Đang mở máy ảnh…" : "Đang mở micro…";
    if (v.phase === "incoming") return `Cuộc gọi nhóm${v.video ? " video" : ""} đến`;
    if (!v.peers.length) return v.ringing.length ? `Đang gọi ${v.ringing.length} người…` : "Chỉ còn bạn trong cuộc gọi";
    return v.connectedAt ? `${clock((now - v.connectedAt) / 1000)} · ${v.peers.length + 1} người` : "Đang kết nối…";
  }
  if (v.peers[0]?.reconnecting) return "Đang kết nối lại…";
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

/** Một ô trong lưới gọi nhóm */
function Tile({
  user,
  stream,
  showVideo,
  mirror,
  self,
  muted,
  note,
}: {
  user: CallPeer;
  stream: Stream | null;
  showVideo: boolean;
  mirror?: boolean;
  self?: boolean;
  muted: boolean;
  note?: string;
}) {
  return (
    <View style={s.tile} accessibilityLabel={`${user.displayName}${muted ? ", đang tắt micro" : ""}${note ? `, ${note}` : ""}`}>
      {/* Hình (và tiếng, bản web) của người này; tắt máy ảnh thì giấu khung, hiện ảnh đại diện */}
      {stream ? (
        <StreamView
          stream={stream}
          mirror={mirror}
          muted={self}
          fit="cover"
          style={showVideo ? StyleSheet.absoluteFill : s.hiddenVideo}
          zOrder={self ? 1 : 0}
        />
      ) : null}
      {showVideo ? null : <Avatar user={{ ...user, online: false }} size={84} dot={false} />}
      <View style={s.tileFoot}>
        {muted ? (
          <View style={s.tileMute}>
            <Icon name="mic-off" size={14} color={INK} />
          </View>
        ) : null}
        <Text style={s.tileName} numberOfLines={1}>
          {user.displayName}
        </Text>
        {note ? (
          <Text style={s.tileNote} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const peerNote = (p: PeerView) => (p.failed ? "Không nối được" : p.reconnecting ? "Đang nối lại…" : !p.connected ? "Đang kết nối…" : undefined);

/** Lưới ô của cuộc gọi nhóm: dọc 1 cột (2 người) hoặc 2 cột */
function GroupGrid({ v, me }: { v: CallView; me: CallPeer }) {
  const tiles = [
    ...v.peers.map((p) => (
      <Tile key={p.id} user={p.user} stream={p.remote} showVideo={v.video && p.remoteVideo && p.camera && p.connected} muted={p.muted} note={peerNote(p)} />
    )),
    <Tile
      key="me"
      self
      user={{ ...me, displayName: "Bạn" }}
      stream={v.local}
      showVideo={v.video && v.camOn && Boolean(v.local?.getVideoTracks().length)}
      mirror={v.facing === "user"}
      muted={v.muted}
    />,
  ];
  const cols = tiles.length <= 2 ? 1 : 2;
  const rows: (typeof tiles)[] = [];
  for (let i = 0; i < tiles.length; i += cols) rows.push(tiles.slice(i, i + cols));
  return (
    <View style={s.grid}>
      {rows.map((row, i) => (
        <View key={i} style={s.gridRow}>
          {row}
          {row.length < cols ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

/** Đặt ở gốc app: có cuộc gọi thì phủ cả màn hình */
export function CallScreen() {
  const v = useCall((st) => st.view);
  const insets = useSafeAreaInsets();
  const { users, me, conv } = useStore(useShallow((st) => ({ users: st.users, me: st.me, conv: v ? st.convs[v.convId] : undefined })));
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

  const group = v.kind === "group";
  const grid = group && v.phase !== "incoming" && v.phase !== "ended";
  const p = v.peers[0];
  const showRemote = !group && v.video && v.phase === "active" && Boolean(p?.remoteVideo && p?.camera && p?.remote);
  const showLocal = !group && v.video && v.camOn && v.phase !== "ended" && Boolean(v.local?.getVideoTracks().length);
  const hasCam = Boolean(v.local?.getVideoTracks().length);
  const ringing = v.phase === "ringing" || v.phase === "incoming";
  const status = statusText(v, Math.max(now, Date.now()));
  const ringNames = v.ringing.map((id) => users[id]?.displayName).filter(Boolean) as string[];
  const myself: CallPeer = me ? { id: me.id, displayName: me.displayName, avatar: me.avatar } : { id: 0, displayName: "Bạn", avatar: null };

  const face = group ? (
    conv ? (
      <ConvAvatar conv={conv} users={users} size={116} dot={false} />
    ) : (
      <Avatar user={{ ...v.peer, online: false }} size={116} dot={false} />
    )
  ) : (
    <Avatar user={{ ...(p?.user || v.peer), online: false }} size={116} dot={false} />
  );

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
      {!group && p?.remote ? <StreamView stream={p.remote} fit="cover" style={showRemote ? StyleSheet.absoluteFill : s.hiddenVideo} zOrder={0} /> : null}

      {grid ? (
        <View style={[s.groupHead, { paddingTop: insets.top + 14 }]}>
          <Text style={[s.name, { fontSize: 19 }]} numberOfLines={1}>
            {v.title}
          </Text>
          <Text style={s.status} accessibilityLiveRegion="polite" testID="call-status">
            {status}
          </Text>
          {ringNames.length && v.phase === "active" ? (
            <Text style={s.ringing} numberOfLines={1}>
              Đang gọi: {ringNames.slice(0, 3).join(", ")}
              {ringNames.length > 3 ? ` và ${ringNames.length - 3} người` : ""}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={[s.peer, showRemote ? [s.peerTop, { paddingTop: insets.top + 16 }] : { paddingTop: insets.top + 32 }]}>
          {showRemote ? null : <View style={[s.avatarWrap, ringing && s.ringingRing]}>{face}</View>}
          <Text style={[s.name, showRemote && { fontSize: 19 }]} numberOfLines={2}>
            {v.title}
          </Text>
          <Text style={s.status} accessibilityLiveRegion="polite" testID="call-status">
            {status}
          </Text>
          {group && v.phase === "incoming" && v.starter ? (
            <View style={s.note}>
              <Text style={s.noteText}>
                {v.starter.displayName} đang gọi nhóm{v.video ? " video" : ""}
              </Text>
            </View>
          ) : null}
          {!group && v.phase === "active" && p?.muted ? (
            <View style={s.note}>
              <Icon name="mic-off" size={16} color={INK} />
              <Text style={s.noteText}>{p.user.displayName} đang tắt micro</Text>
            </View>
          ) : null}
          {!group && v.phase === "active" && v.video && p && !p.camera ? (
            <View style={s.note}>
              <Icon name="videocam-off" size={16} color={INK} />
              <Text style={s.noteText}>Máy ảnh bên kia đang tắt</Text>
            </View>
          ) : null}
        </View>
      )}

      {grid ? <GroupGrid v={v} me={myself} /> : null}

      {showLocal ? (
        <View style={[s.local, { top: insets.top + 14 }]}>
          <StreamView stream={v.local} mirror={v.facing === "user"} muted fit="cover" style={StyleSheet.absoluteFill} zOrder={1} />
        </View>
      ) : null}

      <View style={[s.actions, { paddingBottom: insets.bottom + (grid ? 20 : 34) }, v.phase === "incoming" && { gap: 96 }]}>
        {v.phase === "ended" ? null : v.phase === "incoming" ? (
          <>
            <CallButton icon="call-end" label="Từ chối" kind="end" onPress={() => hangup()} />
            <CallButton icon={v.video ? "videocam" : "call"} label={group ? "Tham gia" : "Trả lời"} kind="accept" onPress={() => acceptCall()} />
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
            <CallButton icon="call-end" label={group ? "Rời" : "Kết thúc"} kind="end" onPress={() => hangup()} />
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
  groupHead: { alignItems: "center", gap: 2, paddingHorizontal: 20, paddingBottom: 10 },
  ringing: { color: "rgba(242,246,244,0.65)", fontSize: 12.5 },
  avatarWrap: { marginBottom: 14, padding: 8, borderRadius: 80, borderWidth: 2, borderColor: "transparent" },
  ringingRing: { borderColor: "rgba(242,246,244,0.35)" },
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
  grid: { flex: 1, gap: 6, paddingHorizontal: 8 },
  gridRow: { flex: 1, flexDirection: "row", gap: 6 },
  tile: { flex: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center" },
  tileFoot: { position: "absolute", left: 8, right: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  tileMute: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  tileName: {
    color: INK,
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.45)",
    flexShrink: 1,
  },
  tileNote: {
    marginLeft: "auto",
    color: DIM,
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  actions: { flexDirection: "row", justifyContent: "center", alignItems: "flex-start", gap: 18, paddingTop: 20, paddingHorizontal: 12, marginTop: "auto" },
  btn: { alignItems: "center", gap: 8, minWidth: 62 },
  btnIc: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center" },
  btnLabel: { color: INK, fontSize: 12.5, fontWeight: "600" },
});
