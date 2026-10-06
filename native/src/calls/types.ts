// Kiểu dữ liệu dùng chung cho gọi thoại / gọi video (đủ dùng cho cả react-native-webrtc lẫn WebRTC của trình duyệt)

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

export type SessionDesc = { type: string; sdp: string };

export type Track = {
  kind: string;
  enabled: boolean;
  stop(): void;
};

export type Stream = {
  toURL?: () => string;
  getTracks(): Track[];
  getAudioTracks(): Track[];
  getVideoTracks(): Track[];
};

export type PeerEvent = {
  candidate?: { toJSON?: () => object } | null;
  track?: Track;
  streams?: Stream[];
};

export type Peer = {
  connectionState: string;
  iceConnectionState?: string;
  remoteDescription: unknown;
  localDescription: SessionDesc | null;
  addTrack(track: Track, stream: Stream): unknown;
  createOffer(opts?: object): Promise<SessionDesc>;
  createAnswer(): Promise<SessionDesc>;
  setLocalDescription(d: SessionDesc): Promise<void>;
  setRemoteDescription(d: SessionDesc): Promise<void>;
  addIceCandidate(c: object): Promise<void>;
  addEventListener(type: string, fn: (e: PeerEvent) => void): void;
  close(): void;
};

/** Thông tin cuộc gọi máy chủ gửi (src/calls.js → payload) */
export type CallInfo = {
  id: string;
  conversationId: number;
  video: boolean;
  state: "ringing" | "active";
  callerId: number;
  calleeId: number;
  caller: { id: number; displayName: string; avatar: string | null };
  callee: { id: number; displayName: string; avatar: string | null };
  createdAt: number;
  answeredAt: number | null;
  iceServers: IceServer[];
};

export type CallPeer = { id: number; displayName: string; avatar: string | null };

export type CallPhase = "preparing" | "ringing" | "incoming" | "connecting" | "active" | "ended";
