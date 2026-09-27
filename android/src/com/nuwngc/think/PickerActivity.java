package com.nuwngc.think;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.widget.Toast;

/**
 * Màn hình trong suốt để chọn ảnh gửi từ bong bóng nổi (Android 8–10): bong bóng không phải Activity
 * nên không tự mở được màn hình chọn ảnh. Ảnh chọn xong được chép vào bộ nhớ riêng của app
 * ({@link PickedFileProvider}) để khung chat vẫn đọc được sau khi màn hình này đóng.
 */
public class PickerActivity extends Activity {
    private static final String EXTRA_PICK = "pick";
    private static ValueCallback<Uri[]> sPending;
    private static boolean sOpened;

    static void start(final Context context, Intent pickIntent, ValueCallback<Uri[]> callback) {
        if (sPending != null) sPending.onReceiveValue(null);
        sPending = callback;
        sOpened = false;
        Intent intent = new Intent(context, PickerActivity.class)
            .putExtra(EXTRA_PICK, pickIntent)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        try {
            context.startActivity(intent);
        } catch (RuntimeException e) {
            deliverStatic(null);
            return;
        }
        // Một số máy (Xiaomi) âm thầm chặn app mở màn hình khi đang chạy nền: báo cho người dùng
        final ValueCallback<Uri[]> mine = callback;
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                if (sOpened || sPending != mine) return;
                deliverStatic(null);
                Toast.makeText(context, "Máy chặn mở màn hình chọn ảnh. Máy Xiaomi: vào Cài đặt → Ứng dụng → Think → "
                    + "Quyền khác → bật \"Hiển thị cửa sổ bật lên khi chạy nền\".", Toast.LENGTH_LONG).show();
                ChatHeads.expandAgain(context);
            }
        }, 2500);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sOpened = true;
        if (savedInstanceState != null) return; // xoay màn hình: đang chờ kết quả, không mở lại
        Intent pick = getIntent().getParcelableExtra(EXTRA_PICK);
        if (pick == null) {
            deliver(null);
            return;
        }
        try {
            startActivityForResult(pick, 1);
        } catch (ActivityNotFoundException e) {
            deliver(null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        final Uri[] picked = WebShell.parseResult(resultCode, data);
        if (picked == null) {
            deliver(null);
            return;
        }
        final Context app = getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                final Uri[] copied = PickedFileProvider.copyAll(app, picked);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        deliver(copied);
                    }
                });
            }
        }, "think-pick").start();
    }

    private void deliver(Uri[] uris) {
        deliverStatic(uris);
        finish();
        overridePendingTransition(0, 0);
        ChatHeads.expandAgain(this);
    }

    private static void deliverStatic(Uri[] uris) {
        ValueCallback<Uri[]> cb = sPending;
        sPending = null;
        if (cb != null) cb.onReceiveValue(uris);
    }
}
