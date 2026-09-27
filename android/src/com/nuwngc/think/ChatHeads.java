package com.nuwngc.think;

import android.app.ActivityManager;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.util.Log;

/**
 * Bong bóng nổi cho Android 8–10 (các máy này chưa có bong bóng của hệ thống như Android 11+).
 * Cần quyền "Hiển thị trên ứng dụng khác". Giao diện nằm ở {@link ChatHeadService}.
 */
final class ChatHeads {
    private static final String TAG = "ThinkHeads";
    static final String ACTION_MESSAGE = "com.nuwngc.think.heads.MESSAGE";
    static final String ACTION_UPDATE = "com.nuwngc.think.heads.UPDATE";
    static final String ACTION_READ = "com.nuwngc.think.heads.READ";
    static final String ACTION_EXPAND = "com.nuwngc.think.heads.EXPAND";
    static final String ACTION_HIDE = "com.nuwngc.think.heads.HIDE";
    static final String ACTION_DISABLE = "com.nuwngc.think.heads.DISABLE";
    static final String ACTION_DEMO = "com.nuwngc.think.heads.DEMO";
    static final String EXTRA_CONV = "conv";

    private ChatHeads() {}

    /** Android 8, 9, 10 (trừ máy Android Go 10, không cho app vẽ đè). Android 11+ dùng bong bóng của hệ thống. */
    static boolean supported(Context context) {
        if (Build.VERSION.SDK_INT < 26 || Build.VERSION.SDK_INT >= 30) return false;
        if (Build.VERSION.SDK_INT == 29) {
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null && am.isLowRamDevice()) return false;
        }
        return true;
    }

    static boolean canDraw(Context context) {
        if (Build.VERSION.SDK_INT < 23) return false;
        if (Settings.canDrawOverlays(context)) return true;
        // Android 8.0 có lỗi: vừa cấp quyền xong vẫn báo chưa có. Hỏi thẳng AppOps cho chắc.
        if (Build.VERSION.SDK_INT == 26) {
            try {
                AppOpsManager ops = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
                return ops != null && ops.checkOpNoThrow(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW,
                    Process.myUid(), context.getPackageName()) == AppOpsManager.MODE_ALLOWED;
            } catch (RuntimeException e) {
                return false;
            }
        }
        return false;
    }

    static boolean enabled(Context context) {
        return supported(context) && Prefs.headsOn(context) && Prefs.linked(context) && canDraw(context);
    }

    /** Có tin nhắn mới: hiện (hoặc cập nhật) bong bóng. */
    static void onMessage(Context context, int convId) {
        if (!enabled(context)) return;
        start(context, ACTION_MESSAGE, convId, true);
    }

    /** Nội dung cuộc trò chuyện vừa đổi (tên, ảnh): vẽ lại bong bóng nếu đang hiện. */
    static void onUpdate(Context context, int convId) {
        if (!ChatHeadService.isRunning()) return;
        start(context, ACTION_UPDATE, convId, false);
    }

    /** Đã đọc ở nơi khác: bỏ số chưa đọc của cuộc trò chuyện này. */
    static void onRead(Context context, int convId) {
        if (!ChatHeadService.isRunning()) return;
        start(context, ACTION_READ, convId, false);
    }

    /** Quay lại từ màn hình chọn ảnh: mở lại khung chat. */
    static void expandAgain(Context context) {
        if (!ChatHeadService.isRunning()) return;
        start(context, ACTION_EXPAND, 0, false);
    }

    /** Hiện thử một bong bóng (mở danh sách tin nhắn) ngay sau khi bật. */
    static void demo(Context context) {
        if (!supported(context) || !canDraw(context)) return;
        start(context, ACTION_DEMO, 0, true);
    }

    private static void start(Context context, String action, int convId, boolean foreground) {
        Intent intent = new Intent(context, ChatHeadService.class).setAction(action).putExtra(EXTRA_CONV, convId);
        try {
            if (foreground && Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException e) {
            Log.w(TAG, "Không mở được bong bóng nổi", e);
        }
    }
}
