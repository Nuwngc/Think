package expo.modules.thinknative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Dịch vụ chạy nền trong lúc gọi (2.10.0): Android chỉ cho app dùng micro khi đang ở nền nếu có
 * thông báo "Đang trong cuộc gọi" (dịch vụ loại microphone). Nhờ vậy chuyển sang app khác vẫn nói chuyện được.
 * Nút "Kết thúc" trong thông báo báo cho JavaScript (sự kiện onCallAction) để gác máy.
 */
class CallService : Service() {
  companion object {
    private const val CHANNEL = "think_call_ongoing"
    private const val NOTIFICATION_ID = 4711
    const val ACTION_HANGUP = "expo.modules.thinknative.CALL_HANGUP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_VIDEO = "video"

    /** Gắn bởi ThinkNativeModule: gửi sự kiện sang JavaScript */
    var onAction: ((String) -> Unit)? = null

    fun start(context: Context, title: String, video: Boolean) {
      try {
        val intent = Intent(context, CallService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_VIDEO, video)
        ContextCompat.startForegroundService(context, intent)
      } catch (_: Throwable) {
        // Không chạy được dịch vụ (máy chặn): cuộc gọi vẫn tiếp tục khi app đang mở
      }
    }

    fun stop(context: Context) {
      try {
        context.stopService(Intent(context, CallService::class.java))
      } catch (_: Throwable) {
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_HANGUP) {
      onAction?.invoke("hangup")
      stopSelf()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Think"
    val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
    try {
      goForeground(title, video)
    } catch (_: Throwable) {
      // Thiếu quyền micro lúc bắt đầu (Android 14 bắt buộc): bỏ qua, không làm app tắt
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Vuốt tắt app trong lúc gọi: kết thúc cuộc gọi
    onAction?.invoke("hangup")
    stopSelf()
  }

  private fun goForeground(title: String, video: Boolean) {
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      val ch = NotificationChannel(CHANNEL, "Đang trong cuộc gọi", NotificationManager.IMPORTANCE_LOW)
      ch.description = "Hiện trong lúc gọi để vẫn nói chuyện được khi chuyển sang app khác"
      ch.setShowBadge(false)
      ch.setSound(null, null)
      nm.createNotificationChannel(ch)
    }
    val immutable = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      PendingIntent.getActivity(this, 11, it, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
    }
    val hangup = PendingIntent.getService(
      this, 12,
      Intent(this, CallService::class.java).setAction(ACTION_HANGUP),
      PendingIntent.FLAG_UPDATE_CURRENT or immutable,
    )
    val n = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(smallIcon())
      .setColor(Color.parseColor("#0E7C66"))
      .setContentTitle(title)
      .setContentText(if (video) "Đang gọi video · chạm để quay lại" else "Đang gọi thoại · chạm để quay lại")
      .setContentIntent(open)
      .addAction(0, "Kết thúc", hangup)
      .setOngoing(true)
      .setUsesChronometer(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .build()
    val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type)
  }

  private fun smallIcon(): Int {
    val id = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (id != 0) id else applicationInfo.icon
  }
}
