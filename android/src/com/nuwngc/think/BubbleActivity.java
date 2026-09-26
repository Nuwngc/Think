package com.nuwngc.think;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** Khung chat nhỏ trong bong bóng: mở đúng cuộc trò chuyện, gõ trả lời ngay, không cần mở app. */
public class BubbleActivity extends Activity {
    private WebShell shell;
    private int convId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        convId = conversationOf(getIntent());
        shell = WebShell.tryCreate(this);
        if (shell == null) return;
        setContentView(shell.web);
        if (savedInstanceState != null) shell.web.restoreState(savedInstanceState);
        else shell.load(Config.ORIGIN + "/?bubble=1#/c/" + convId);
    }

    static int conversationOf(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null) return 0;
        try {
            return Integer.parseInt(data.getLastPathSegment());
        } catch (Exception e) {
            return 0;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (shell == null) return;
        int next = conversationOf(intent);
        if (next != 0 && next != convId) {
            convId = next;
            shell.load(Config.ORIGIN + "/?bubble=1#/c/" + convId);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (shell == null) return;
        shell.onResume();
        if (convId != 0) {
            final int id = convId;
            final android.content.Context app = getApplicationContext();
            Notifier.runInBackground(new Runnable() {
                @Override
                public void run() {
                    Notifier.onBubbleShown(app, id);
                }
            });
        }
    }

    @Override
    protected void onPause() {
        if (shell != null) shell.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (shell != null) shell.web.saveState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (shell == null || !shell.onActivityResult(requestCode, resultCode, data)) {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (shell == null || !shell.back()) super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (shell != null) shell.destroy();
        super.onDestroy();
    }
}
