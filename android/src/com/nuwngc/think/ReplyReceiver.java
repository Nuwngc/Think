package com.nuwngc.think;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import org.json.JSONObject;

/** Bấm "Trả lời" (gõ ngay trong thông báo) hoặc "Đã đọc". */
public class ReplyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        final int convId = intent.getIntExtra(Notifier.EXTRA_CONV, 0);
        final String action = intent.getAction();
        if (convId <= 0 || action == null) return;

        if (Notifier.ACTION_REPLY.equals(action)) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence input = results == null ? null : results.getCharSequence(Notifier.KEY_REPLY);
            final String text = input == null ? "" : input.toString().trim();
            final PendingResult pending = goAsync();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (text.isEmpty()) {
                            Notifier.afterReply(app, convId, "", "tin nhắn trống");
                            return;
                        }
                        JSONObject body = new JSONObject()
                            .put("text", text)
                            .put("clientId", "n" + System.currentTimeMillis());
                        Http.post(app, "/api/conversations/" + convId + "/messages", body, Http.QUICK_CONNECT, Http.QUICK_READ);
                        Notifier.afterReply(app, convId, text, null);
                    } catch (Http.HttpError e) {
                        Notifier.afterReply(app, convId, text, e.status == 401
                            ? "cần bật lại bong bóng chat trong app"
                            : e.getMessage());
                    } catch (Exception e) {
                        Notifier.afterReply(app, convId, text, "lỗi không rõ");
                    } finally {
                        pending.finish();
                    }
                }
            }, "think-reply").start();
            return;
        }

        if (Notifier.ACTION_READ.equals(action)) {
            final PendingResult pending = goAsync();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Notifier.dismiss(app, convId);
                        Http.post(app, "/api/conversations/" + convId + "/read", new JSONObject(), Http.QUICK_CONNECT, Http.QUICK_READ);
                    } catch (Exception ignored) {
                        // mở app lần sau sẽ tự đánh dấu đã đọc
                    } finally {
                        pending.finish();
                    }
                }
            }, "think-read").start();
        }
    }
}
