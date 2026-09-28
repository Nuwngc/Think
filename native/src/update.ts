import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";

import { UPDATE_URL } from "./config";
import { useStore, type UpdateInfo } from "./store";

// Kiểm tra bản app mới trên GitHub Releases (file think-app.json do GitHub Actions tạo mỗi lần build)
const CHECK_KEY = "think.updateCheck";
const INFO_KEY = "think.updateInfo";
const EVERY = 6 * 60 * 60 * 1000;

export const currentVersionCode = () => Number(Application.nativeBuildVersion || 0) || 0;
export const currentVersionName = () => Application.nativeApplicationVersion || "";

export async function checkForUpdate({ force = false } = {}): Promise<UpdateInfo | null> {
  if (Platform.OS !== "android" || !UPDATE_URL) return null;
  try {
    const last = Number(await AsyncStorage.getItem(CHECK_KEY)) || 0;
    let info: UpdateInfo | null = null;
    if (!force && Date.now() - last < EVERY) {
      // Vừa kiểm tra gần đây: dùng lại kết quả đã lưu
      info = JSON.parse((await AsyncStorage.getItem(INFO_KEY)) || "null");
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${UPDATE_URL}?t=${Date.now()}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      info = (await res.json()) as UpdateInfo;
      await AsyncStorage.multiSet([
        [CHECK_KEY, String(Date.now())],
        [INFO_KEY, JSON.stringify(info)],
      ]);
    }
    const newer = info && Number(info.versionCode) > currentVersionCode() && /^https:\/\//.test(String(info.apk || ""));
    const update = newer && info ? { ...info, versionCode: Number(info.versionCode) } : null;
    useStore.setState({ update });
    return update;
  } catch {
    return null;
  }
}
