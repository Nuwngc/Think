package com.nuwngc.think;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Web mở thinkchat://link?code=... khi bấm "Bật bong bóng chat" trong trang Cá nhân.
 * App đổi mã lấy phiên đăng nhập riêng (cho bong bóng và ô Trả lời nhanh),
 * rồi hướng dẫn bật quyền thông báo và bong bóng.
 */
public class LinkActivity extends Activity {
    private static final String PERMISSION = "android.permission.POST_NOTIFICATIONS";
    private TextView title;
    private TextView message;
    private TextView hint;
    private ProgressBar progress;
    private Button action;
    private Button close;
    private boolean linked;
    private String userName;
    private String pendingToken; // phiên mới đang chờ người dùng xác nhận đổi tài khoản

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (linked) showSteps(); // quay lại từ phần cài đặt
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(22), dp(24), dp(12));

        title = new TextView(this);
        title.setTextAppearance(android.R.style.TextAppearance_Material_Title);
        title.setText("Bong bóng chat");
        root.addView(title);

        progress = new ProgressBar(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(36), dp(36));
        lp.topMargin = dp(16);
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(progress, lp);

        message = new TextView(this);
        message.setTextAppearance(android.R.style.TextAppearance_Material_Subhead);
        message.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mp.topMargin = dp(14);
        root.addView(message, mp);

        hint = new TextView(this);
        hint.setTextAppearance(android.R.style.TextAppearance_Material_Body1);
        hint.setAlpha(0.75f);
        hint.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.topMargin = dp(10);
        root.addView(hint, hp);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.END);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = dp(18);
        close = new Button(this, null, android.R.attr.buttonBarButtonStyle);
        close.setText("Xong");
        close.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        action = new Button(this, null, android.R.attr.buttonBarButtonStyle);
        action.setVisibility(View.GONE);
        buttons.addView(close);
        buttons.addView(action);
        root.addView(buttons, bp);
        setContentView(root);
    }

    private void handle(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        final String code = data == null ? null : data.getQueryParameter("code");
        if (code == null || code.isEmpty()) {
            if (Prefs.linked(this)) {
                linked = true;
                showSteps();
            } else {
                showError("Liên kết không hợp lệ. Mở app Think, vào Cá nhân, bấm \"Bật bong bóng chat\".");
            }
            return;
        }
        progress.setVisibility(View.VISIBLE);
        message.setText("Đang bật bong bóng chat…");
        hint.setText("");
        action.setVisibility(View.GONE);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject body = new JSONObject().put("code", code);
                    final JSONObject res = Http.postNoAuth(LinkActivity.this, "/api/app/redeem", body);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            onLinked(res);
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            showError(e.getMessage() == null ? "Chưa bật được. Thử lại nhé." : e.getMessage());
                        }
                    });
                }
            }
        }, "think-link").start();
    }

    private void onLinked(final JSONObject res) {
        final String token = res.optString("token", "");
        final JSONObject user = res.optJSONObject("user");
        if (token.isEmpty() || user == null) {
            showError("Máy chủ trả về dữ liệu lạ. Thử lại nhé.");
            return;
        }
        long currentId = Prefs.meId(this);
        long newId = user.optLong("id");
        String newName = Notifier.str(user, "displayName");
        if (Prefs.linked(this) && currentId != 0 && currentId != newId) {
            // Đang liên kết tài khoản khác: hỏi trước khi đổi (tránh trang lạ tự đổi tài khoản của bong bóng)
            progress.setVisibility(View.GONE);
            pendingToken = token;
            title.setText("Đổi tài khoản cho bong bóng chat?");
            String oldName = Prefs.meName(this);
            message.setText("Bong bóng chat đang dùng tài khoản " + (oldName == null ? "khác" : oldName)
                + ". Chuyển sang tài khoản " + (newName == null ? "mới" : newName) + "?");
            hint.setText("Nếu bạn không vừa bấm \"Bật bong bóng chat\" trong app Think, hãy chọn Giữ nguyên.");
            close.setText("Giữ nguyên");
            close.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    finish(); // onDestroy đăng xuất phiên chưa dùng
                }
            });
            setAction("Chuyển", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    pendingToken = null;
                    resetClose();
                    applyLink(res, token, user);
                }
            });
            return;
        }
        applyLink(res, token, user);
    }

    private void resetClose() {
        close.setText("Xong");
        close.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
    }

    /** Không dùng phiên vừa tạo: đăng xuất nó trên máy chủ. */
    private void discard(final String token) {
        final android.content.Context app = getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Http.postWithToken(app, "/api/logout", token);
                } catch (Exception ignored) {
                    // phiên tự hết hạn sau này
                }
            }
        }, "think-discard").start();
    }

    private void applyLink(JSONObject res, String token, JSONObject user) {
        long maxAge = res.optLong("maxAge", 180L * 24 * 3600 * 1000) / 1000;
        userName = Notifier.str(user, "displayName");
        Prefs.saveSession(this, token, user.optLong("id"), userName, Notifier.str(user, "avatar"));
        // Bong bóng (WebView) dùng chung phiên này, khỏi phải đăng nhập lại
        try {
            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setCookie(Config.ORIGIN, "sid=" + token + "; Max-Age=" + maxAge + "; Path=/; Secure; HttpOnly; SameSite=Lax",
                new ValueCallback<Boolean>() {
                    @Override
                    public void onReceiveValue(Boolean ok) {
                        CookieManager.getInstance().flush();
                    }
                });
        } catch (RuntimeException e) {
            // Máy đang cập nhật WebView: ô Trả lời nhanh vẫn chạy, bong bóng sẽ hỏi đăng nhập một lần
        }
        linked = true;
        showSteps();
    }

    private void showError(String text) {
        progress.setVisibility(View.GONE);
        title.setText("Chưa bật được bong bóng chat");
        message.setText(text);
        hint.setText("");
        action.setVisibility(View.GONE);
    }

    private boolean notificationsAllowed() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        return nm.areNotificationsEnabled();
    }

    @SuppressWarnings("deprecation")
    private boolean bubblesAllowedForAll() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 31) return nm.getBubblePreference() == NotificationManager.BUBBLE_PREFERENCE_ALL;
        if (Build.VERSION.SDK_INT >= 30) return nm.areBubblesAllowed();
        return false;
    }

    private void showSteps() {
        progress.setVisibility(View.GONE);
        title.setText("Bong bóng chat");
        String who = userName == null || userName.isEmpty() ? Prefs.meName(this) : userName;
        String intro = who == null || who.isEmpty() ? "Đã liên kết tài khoản." : "Đã liên kết tài khoản " + who + ".";
        boolean samsung = "samsung".equalsIgnoreCase(Build.MANUFACTURER);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(PERMISSION) != PackageManager.PERMISSION_GRANTED
                && !Prefs.askedNotify(this)) {
            message.setText(intro + " Bước tiếp: cho app gửi thông báo.");
            hint.setText("Không có thông báo thì không hiện được bong bóng chat.");
            setAction("Cho phép thông báo", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Notifier.ensureChannels(LinkActivity.this);
                    requestPermissions(new String[] { PERMISSION }, 2);
                }
            });
            return;
        }
        if (!notificationsAllowed()) {
            message.setText(intro + " Thông báo của app đang tắt.");
            hint.setText("Mở cài đặt, bật \"Cho phép thông báo\" cho Think.");
            setAction("Mở cài đặt", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    openSettings(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                }
            });
            return;
        }
        if (Build.VERSION.SDK_INT < 30) {
            message.setText(intro + " Máy bạn dùng Android 10 trở xuống nên chưa có bong bóng chat.");
            hint.setText("Bạn vẫn trả lời được ngay trong thông báo: kéo thông báo xuống, bấm \"Trả lời\".");
            action.setVisibility(View.GONE);
            return;
        }
        if (!bubblesAllowedForAll()) {
            message.setText(intro + " Bước cuối: cho phép hiện bong bóng.");
            String h = "Trong trang cài đặt sắp mở, chọn \"Tất cả cuộc trò chuyện đều có thể hiện bong bóng\" (hoặc bật Bong bóng).";
            if (samsung) h += "\n\nMáy Samsung: vào thêm Cài đặt → Thông báo → Cài đặt nâng cao → Thông báo nổi → chọn Bong bóng.";
            hint.setText(h);
            setAction("Cho phép bong bóng", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    openSettings(Settings.ACTION_APP_NOTIFICATION_BUBBLE_SETTINGS);
                }
            });
            return;
        }
        message.setText(intro + " Xong rồi! Tin nhắn mới sẽ hiện thành bong bóng chat, chạm vào để trả lời.");
        String h = "Muốn tắt: nhấn giữ bong bóng hoặc vào Cài đặt → Thông báo của Think.";
        if (samsung) h = "Máy Samsung: nếu chưa thấy bong bóng, vào Cài đặt → Thông báo → Cài đặt nâng cao → Thông báo nổi → chọn Bong bóng.";
        hint.setText(h);
        action.setVisibility(View.GONE);
    }

    private void setAction(String label, View.OnClickListener listener) {
        action.setText(label);
        action.setOnClickListener(listener);
        action.setVisibility(View.VISIBLE);
    }

    private void openSettings(String settingsAction) {
        try {
            Intent i = new Intent(settingsAction).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
            startActivity(i);
        }
    }

    @Override
    protected void onDestroy() {
        // Bấm Back hoặc Giữ nguyên khi đang hỏi đổi tài khoản: bỏ phiên vừa tạo
        if (pendingToken != null && isFinishing()) discard(pendingToken);
        pendingToken = null;
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        Prefs.setAskedNotify(this);
        showSteps();
    }
}
