import Constants from "expo-constants";

type Extra = { apiUrl?: string; updateUrl?: string; pushConfigured?: boolean };

const extra = (Constants.expoConfig?.extra || {}) as Extra;

/** Địa chỉ máy chủ Think. Chạy thử bản web có thể đổi bằng biến EXPO_PUBLIC_THINK_API_URL. */
export const API_URL = String(process.env.EXPO_PUBLIC_THINK_API_URL || extra.apiUrl || "https://thinkchat.id.vn").replace(/\/+$/, "");

/** File JSON báo bản app mới nhất (GitHub Releases). Rỗng khi build tay. */
export const UPDATE_URL = String(extra.updateUrl || "");

/** Bản build có kèm google-services.json (bật được thông báo đẩy). */
export const PUSH_CONFIGURED = Boolean(extra.pushConfigured);

export const APP_NAME = "Think";
