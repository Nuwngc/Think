package com.nuwngc.think;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
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
 * Khung web dùng cho bong bóng chat (và bản dự phòng khi máy không có Chrome).
 * Đăng nhập được giữ trong cookie của app, nên app và bong bóng dùng chung một lần đăng nhập.
 */
final class WebShell {
    static final int REQUEST_FILE = 41;
    private final Activity activity;
    final WebView web;
    private ValueCallback<Uri[]> pendingFiles;

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    WebShell(Activity activity) {
        this.activity = activity;
        web = new WebView(activity);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " ThinkApp/" + Config.versionName(activity));
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.addJavascriptInterface(new Bridge(activity.getApplicationContext()), "ThinkApp");
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
    }

    /** Tạo khung web; nếu máy đang cập nhật hoặc đã tắt Android System WebView thì hiện lời nhắn và trả về null. */
    static WebShell tryCreate(Activity activity) {
        try {
            return new WebShell(activity);
        } catch (RuntimeException e) {
            TextView msg = new TextView(activity);
            int pad = Math.round(24 * activity.getResources().getDisplayMetrics().density);
            msg.setPadding(pad, pad, pad, pad);
            msg.setTextAppearance(android.R.style.TextAppearance_Material_Subhead);
            msg.setText("Không mở được khung chat vì Android System WebView đang cập nhật hoặc bị tắt. "
                + "Vào CH Play cập nhật \"Android System WebView\" rồi thử lại.");
            activity.setContentView(msg);
            return null;
        }
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
        syncSession(activity);
        CookieManager.getInstance().flush();
    }

    void onResume() {
        web.onResume();
    }

    void destroy() {
        web.destroy();
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

    /* ---- Chọn ảnh để gửi ---- */
    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_FILE) return false;
        ValueCallback<Uri[]> cb = pendingFiles;
        pendingFiles = null;
        if (cb == null) return true;
        Uri[] result = null;
        if (resultCode == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                List<Uri> uris = new ArrayList<>();
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) uris.add(u);
                }
                result = uris.toArray(new Uri[0]);
            } else if (data.getData() != null) {
                result = new Uri[] { data.getData() };
            }
        }
        cb.onReceiveValue(result);
        return true;
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
                activity.startActivity(intent);
            } catch (Exception e) {
                Toast.makeText(activity, "Không mở được liên kết này.", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            syncSession(activity);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                activity.startActivityForResult(intent, REQUEST_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                return false;
            }
        }
    }

    /** Hàm web gọi được: window.ThinkApp.openApp('#/c/1'), window.ThinkApp.download(url). */
    static final class Bridge {
        private final Context context;

        Bridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public void openApp(String hash) {
            String h = hash == null ? "" : hash.trim();
            if (!h.startsWith("#")) h = "";
            Intent intent = new Intent(context, LauncherActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(Config.ORIGIN + "/" + h))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
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
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_PICTURES, "Think/" + name);
                String cookie = CookieManager.getInstance().getCookie(Config.ORIGIN);
                if (cookie != null) req.addRequestHeader("Cookie", cookie);
                DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
                dm.enqueue(req);
            } catch (Exception e) {
                // Android 9 trở xuống cần quyền lưu tệp: bỏ qua
            }
        }

        @JavascriptInterface
        public int version() {
            return Config.versionCode(context);
        }

        @JavascriptInterface
        public boolean isBubble() {
            return Build.VERSION.SDK_INT >= 30;
        }
    }
}
