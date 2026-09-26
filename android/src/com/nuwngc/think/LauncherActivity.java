package com.nuwngc.think;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.customtabs.ICustomTabsCallback;
import android.support.customtabs.ICustomTabsService;
import android.util.Log;
import android.util.SparseArray;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Mở web Think toàn màn hình bằng Chrome (Trusted Web Activity), như app PWABuilder cũ:
 * kết nối Chrome, tạo phiên, mở trang, rồi tự đóng. Trang web chạy trong Chrome nên thông báo đẩy
 * vẫn hoạt động; Chrome chuyển thông báo sang {@link DelegationService} để app hiện bong bóng chat.
 */
public class LauncherActivity extends Activity {
    private static final String TAG = "ThinkLauncher";
    private static final String ACTION_CUSTOM_TABS = "android.support.customtabs.action.CustomTabsService";
    private static final String CATEGORY_TWA = "androidx.browser.trusted.category.TrustedWebActivities";
    private static final String EXTRA_SESSION = "android.support.customtabs.extra.SESSION";
    private static final String EXTRA_SESSION_ID = "android.support.customtabs.extra.SESSION_ID";
    private static final String EXTRA_LAUNCH_AS_TWA = "android.support.customtabs.extra.LAUNCH_AS_TRUSTED_WEB_ACTIVITY";
    private static final String EXTRA_TOOLBAR_COLOR = "android.support.customtabs.extra.TOOLBAR_COLOR";
    private static final String EXTRA_NAVBAR_COLOR = "androidx.browser.customtabs.extra.NAVIGATION_BAR_COLOR";
    private static final String EXTRA_COLOR_SCHEME = "androidx.browser.customtabs.extra.COLOR_SCHEME";
    private static final String EXTRA_COLOR_SCHEME_PARAMS = "androidx.browser.customtabs.extra.COLOR_SCHEME_PARAMS";
    private static final String EXTRA_DISPLAY_MODE = "androidx.browser.trusted.extra.DISPLAY_MODE";
    private static final String KEY_DISPLAY_MODE_ID = "androidx.browser.trusted.displaymode.KEY_ID";
    private static final String STATE_LAUNCHED = "launched";
    private static final long CONNECT_TIMEOUT_MS = 6000;

    private static int sAlive;
    private static final Map<Integer, Integer> SESSION_IDS = new HashMap<>();
    private boolean launched;
    private boolean bound;
    private ServiceConnection connection;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable connectTimeout = new Runnable() {
        @Override
        public void run() {
            if (launched || isFinishing()) return;
            Log.w(TAG, "Chrome phản hồi chậm, mở kiểu thẻ Chrome");
            openCustomTab(pickedProvider);
        }
    };
    private String pickedProvider;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sAlive++;
        boolean hasData = getIntent().getData() != null;
        if (sAlive > 1 && !hasData) { // đang mở dở, chờ lần mở trước
            finish();
            return;
        }
        if (restartInNewTask()) {
            finish();
            return;
        }
        if (savedInstanceState != null && savedInstanceState.getBoolean(STATE_LAUNCHED)) {
            finish();
            return;
        }
        Notifier.ensureChannels(this);
        UpdateChecker.maybeCheck(this);
        launch();
    }

    /** Mở từ app khác mà không có FLAG_ACTIVITY_NEW_TASK thì mở lại trong task riêng (như android-browser-helper). */
    private boolean restartInNewTask() {
        int flags = getIntent().getFlags();
        boolean newTask = (flags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0;
        boolean newDocument = (flags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0;
        if (newTask && !newDocument) return false;
        Intent again = new Intent(getIntent());
        again.setFlags((flags | Intent.FLAG_ACTIVITY_NEW_TASK) & ~Intent.FLAG_ACTIVITY_NEW_DOCUMENT);
        startActivity(again);
        return true;
    }

    private Uri launchUrl() {
        return Config.appUrl(this, getIntent().getData());
    }

    private void launch() {
        Provider p = pickProvider(getPackageManager());
        pickedProvider = p == null ? null : p.pkg;
        if (p == null) {
            openWebView();
            return;
        }
        if (!p.twa) {
            openCustomTab(p.pkg);
            return;
        }
        final String pkg = p.pkg;
        connection = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder service) {
                if (launched || isFinishing()) return;
                handler.removeCallbacks(connectTimeout);
                try {
                    ICustomTabsService tabs = ICustomTabsService.Stub.asInterface(service);
                    try {
                        tabs.warmup(0);
                    } catch (Exception ignored) {
                        // không sao
                    }
                    SessionCallback callback = new SessionCallback();
                    PendingIntent sessionId = sessionId();
                    Bundle extras = new Bundle();
                    extras.putParcelable(EXTRA_SESSION_ID, sessionId);
                    boolean ok;
                    try {
                        ok = tabs.newSessionWithExtras(callback, extras);
                    } catch (Exception e) {
                        ok = tabs.newSession(callback);
                        sessionId = null;
                    }
                    if (ok) {
                        openTrusted(pkg, callback.asBinder(), sessionId);
                        return;
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Không tạo được phiên với Chrome", e);
                }
                openCustomTab(pkg);
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                // Chrome tắt giữa chừng: lần mở sau sẽ kết nối lại
            }
        };
        Intent bind = new Intent(ACTION_CUSTOM_TABS).setPackage(pkg);
        try {
            bound = bindService(bind, connection, BIND_AUTO_CREATE);
        } catch (SecurityException e) {
            bound = false;
        }
        if (!bound) {
            openCustomTab(pkg);
            return;
        }
        handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS);
    }

    private void addColors(Intent intent) {
        intent.putExtra(EXTRA_TOOLBAR_COLOR, Config.SURFACE_LIGHT);
        intent.putExtra(EXTRA_NAVBAR_COLOR, Config.SURFACE_LIGHT);
        intent.putExtra(EXTRA_COLOR_SCHEME, 0); // theo máy (sáng/tối)
        SparseArray<Bundle> schemes = new SparseArray<>();
        Bundle light = new Bundle();
        light.putInt(EXTRA_TOOLBAR_COLOR, Config.SURFACE_LIGHT);
        light.putInt(EXTRA_NAVBAR_COLOR, Config.SURFACE_LIGHT);
        Bundle dark = new Bundle();
        dark.putInt(EXTRA_TOOLBAR_COLOR, Config.SURFACE_DARK);
        dark.putInt(EXTRA_NAVBAR_COLOR, Config.SURFACE_DARK);
        schemes.put(1, light);
        schemes.put(2, dark);
        Bundle holder = new Bundle();
        holder.putSparseParcelableArray(EXTRA_COLOR_SCHEME_PARAMS, schemes);
        intent.putExtras(holder);
    }

    /** Mỗi task một mã phiên cố định (như android-browser-helper), để Chrome mở tiếp trang đang có thay vì chồng thêm. */
    private PendingIntent sessionId() {
        int task = getTaskId();
        Integer id;
        synchronized (SESSION_IDS) {
            id = SESSION_IDS.get(task);
            if (id == null) {
                id = new Random().nextInt(Integer.MAX_VALUE);
                SESSION_IDS.put(task, id);
            }
        }
        return PendingIntent.getActivity(this, id, new Intent(), PendingIntent.FLAG_IMMUTABLE);
    }

    private void openTrusted(String pkg, IBinder session, PendingIntent sessionId) {
        Intent intent = new Intent(Intent.ACTION_VIEW, launchUrl());
        intent.setPackage(pkg);
        Bundle sessionExtras = new Bundle();
        sessionExtras.putBinder(EXTRA_SESSION, session);
        if (sessionId != null) sessionExtras.putParcelable(EXTRA_SESSION_ID, sessionId);
        intent.putExtras(sessionExtras);
        intent.putExtra(EXTRA_LAUNCH_AS_TWA, true);
        Bundle displayMode = new Bundle();
        displayMode.putInt(KEY_DISPLAY_MODE_ID, 0); // mặc định: hiện thanh trạng thái, không thanh địa chỉ
        intent.putExtra(EXTRA_DISPLAY_MODE, displayMode);
        addColors(intent);
        try {
            startActivity(intent);
            Prefs.setProvider(this, pkg);
            done();
        } catch (ActivityNotFoundException e) {
            openCustomTab(pkg);
        }
    }

    /** Trình duyệt không hỗ trợ chế độ app: mở dạng thẻ trình duyệt (vẫn nhận thông báo của trình duyệt). */
    private void openCustomTab(String pkg) {
        if (launched || isFinishing()) return;
        handler.removeCallbacks(connectTimeout);
        if (pkg == null) {
            openWebView();
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, launchUrl());
        intent.setPackage(pkg);
        Bundle sessionExtras = new Bundle();
        sessionExtras.putBinder(EXTRA_SESSION, null);
        intent.putExtras(sessionExtras);
        addColors(intent);
        try {
            startActivity(intent);
            Prefs.setProvider(this, pkg);
            done();
        } catch (ActivityNotFoundException e) {
            openWebView();
        }
    }

    private void openWebView() {
        if (launched) return;
        Intent intent = new Intent(this, WebAppActivity.class).setData(launchUrl());
        startActivity(intent);
        done();
    }

    private void done() {
        launched = true;
        finish();
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        if (launched) finish(); // người dùng đóng web và quay lại đây
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(STATE_LAUNCHED, launched);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        sAlive--;
        handler.removeCallbacks(connectTimeout);
        if (bound && connection != null) {
            try {
                unbindService(connection);
            } catch (IllegalArgumentException ignored) {
                // đã ngắt
            }
            bound = false;
        }
    }

    /* ======================= Chọn trình duyệt ======================= */

    static final class Provider {
        final String pkg;
        final boolean twa;

        Provider(String pkg, boolean twa) {
            this.pkg = pkg;
            this.twa = twa;
        }
    }

    /**
     * Ưu tiên Chrome (chắc chắn hỗ trợ chế độ app và chuyển thông báo cho app), sau đó trình duyệt
     * mặc định nếu hỗ trợ chế độ app, rồi trình duyệt khác, cuối cùng là thẻ trình duyệt thường.
     */
    static Provider pickProvider(PackageManager pm) {
        Map<String, Boolean> services = new HashMap<>();
        List<ResolveInfo> found = pm.queryIntentServices(new Intent(ACTION_CUSTOM_TABS), PackageManager.GET_RESOLVED_FILTER);
        for (ResolveInfo info : found) {
            if (info.serviceInfo == null) continue;
            IntentFilter filter = info.filter;
            boolean twa = filter != null && filter.hasCategory(CATEGORY_TWA);
            String pkg = info.serviceInfo.packageName;
            if (isChrome(pkg)) twa = twa || chromeSupportsTwa(pm, pkg);
            Boolean prev = services.get(pkg);
            services.put(pkg, (prev != null && prev) || twa);
        }
        for (String chrome : Config.CHROME_PACKAGES) {
            Boolean twa = services.get(chrome);
            if (twa != null && twa) return new Provider(chrome, true);
        }
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.fromParts("http", "", null))
            .addCategory(Intent.CATEGORY_BROWSABLE);
        List<String> browsers = new ArrayList<>();
        ResolveInfo def = pm.resolveActivity(view, PackageManager.MATCH_DEFAULT_ONLY);
        if (def != null && def.activityInfo != null) browsers.add(def.activityInfo.packageName);
        int flags = Build.VERSION.SDK_INT >= 23 ? PackageManager.MATCH_ALL : PackageManager.MATCH_DEFAULT_ONLY;
        for (ResolveInfo info : pm.queryIntentActivities(view, flags)) {
            if (info.activityInfo != null && !browsers.contains(info.activityInfo.packageName)) {
                browsers.add(info.activityInfo.packageName);
            }
        }
        String customTab = null;
        for (String pkg : browsers) {
            Boolean twa = services.get(pkg);
            if (twa == null) continue;
            if (twa) return new Provider(pkg, true);
            if (customTab == null) customTab = pkg;
        }
        if (customTab != null) return new Provider(customTab, false);
        return null;
    }

    private static boolean isChrome(String pkg) {
        for (String c : Config.CHROME_PACKAGES) if (c.equals(pkg)) return true;
        return false;
    }

    /** Chrome từ bản 72 đã hỗ trợ chế độ app kể cả khi chưa khai báo category. */
    private static boolean chromeSupportsTwa(PackageManager pm, String pkg) {
        try {
            String version = pm.getPackageInfo(pkg, 0).versionName;
            int major = Integer.parseInt(version.split("\\.")[0]);
            return major >= 72;
        } catch (Exception e) {
            return false;
        }
    }

    /** Phiên với Chrome: chỉ cần tồn tại, không phải xử lý sự kiện nào. */
    static final class SessionCallback extends ICustomTabsCallback.Stub {
        @Override public void onNavigationEvent(int navigationEvent, Bundle extras) {}
        @Override public void extraCallback(String callbackName, Bundle args) {}
        @Override public void onMessageChannelReady(Bundle extras) {}
        @Override public void onPostMessage(String message, Bundle extras) {}
        @Override public void onRelationshipValidationResult(int relation, Uri origin, boolean result, Bundle extras) {}
        @Override public Bundle extraCallbackWithResult(String callbackName, Bundle args) { return null; }
        @Override public void onActivityResized(int height, int width, Bundle extras) {}
        @Override public void onWarmupCompleted(Bundle extras) {}
        @Override public void onActivityLayout(int left, int top, int right, int bottom, int state, Bundle extras) {}
        @Override public void onMinimized(Bundle extras) {}
        @Override public void onUnminimized(Bundle extras) {}
    }
}
