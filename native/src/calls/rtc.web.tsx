import { useEffect, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";

import type { IceServer, Peer, SessionDesc, Stream, Track } from "./types";

// Bản web của app Think Beta (chỉ dùng để chạy thử bằng trình duyệt): WebRTC có sẵn của trình duyệt.
// Trên điện thoại app dùng rtc.tsx (thư viện react-native-webrtc).

const g = globalThis as unknown as {
  RTCPeerConnection?: new (config: object) => Peer;
  navigator?: { mediaDevices?: { getUserMedia(c: object): Promise<Stream> } };
};

export const rtcAvailable = Boolean(g.RTCPeerConnection && g.navigator?.mediaDevices);

export function createPeer(iceServers: IceServer[]): Peer {
  if (!g.RTCPeerConnection) throw new Error("Trình duyệt này chưa gọi được.");
  return new g.RTCPeerConnection({ iceServers });
}

export async function getUserMedia(constraints: { audio: boolean | object; video: boolean | object }): Promise<Stream> {
  if (!g.navigator?.mediaDevices) throw new Error("Trình duyệt này chưa gọi được.");
  return g.navigator.mediaDevices.getUserMedia(constraints);
}

export const toSession = (d: SessionDesc) => d;
export const toCandidate = (c: object) => c;

export async function switchCamera(track: Track) {
  const t = track as Track & { getSettings?: () => { facingMode?: string }; applyConstraints?: (c: object) => Promise<void> };
  const facing = t.getSettings?.().facingMode === "environment" ? "user" : "environment";
  await t.applyConstraints?.({ facingMode: facing }).catch(() => undefined);
}

export function StreamView({
  stream,
  mirror,
  muted,
  fit = "cover",
  style,
}: {
  stream: Stream | null;
  mirror?: boolean;
  /** Bản web: tắt tiếng khung của chính mình (tránh nghe lại tiếng mình) */
  muted?: boolean;
  fit?: "cover" | "contain";
  style?: StyleProp<ViewStyle>;
  zOrder?: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== (stream as unknown as MediaStream)) {
      v.srcObject = stream as unknown as MediaStream;
      v.play().catch(() => undefined);
    }
  }, [stream]);
  if (!stream) return null;
  const flat = StyleSheet.flatten(style) || {};
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={Boolean(muted)}
      style={{ width: "100%", height: "100%", ...(flat as object), objectFit: fit, transform: mirror ? "scaleX(-1)" : undefined, backgroundColor: "#000" }}
    />
  );
}
