package com.nuwngc.think;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Dự phòng khi máy không có trình duyệt nào: mở web Think bằng WebView của app.
 * Chạy được chat bình thường nhưng không nhận thông báo đẩy (cần Chrome).
 */
public class WebAppActivity extends Activity {
    private WebShell shell;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        shell = WebShell.tryCreate(this);
        if (shell == null) return;
        setContentView(shell.web);
        if (savedInstanceState != null) {
            shell.web.restoreState(savedInstanceState);
        } else {
            Uri data = getIntent().getData();
            shell.load(Config.isOurUrl(data) ? data.toString() : Config.ORIGIN + "/");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (shell == null) return;
        Uri data = intent.getData();
        if (Config.isOurUrl(data)) shell.load(data.toString());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (shell == null) return;
        shell.onResume();
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
