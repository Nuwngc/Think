import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Mã phiên đăng nhập: giữ trong bộ nhớ an toàn của máy (Android Keystore).
// Bản web chạy thử không có SecureStore nên dùng bộ nhớ của trình duyệt.
const TOKEN_KEY = "think.session";

let memo: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (memo !== undefined) return memo;
  try {
    memo = Platform.OS === "web" ? await AsyncStorage.getItem(TOKEN_KEY) : await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    memo = null;
  }
  return memo;
}

export async function setToken(token: string) {
  memo = token;
  if (Platform.OS === "web") await AsyncStorage.setItem(TOKEN_KEY, token);
  else await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken() {
  memo = null;
  try {
    if (Platform.OS === "web") await AsyncStorage.removeItem(TOKEN_KEY);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* không xóa được thì thôi, mã cũ đã bị máy chủ hủy */
  }
}

/** Mã đang dùng (đã đọc từ trước), cho các chỗ cần đồng bộ như header ảnh. */
export const currentToken = () => memo ?? null;
