import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { API_URL } from "./config";
import { deviceInfo, ThinkNative } from "./native";
import { getToken } from "./session";

// Báo lỗi app cho admin (tab Quản trị → Báo lỗi app): lỗi JavaScript, lời hứa bị từ chối không ai bắt,
// và crash của Android (phần Kotlin ghi lại, xem native/modules/think-native). Gửi kèm tên máy, bản Android, bản app
// để biết app lỗi ở máy nào. Không gửi nội dung tin nhắn hay mật khẩu.

export type ErrorReport = {
  kind: "js" | "promise" | "crash" | "other";
  fatal: boolean;
  message: string;
  stack?: string;
  platform: string;
  appVersion?: string;
  osVersion?: string;
  device?: string;
  where?: string;
  at: number;
};

const QUEUE_KEY = "think.errorQueue";
const MAX_QUEUE = 20;
const MAX_PER_SESSION = 15;

let where: () => string = () => "";
let sentThisSession = 0;
const seen = new Set<string>();
let flushing: Promise<void> | null = null;

/** Cho biết người dùng đang ở màn hình nào (ghi vào báo lỗi) */
export function setWhereProvider(fn: () => string) {
  where = fn;
}

function appVersion() {
  return deviceInfo()?.appVersion || String(Constants.expoConfig?.version || "?");
}

export function makeReport(kind: ErrorReport["kind"], error: unknown, fatal: boolean): ErrorReport {
  const e = error as { name?: string; message?: string; stack?: string } | null;
  const name = e && typeof e === "object" && e.name && e.name !== "Error" ? `${e.name}: ` : "";
  const message = e && typeof e === "object" && typeof e.message === "string" ? `${name}${e.message}` : String(error);
  const info = deviceInfo();
  let at = "";
  try {
    at = where();
  } catch {
    at = "";
  }
  return {
    kind,
    fatal,
    message: message.slice(0, 600) || "(không có nội dung)",
    stack: typeof e?.stack === "string" ? e.stack.slice(0, 8000) : undefined,
    platform: Platform.OS,
    appVersion: appVersion(),
    osVersion: info?.osVersion || `${Platform.OS} ${String(Platform.Version)}`,
    device: info?.device,
    where: at.slice(0, 120) || undefined,
    at: Date.now(),
  };
}

async function readQueue(): Promise<ErrorReport[]> {
  try {
    const list = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeQueue(list: ErrorReport[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-MAX_QUEUE))).catch(() => undefined);
}

/** Ghi một lỗi để gửi (lỗi giống nhau trong một lần mở app chỉ gửi một lần) */
export function report(r: ErrorReport) {
  const key = `${r.kind}|${r.message}`;
  if (seen.has(key) || sentThisSession >= MAX_PER_SESSION) return;
  seen.add(key);
  sentThisSession++;
  if (r.fatal && ThinkNative) {
    // App sắp tắt: ghi đồng bộ bằng phần Kotlin (AsyncStorage không kịp ghi)
    try {
      ThinkNative.saveReport(JSON.stringify(r));
      return;
    } catch {
      /* ghi vào hàng chờ bên dưới */
    }
  }
  readQueue()
    .then((list) => writeQueue([...list, r]))
    .then(() => flushReports())
    .catch(() => undefined);
}

/** Gửi các lỗi đang chờ (crash lần trước + lỗi JavaScript). Gọi khi mở app và khi có mạng lại. */
export function flushReports(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const list = await readQueue();
    if (ThinkNative) {
      try {
        for (const raw of ThinkNative.takeReports()) {
          try {
            list.push(JSON.parse(raw));
          } catch {
            /* file hỏng */
          }
        }
      } catch {
        /* bỏ qua */
      }
    }
    if (!list.length) return;
    await writeQueue(list); // giữ lại phòng khi gửi không được
    try {
      const token = await getToken().catch(() => null);
      const res = await fetch(`${API_URL}/api/app/errors`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ errors: list.slice(-MAX_QUEUE) }),
      });
      if (res.ok || res.status === 400) await AsyncStorage.removeItem(QUEUE_KEY).catch(() => undefined);
    } catch {
      /* mất mạng: lần sau gửi tiếp */
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

/** Cài bộ bắt lỗi JavaScript. Gọi một lần, sớm nhất có thể (index.ts). */
export function installErrorReporting() {
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void };
    HermesInternal?: { enablePromiseRejectionTracker?: (opts: object) => void };
    __thinkErrorsInstalled?: boolean;
  };
  if (g.__thinkErrorsInstalled || Platform.OS === "web") return;
  g.__thinkErrorsInstalled = true;
  const eu = g.ErrorUtils;
  if (eu) {
    const previous = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      try {
        report(makeReport("js", error, Boolean(isFatal)));
      } catch {
        /* không để phần báo lỗi gây thêm lỗi */
      }
      previous?.(error, isFatal);
    });
  }
  try {
    g.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id: number, rejection: unknown) => {
        // Lỗi gọi máy chủ (mất mạng, hết phiên...) là chuyện thường, không báo
        const name = (rejection as { name?: string } | null)?.name;
        if (name === "ApiError" || name === "AbortError") return;
        try {
          report(makeReport("promise", rejection, false));
        } catch {
          /* bỏ qua */
        }
      },
      onHandled: () => undefined,
    });
  } catch {
    /* máy không hỗ trợ */
  }
}
