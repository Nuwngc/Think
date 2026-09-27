package com.nuwngc.think;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Khung web dùng cho bong bóng chat: trong Activity (Android 11+ và bản dự phòng khi máy không có Chrome)
 * hoặc trong cửa sổ nổi (bong bóng Android 8–10, xem {@link ChatHeadService}).
 * Đăng nhập được giữ trong cookie của app, nên mọi khung web của app dùng chung một lần đăng nhập.
 */
final class WebShell {
    static final int REQUEST_FILE = 41;

    /** Nơi chứa khung web. */
    interface Host {
        /** Mở màn hình chọn ảnh; kết quả trả qua callback. Trả false nếu không mở được. */
        boolean pickFiles(Intent pickIntent, ValueCallback<Uri[]> callback);

        /** Sắp mở app khác (hoặc app Think toàn màn hình): bong bóng nổi thì thu gọn lại. */
        void beforeLeave();

        /** Khung web nằm trong cửa sổ nổi (không có Activity), hộp thoại phải tự vẽ. */
        boolean isOverlay();
    }

    private final Context context;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private AlertDialog openDialog;
    final WebView web;

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    WebShell(Context context, Host host) {
        this.context = context;
        this.host = host;
        web = new WebView(context);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " ThinkApp/" + Config.versionName(context));
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.addJavascriptInterface(new Bridge(context.getApplicationContext()), "ThinkApp");
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
    }

    /** Tạo khung web trong Activity; nếu máy đang cập nhật hoặc đã tắt Android System WebView thì báo và trả về null. */
    static WebShell tryCreate(Activity activity) {
        try {
            return new WebShell(activity, new ActivityHost(activity));
        } catch (RuntimeException e) {
            TextView msg = new TextView(activity);
            int pad = Math.round(24 * activity.getResources().getDisplayMetrics().density);
            msg.setPadding(pad, pad, pad, pad);
            msg.setTextAppearance(android.R.style.TextAppearance_Material_Subhead);
            msg.setText(webViewMissingText());
            activity.setContentView(msg);
            return null;
        }
    }

    static String webViewMissingText() {
        return "Không mở được khung chat vì Android System WebView đang cập nhật hoặc bị tắt. "
            + "Vào CH Play cập nhật \"Android System WebView\" rồi thử lại.";
    }

    void load(String url) {
        web.loadUrl(url);
    }

    boolean back() {
        if (web.canGoBack()) {
            web.goBack();
            return true;
        }
        return false;
    }

    void onPause() {
        web.onPause();       // trang biết là đang ẩn: máy chủ sẽ gửi thông báo cho tin mới
        syncSession(context);
        CookieManager.getInstance().flush();
    }

    void onResume() {
        web.onResume();
    }

    void destroy() {
        dismissDialog();
        web.destroy();
    }

    /** Đóng hộp thoại xác nhận đang mở (bong bóng nổi thu gọn thì không để nó lơ lửng). */
    void dismissDialog() {
        if (openDialog != null) {
            try {
                openDialog.dismiss(); // coi như bấm Hủy
            } catch (RuntimeException ignored) {
                // đã đóng
            }
            openDialog = null;
        }
    }

    /** Người dùng đăng nhập/đăng xuất ngay trong bong bóng: chép phiên sang cho ô Trả lời nhanh dùng. */
    static void syncSession(Context context) {
        String cookies;
        try {
            cookies = CookieManager.getInstance().getCookie(Config.ORIGIN);
        } catch (RuntimeException e) {
            return;
        }
        String token = null;
        if (cookies != null) {
            for (String part : cookies.split(";")) {
                String p = part.trim();
                if (p.startsWith("sid=")) token = p.substring(4);
            }
        }
        String saved = Prefs.token(context);
        if (Prefs.isRevoked(context, token)) return; // cookie cũ đã hết hạn trên máy chủ
        if (token != null && !token.isEmpty() && !token.equals(saved)) Prefs.saveToken(context, token);
        else if ((token == null || token.isEmpty()) && saved != null) Prefs.clearSession(context);
    }

    /** Activity chứa khung web chuyển kết quả chọn ảnh vào đây. */
    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (!(host instanceof ActivityHost)) return false;
        return ((ActivityHost) host).onResult(requestCode, resultCode, data);
    }

    /** Đọc danh sách ảnh đã chọn từ kết quả trả về. */
    static Uri[] parseResult(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null) return null;
        ClipData clip = data.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            List<Uri> uris = new ArrayList<>();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri u = clip.getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
            return uris.isEmpty() ? null : uris.toArray(new Uri[0]);
        }
        return data.getData() != null ? new Uri[] { data.getData() } : null;
    }

    /** Khung web trong Activity: chọn ảnh bằng startActivityForResult như bình thường. */
    private static final class ActivityHost implements Host {
        private final Activity activity;
        private ValueCallback<Uri[]> pending;

        ActivityHost(Activity activity) {
            this.activity = activity;
        }

        @Override
        public boolean pickFiles(Intent pickIntent, ValueCallback<Uri[]> callback) {
            if (pending != null) pending.onReceiveValue(null);
            pending = callback;
            try {
                activity.startActivityForResult(pickIntent, REQUEST_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                pending = null;
                return false;
            }
        }

        boolean onResult(int requestCode, int resultCode, Intent data) {
            if (requestCode != REQUEST_FILE) return false;
            ValueCallback<Uri[]> cb = pending;
            pending = null;
            if (cb != null) cb.onReceiveValue(parseResult(resultCode, data));
            return true;
        }

        @Override
        public void beforeLeave() {
            // Activity tự lùi xuống khi app khác mở lên
        }

        @Override
        public boolean isOverlay() {
            return false;
        }
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (Config.isOurUrl(uri)) return false;
            // Link ngoài (hoặc thinkchat://link...) thì mở bằng app phù hợp
            try {
                Intent intent = "intent".equals(uri.getScheme())
                    ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                    : new Intent(Intent.ACTION_VIEW, uri);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
                host.beforeLeave();
                context.startActivity(intent);
            } catch (Exception e) {
                Toast.makeText(context, "Không mở được liên kết này.", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            syncSession(context);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                return host.pickFiles(intent, callback);
            } catch (RuntimeException e) {
                return false;
            }
        }

        // Cửa sổ nổi không có Activity: hộp thoại xác nhận của web phải tự vẽ dạng cửa sổ nổi
        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            if (!host.isOverlay()) return super.onJsAlert(view, url, message, result);
            return showOverlayDialog(message, result, false);
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            if (!host.isOverlay()) return super.onJsConfirm(view, url, message, result);
            return showOverlayDialog(message, result, true);
        }
    }

    /** Trả lời hộp thoại của web đúng một lần (bấm nút, bấm ra ngoài, hay bị đóng khi thu gọn). */
    private static final class Answer {
        private final JsResult result;
        private boolean done;

        Answer(JsResult result) {
            this.result = result;
        }

        void yes() {
            if (done) return;
            done = true;
            result.confirm();
        }

        void no() {
            if (done) return;
            done = true;
            result.cancel();
        }
    }

    private boolean showOverlayDialog(String message, JsResult result, boolean withCancel) {
        final Answer answer = new Answer(result);
        try {
            int theme = isNight(context)
                ? android.R.style.Theme_Material_Dialog_Alert
                : android.R.style.Theme_Material_Light_Dialog_Alert;
            AlertDialog.Builder b = new AlertDialog.Builder(context, theme)
                .setMessage(message)
                .setPositiveButton("Đồng ý", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        answer.yes();
                    }
                });
            if (withCancel) {
                b.setNegativeButton("Hủy", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        answer.no();
                    }
                });
            }
            dismissDialog();
            AlertDialog dialog = b.create();
            dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
                @Override
                public void onDismiss(DialogInterface d) {
                    answer.no(); // đóng mà chưa bấm Đồng ý thì coi như Hủy
                }
            });
            if (dialog.getWindow() != null) {
                dialog.getWindow().setType(Build.VERSION.SDK_INT >= 26
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE);
            }
            dialog.show();
            openDialog = dialog;
            return true;
        } catch (RuntimeException e) {
            answer.no();
            return true;
        }
    }

    static boolean isNight(Context context) {
        int mode = context.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return mode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    /** Hàm web gọi được: window.ThinkApp.openApp('#/c/1'), window.ThinkApp.download(url). */
    final class Bridge {
        private final Context app;

        Bridge(Context app) {
            this.app = app;
        }

        @JavascriptInterface
        public void openApp(String hash) {
            String h = hash == null ? "" : hash.trim();
            if (!h.startsWith("#")) h = "";
            final Intent intent = new Intent(app, LauncherActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(Config.ORIGIN + "/" + h))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            main.post(new Runnable() {
                @Override
                public void run() {
                    host.beforeLeave();
                    app.startActivity(intent);
                }
            });
        }

        @JavascriptInterface
        public void download(String url) {
            Uri uri = Uri.parse(url == null ? "" : url);
            if (!Config.isOurUrl(uri)) return;
            try {
                String name = URLUtil.guessFileName(url, null, null);
                if (!name.startsWith("think-")) name = "think-" + name;
                DownloadManager.Request req = new DownloadManager.Request(uri)
                    .setTitle(name)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                // Android 10+: lưu thẳng vào Ảnh/Think. Android 9 trở xuống cần quyền bộ nhớ, nên để
                // Trình quản lý tải xuống tự chọn chỗ (xem trong app Tải xuống).
                if (Build.VERSION.SDK_INT >= 29) {
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_PICTURES, "Think/" + name);
                }
                String cookie = CookieManager.getInstance().getCookie(Config.ORIGIN);
                if (cookie != null) req.addRequestHeader("Cookie", cookie);
                DownloadManager dm = (DownloadManager) app.getSystemService(Context.DOWNLOAD_SERVICE);
                dm.enqueue(req);
            } catch (Exception e) {
                // không tải được thì thôi
            }
        }

        @JavascriptInterface
        public int version() {
            return Config.versionCode(app);
        }

        @JavascriptInterface
        public boolean isBubble() {
            return true;
        }
    }
}
