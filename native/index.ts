// Nạp tác vụ nền trước tiên: bấm Trả lời / Đã đọc trong thông báo khi app đã tắt vẫn chạy được
import "./src/background";

import { registerRootComponent } from "expo";
import * as SplashScreen from "expo-splash-screen";
import { createElement, type ComponentType } from "react";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Chỉ nạp giao diện khi thật sự mở app. Thông báo đến lúc app đang tắt chỉ chạy phần nền ở trên,
// không dựng cả app (đỡ tốn pin trên máy yếu).
function Root() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const App = require("./App").default as ComponentType;
  return createElement(App);
}

registerRootComponent(Root);
