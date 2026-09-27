package com.nuwngc.think;

import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.view.animation.OvershootInterpolator;
import android.webkit.ValueCallback;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.LinkedHashMap;

/**
 * Bong bóng nổi (Android 8–10): hình tròn ảnh người nhắn nằm đè lên màn hình, kéo đi đâu cũng được,
 * kéo xuống dấu ✕ để ẩn. Chạm vào thì mở khung chat (web Think, chế độ bong bóng) ngay trên màn hình.
 * Android 8–10 bắt buộc app hiện một thông báo "đang chạy" trong lúc có bong bóng.
 */
public class ChatHeadService extends Service {
    private static final int NOTIFICATION_ID = 7101;
    private static final String CH_HEADS = "chat_heads";
    private static volatile boolean sRunning;

    static boolean isRunning() {
        return sRunning;
    }

    private WindowManager wm;
    private float density;
    private int headSize;
    private int headBox;
    private int touchSlop;

    private FrameLayout head;
    private ImageView headImage;
    private TextView headBadge;
    private WindowManager.LayoutParams headParams;
    private boolean headShown;
    private int restX = -1;
    private int restY = -1;

    private FrameLayout closeTarget;
    private WindowManager.LayoutParams closeParams;
    private boolean closeShown;

    private FrameLayout panelRoot;
    private WindowManager.LayoutParams panelParams;
    private boolean expanded;
    private WebShell shell;
    private boolean shellLoaded;
    private int shellConv = -1;

    private int currentConv;                                             // 0 = danh sách tin nhắn
    private int lastStartId;
    private final LinkedHashMap<Integer, Integer> unread = new LinkedHashMap<>();
    private BroadcastReceiver systemDialogs;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sRunning = true;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        density = getResources().getDisplayMetrics().density;
        headSize = dp(58);
        headBox = headSize + dp(10);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();
        goForeground();
        // Về màn hình chính, mở đa nhiệm, cử chỉ (MIUI) hay tắt màn hình: thu gọn khung chat,
        // để trang biết là đang ẩn (tin mới lại có thông báo, không bị tự đánh dấu đã đọc)
        systemDialogs = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                collapse();
            }
        };
        IntentFilter filter = new IntentFilter(Intent.ACTION_CLOSE_SYSTEM_DIALOGS);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        try {
            registerReceiver(systemDialogs, filter);
        } catch (RuntimeException e) {
            systemDialogs = null;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        goForeground(); // mỗi lần được gọi bằng startForegroundService đều phải báo lại
        lastStartId = startId;
        if (!ChatHeads.canDraw(this)) {
            hideAndStop();
            return START_NOT_STICKY;
        }
        String action = intent == null ? null : intent.getAction();
        int convId = intent == null ? 0 : intent.getIntExtra(ChatHeads.EXTRA_CONV, 0);
        try {
            if (ChatHeads.ACTION_MESSAGE.equals(action) && convId > 0) {
                if (Prefs.headsOn(this)) {
                    Notifier.Conv c = Notifier.load(this, convId);
                    int n = c != null && c.unread > 0 ? c.unread : 1;
                    unread.remove(convId);
                    unread.put(convId, n);
                    if (!expanded) currentConv = convId;
                    showHead();
                    refreshHead();
                    if (!expanded) pulse();
                }
            } else if (ChatHeads.ACTION_UPDATE.equals(action)) {
                if (headShown && convId == currentConv) refreshHead();
            } else if (ChatHeads.ACTION_READ.equals(action)) {
                unread.remove(convId);
                if (headShown) refreshHead();
            } else if (ChatHeads.ACTION_EXPAND.equals(action)) {
                if (headShown) expand();
            } else if (ChatHeads.ACTION_DEMO.equals(action)) {
                if (!headShown) currentConv = 0;
                showHead();
                refreshHead();
                pulse();
            } else if (ChatHeads.ACTION_DISABLE.equals(action)) {
                Prefs.setHeadsOn(this, false);
                Toast.makeText(this, "Đã tắt bong bóng chat. Bật lại trong app: Cá nhân → Bật bong bóng chat.", Toast.LENGTH_LONG).show();
                hideAndStop();
            } else if (ChatHeads.ACTION_HIDE.equals(action)) {
                hideAndStop();
            }
        } catch (RuntimeException e) {
            // Mất quyền hiện trên ứng dụng khác giữa chừng, hoặc WebView hỏng: tắt bong bóng
            hideAndStop();
        }
        if (!headShown) stopSelfResult(startId);
        return START_NOT_STICKY;
    }

    /**
     * Gỡ bong bóng khỏi màn hình rồi dừng. Dùng stopSelfResult: nếu vừa có tin mới gọi tới
     * (startForegroundService) thì service chạy tiếp để xử lý tin đó, tránh lỗi của Android.
     */
    private void hideAndStop() {
        collapse();
        hideClose();
        if (headShown) removeQuietly(head);
        headShown = false;
        unread.clear();
        stopSelfResult(lastStartId);
    }

    @Override
    public void onDestroy() {
        sRunning = false;
        if (systemDialogs != null) {
            try {
                unregisterReceiver(systemDialogs);
            } catch (RuntimeException ignored) {
                // đã gỡ
            }
        }
        removeQuietly(closeTarget);
        closeShown = false;
        if (expanded) removeQuietly(panelRoot);
        expanded = false;
        if (headShown) removeQuietly(head);
        headShown = false;
        if (shell != null) {
            shell.onPause();
            shell.destroy();
            shell = null;
        }
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        collapse();
        if (headShown) {
            headParams.x = clampX(headParams.x);
            headParams.y = clampY(headParams.y);
            updateHead();
            snapToEdge();
        }
    }

    /* ======================= Thông báo "đang chạy" (bắt buộc) ======================= */

    private void goForeground() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CH_HEADS) == null) {
            NotificationChannel ch = new NotificationChannel(CH_HEADS, "Bong bóng chat đang bật", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Android 8–10 bắt buộc hiện thông báo này khi có bong bóng chat trên màn hình");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent hide = PendingIntent.getService(this, 1,
            new Intent(this, ChatHeadService.class).setAction(ChatHeads.ACTION_HIDE),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent disable = PendingIntent.getService(this, 2,
            new Intent(this, ChatHeadService.class).setAction(ChatHeads.ACTION_DISABLE),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CH_HEADS)
            .setSmallIcon(R.drawable.ic_stat_think)
            .setColor(Config.BRAND)
            .setContentTitle("Bong bóng chat đang bật")
            .setContentText("Chạm để ẩn bong bóng. Có tin mới bong bóng sẽ hiện lại.")
            .setContentIntent(hide)
            .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_done), "Tắt bong bóng", disable).build())
            .setOngoing(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
        startForeground(NOTIFICATION_ID, n);
    }

    /* ======================= Bong bóng (hình tròn) ======================= */

    private int dp(float v) {
        return Math.round(v * density);
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private DisplayMetrics screen() {
        DisplayMetrics dm = new DisplayMetrics();
        wm.getDefaultDisplay().getMetrics(dm);
        return dm;
    }

    private int statusBarHeight() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : dp(24);
    }

    private int clampX(int x) {
        return Math.max(0, Math.min(x, screen().widthPixels - headBox));
    }

    private int clampY(int y) {
        return Math.max(statusBarHeight(), Math.min(y, screen().heightPixels - headBox - dp(8)));
    }

    private void buildHead() {
        head = new FrameLayout(this);
        headImage = new ImageView(this);
        headImage.setScaleType(ImageView.ScaleType.CENTER_CROP);
        headImage.setElevation(dp(6));
        headImage.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setOval(0, 0, view.getWidth(), view.getHeight());
            }
        });
        FrameLayout.LayoutParams ip = new FrameLayout.LayoutParams(headSize, headSize, Gravity.BOTTOM | Gravity.START);
        ip.setMargins(dp(3), 0, 0, dp(3));
        head.addView(headImage, ip);

        headBadge = new TextView(this);
        headBadge.setTextColor(Color.WHITE);
        headBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        headBadge.setTypeface(Typeface.DEFAULT_BOLD);
        headBadge.setGravity(Gravity.CENTER);
        headBadge.setMinWidth(dp(20));
        headBadge.setPadding(dp(5), 0, dp(5), 0);
        headBadge.setElevation(dp(7));
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(0xFFE0245E);
        badgeBg.setCornerRadius(dp(10));
        badgeBg.setStroke(dp(2), Color.WHITE);
        headBadge.setBackground(badgeBg);
        head.addView(headBadge, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(20), Gravity.TOP | Gravity.END));

        headParams = new WindowManager.LayoutParams(headBox, headBox, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        headParams.gravity = Gravity.TOP | Gravity.START;
        head.setOnTouchListener(new HeadTouch());
    }

    private void showHead() {
        if (headShown) return;
        if (head == null) buildHead();
        DisplayMetrics dm = screen();
        if (restX < 0) {
            restX = dm.widthPixels - headBox - dp(4);
            restY = (int) (dm.heightPixels * 0.28f);
        }
        headParams.x = clampX(restX);
        headParams.y = clampY(restY);
        wm.addView(head, headParams);
        headShown = true;
    }

    private void refreshHead() {
        if (head == null) return;
        Notifier.Conv c = currentConv > 0 ? Notifier.load(this, currentConv) : null;
        Bitmap bmp;
        if (c != null) {
            bmp = Avatars.conversationCircle(this, c.isGroup, c.avatar, c.title, c.isGroup ? c.id : c.peerId, headSize);
            headImage.setContentDescription("Bong bóng chat: " + c.title);
        } else {
            bmp = appIcon();
            headImage.setContentDescription("Bong bóng chat Think");
        }
        headImage.setImageBitmap(bmp);
        int total = 0;
        for (Integer n : unread.values()) total += n;
        headBadge.setVisibility(total > 0 && !expanded ? View.VISIBLE : View.GONE);
        headBadge.setText(total > 99 ? "99+" : String.valueOf(total));
    }

    private Bitmap appIcon() {
        Bitmap out = Bitmap.createBitmap(headSize, headSize, Bitmap.Config.ARGB_8888);
        Drawable d = getDrawable(R.mipmap.ic_launcher_round);
        if (d != null) {
            d.setBounds(0, 0, headSize, headSize);
            d.draw(new Canvas(out));
        }
        return out;
    }

    private void pulse() {
        if (headImage == null) return;
        headImage.setScaleX(0.7f);
        headImage.setScaleY(0.7f);
        headImage.animate().scaleX(1f).scaleY(1f).setDuration(320).setInterpolator(new OvershootInterpolator(3f)).start();
    }

    private void snapToEdge() {
        if (!headShown) return;
        DisplayMetrics dm = screen();
        int center = headParams.x + headBox / 2;
        final int target = center < dm.widthPixels / 2 ? dp(2) : dm.widthPixels - headBox - dp(2);
        ValueAnimator anim = ValueAnimator.ofInt(headParams.x, target);
        anim.setDuration(220);
        anim.setInterpolator(new OvershootInterpolator(1.2f));
        anim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                if (!headShown || expanded) return;
                headParams.x = (Integer) a.getAnimatedValue();
                try {
                    wm.updateViewLayout(head, headParams);
                } catch (RuntimeException ignored) {
                    // bong bóng đã bị gỡ
                }
            }
        });
        anim.start();
        restX = target;
        restY = headParams.y;
    }

    /** Kéo thả bong bóng; chạm nhẹ thì mở/thu gọn khung chat. */
    private final class HeadTouch implements View.OnTouchListener {
        private float downX;
        private float downY;
        private int startX;
        private int startY;
        private boolean dragging;

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = e.getRawX();
                    downY = e.getRawY();
                    startX = headParams.x;
                    startY = headParams.y;
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    if (expanded) return true; // đang mở khung chat: chỉ chạm để thu gọn
                    float dx = e.getRawX() - downX;
                    float dy = e.getRawY() - downY;
                    if (!dragging && Math.hypot(dx, dy) > touchSlop) {
                        dragging = true;
                        showClose();
                    }
                    if (dragging) {
                        headParams.x = clampX(startX + Math.round(dx));
                        headParams.y = clampY(startY + Math.round(dy));
                        updateHead();
                        highlightClose(isOverClose(e.getRawX(), e.getRawY()));
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP:
                    if (dragging) {
                        boolean over = isOverClose(e.getRawX(), e.getRawY());
                        hideClose();
                        if (over) hideAndStop(); // kéo vào dấu ✕: ẩn đến khi có tin mới
                        else snapToEdge();
                    } else {
                        if (expanded) collapse();
                        else expand();
                    }
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    if (dragging) {
                        hideClose();
                        snapToEdge();
                    }
                    dragging = false;
                    return true;
                default:
                    return false;
            }
        }
    }

    /* ======================= Dấu ✕ để ẩn bong bóng ======================= */

    private void showClose() {
        if (closeShown) return;
        if (closeTarget == null) {
            closeTarget = new FrameLayout(this);
            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.OVAL);
            bg.setColor(0xCC1B1F1D);
            bg.setStroke(dp(2), 0x66FFFFFF);
            closeTarget.setBackground(bg);
            TextView x = new TextView(this);
            x.setText("✕");
            x.setTextColor(Color.WHITE);
            x.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
            x.setGravity(Gravity.CENTER);
            closeTarget.addView(x, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            closeParams = new WindowManager.LayoutParams(dp(64), dp(64), overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
            closeParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            closeParams.y = dp(56);
        }
        try {
            wm.addView(closeTarget, closeParams);
            closeShown = true;
        } catch (RuntimeException ignored) {
            closeShown = false;
        }
    }

    private void hideClose() {
        if (!closeShown) return;
        removeQuietly(closeTarget);
        closeShown = false;
    }

    private boolean isOverClose(float rawX, float rawY) {
        if (!closeShown || closeTarget == null) return false;
        int[] loc = new int[2];
        closeTarget.getLocationOnScreen(loc);
        float cx;
        float cy;
        if (closeTarget.getWidth() > 0) {
            cx = loc[0] + closeTarget.getWidth() / 2f;
            cy = loc[1] + closeTarget.getHeight() / 2f;
        } else { // chưa vẽ xong: ước lượng
            DisplayMetrics dm = screen();
            cx = dm.widthPixels / 2f;
            cy = dm.heightPixels - dp(56) - dp(32);
        }
        return Math.hypot(rawX - cx, rawY - cy) < dp(80);
    }

    private void highlightClose(boolean on) {
        if (closeTarget == null) return;
        float s = on ? 1.25f : 1f;
        closeTarget.setScaleX(s);
        closeTarget.setScaleY(s);
    }

    /* ======================= Khung chat ======================= */

    private final WebShell.Host host = new WebShell.Host() {
        @Override
        public boolean pickFiles(Intent pickIntent, ValueCallback<Uri[]> callback) {
            collapse(); // màn hình chọn ảnh nằm dưới cửa sổ nổi nên phải thu gọn trước
            PickerActivity.start(ChatHeadService.this, pickIntent, callback);
            return true;
        }

        @Override
        public void beforeLeave() {
            collapse();
        }

        @Override
        public boolean isOverlay() {
            return true;
        }
    };

    private boolean buildPanel() {
        boolean night = WebShell.isNight(this);
        Context themed = new ContextThemeWrapper(this, night
            ? android.R.style.Theme_Material_NoActionBar
            : android.R.style.Theme_Material_Light_NoActionBar);
        try {
            shell = new WebShell(themed, host);
        } catch (RuntimeException e) {
            shell = null;
            Toast.makeText(this, WebShell.webViewMissingText(), Toast.LENGTH_LONG).show();
            return false;
        }
        panelRoot = new FrameLayout(themed) {
            @Override
            public boolean dispatchKeyEvent(KeyEvent event) {
                if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
                    if (event.getAction() == KeyEvent.ACTION_UP && !shell.back()) collapse();
                    return true;
                }
                return super.dispatchKeyEvent(event);
            }
        };
        panelRoot.setBackgroundColor(0x80000000);
        panelRoot.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapse(); // chạm ra ngoài khung chat
            }
        });
        FrameLayout card = new FrameLayout(themed);
        card.setClickable(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(night ? Config.SURFACE_DARK : Config.SURFACE_LIGHT);
        bg.setCornerRadius(dp(18));
        card.setBackground(bg);
        card.setClipToOutline(true);
        card.setElevation(dp(10));
        card.addView(shell.web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        cardLp.setMargins(dp(8), statusBarHeight() + headBox + dp(10), dp(8), dp(8));
        panelRoot.addView(card, cardLp);

        int flags = WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED; // WebView cần tăng tốc phần cứng
        panelParams = new WindowManager.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
            overlayType(), flags, PixelFormat.TRANSLUCENT);
        panelParams.gravity = Gravity.TOP | Gravity.START;
        panelParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN;
        return true;
    }

    private void expand() {
        if (expanded || !headShown) return;
        if (panelRoot == null && !buildPanel()) return;
        String hash = currentConv > 0 ? "#/c/" + currentConv : "#/";
        if (!shellLoaded) {
            shell.load(Config.ORIGIN + "/?bubble=1&overlay=1" + hash);
            shellLoaded = true;
        } else if (shellConv != currentConv) {
            shell.web.evaluateJavascript("location.hash = " + JSONObject.quote(hash) + ";", null);
        }
        shellConv = currentConv;
        try {
            wm.addView(panelRoot, panelParams);
        } catch (RuntimeException e) {
            return;
        }
        expanded = true;
        // Bong bóng lên góc trên bên phải, nằm trên khung chat
        restX = headParams.x;
        restY = headParams.y;
        headParams.x = screen().widthPixels - headBox - dp(8);
        headParams.y = statusBarHeight() + dp(4);
        head.post(new Runnable() {
            @Override
            public void run() {
                if (!headShown || !expanded) return;
                removeQuietly(head);
                try {
                    wm.addView(head, headParams); // gắn lại để bong bóng nằm trên khung chat
                } catch (RuntimeException e) {
                    headShown = false;
                    hideAndStop();
                }
            }
        });
        shell.onResume();
        if (currentConv > 0) {
            unread.remove(currentConv);
            final int id = currentConv;
            final Context app = getApplicationContext();
            Notifier.runInBackground(new Runnable() {
                @Override
                public void run() {
                    Notifier.dismiss(app, id); // đang đọc trong bong bóng: bỏ thông báo trên thanh
                }
            });
        }
        refreshHead();
    }

    private void collapse() {
        if (!expanded) return;
        expanded = false;
        if (shell != null) {
            shell.dismissDialog();
            shell.onPause(); // trang biết là đang ẩn: tin mới sẽ lại có thông báo
        }
        removeQuietly(panelRoot);
        if (headShown) {
            headParams.x = clampX(restX);
            headParams.y = clampY(restY);
            try {
                wm.updateViewLayout(head, headParams);
            } catch (RuntimeException ignored) {
                // đã gỡ
            }
        }
        // Tin đến lúc đang mở khung chat: chuyển bong bóng sang cuộc trò chuyện mới nhất còn chưa đọc
        Integer latest = null;
        for (Integer id : unread.keySet()) latest = id;
        if (latest != null) currentConv = latest;
        refreshHead();
    }

    private void updateHead() {
        try {
            wm.updateViewLayout(head, headParams);
        } catch (RuntimeException ignored) {
            // bong bóng đã bị gỡ
        }
    }

    private void removeQuietly(View v) {
        if (v == null) return;
        try {
            wm.removeViewImmediate(v);
        } catch (RuntimeException ignored) {
            // chưa gắn vào màn hình
        }
    }
}
