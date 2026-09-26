package com.nuwngc.think;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Gọi API của máy chủ Think bằng phiên đăng nhập riêng của app. Chỉ gọi ở luồng nền. */
final class Http {
    static final int CONNECT_TIMEOUT = 8000;
    static final int READ_TIMEOUT = 12000;
    // Nút trong thông báo chỉ được chạy khoảng 10 giây, nên chờ ngắn hơn
    static final int QUICK_CONNECT = 4000;
    static final int QUICK_READ = 4500;

    /** Lỗi từ máy chủ, kèm mã HTTP (0 = không kết nối được). */
    static final class HttpError extends IOException {
        final int status;

        HttpError(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private Http() {}

    static JSONObject get(Context context, String path) throws IOException {
        return request(context, "GET", path, null, true, null, CONNECT_TIMEOUT, READ_TIMEOUT);
    }

    static JSONObject post(Context context, String path, JSONObject body, int connectMs, int readMs) throws IOException {
        return request(context, "POST", path, body, true, null, connectMs, readMs);
    }

    static JSONObject postNoAuth(Context context, String path, JSONObject body) throws IOException {
        return request(context, "POST", path, body, false, null, CONNECT_TIMEOUT, READ_TIMEOUT);
    }

    /** Gọi bằng một phiên cụ thể (ví dụ để đăng xuất phiên vừa tạo mà người dùng không muốn dùng). */
    static JSONObject postWithToken(Context context, String path, String token) throws IOException {
        return request(context, "POST", path, new JSONObject(), false, token, QUICK_CONNECT, QUICK_READ);
    }

    private static JSONObject request(Context context, String method, String path, JSONObject body, boolean auth,
                                      String explicitToken, int connectMs, int readMs) throws IOException {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(Config.ORIGIN + path).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(connectMs);
            conn.setReadTimeout(readMs);
            conn.setUseCaches(false);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "ThinkApp/" + Config.versionName(context) + " (Android)");
            String token = explicitToken;
            if (auth) {
                token = Prefs.token(context);
                if (token == null) throw new HttpError(401, "Chưa liên kết bong bóng chat.");
            }
            if (token != null) conn.setRequestProperty("Cookie", "sid=" + token);
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setFixedLengthStreamingMode(bytes.length);
                OutputStream out = conn.getOutputStream();
                try {
                    out.write(bytes);
                } finally {
                    out.close();
                }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = in == null ? "" : readAll(in);
            JSONObject json;
            try {
                json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (Exception e) {
                json = new JSONObject();
            }
            if (status >= 400) {
                if (status == 401 && auth) Prefs.revokeSession(context, token); // phiên đã hết hoặc bị đăng xuất
                throw new HttpError(status, json.optString("error", "Máy chủ báo lỗi " + status));
            }
            return json;
        } catch (HttpError e) {
            throw e;
        } catch (IOException e) {
            throw new HttpError(0, "Không kết nối được máy chủ.");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static byte[] download(String url, int maxBytes) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(READ_TIMEOUT);
            if (conn.getResponseCode() != 200) throw new IOException("HTTP " + conn.getResponseCode());
            InputStream in = conn.getInputStream();
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > maxBytes) throw new IOException("Tệp quá lớn");
                }
                return out.toByteArray();
            } finally {
                in.close();
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }
}
