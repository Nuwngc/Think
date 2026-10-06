import type { StyleProp, ViewStyle } from "react-native";
import { mediaDevices, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, RTCView } from "react-native-webrtc";

import type { IceServer, Peer, SessionDesc, Stream, Track } from "./types";

// Gọi thoại / gọi video trên Android: thư viện react-native-webrtc.
// Bản web của app (chỉ để chạy thử bằng trình duyệt) dùng rtc.web.tsx với WebRTC có sẵn của trình duyệt.

export const rtcAvailable = true;

export function createPeer(iceServers: IceServer[]): Peer {
  return new RTCPeerConnection({ iceServers }) as unknown as Peer;
}

export async function getUserMedia(constraints: { audio: boolean | object; video: boolean | object }): Promise<Stream> {
  return (await mediaDevices.getUserMedia(constraints as never)) as unknown as Stream;
}

export const toSession = (d: SessionDesc) => new RTCSessionDescription(d as never) as unknown as SessionDesc;
export const toCandidate = (c: object) => new RTCIceCandidate(c as never) as unknown as object;

/** Đổi máy ảnh trước / sau (không cần kết nối lại) */
export async function switchCamera(track: Track) {
  const t = track as Track & { _switchCamera?: () => void };
  if (typeof t._switchCamera === "function") t._switchCamera();
}

/** Khung hình của một luồng video */
export function StreamView({
  stream,
  mirror,
  muted,
  fit = "cover",
  style,
  zOrder = 0,
}: {
  stream: Stream | null;
  mirror?: boolean;
  /** Bản web: tắt tiếng khung của chính mình (tránh nghe lại tiếng mình) */
  muted?: boolean;
  fit?: "cover" | "contain";
  style?: StyleProp<ViewStyle>;
  zOrder?: number;
}) {
  void muted; // điện thoại: tiếng phát qua loa gọi điện, không qua khung hình
  if (!stream || typeof stream.toURL !== "function") return null;
  return <RTCView streamURL={stream.toURL()} mirror={mirror} objectFit={fit} style={style} zOrder={zOrder} />;
}
