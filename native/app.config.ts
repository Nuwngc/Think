import fs from "node:fs";
import path from "node:path";
import type { ExpoConfig } from "expo/config";

// Cấu hình app Think (bản cài trên điện thoại).
// Các giá trị đổi theo từng lần build được lấy từ biến môi trường (GitHub Actions tự đặt, xem README.md):
//   THINK_VERSION_CODE  số phiên bản tăng dần (Android dùng để biết bản nào mới hơn)
//   THINK_VERSION_NAME  tên phiên bản hiện cho người dùng, vd 0.1.7
//   THINK_API_URL       địa chỉ máy chủ Think (mặc định https://thinkchat.id.vn)
//   THINK_UPDATE_URL    file JSON báo bản mới nhất (GitHub Actions tự điền theo repo)
//   google-services.json đặt cạnh file này để bật thông báo đẩy (GitHub Actions tạo từ secret)

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")) as { version: string };

const env = process.env;
const versionCode = Math.max(1, Number.parseInt(env.THINK_VERSION_CODE || "1", 10) || 1);
const repo = env.GITHUB_REPOSITORY || "";
const updateUrl = env.THINK_UPDATE_URL || (repo ? `https://github.com/${repo}/releases/latest/download/think-app.json` : "");
const googleServices = path.join(__dirname, "google-services.json");
const hasGoogleServices = fs.existsSync(googleServices);

const config: ExpoConfig = {
  name: "Think Beta",
  slug: "think",
  version: env.THINK_VERSION_NAME || pkg.version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "thinkbeta",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  backgroundColor: "#EEF2EF",
  android: {
    package: "com.nuwngc.think.beta",
    versionCode,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/adaptive-monochrome.png",
      backgroundColor: "#0E7C66",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    softwareKeyboardLayoutMode: "resize",
    allowBackup: false,
    permissions: ["POST_NOTIFICATIONS"],
    blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.SYSTEM_ALERT_WINDOW"],
    ...(hasGoogleServices ? { googleServicesFile: "./google-services.json" } : {}),
  },
  ios: {
    bundleIdentifier: "com.nuwngc.think.beta",
    buildNumber: String(versionCode),
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  web: { bundler: "metro", output: "single", favicon: "./assets/favicon.png" },
  plugins: [
    [
      "expo-notifications",
      { icon: "./assets/notification-icon.png", color: "#0E7C66", defaultChannel: "messages" },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: "#EEF2EF",
        dark: { image: "./assets/splash-icon.png", backgroundColor: "#0F1714" },
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Think cần quyền xem ảnh để bạn gửi ảnh vào cuộc trò chuyện.",
        cameraPermission: "Think cần quyền dùng máy ảnh để bạn chụp và gửi ảnh.",
        microphonePermission: false,
      },
    ],
    "expo-secure-store",
    // Chỉ phát tiếng quân cờ, không ghi âm
    ["expo-audio", { microphonePermission: false, recordAudioAndroid: false }],
    [
      "expo-build-properties",
      { android: { minSdkVersion: 24, buildArchs: ["armeabi-v7a", "arm64-v8a"] } },
    ],
  ],
  extra: {
    apiUrl: (env.THINK_API_URL || "https://thinkchat.id.vn").replace(/\/+$/, ""),
    updateUrl,
    pushConfigured: hasGoogleServices,
  },
};

export default config;
