package com.nuwngc.think;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;

/** Mỗi ngày xem một lần có bản app mới trên máy chủ không (file /download/version.json), có thì báo. */
final class UpdateChecker {
    private static final long INTERVAL = 20L * 60 * 60 * 1000;
    private static final int NOTIFICATION_ID = 7001;

    private UpdateChecker() {}

    static void maybeCheck(final Context context) {
        final Context app = context.getApplicationContext();
        long now = System.currentTimeMillis();
        if (now - Prefs.lastUpdateCheck(app) < INTERVAL) return;
        Prefs.setLastUpdateCheck(app, now);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    byte[] raw = Http.download(Config.ORIGIN + "/download/version.json?t=" + System.currentTimeMillis(), 64 * 1024);
                    JSONObject v = new JSONObject(new String(raw, StandardCharsets.UTF_8));
                    int latest = v.optInt("versionCode", 0);
                    if (latest <= Config.versionCode(app) || latest <= Prefs.updateSeen(app)) return;
                    Prefs.setUpdateSeen(app, latest);
                    notifyUpdate(app, v.optString("versionName", ""), v.optString("notes", ""));
                } catch (Exception ignored) {
                    // không có mạng hoặc máy chủ chưa có file: lần sau thử lại
                }
            }
        }, "think-update").start();
    }

    private static void notifyUpdate(Context context, String versionName, String notes) {
        if (!Notifier.enabled(context)) return;
        Notifier.ensureChannels(context);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(Config.ORIGIN + "/download/think.apk"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // Mở bằng Chrome để tải file, tránh vòng lại vào chính app Think (app nhận mọi link thinkchat.id.vn)
        String browser = Prefs.provider(context);
        if (browser == null) {
            LauncherActivity.Provider p = LauncherActivity.pickProvider(context.getPackageManager());
            if (p == null) return;
            browser = p.pkg;
        }
        open.setPackage(browser);
        PendingIntent pi = PendingIntent.getActivity(context, NOTIFICATION_ID, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, Notifier.CH_OTHER)
            : new Notification.Builder(context);
        String text = notes == null || notes.isEmpty()
            ? "Chạm để tải về rồi mở file để cài đè. Tin nhắn không bị mất."
            : notes + " Chạm để tải về rồi mở file để cài đè.";
        b.setSmallIcon(R.drawable.ic_stat_think)
            .setColor(Config.BRAND)
            .setContentTitle("Có app Think bản mới " + versionName)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify("update", NOTIFICATION_ID, b.build());
    }
}
