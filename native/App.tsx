import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { loadPrefs } from "./src/chess/prefs";
import { prepareImage, recoverPick } from "./src/images";
import { parseResponse, runQuickAction, setupNotifications, watchPushToken, type NotificationAction } from "./src/notifications";
import { BootScreen } from "./src/screens/BootScreen";
import { ForcePasswordScreen } from "./src/screens/ForcePasswordScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MainScreen } from "./src/screens/MainScreen";
import { ToastHost } from "./src/screens/ToastHost";
import { boot, openChess, openConversation, sendImages, showToast, startLifecycle, useStore } from "./src/store";
import { useColors } from "./src/theme";
import { confirm } from "./src/ui";
import { checkForUpdate } from "./src/update";

const seen = new Set<string>();
let pendingOpen: (() => void) | null = null;

function handleResponse(resp: unknown) {
  const a: NotificationAction | null = parseResponse(resp as any);
  if (!a || seen.has(a.key)) return;
  seen.add(a.key);
  if (a.action === "open" && (a.conversationId || a.type === "chess")) {
    const go =
      a.type === "chess"
        ? () => openChess(a.gameId)
        : () => {
            if (a.conversationId) openConversation(a.conversationId);
          };
    if (useStore.getState().phase === "ready") go();
    else pendingOpen = go;
  } else if ((a.action === "reply" || a.action === "read") && AppState.currentState === "active") {
    // App đang mở: tự làm luôn (khi app chạy nền thì tác vụ nền trong src/background.ts làm)
    runQuickAction(a).then((r) => {
      if (r === "failed") showToast("Chưa gửi được tin trả lời. Mở cuộc trò chuyện để gửi lại.");
    });
  }
}

/** App bị Android tắt trong lúc chụp / chọn ảnh: mở lại thì hỏi có gửi ảnh đó không */
async function resumePendingPick() {
  const found = await recoverPick();
  if (!found || !useStore.getState().convs[found.convId]) return;
  await openConversation(found.convId);
  const n = found.assets.length;
  if (!(await confirm("Gửi ảnh vừa chọn?", `Bạn đã chọn ${n} ảnh trước khi app bị tắt.`, "Gửi", false))) return;
  const prepared = [];
  for (const a of found.assets.slice(0, 10)) prepared.push(await prepareImage(a).catch(() => null));
  await sendImages(found.convId, prepared.filter((x): x is NonNullable<typeof x> => x != null));
}

export default function App() {
  const c = useColors();
  const phase = useStore((s) => s.phase);
  const [fontsLoaded, fontError] = useFonts(MaterialIcons.font);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    startLifecycle();
    boot();
    loadPrefs();
    setupNotifications();
    checkForUpdate();
    if (Platform.OS === "web") return;
    const stopToken = watchPushToken();
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handleResponse(last);
      Notifications.clearLastNotificationResponse();
    }
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => {
      sub.remove();
      stopToken();
    };
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => undefined);
  }, [c.bg]);

  // Mở cuộc trò chuyện từ thông báo sau khi đăng nhập xong
  const offline = useStore((s) => s.offline);
  const [pickChecked, setPickChecked] = useState(false);
  useEffect(() => {
    if (phase !== "ready") return;
    if (pendingOpen != null) {
      const go = pendingOpen;
      pendingOpen = null;
      go();
    }
    if (!offline && !pickChecked) {
      setPickChecked(true);
      resumePendingPick().catch(() => undefined);
    }
  }, [phase, offline, pickChecked]);

  // Ẩn màn hình chờ khi đã có gì để hiện (tối đa 2,5 giây)
  const ready = (fontsLoaded || Boolean(fontError)) && phase !== "boot";
  useEffect(() => {
    if (splashDone) return;
    const hide = () => {
      setSplashDone(true);
      SplashScreen.hideAsync().catch(() => undefined);
    };
    if (ready) {
      hide();
      return;
    }
    const t = setTimeout(hide, 2500);
    return () => clearTimeout(t);
  }, [ready, splashDone]);

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <StatusBar style={c.scheme === "dark" ? "light" : "dark"} />
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          {phase === "login" ? (
            <LoginScreen />
          ) : phase === "force" ? (
            <ForcePasswordScreen />
          ) : phase === "ready" ? (
            <MainScreen />
          ) : (
            <BootScreen />
          )}
          <ToastHost />
        </View>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
