package com.nuwngc.think;

import android.content.Context;
import android.content.SharedPreferences;

/** Dữ liệu nhỏ app tự giữ: phiên đăng nhập của bong bóng chat, trình duyệt đang dùng, cài đặt. */
final class Prefs {
    private static final String FILE = "think";
    private static final String KEY_TOKEN = "session_token";
    private static final String KEY_REVOKED = "revoked_token";
    private static final String KEY_ME_ID = "me_id";
    private static final String KEY_ME_NAME = "me_name";
    private static final String KEY_ME_AVATAR = "me_avatar";
    private static final String KEY_PROVIDER = "provider";
    private static final String KEY_ASKED_NOTIFY = "asked_notify";
    private static final String KEY_UPDATE_CHECK = "update_check";
    private static final String KEY_UPDATE_SEEN = "update_seen";
    private static final String KEY_HEADS = "chat_heads";

    private Prefs() {}

    static SharedPreferences get(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /* ---- Phiên đăng nhập riêng của app (bong bóng chat, Trả lời nhanh) ---- */
    static String token(Context context) {
        String t = get(context).getString(KEY_TOKEN, null);
        return t == null || t.isEmpty() ? null : t;
    }

    static boolean linked(Context context) {
        return token(context) != null;
    }

    static void saveSession(Context context, String token, long meId, String meName, String meAvatar) {
        get(context).edit()
            .putString(KEY_TOKEN, token)
            .putLong(KEY_ME_ID, meId)
            .putString(KEY_ME_NAME, meName)
            .putString(KEY_ME_AVATAR, meAvatar)
            .apply();
    }

    static void saveToken(Context context, String token) {
        get(context).edit().putString(KEY_TOKEN, token).apply();
    }

    static void saveMe(Context context, long id, String name, String avatar) {
        get(context).edit().putLong(KEY_ME_ID, id).putString(KEY_ME_NAME, name).putString(KEY_ME_AVATAR, avatar).apply();
    }

    static void clearSession(Context context) {
        get(context).edit().remove(KEY_TOKEN).apply();
    }

    /** Máy chủ báo phiên hết hạn: bỏ phiên và nhớ lại để không lấy lại nó từ cookie cũ của WebView. */
    static void revokeSession(Context context, String token) {
        get(context).edit().remove(KEY_TOKEN).putString(KEY_REVOKED, token).apply();
    }

    static boolean isRevoked(Context context, String token) {
        return token != null && token.equals(get(context).getString(KEY_REVOKED, null));
    }

    static long meId(Context context) {
        return get(context).getLong(KEY_ME_ID, 0);
    }

    static String meName(Context context) {
        return get(context).getString(KEY_ME_NAME, null);
    }

    static String meAvatar(Context context) {
        return get(context).getString(KEY_ME_AVATAR, null);
    }

    /* ---- Bong bóng nổi (Android 8–10) ---- */
    static boolean headsOn(Context context) {
        return get(context).getBoolean(KEY_HEADS, true);
    }

    static void setHeadsOn(Context context, boolean on) {
        get(context).edit().putBoolean(KEY_HEADS, on).apply();
    }

    /* ---- Trình duyệt đã mở app lần gần nhất (Chrome) ---- */
    static String provider(Context context) {
        return get(context).getString(KEY_PROVIDER, null);
    }

    static void setProvider(Context context, String pkg) {
        get(context).edit().putString(KEY_PROVIDER, pkg).apply();
    }

    /* ---- Đã hỏi quyền thông báo chưa (Android 13+) ---- */
    static boolean askedNotify(Context context) {
        return get(context).getBoolean(KEY_ASKED_NOTIFY, false);
    }

    static void setAskedNotify(Context context) {
        get(context).edit().putBoolean(KEY_ASKED_NOTIFY, true).apply();
    }

    /* ---- Kiểm tra bản app mới ---- */
    static long lastUpdateCheck(Context context) {
        return get(context).getLong(KEY_UPDATE_CHECK, 0);
    }

    static void setLastUpdateCheck(Context context, long when) {
        get(context).edit().putLong(KEY_UPDATE_CHECK, when).apply();
    }

    static int updateSeen(Context context) {
        return get(context).getInt(KEY_UPDATE_SEEN, 0);
    }

    static void setUpdateSeen(Context context, int versionCode) {
        get(context).edit().putInt(KEY_UPDATE_SEEN, versionCode).apply();
    }

    /* ---- Nội dung thông báo gần nhất của từng cuộc trò chuyện ---- */
    static String conversation(Context context, int convId) {
        return get(context).getString("conv_" + convId, null);
    }

    static void saveConversation(Context context, int convId, String json) {
        get(context).edit().putString("conv_" + convId, json).apply();
    }
}
