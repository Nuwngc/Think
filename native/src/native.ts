import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// Phần viết riêng cho Android của app Think (thư mục native/modules/think-native, viết bằng Kotlin).
// Trên bản web (chạy thử) và iPhone không có: các hàm ở đây tự bỏ qua.

type DeviceInfo = { device: string; osVersion: string; appVersion: string; sdk: number; manufacturer: string };

type ThinkNativeModule = {
  takeReports(): string[];
  saveReport(json: string): boolean;
  deviceInfo(): DeviceInfo;
  crashForTest(): void;
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
