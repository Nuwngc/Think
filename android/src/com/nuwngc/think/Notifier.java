package com.nuwngc.think;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.LocusId;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Hiện thông báo tin nhắn kiểu hội thoại: ảnh và tên từng người gửi, ô Trả lời, nút Đã đọc,
 * và bong bóng chat (Android 11+). Chrome nhận thông báo đẩy của web rồi chuyển sang đây.
 */
final class Notifier {
    private static final String TAG = "ThinkNotifier";
    static final String CH_MESSAGES = "messages";
    static final String CH_OTHER = "other";
    static final String KEY_REPLY = "reply_text";
    static final String EXTRA_CONV = "conversation_id";
    static final String ACTION_REPLY = "com.nuwngc.think.REPLY";
    static final String ACTION_READ = "com.nuwngc.think.READ";
    private static final int MAX_MESSAGES = 10;
    private static final long FETCH_WAIT_MS = 1500;

    /** Web gắn tag "conv-<id>" cho thông báo tin nhắn (public/sw.js); Chrome thêm tiền tố phía trước. */
    private static final Pattern CONV_TAG = Pattern.compile("conv-(\\d+)");
    private static final Pattern COUNT_SUFFIX = Pattern.compile("\\s*\\(\\d+ tin nhắn\\)\\s*$");

    /** Nút xóa thông báo của Chrome, để Chrome biết thông báo đã đóng. Chỉ giữ trong bộ nhớ. */
    private static final Map<Integer, PendingIntent> CHROME_DELETE = new HashMap<>();

    private Notifier() {}

    /* ======================= Kênh thông báo ======================= */

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_MESSAGES) == null) {
            NotificationChannel ch = new NotificationChannel(CH_MESSAGES,
                context.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription(context.getString(R.string.channel_messages_desc));
            ch.enableVibration(true);
            ch.setShowBadge(true);
            if (Build.VERSION.SDK_INT >= 29) ch.setAllowBubbles(true);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_OTHER) == null) {
            NotificationChannel ch = new NotificationChannel(CH_OTHER,
                context.getString(R.string.channel_other), NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(context.getString(R.string.channel_other_desc));
            nm.createNotificationChannel(ch);
        }
    }

    static boolean enabled(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.areNotificationsEnabled();
    }

    static int parseConversation(String platformTag) {
        if (platformTag == null) return 0;
        Matcher m = CONV_TAG.matcher(platformTag);
        int found = 0;
        while (m.find()) {
            try {
                found = Integer.parseInt(m.group(1));
            } catch (NumberFormatException ignored) {
                found = 0;
            }
        }
        return found;
    }

    /* ======================= Mô hình cuộc trò chuyện ======================= */

    static final class Msg {
        String sender;
        long senderId;
        String avatar;
        String text;
        long time;
        boolean mine;

        JSONObject toJson() throws Exception {
            JSONObject o = new JSONObject();
            o.put("s", sender == null ? "" : sender);
            o.put("sid", senderId);
            o.put("a", avatar == null ? "" : avatar);
            o.put("t", text == null ? "" : text);
            o.put("w", time);
            o.put("me", mine);
            return o;
        }

        static Msg fromJson(JSONObject o) {
            Msg m = new Msg();
            m.sender = o.optString("s", "");
            m.senderId = o.optLong("sid", 0);
            m.avatar = emptyToNull(o.optString("a", ""));
            m.text = o.optString("t", "");
            m.time = o.optLong("w", System.currentTimeMillis());
            m.mine = o.optBoolean("me", false);
            return m;
        }
    }

    static final class Conv {
        int id;
        String tag;
        int platformId;
        String title = "Think";
        boolean isGroup;
        boolean knowsType;
        String avatar;       // ảnh người kia (nhắn riêng)
        long peerId;
        int unread;
        final List<Msg> messages = new ArrayList<>();

        String toJson() {
            try {
                JSONObject o = new JSONObject();
                o.put("id", id);
                o.put("tag", tag == null ? "" : tag);
                o.put("pid", platformId);
                o.put("title", title);
                o.put("group", isGroup);
                o.put("knows", knowsType);
                o.put("avatar", avatar == null ? "" : avatar);
                o.put("peer", peerId);
                o.put("unread", unread);
                JSONArray arr = new JSONArray();
                for (Msg m : messages) arr.put(m.toJson());
                o.put("messages", arr);
                return o.toString();
            } catch (Exception e) {
                return null;
            }
        }

        static Conv fromJson(String json) {
            if (json == null) return null;
            try {
                JSONObject o = new JSONObject(json);
                Conv c = new Conv();
                c.id = o.getInt("id");
                c.tag = emptyToNull(o.optString("tag", ""));
                c.platformId = o.optInt("pid", -1);
                c.title = o.optString("title", "Think");
                c.isGroup = o.optBoolean("group", false);
                c.knowsType = o.optBoolean("knows", false);
                c.avatar = emptyToNull(o.optString("avatar", ""));
                c.peerId = o.optLong("peer", 0);
                c.unread = o.optInt("unread", 0);
                JSONArray arr = o.optJSONArray("messages");
                if (arr != null) for (int i = 0; i < arr.length(); i++) c.messages.add(Msg.fromJson(arr.getJSONObject(i)));
                return c;
            } catch (Exception e) {
                return null;
            }
        }
    }

    private static String emptyToNull(String s) {
        return s == null || s.isEmpty() ? null : s;
    }

    static Conv load(Context context, int convId) {
        return Conv.fromJson(Prefs.conversation(context, convId));
    }

    private static void save(Context context, Conv c) {
        String json = c.toJson();
        if (json != null) Prefs.saveConversation(context, c.id, json);
    }

    /** Dựng tạm nội dung từ thông báo Chrome gửi sang: "Tên (3 tin nhắn)" và các dòng "Người gửi: nội dung". */
    private static Conv fromBrowser(Context context, int convId, String tag, int platformId, Notification n) {
        Conv prev = load(context, convId);
        Conv c = new Conv();
        c.id = convId;
        c.tag = tag;
        c.platformId = platformId;
        Bundle extras = n.extras;
        CharSequence title = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence big = extras == null ? null : extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence text = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TEXT);
        String body = big != null ? big.toString() : text != null ? text.toString() : "";
        c.title = title == null ? "Think" : COUNT_SUFFIX.matcher(title.toString()).replaceAll("");
        if (prev != null && prev.knowsType) {
            c.isGroup = prev.isGroup;
            c.knowsType = true;
            c.avatar = prev.avatar;
            c.peerId = prev.peerId;
            if (!prev.title.isEmpty()) c.title = prev.title;
        }
        long now = n.when > 0 ? n.when : System.currentTimeMillis();
        String[] lines = body.split("\n");
        for (String line : lines) {
            if (line.trim().isEmpty()) continue;
            Msg m = new Msg();
            m.time = now;
            int colon = line.indexOf(": ");
            if (c.isGroup && colon > 0 && colon <= 40) {
                m.sender = line.substring(0, colon);
                m.text = line.substring(colon + 2);
                m.senderId = m.sender.hashCode();
            } else {
                m.sender = c.title;
                m.senderId = c.peerId != 0 ? c.peerId : c.title.hashCode();
                m.avatar = c.isGroup ? null : c.avatar;
                m.text = line;
            }
            c.messages.add(m);
        }
        c.unread = c.messages.size();
        return c;
    }

    /** Chuỗi trong JSON; giá trị null hoặc rỗng thì trả về null (org.json trả chữ "null"). */
    static String str(JSONObject o, String key) {
        if (o == null || !o.has(key) || o.isNull(key)) return null;
        String v = o.optString(key, "");
        return v.isEmpty() ? null : v;
    }

    /** Lấy đủ nội dung (tên, ảnh từng người gửi, các tin chưa đọc) từ máy chủ. */
    private static Conv fetch(Context context, Conv base) throws Exception {
        JSONObject data = Http.get(context, "/api/app/notification/" + base.id);
        JSONObject conv = data.getJSONObject("conversation");
        JSONObject me = data.optJSONObject("me");
        if (me != null) Prefs.saveMe(context, me.optLong("id"), str(me, "name"), str(me, "avatar"));
        Conv c = new Conv();
        c.id = base.id;
        c.tag = base.tag;
        c.platformId = base.platformId;
        String title = str(conv, "title");
        c.title = title == null ? base.title : title;
        c.isGroup = conv.optBoolean("isGroup", false);
        c.knowsType = true;
        c.avatar = str(conv, "avatar");
        c.unread = data.optInt("unread", 0);
        long meId = Prefs.meId(context);
        JSONArray arr = data.optJSONArray("messages");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Msg m = new Msg();
                m.senderId = o.optLong("senderId");
                String name = str(o, "senderName");
                m.sender = name == null ? c.title : name;
                m.avatar = str(o, "senderAvatar");
                String text = str(o, "text");
                m.text = text == null ? "" : text;
                m.time = o.optLong("createdAt", System.currentTimeMillis());
                m.mine = meId != 0 && m.senderId == meId;
                if (!c.isGroup && !m.mine) c.peerId = m.senderId;
                c.messages.add(m);
            }
        }
        // Tải ảnh đại diện chưa có trên máy (lần sau có sẵn, hiện ngay)
        Avatars.photo(context, c.avatar, true);
        for (Msg m : c.messages) Avatars.photo(context, m.avatar, true);
        return c;
    }

    /* ======================= Luồng nền ======================= */

    // Mọi việc nặng (mạng, vẽ ảnh, tạo lối tắt) chạy lần lượt trên một luồng riêng,
    // để không giữ luồng của Chrome hay luồng giao diện của app.
    private static final class Worker {
        static final Handler HANDLER;

        static {
            HandlerThread thread = new HandlerThread("think-notify");
            thread.start();
            HANDLER = new Handler(thread.getLooper());
        }
    }

    private static final Object POST_LOCK = new Object();

    /** Chạy trên luồng nền của thông báo; lỗi bất ngờ chỉ ghi lại, không làm sập app. */
    static void runInBackground(final Runnable task) {
        Worker.HANDLER.post(new Runnable() {
            @Override
            public void run() {
                try {
                    task.run();
                } catch (RuntimeException e) {
                    Log.e(TAG, "Lỗi khi xử lý thông báo", e);
                }
            }
        });
    }

    /** Chạy trên luồng nền và chờ xong (tối đa waitMs), để giữ đúng thứ tự với các việc khác. */
    static void runInBackgroundAndWait(Runnable task, long waitMs) {
        if (Looper.myLooper() == Worker.HANDLER.getLooper()) {
            task.run();
            return;
        }
        final CountDownLatch latch = new CountDownLatch(1);
        final Runnable inner = task;
        runInBackground(new Runnable() {
            @Override
            public void run() {
                try {
                    inner.run();
                } finally {
                    latch.countDown();
                }
            }
        });
        try {
            latch.await(waitMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    // Số thứ tự việc mới nhất của từng cuộc trò chuyện: kết quả cũ về muộn thì bỏ qua
    private static final Map<Integer, Long> LATEST = new HashMap<>();
    private static long sSeq;

    private static long nextSeq(int convId) {
        synchronized (LATEST) {
            long seq = ++sSeq;
            LATEST.put(convId, seq);
            return seq;
        }
    }

    private static boolean isLatest(int convId, long seq) {
        synchronized (LATEST) {
            Long cur = LATEST.get(convId);
            return cur != null && cur == seq;
        }
    }

    /* ======================= Chrome gửi thông báo sang ======================= */

    /** Chrome gọi từ luồng của nó: chỉ ghi nhận rồi trả lời ngay, phần hiện thông báo làm ở luồng nền. */
    static boolean onBrowserNotify(final Context context, final String tag, final int platformId, final Notification n,
                                   String channelName) {
        ensureChannels(context);
        if (!enabled(context)) return false;
        final NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        final int convId = parseConversation(tag);
        final boolean rich = convId > 0 && Prefs.linked(context);
        if (rich && n.deleteIntent != null) synchronized (CHROME_DELETE) { CHROME_DELETE.put(convId, n.deleteIntent); }
        final long seq = convId > 0 ? nextSeq(convId) : 0;
        runInBackground(new Runnable() {
            @Override
            public void run() {
                if (!rich) {
                    // Thông báo khác, hoặc chưa bật bong bóng chat: hiện đúng như Chrome gửi
                    repost(context, nm, tag, platformId, n, convId > 0 ? CH_MESSAGES : CH_OTHER, convId, false);
                    return;
                }
                if (Build.VERSION.SDK_INT < 28) {
                    repost(context, nm, tag, platformId, n, CH_MESSAGES, convId, true);
                    // Android 8: thông báo giữ như Chrome gửi; lấy thêm tên/ảnh để hiện bong bóng nổi
                    if (ChatHeads.enabled(context)) showConversation(context, convId, tag, platformId, n, seq);
                    return;
                }
                try {
                    showConversation(context, convId, tag, platformId, n, seq);
                } catch (RuntimeException e) {
                    Log.e(TAG, "Không dựng được thông báo hội thoại, hiện bản của Chrome", e);
                    repost(context, nm, tag, platformId, n, CH_MESSAGES, convId, true);
                }
            }
        });
        return true;
    }

    /** Luồng nền: hỏi máy chủ nội dung đầy đủ, chờ tối đa 1,5 giây; quá thì hiện tạm bản dựng từ thông báo Chrome. */
    private static void showConversation(final Context context, final int convId, String tag, int platformId,
                                         Notification n, final long seq) {
        if (!isLatest(convId, seq)) return; // đã có tin mới hơn đang chờ
        final Conv quick = fromBrowser(context, convId, tag, platformId, n);
        final CountDownLatch done = new CountDownLatch(1);
        final Conv[] full = new Conv[1];
        final boolean[] late = new boolean[1];
        new Thread(new Runnable() {
            @Override
            public void run() {
                Conv c = null;
                try {
                    c = fetch(context, quick);
                } catch (Exception e) {
                    Log.w(TAG, "Không lấy được nội dung tin nhắn: " + e.getMessage());
                }
                boolean isLate;
                synchronized (late) {
                    full[0] = c;
                    isLate = late[0];
                }
                done.countDown();
                if (c == null || !isLate) return;
                final Conv result = c;
                runInBackground(new Runnable() {
                    @Override
                    public void run() {
                        lateUpdate(context, result, seq);
                    }
                });
            }
        }, "think-fetch").start();
        try {
            done.await(FETCH_WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        Conv got;
        synchronized (late) {
            late[0] = true;
            got = full[0];
        }
        if (!isLatest(convId, seq)) return;
        if (got != null && got.unread == 0) { // vừa đọc ở thiết bị khác: bỏ thông báo cũ, không báo nữa
            dismiss(context, convId);
            return;
        }
        show(context, got != null ? got : quick, true);
    }

    /** Nội dung đầy đủ về muộn: chỉ cập nhật nếu thông báo vẫn đang hiện và chưa có tin mới hơn. */
    private static void lateUpdate(Context context, Conv c, long seq) {
        if (!isLatest(c.id, seq)) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (findActive(nm, c.tag, c.platformId) == null) return; // người dùng đã vuốt bỏ hoặc đã đọc
        if (c.unread == 0) {
            dismiss(context, c.id);
            return;
        }
        show(context, c, false);
    }

    /** Chrome muốn đóng thông báo (ví dụ đã đọc trong app): nếu đang là bong bóng thì giữ bong bóng. */
    static void onBrowserCancel(final Context context, final String tag, final int platformId) {
        final int convId = parseConversation(tag);
        if (convId > 0) nextSeq(convId);
        runInBackground(new Runnable() {
            @Override
            public void run() {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                StatusBarNotification active = findActive(nm, tag, platformId);
                if (convId > 0) ChatHeads.onRead(context, convId);
                if (convId > 0 && active != null && isBubble(active.getNotification())) {
                    Conv c = load(context, convId);
                    if (c != null) {
                        c.unread = 0;
                        save(context, c);
                        post(context, c, false, true);
                        return;
                    }
                }
                nm.cancel(tag, platformId);
            }
        });
    }

    /** Hiện lại thông báo Chrome gửi (đổi sang kênh của app), có thêm nút Trả lời nếu đã liên kết. */
    private static void repost(Context context, NotificationManager nm, String tag, int platformId, Notification n,
                               String channel, int convId, boolean withActions) {
        Notification out = n;
        if (Build.VERSION.SDK_INT >= 24) {
            Notification.Builder b = Notification.Builder.recoverBuilder(context, n);
            if (Build.VERSION.SDK_INT >= 26) b.setChannelId(channel);
            if (Build.VERSION.SDK_INT >= 26 && n.getGroupAlertBehavior() == Notification.GROUP_ALERT_SUMMARY) {
                b.setGroupAlertBehavior(Notification.GROUP_ALERT_ALL);
            }
            if (withActions && convId > 0) {
                b.addAction(replyAction(context, convId));
                b.addAction(readAction(context, convId));
            }
            out = b.build();
        }
        nm.notify(tag, platformId, out);
    }

    /* ======================= Dựng thông báo hội thoại ======================= */

    /** Hiện cuộc trò chuyện; alert = rung/chuông (tin mới), false = chỉ cập nhật nội dung. */
    static void show(Context context, Conv c, boolean alert) {
        while (c.messages.size() > MAX_MESSAGES) c.messages.remove(0);
        if (c.messages.isEmpty()) return;
        save(context, c);
        post(context, c, alert, false);
        // Android 8–10: bong bóng nổi (Android 11+ dùng bong bóng của hệ thống trong post)
        if (alert) ChatHeads.onMessage(context, c.id);
        else ChatHeads.onUpdate(context, c.id);
    }

    private static void post(Context context, Conv c, boolean alert, boolean suppress) {
        if (Build.VERSION.SDK_INT < 28 || c.tag == null) return;
        ensureChannels(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        synchronized (POST_LOCK) {
            try {
                nm.notify(c.tag, c.platformId, build(context, c, alert, suppress));
            } catch (RuntimeException e) {
                Log.e(TAG, "Không hiện được thông báo", e);
            }
        }
    }

    private static Notification build(Context context, Conv c, boolean alert, boolean suppress) {
        String meName = Prefs.meName(context);
        Person me = new Person.Builder()
            .setName(meName == null || meName.isEmpty() ? "Bạn" : meName)
            .setKey("me")
            .setIcon(Avatars.personIcon(context, Prefs.meAvatar(context), meName, Prefs.meId(context), false))
            .build();
        Notification.MessagingStyle style = new Notification.MessagingStyle(me);
        if (c.isGroup) {
            style.setConversationTitle(c.title);
            style.setGroupConversation(true);
        }
        Map<Long, Person> people = new HashMap<>();
        long lastTime = 0;
        for (Msg m : c.messages) {
            Person who = null;
            if (!m.mine) {
                who = people.get(m.senderId);
                if (who == null) {
                    who = new Person.Builder()
                        .setName(m.sender == null || m.sender.isEmpty() ? c.title : m.sender)
                        .setKey("u" + m.senderId)
                        .setIcon(Avatars.personIcon(context, m.avatar, m.sender, m.senderId, false))
                        .build();
                    people.put(m.senderId, who);
                }
            }
            style.addMessage(new Notification.MessagingStyle.Message(m.text, m.time, who));
            lastTime = Math.max(lastTime, m.time);
        }

        Notification.Builder b = new Notification.Builder(context, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_think)
            .setColor(Config.BRAND)
            .setStyle(style)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(openIntent(context, c.id))
            .setAutoCancel(true)
            .setShowWhen(true)
            .setWhen(lastTime > 0 ? lastTime : System.currentTimeMillis())
            .setOnlyAlertOnce(!alert)
            .addAction(replyAction(context, c.id))
            .addAction(readAction(context, c.id));
        if (c.unread > 0) b.setNumber(c.unread);
        PendingIntent chromeDelete;
        synchronized (CHROME_DELETE) { chromeDelete = CHROME_DELETE.get(c.id); }
        if (chromeDelete != null) b.setDeleteIntent(chromeDelete);

        if (Build.VERSION.SDK_INT >= 30) {
            String shortcutId = "conv-" + c.id;
            Icon convIcon = Avatars.conversationIcon(context, c.isGroup, c.avatar, c.title,
                c.isGroup ? c.id : c.peerId, false);
            publishShortcut(context, c, shortcutId, convIcon, new ArrayList<>(people.values()));
            b.setShortcutId(shortcutId);
            b.setLocusId(new LocusId(shortcutId));
            Notification.BubbleMetadata bubble = new Notification.BubbleMetadata.Builder(bubbleIntent(context, c.id), convIcon)
                .setDesiredHeight(600)
                .setAutoExpandBubble(false)
                .setSuppressNotification(suppress)
                .build();
            b.setBubbleMetadata(bubble);
        }
        return b.build();
    }

    private static void publishShortcut(Context context, Conv c, String id, Icon icon, List<Person> people) {
        try {
            ShortcutManager sm = context.getSystemService(ShortcutManager.class);
            if (sm == null) return;
            Intent open = new Intent(context, LauncherActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Config.conversationUrl(c.id));
            ShortcutInfo.Builder sb = new ShortcutInfo.Builder(context, id)
                .setShortLabel(c.title.isEmpty() ? "Think" : c.title)
                .setLongLabel(c.title.isEmpty() ? "Think" : c.title)
                .setIcon(icon)
                .setIntent(open)
                .setLongLived(true)
                .setLocusId(new LocusId(id))
                .setCategories(Collections.singleton("android.shortcut.conversation"));
            if (!people.isEmpty()) sb.setPersons(people.toArray(new Person[0]));
            sm.pushDynamicShortcut(sb.build());
        } catch (RuntimeException e) {
            Log.w(TAG, "Không tạo được lối tắt cuộc trò chuyện", e);
        }
    }

    /* ======================= Các nút trong thông báo ======================= */

    static PendingIntent openIntent(Context context, int convId) {
        Intent intent = new Intent(context, LauncherActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Config.conversationUrl(convId))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, convId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent bubbleIntent(Context context, int convId) {
        Intent intent = new Intent(context, BubbleActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("thinkchat://bubble/" + convId));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE; // hệ thống yêu cầu với bong bóng
        return PendingIntent.getActivity(context, convId, intent, flags);
    }

    private static Notification.Action replyAction(Context context, int convId) {
        RemoteInput input = new RemoteInput.Builder(KEY_REPLY).setLabel("Trả lời…").build();
        Intent intent = new Intent(context, ReplyReceiver.class)
            .setAction(ACTION_REPLY)
            .setData(Uri.parse("thinkchat://reply/" + convId))
            .putExtra(EXTRA_CONV, convId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE; // ô nhập chữ cần intent sửa được
        PendingIntent pi = PendingIntent.getBroadcast(context, convId, intent, flags);
        Notification.Action.Builder b = new Notification.Action.Builder(
            Icon.createWithResource(context, R.drawable.ic_reply), "Trả lời", pi)
            .addRemoteInput(input)
            .setAllowGeneratedReplies(true);
        if (Build.VERSION.SDK_INT >= 28) b.setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY);
        return b.build();
    }

    private static Notification.Action readAction(Context context, int convId) {
        Intent intent = new Intent(context, ReplyReceiver.class)
            .setAction(ACTION_READ)
            .setData(Uri.parse("thinkchat://read/" + convId))
            .putExtra(EXTRA_CONV, convId);
        PendingIntent pi = PendingIntent.getBroadcast(context, convId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Action.Builder b = new Notification.Action.Builder(
            Icon.createWithResource(context, R.drawable.ic_done), "Đã đọc", pi);
        if (Build.VERSION.SDK_INT >= 28) {
            b.setSemanticAction(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ);
        }
        return b.build();
    }

    /* ======================= Sau khi trả lời / đánh dấu đã đọc ======================= */

    /** Đã gửi (hoặc gửi lỗi) câu trả lời từ thông báo: cập nhật thông báo để tắt vòng xoay. */
    static void afterReply(final Context context, final int convId, final String text, final String error) {
        nextSeq(convId); // bỏ các kết quả cũ còn đang về
        runInBackgroundAndWait(new Runnable() {
            @Override
            public void run() {
                afterReplyNow(context, convId, text, error);
            }
        }, 1500);
    }

    private static void afterReplyNow(Context context, int convId, String text, String error) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        Conv c = load(context, convId);
        if (Build.VERSION.SDK_INT >= 28 && c != null && c.tag != null) {
            Msg m = new Msg();
            m.mine = true;
            m.senderId = Prefs.meId(context);
            m.sender = Prefs.meName(context);
            m.text = error == null ? text : "⚠️ Chưa gửi được: " + text + " (" + error + ")";
            m.time = System.currentTimeMillis();
            c.messages.add(m);
            if (error == null) c.unread = 0;
            while (c.messages.size() > MAX_MESSAGES) c.messages.remove(0);
            save(context, c);
            post(context, c, false, false);
            return;
        }
        // Android 7–8: thêm câu trả lời vào dưới thông báo đang hiện
        StatusBarNotification active = findConversation(nm, convId);
        if (active != null && Build.VERSION.SDK_INT >= 24) {
            Notification.Builder b = Notification.Builder.recoverBuilder(context, active.getNotification());
            b.setRemoteInputHistory(new CharSequence[] { error == null ? text : "⚠️ Chưa gửi được: " + text });
            b.setOnlyAlertOnce(true);
            nm.notify(active.getTag(), active.getId(), b.build());
        }
    }

    /** Đã đọc: bỏ thông báo khỏi thanh thông báo (bong bóng, nếu có, vẫn giữ). */
    static void dismiss(final Context context, final int convId) {
        nextSeq(convId);
        runInBackgroundAndWait(new Runnable() {
            @Override
            public void run() {
                dismissNow(context, convId);
            }
        }, 1500);
    }

    private static void dismissNow(Context context, int convId) {
        ChatHeads.onRead(context, convId);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        StatusBarNotification active = findConversation(nm, convId);
        PendingIntent chromeDelete;
        synchronized (CHROME_DELETE) { chromeDelete = CHROME_DELETE.remove(convId); }
        if (chromeDelete == null && active != null) chromeDelete = active.getNotification().deleteIntent;
        if (active == null) return;
        if (isBubble(active.getNotification())) {
            Conv c = load(context, convId);
            if (c != null) {
                c.unread = 0;
                save(context, c);
                post(context, c, false, true);
                return;
            }
        }
        nm.cancel(active.getTag(), active.getId());
        // Báo cho Chrome là thông báo đã đóng, để lần sau web không gộp tin cũ vào
        if (chromeDelete != null) {
            try {
                chromeDelete.send();
            } catch (PendingIntent.CanceledException ignored) {
                // Chrome đã tự dọn
            }
        }
    }

    /** Người dùng đang mở bong bóng: ẩn dòng thông báo trong thanh thông báo, giữ bong bóng. */
    static void onBubbleShown(Context context, int convId) {
        if (Build.VERSION.SDK_INT < 30) return;
        nextSeq(convId);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        StatusBarNotification active = findConversation(nm, convId);
        Conv c = load(context, convId);
        if (active == null || c == null) return;
        Notification.BubbleMetadata meta = active.getNotification().getBubbleMetadata();
        if (meta != null && meta.isNotificationSuppressed()) return;
        c.unread = 0;
        save(context, c);
        post(context, c, false, true);
    }

    static boolean isBubble(Notification n) {
        return Build.VERSION.SDK_INT >= 29 && (n.flags & Notification.FLAG_BUBBLE) != 0;
    }

    private static StatusBarNotification findActive(NotificationManager nm, String tag, int id) {
        if (tag == null) return null;
        try {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                if (sbn.getId() == id && tag.equals(sbn.getTag())) return sbn;
            }
        } catch (RuntimeException ignored) {
            // bỏ qua
        }
        return null;
    }

    static StatusBarNotification findConversation(NotificationManager nm, int convId) {
        try {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                if (parseConversation(sbn.getTag()) == convId) return sbn;
            }
        } catch (RuntimeException ignored) {
            // bỏ qua
        }
        return null;
    }
}
