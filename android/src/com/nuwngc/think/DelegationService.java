package com.nuwngc.think;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Parcelable;
import android.support.customtabs.trusted.ITrustedWebActivityService;
import android.util.Log;

/**
 * Chrome kết nối vào đây để hiện thông báo của web dưới tên app Think (notification delegation),
 * giống DelegationService của android-browser-helper. Khác ở chỗ: tin nhắn được hiện kiểu hội thoại
 * có bong bóng chat và ô Trả lời (xem {@link Notifier}).
 */
public class DelegationService extends Service {
    private static final String TAG = "ThinkDelegation";

    // Khóa dữ liệu theo androidx.browser.trusted (TrustedWebActivityServiceConnection)
    private static final String KEY_PLATFORM_TAG = "android.support.customtabs.trusted.PLATFORM_TAG";
    private static final String KEY_PLATFORM_ID = "android.support.customtabs.trusted.PLATFORM_ID";
    private static final String KEY_NOTIFICATION = "android.support.customtabs.trusted.NOTIFICATION";
    private static final String KEY_CHANNEL_NAME = "android.support.customtabs.trusted.CHANNEL_NAME";
    private static final String KEY_ACTIVE_NOTIFICATIONS = "android.support.customtabs.trusted.ACTIVE_NOTIFICATIONS";
    private static final String KEY_SUCCESS = "android.support.customtabs.trusted.NOTIFICATION_SUCCESS";
    private static final String KEY_SMALL_ICON_BITMAP = "android.support.customtabs.trusted.SMALL_ICON_BITMAP";

    // Lệnh phụ về quyền thông báo (android-browser-helper: NotificationDelegationExtraCommandHandler)
    private static final String COMMAND_SUCCESS = "success";
    private static final String CMD_CHECK_PERMISSION = "checkNotificationPermission";
    private static final String CMD_PERMISSION_INTENT = "getNotificationPermissionRequestPendingIntent";
    private static final String KEY_PERMISSION_STATUS = "permissionStatus";
    private static final String KEY_PERMISSION_INTENT = "notificationPermissionRequestPendingIntent";
    static final String ARG_CHANNEL_NAME = "notificationChannelName";
    static final int PERMISSION_ALLOW = 0;
    static final int PERMISSION_BLOCK = 1;
    static final int PERMISSION_ASK = 2;

    private int verifiedUid = -1;

    private final ITrustedWebActivityService.Stub binder = new ITrustedWebActivityService.Stub() {
        @Override
        public Bundle areNotificationsEnabled(Bundle args) {
            checkCaller();
            return result(Notifier.enabled(DelegationService.this));
        }

        @Override
        public Bundle notifyNotificationWithChannel(Bundle args) {
            checkCaller();
            String tag = args.getString(KEY_PLATFORM_TAG);
            int id = args.getInt(KEY_PLATFORM_ID);
            Notification notification = args.getParcelable(KEY_NOTIFICATION);
            String channel = args.getString(KEY_CHANNEL_NAME);
            if (notification == null) return result(false);
            boolean ok;
            try {
                ok = Notifier.onBrowserNotify(DelegationService.this, tag, id, notification, channel);
            } catch (RuntimeException e) {
                Log.e(TAG, "Lỗi khi hiện thông báo", e);
                ok = fallbackNotify(tag, id, notification);
            }
            return result(ok);
        }

        @Override
        public void cancelNotification(Bundle args) {
            checkCaller();
            Notifier.onBrowserCancel(DelegationService.this, args.getString(KEY_PLATFORM_TAG), args.getInt(KEY_PLATFORM_ID));
        }

        @Override
        public Bundle getActiveNotifications() {
            checkCaller();
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            Bundle out = new Bundle();
            Parcelable[] active = nm.getActiveNotifications();
            out.putParcelableArray(KEY_ACTIVE_NOTIFICATIONS, active);
            return out;
        }

        @Override
        public int getSmallIconId() {
            checkCaller();
            return R.drawable.ic_stat_think;
        }

        @Override
        public Bundle getSmallIconBitmap() {
            checkCaller();
            Bundle out = new Bundle();
            Drawable d = getDrawable(R.drawable.ic_stat_think);
            if (d != null) {
                int size = Math.round(24 * getResources().getDisplayMetrics().density);
                Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
                d.setBounds(0, 0, size, size);
                d.draw(new Canvas(bmp));
                out.putParcelable(KEY_SMALL_ICON_BITMAP, bmp);
            }
            return out;
        }

        @Override
        public Bundle extraCommand(String commandName, Bundle args, IBinder callback) {
            checkCaller();
            return handleExtraCommand(commandName, args);
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        verifiedUid = -1;
        return super.onUnbind(intent);
    }

    private static Bundle result(boolean ok) {
        Bundle b = new Bundle();
        b.putBoolean(KEY_SUCCESS, ok);
        return b;
    }

    /** Chỉ cho trình duyệt đã mở app (Chrome) gọi vào. */
    private void checkCaller() {
        int uid = Binder.getCallingUid();
        if (uid == verifiedUid) return;
        PackageManager pm = getPackageManager();
        String[] packages = pm.getPackagesForUid(uid);
        String provider = Prefs.provider(this);
        if (packages != null) {
            for (String p : packages) {
                if (p.equals(provider) || isChrome(p)) {
                    verifiedUid = uid;
                    return;
                }
            }
        }
        throw new SecurityException("Caller is not verified as Trusted Web Activity provider.");
    }

    private static boolean isChrome(String pkg) {
        for (String c : Config.CHROME_PACKAGES) if (c.equals(pkg)) return true;
        return false;
    }

    private boolean fallbackNotify(String tag, int id, Notification notification) {
        try {
            Notifier.ensureChannels(this);
            Notification out = notification;
            if (Build.VERSION.SDK_INT >= 26) {
                out = Notification.Builder.recoverBuilder(this, notification).setChannelId(Notifier.CH_OTHER).build();
            }
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(tag, id, out);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private Bundle handleExtraCommand(String command, Bundle args) {
        Bundle out = new Bundle();
        out.putBoolean(COMMAND_SUCCESS, false);
        if (command == null) return out;
        String channel = args == null ? null : args.getString(ARG_CHANNEL_NAME);
        if (CMD_CHECK_PERMISSION.equals(command)) {
            int status;
            if (Notifier.enabled(this)) status = PERMISSION_ALLOW;
            else if (Build.VERSION.SDK_INT >= 33 && !Prefs.askedNotify(this)) status = PERMISSION_ASK;
            else status = PERMISSION_BLOCK;
            out.putInt(KEY_PERMISSION_STATUS, status);
            out.putBoolean(COMMAND_SUCCESS, true);
        } else if (CMD_PERMISSION_INTENT.equals(command)) {
            Intent intent = new Intent(getApplicationContext(), PermissionActivity.class);
            intent.putExtra(ARG_CHANNEL_NAME, channel == null ? "" : channel);
            // Chrome thêm "messenger" vào intent để nhận kết quả, nên phải để sửa được
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getActivity(getApplicationContext(), 0, intent, flags);
            out.putParcelable(KEY_PERMISSION_INTENT, pi);
            out.putBoolean(COMMAND_SUCCESS, true);
        }
        return out;
    }
}
