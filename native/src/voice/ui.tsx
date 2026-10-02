import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

import { isPending } from "../messages";
import { sendVoice, showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import type { ChatItem } from "../types";
import { Icon, useStyles } from "../ui";
import { clock, decodeWave, encodeWave, levelFromDb, MAX_MS, MIN_MS } from "./core";
import { cycleRate, rateLabel, stopVoice, toggleVoice, useVoice } from "./player";

// Tin nhắn thoại trong app (giống bản web: public/voice-ui.js).
// - Ghi âm: giữ nút micro để nói, thả tay là gửi, kéo ngón tay ra xa nút để hủy. Chạm nhanh thì ghi rảnh tay
//   (bấm Gửi hoặc Hủy trên thanh ghi âm). Tối đa 2 phút.
// - Nghe: phát / tạm dừng, chạm vào dạng sóng để tua, đổi tốc độ 1× / 1,5× / 2×; phát xong tự phát tin thoại kế tiếp.

const HOLD_TAP_MS = 300;
const CANCEL_DIST = 70;
const LIVE_BARS = 26;

/** Ghi giọng nói: M4A một kênh 64 kb/s (khoảng 0,5 MB / phút), có đo âm lượng để vẽ sóng */
const VOICE_PRESET: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true };

/* ======================= Nghe ======================= */

/** Phát tiếp tin thoại kế tiếp (của người khác) trong cùng cuộc trò chuyện */
function playNext(convId: number, afterId: number) {
  const st = useStore.getState();
  const meId = st.me?.id;
  const list = st.msgs[convId]?.list || [];
  const i = list.findIndex((x) => !isPending(x) && x.id === afterId);
  if (i < 0) return;
  const next = list.slice(i + 1).find((x) => !isPending(x) && x.kind === "voice" && !x.deleted && x.senderId !== meId && x.audio);
  if (next && !isPending(next) && next.audio) toggleVoice(next.audio.url, next.audio.url, next.audio.ms, { next: () => playNext(convId, next.id) });
}

export const VoiceBubble = memo(function VoiceBubble({ m, mine, accent }: { m: ChatItem; mine: boolean; accent: string }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const a = m.audio;
  const key = a?.url || "";
  const active = useVoice((v) => Boolean(key) && v.key === key);
  const playing = useVoice((v) => Boolean(key) && v.key === key && v.playing);
  const position = useVoice((v) => (key && v.key === key ? v.position : 0));
  const duration = useVoice((v) => (key && v.key === key ? v.duration : 0));
  const rate = useVoice((v) => v.rate);
  const bars = useMemo(() => decodeWave(a?.wave), [a?.wave]);
  const width = useRef(1);
  const fg = mine ? c.mineText : c.theirsText;
  if (!a) {
    return (
      <View style={s.gone}>
        <Icon name="mic-off" size={18} color={fg} />
        <Text style={[s.goneText, { color: fg }]}>{"audioPurged" in m && m.audioPurged ? "Tin nhắn thoại đã được dọn khỏi máy chủ" : "Tin nhắn thoại"}</Text>
      </View>
    );
  }
  const total = duration || a.ms / 1000;
  const frac = active && total ? Math.min(1, position / total) : 0;
  const played = Math.round(frac * bars.length);
  const next = () => (!isPending(m) ? playNext(m.conversationId, m.id) : undefined);
  const toggle = (at?: number) => toggleVoice(key, a.url, a.ms, { at, next });
  return (
    <View style={s.voice}>
      <Pressable
        onPress={() => toggle()}
        hitSlop={6}
        style={({ pressed }) => [s.play, { backgroundColor: mine ? "rgba(255,255,255,0.24)" : accent, opacity: pressed ? 0.8 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={playing ? "Tạm dừng tin nhắn thoại" : `Phát tin nhắn thoại ${clock(a.ms)}`}
      >
        <Icon name={playing ? "pause" : "play-arrow"} size={24} color="#FFFFFF" />
      </Pressable>
      <Pressable
        style={s.wave}
        onLayout={(e) => {
          width.current = Math.max(1, e.nativeEvent.layout.width);
        }}
        onPress={(e) => toggle(Math.min(1, Math.max(0, e.nativeEvent.locationX / width.current)))}
        accessibilityRole="adjustable"
        accessibilityLabel="Tua tin nhắn thoại"
        accessibilityValue={{ min: 0, max: Math.round(a.ms / 1000), now: Math.round(active ? position : 0) }}
      >
        {bars.map((v, i) => (
          <View
            key={i}
            style={[
              s.bar,
              { height: `${Math.round(18 + v * 82)}%`, backgroundColor: i < played ? (mine ? "#FFFFFF" : accent) : fg, opacity: i < played ? 1 : 0.4 },
            ]}
          />
        ))}
      </Pressable>
      <Text style={[s.time, { color: fg }]}>{clock(active && (playing || position > 0) ? position * 1000 : a.ms)}</Text>
      <Pressable
        onPress={cycleRate}
        hitSlop={8}
        style={[s.speed, { backgroundColor: mine ? "rgba(255,255,255,0.2)" : c.field }]}
        accessibilityRole="button"
        accessibilityLabel={`Tốc độ ${rateLabel(rate)}. Bấm để đổi`}
      >
        <Text style={[s.speedText, { color: fg }]}>{rateLabel(rate)}</Text>
      </Pressable>
    </View>
  );
});

/* ======================= Ghi âm ======================= */

type RecState = "idle" | "starting" | "recording" | "finishing";

/**
 * Nút micro + thanh ghi âm trong ô nhập tin. onActive(true) khi đang ghi (khung chat ẩn ô nhập để thanh ghi âm
 * thay chỗ). disabled: mất mạng / đang sửa tin.
 */
export function VoiceRecorder({ convId, accent, disabled, onActive }: { convId: number; accent: string; disabled?: boolean; onActive: (on: boolean) => void }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const recorder = useAudioRecorder(VOICE_PRESET);
  const status = useAudioRecorderState(recorder, 100);
  const [state, setState] = useState<RecState>("idle");
  const [locked, setLocked] = useState(false);
  const [cancelZone, setCancelZone] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const r = useRef({ state: "idle" as RecState, held: false, downAt: 0, startedAt: 0, levels: [] as number[], cancelZone: false, gen: 0, asking: false });

  const move = (next: RecState) => {
    r.current.state = next;
    setState(next);
    onActive(next !== "idle");
  };

  // Mức âm lượng → sóng; quá 2 phút thì tự gửi
  useEffect(() => {
    if (r.current.state !== "recording") return;
    r.current.levels.push(levelFromDb(status.metering));
    setLevels(r.current.levels.slice(-LIVE_BARS));
    if (Date.now() - r.current.startedAt >= MAX_MS) {
      showToast("Tin nhắn thoại dài tối đa 2 phút — đã gửi.");
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy theo nhịp đo của máy ghi
  }, [status.durationMillis, status.metering]);

  async function begin() {
    const gen = ++r.current.gen;
    stopVoice(); // đang nghe tin thoại thì dừng
    r.current.levels = [];
    setLevels([]);
    move("starting");
    try {
      let perm = await getRecordingPermissionsAsync();
      if (!perm.granted) {
        // Hộp hỏi quyền cắt ngang thao tác giữ nút: cho phép xong thì ghi rảnh tay (bấm Gửi / Hủy)
        r.current.asking = true;
        setLocked(true);
        try {
          perm = await requestRecordingPermissionsAsync();
        } finally {
          r.current.asking = false;
        }
        r.current.held = false;
      }
      if (gen !== r.current.gen) return;
      if (!perm.granted) {
        move("idle");
        setLocked(false);
        showToast("Think chưa được dùng micro. Vào Cài đặt của máy → Ứng dụng → Think Beta → Quyền → Micrô để bật.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (gen !== r.current.gen) return;
      recorder.record();
      r.current.startedAt = Date.now();
      move("recording");
      AccessibilityInfo.announceForAccessibility?.("Đang ghi âm");
    } catch {
      if (gen !== r.current.gen) return;
      move("idle");
      setLocked(false);
      setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      showToast("Không bật được micro. Thử lại sau nhé.");
    }
  }

  async function stopRecorder() {
    try {
      await recorder.stop();
    } catch {
      /* chưa ghi */
    }
    setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }

  async function cancel() {
    if (r.current.state === "idle") return;
    r.current.gen++;
    const was = r.current.state;
    move("idle");
    setLocked(false);
    setCancelZone(false);
    r.current.cancelZone = false;
    if (was === "recording") await stopRecorder();
  }

  async function finish() {
    if (r.current.state === "starting") return cancel();
    if (r.current.state !== "recording") return;
    const ms = Math.min(MAX_MS, Date.now() - r.current.startedAt);
    const wave = encodeWave(r.current.levels);
    move("finishing");
    await stopRecorder();
    const uri = recorder.uri;
    move("idle");
    setLocked(false);
    if (ms < MIN_MS || !uri) {
      showToast("Tin nhắn thoại ngắn quá. Giữ nút micro trong lúc nói nhé.");
      return;
    }
    sendVoice(convId, { uri, ms, wave, mime: "audio/mp4" });
  }

  // Rời khung chat lúc đang ghi: bỏ bản ghi
  useEffect(
    () => () => {
      if (r.current.state !== "idle") {
        r.current.gen++;
        r.current.state = "idle";
        recorder.stop().catch(() => undefined);
        setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
    },
    [recorder],
  );

  const fns = useRef({ begin, cancel, finish });
  fns.current = { begin, cancel, finish };
  const dis = useRef(disabled);
  dis.current = disabled;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const cur = r.current;
          if (cur.state === "recording") {
            // Đang ghi rảnh tay: chạm micro lần nữa là gửi
            cur.held = false;
            fns.current.finish();
            return;
          }
          if (cur.state !== "idle" || dis.current) return;
          cur.held = true;
          cur.downAt = Date.now();
          cur.cancelZone = false;
          setCancelZone(false);
          setLocked(false);
          fns.current.begin();
        },
        onPanResponderMove: (_, g) => {
          const cur = r.current;
          if (!cur.held) return;
          const far = Math.hypot(g.dx, g.dy) > CANCEL_DIST;
          if (far !== cur.cancelZone) {
            cur.cancelZone = far;
            setCancelZone(far);
          }
        },
        onPanResponderRelease: () => {
          const cur = r.current;
          if (!cur.held) return;
          cur.held = false;
          if (Date.now() - cur.downAt < HOLD_TAP_MS || cur.state === "starting") setLocked(true);
          else if (cur.cancelZone) fns.current.cancel();
          else fns.current.finish();
        },
        onPanResponderTerminate: () => {
          if (!r.current.held) return;
          r.current.held = false;
          if (r.current.asking) return; // hộp hỏi quyền micro vừa hiện: không hủy, ghi rảnh tay sau khi cho phép
          fns.current.cancel();
        },
      }),
    [],
  );

  const on = state !== "idle";
  const elapsed = state === "recording" ? Math.max(0, status.durationMillis || Date.now() - r.current.startedAt) : 0;
  const live = Array.from({ length: LIVE_BARS }, (_, i) => levels[i - (LIVE_BARS - levels.length)] || 0);
  const hint = state === "starting" ? "Đang bật micro…" : locked ? "Đang ghi âm" : cancelZone ? "Thả tay để hủy" : "Thả để gửi · kéo xa để hủy";

  return (
    <>
      <View
        {...pan.panHandlers}
        style={[s.mic, on && { backgroundColor: c.danger, transform: [{ scale: 1.12 }] }, disabled && !on && { opacity: 0.4 }]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={on ? "Gửi tin nhắn thoại" : "Ghi âm: giữ để nói, thả tay để gửi"}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={() => {
          if (r.current.state === "idle") {
            if (disabled) return;
            setLocked(true);
            begin();
          } else finish();
        }}
      >
        <Icon name="mic" size={24} color={on ? "#FFFFFF" : accent} />
      </View>
      {on ? (
        <View style={[s.recBar, cancelZone && !locked && { backgroundColor: c.dangerWash }]}>
          <View style={[s.dot, { backgroundColor: c.danger }]} />
          <Text style={s.recTime}>{clock(elapsed)}</Text>
          <View style={s.live}>
            {live.map((v, i) => (
              <View key={i} style={[s.liveBar, { height: `${Math.round(12 + v * 88)}%`, backgroundColor: c.danger }]} />
            ))}
          </View>
          {locked ? (
            <>
              <Pressable onPress={() => cancel()} hitSlop={6} style={s.recBtn} accessibilityRole="button" accessibilityLabel="Hủy ghi âm">
                <Icon name="delete-outline" size={24} color={c.danger} />
              </Pressable>
              <Pressable
                onPress={() => finish()}
                hitSlop={6}
                style={[s.recBtn, { backgroundColor: accent }]}
                accessibilityRole="button"
                accessibilityLabel="Gửi tin nhắn thoại"
              >
                <Icon name="send" size={20} color="#FFFFFF" />
              </Pressable>
            </>
          ) : (
            <Text style={[s.hint, cancelZone && { color: c.danger, fontWeight: "800" }]} numberOfLines={1} accessibilityLiveRegion="polite">
              {hint}
            </Text>
          )}
        </View>
      ) : null}
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    voice: { flexDirection: "row", alignItems: "center", gap: 8, width: 252, maxWidth: "100%", paddingVertical: 2 },
    play: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    wave: { flex: 1, height: 30, flexDirection: "row", alignItems: "center", gap: 1.5, overflow: "hidden" },
    bar: { flex: 1, minWidth: 1.5, borderRadius: 2 },
    time: { minWidth: 32, fontSize: 12.5, fontWeight: "600", fontVariant: ["tabular-nums"], textAlign: "right" },
    speed: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
    speedText: { fontSize: 11.5, fontWeight: "800" },
    gone: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 4 },
    goneText: { fontSize: 14, opacity: 0.85 },
    mic: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
    // thanh ghi âm thay chỗ ô nhập
    recBar: {
      flex: 1,
      minWidth: 0,
      height: 42,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 12,
      paddingRight: 4,
      borderRadius: 21,
      backgroundColor: c.field,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    recTime: { color: c.text, fontWeight: "800", fontVariant: ["tabular-nums"], minWidth: 34 },
    live: { flex: 1, height: 26, flexDirection: "row", alignItems: "center", gap: 2, overflow: "hidden" },
    liveBar: { flex: 1, minWidth: 2, maxWidth: 3, borderRadius: 2 },
    hint: { color: c.muted, fontSize: 13, flexShrink: 1, maxWidth: "62%" },
    recBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  });
