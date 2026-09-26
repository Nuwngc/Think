package com.nuwngc.think;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.net.Uri;

/** Địa chỉ web và các hằng số dùng chung. Đổi tên miền thì sửa HOST rồi build lại app. */
final class Config {
    static final String HOST = "thinkchat.id.vn";
    static final String ORIGIN = "https://" + HOST;

    static final int BRAND = 0xFF0E7C66;
    static final int SURFACE_LIGHT = 0xFFFFFFFF;
    static final int SURFACE_DARK = 0xFF16211D;

    /** Chrome các bản: ưu tiên dùng vì chắc chắn hỗ trợ thông báo qua app. */
    static final String[] CHROME_PACKAGES = {
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary",
        "com.google.android.apps.chrome",
    };

    private Config() {}

    static int versionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    static String versionName(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    static boolean isOurUrl(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost());
    }

    /** Link mở web trong app: thêm ?app=android&v=... để web biết đang chạy trong app Think. */
    static Uri appUrl(Context context, Uri target) {
        Uri base = isOurUrl(target) ? target : Uri.parse(ORIGIN + "/");
        Uri.Builder b = base.buildUpon().clearQuery();
        for (String name : base.getQueryParameterNames()) {
            if ("app".equals(name) || "v".equals(name)) continue;
            for (String value : base.getQueryParameters(name)) b.appendQueryParameter(name, value);
        }
        b.appendQueryParameter("app", "android");
        b.appendQueryParameter("v", String.valueOf(versionCode(context)));
        return b.build();
    }

    static Uri conversationUrl(int convId) {
        return Uri.parse(ORIGIN + "/#/c/" + convId);
    }
}
