package com.nuwngc.think;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;

/**
 * Chrome mở màn hình trong suốt này khi web xin quyền thông báo (Android 13+).
 * Hỏi quyền xong thì gửi kết quả về cho Chrome qua Messenger rồi đóng.
 */
public class PermissionActivity extends Activity {
    private static final String PERMISSION = "android.permission.POST_NOTIFICATIONS";
    private static final String EXTRA_MESSENGER = "messenger";
    private static final String KEY_PERMISSION_STATUS = "permissionStatus";
    private Messenger messenger;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        messenger = getIntent().getParcelableExtra(EXTRA_MESSENGER);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(PERMISSION) != PackageManager.PERMISSION_GRANTED) {
            Notifier.ensureChannels(this);
            requestPermissions(new String[] { PERMISSION }, 1);
            return;
        }
        reply(Notifier.enabled(this));
        finish();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        boolean granted = false;
        for (int i = 0; i < permissions.length; i++) {
            if (PERMISSION.equals(permissions[i])) {
                Prefs.setAskedNotify(this);
                granted = grantResults.length > i && grantResults[i] == PackageManager.PERMISSION_GRANTED;
            }
        }
        reply(granted || Notifier.enabled(this));
        finish();
    }

    private void reply(boolean enabled) {
        if (messenger == null) return;
        Bundle data = new Bundle();
        data.putInt(KEY_PERMISSION_STATUS, enabled ? DelegationService.PERMISSION_ALLOW : DelegationService.PERMISSION_BLOCK);
        Message msg = Message.obtain();
        msg.setData(data);
        try {
            messenger.send(msg);
        } catch (RemoteException ignored) {
            // Chrome đã đóng
        }
    }
}
