import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// Phần viết riêng cho Android của app Think (thư mục native/modules/think-native, viết bằng Kotlin).
// Trên bản web (chạy thử) và iPhone không có: các hàm ở đây tự bỏ qua.

type DeviceInfo = { device: string; osVersion: string; appVersion: string; sdk: number; manufacturer: string };

export type BubblesState = { supported: boolean; on: boolean; canDraw: boolean; running: boolean };

/** Thông tin để vẽ bong bóng chat */
export type HeadInfo = {
  convId: number;
  title: string;
  initial: string;
  color: string;
  avatarUrl: string;
  preview: string;
  unread: number;
  general: boolean;
  /** Hiện cả khi app đang mở (nút "Thử bong bóng") */
  force?: boolean;
};

export type ChatHeadEvent = { type: "open" | "disabled" | "dismissed" | "bubble-shown" | "bubble-hidden"; convId: number };

type ThinkNativeModule = {
  takeReports(): string[];
  saveReport(json: string): boolean;
  deviceInfo(): DeviceInfo;
  crashForTest(): void;
  bubblesState(): BubblesState;
  setBubbles(on: boolean): boolean;
  openOverlaySettings(): void;
  showHead(info: HeadInfo): void;
  hideHead(): void;
  bubbleVisible(): boolean;
  bubbleConv(): number;
  minimizeBubble(): void;
  openApp(): void;
  /** Gọi thoại / gọi video (2.10.0): CallAudio.kt */
  callAudioStart?(speaker: boolean): void;
  callAudioStop?(): void;
  callSpeaker?(on: boolean): boolean;
  callProximity?(on: boolean): void;
  callServiceStart?(title: string, video: boolean): void;
  callServiceStop?(): void;
  addListener(event: "onChatHead", listener: (e: ChatHeadEvent) => void): { remove(): void };
  addListener(event: "onCallAction", listener: (e: { type: string }) => void): { remove(): void };
};

export const ThinkNative: ThinkNativeModule | null =
  Platform.OS === "android" ? requireOptionalNativeModule<ThinkNativeModule>("ThinkNative") : null;

let info: DeviceInfo | null = null;
export function deviceInfo(): DeviceInfo | null {
  if (!info && ThinkNative) {
    try {
      info = ThinkNative.deviceInfo();
    } catch {
      info = null;
    }
  }
  return info;
}
