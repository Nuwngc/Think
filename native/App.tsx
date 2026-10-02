import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BlocksScreen } from "./src/blocks/BlocksScreen";
import { initBubbles, setBubbles } from "./src/bubbles";
import { openStandalone, useBlocks } from "./src/blocks/store";
import { loadPrefs } from "./src/chess/prefs";
import { TEST_BUILD } from "./src/config";
import { flushReports, setWhereProvider } from "./src/errors";
import { prepareImage, recoverPick } from "./src/images";
import { ThinkNative } from "./src/native";
import { parseResponse, runQuickAction, setupNotifications, watchPushToken, type NotificationAction } from "./src/notifications";
import { BootScreen } from "./src/screens/BootScreen";
import { ErrorBoundary } from "./src/screens/ErrorBoundary";
import { ForcePasswordScreen } from "./src/screens/ForcePasswordScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MainScreen } from "./src/screens/MainScreen";
import { ToastHost } from "./src/screens/ToastHost";
import { openComments } from "./src/social/store";
import { boot, openBlocks, openCaro, openChess, openConversation, openFarm, sendImages, setTab, showToast, startLifecycle, useStore } from "./src/store";
import { loadThemeMode, useColors, useThemeMode } from "./src/theme";
import { confirm } from "./src/ui";
import { checkForUpdate } from "./src/update";

const seen = new Set<string>();
let pendingOpen: (() => void) | null = null;

function handleResponse(resp: unknown) {
  const a: NotificationAction | null = parseResponse(resp as any);
  if (!a || seen.has(a.key)) return;
  seen.add(a.key);
  if (a.action === "open" && (a.conversationId || a.type === "chess" || a.type === "caro" || a.type === "farm" || (a.type === "post" && a.postId))) {
    const go =
      a.type === "chess"
        ? () => openChess(a.gameId)
        : a.type === "caro"
          ? () => openCaro(a.gameId)
          : a.type === "farm"
            ? () => openFarm()
          : a.type === "post"
            ? () => {
                // Thả tim / bình luận bài của bạn: mở trang cá nhân và bảng bình luận của bài đó
                setTab("me");
                if (a.postId) openComments(a.postId);
              }
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

/** Màn hình đang mở (ghi vào báo lỗi để biết lỗi xảy ra ở đâu) */
function whereNow() {
  const st = useStore.getState();
  if (st.phase !== "ready") return st.phase;
  if (st.currentId != null) return `chat #${st.currentId}`;
  if (st.tab === "games") return `trò chơi: ${st.gamesView}`;
  return st.tab;
}

/** Chỉ bản thử: một màn hình cố tình lỗi, để kiểm tra khung "Có lỗi xảy ra" và phần báo lỗi */
function TestBomb(): null {
  throw new Error("Think: lỗi màn hình thử để kiểm tra báo lỗi");
}

export default function App() {
  const c = useColors();
  const [bomb, setBomb] = useState(false);
  const phase = useStore((s) => s.phase);
  const [fontsLoaded, fontError] = useFonts(MaterialIcons.font);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    setWhereProvider(whereNow);
    // Gửi các lỗi còn chờ (vd crash lần trước) sau khi app đã mở xong
    const flushTimer = setTimeout(() => flushReports(), 4000);
    loadThemeMode();
    startLifecycle();
    boot();
    loadPrefs();
    setupNotifications();
    checkForUpdate();
    if (Platform.OS === "web") return;
    initBubbles();
    let linkSub: { remove(): void } | null = null;
    if (TEST_BUILD) {
      const onUrl = (url: string | null) => {
        if (url === "thinkbeta://test-crash") ThinkNative?.crashForTest();
        if (url === "thinkbeta://test-render-error") setBomb(true);
        if (url === "thinkbeta://test-flush") flushReports();
        if (url === "thinkbeta://test-bubbles") setBubbles(true);
      };
      Linking.getInitialURL().then(onUrl).catch(() => undefined);
      linkSub = Linking.addEventListener("url", (e) => onUrl(e.url));
    }
    const stopToken = watchPushToken();
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handleResponse(last);
      Notifications.clearLastNotificationResponse();
    }
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => {
      clearTimeout(flushTimer);
      linkSub?.remove();
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

  const standalone = useBlocks((s) => s.standalone);
  useEffect(() => {
    // Máy chủ vừa trả lời trong lúc đang chơi: chơi tiếp ngay trong app (ván vẫn giữ nguyên)
    if (phase === "ready" && standalone) {
      // Người dùng vừa chạm một thông báo (mở chat / ván cờ) thì để yên chỗ đó
      const st = useStore.getState();
      if (st.currentId == null && st.tab === "chats") openBlocks();
      openStandalone(false);
    }
  }, [phase, standalone]);

  // Ẩn màn hình chờ khi đã có gì để hiện (tối đa 2,5 giây)
  const themeLoaded = useThemeMode((s) => s.loaded);
  const ready = (fontsLoaded || Boolean(fontError)) && phase !== "boot" && themeLoaded;
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
          <ErrorBoundary name={phase} onReset={() => setBomb(false)}>
            {bomb ? <TestBomb /> : null}
            {standalone && phase !== "ready" ? (
              // Chơi Xếp Khối ngay từ màn đăng nhập / màn chờ máy chủ (không cần mạng)
              <BlocksScreen onBack={() => openStandalone(false)} />
            ) : phase === "login" ? (
              <LoginScreen />
            ) : phase === "force" ? (
              <ForcePasswordScreen />
            ) : phase === "ready" ? (
              <MainScreen />
            ) : (
              <BootScreen />
            )}
          </ErrorBoundary>
          <ToastHost />
        </View>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
