package expo.modules.thinknative

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

/**
 * Bong bóng chat (giống Messenger): trạng thái chung giữa JavaScript, dịch vụ vẽ bong bóng
 * (ChatHeadService) và khung chat nổi (BubbleActivity).
 */
object ChatHeads {
  private const val TAG = "ThinkHeads"
  private const val PREFS = "think_chat_heads"
  private const val KEY_ON = "on"

  const val ACTION_START = "expo.modules.thinknative.heads.START"
  const val ACTION_DISABLE = "expo.modules.thinknative.heads.DISABLE"
  const val EXTRA_CONV = "convId"

  private val main = Handler(Looper.getMainLooper())

  /** Một màn hình bình thường của app đang mở (không tính khung chat nổi) */
  @Volatile var mainVisible = false
    private set

  /** Khung chat nổi đang hiện trên màn hình */
  @Volatile var bubbleVisible = false
    private set

  /** Cuộc trò chuyện khung chat nổi cần mở */
  @Volatile var bubbleConv = 0

  @Volatile var bubble: WeakReference<Activity>? = null

  /** Gửi sự kiện cho JavaScript (ThinkNativeModule gắn vào khi chạy) */
  @Volatile var emitter: ((String, Int) -> Unit)? = null

  /** Bong bóng đang chờ hiện khi dịch vụ vừa khởi động */
  @Volatile var pendingShow: Bundle? = null

  fun supported() = Build.VERSION.SDK_INT >= 26

  fun canDraw(context: Context) = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context)

  fun isOn(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ON, false)

  fun setOn(context: Context, on: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ON, on).apply()
  }

  fun emit(type: String, convId: Int = 0) {
    main.post {
      try {
        emitter?.invoke(type, convId)
      } catch (e: Exception) {
        Log.w(TAG, "emit $type: ${e.message}")
      }
    }
  }

  /** Bật dịch vụ bong bóng (gọi khi app đang mở). Trả về false nếu chưa có quyền hoặc máy không cho. */
  fun start(context: Context): Boolean {
    if (!supported() || !canDraw(context)) return false
    if (ChatHeadService.instance != null) return true
    return try {
      val intent = Intent(context, ChatHeadService::class.java).setAction(ACTION_START)
      ContextCompat.startForegroundService(context, intent)
      true
    } catch (e: Exception) {
      // Android không cho bật dịch vụ lúc app chạy nền: lần mở app sau sẽ bật lại
      Log.w(TAG, "start: ${e.message}")
      false
    }
  }

  fun stop(context: Context) {
    main.post { ChatHeadService.instance?.stopEverything() }
    try {
      context.stopService(Intent(context, ChatHeadService::class.java))
    } catch (_: Exception) {
      // đã dừng
    }
  }

  /** Hiện (hoặc cập nhật) bong bóng cho một tin nhắn mới */
  fun show(context: Context, info: Bundle) {
    main.post {
      val svc = ChatHeadService.instance
      if (svc != null) {
        svc.show(info)
      } else if (isOn(context)) {
        pendingShow = info
        start(context)
      }
    }
  }

  fun hide() {
    main.post { ChatHeadService.instance?.hideHead() }
  }

  /** Mở khung chat nổi của một cuộc trò chuyện */
  fun openBubble(context: Context, convId: Int) {
    bubbleConv = convId
    val intent = Intent(context, BubbleActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      .putExtra(EXTRA_CONV, convId)
    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      // Máy không cho mở khung nổi: mở hẳn app vào cuộc trò chuyện
      Log.w(TAG, "openBubble: ${e.message}")
      openApp(context, convId)
    }
  }

  /** Thu nhỏ khung chat nổi (vẫn giữ để mở lại nhanh) */
  fun minimizeBubble() {
    main.post {
      val a = bubble?.get() ?: return@post
      if (!a.isFinishing) a.moveTaskToBack(true)
    }
  }

  /** Mở app Think (màn hình chính), nếu có thì vào thẳng cuộc trò chuyện */
  fun openApp(context: Context, convId: Int = 0) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    if (convId > 0) launch.putExtra(EXTRA_CONV, convId)
    try {
      context.startActivity(launch)
    } catch (e: Exception) {
      Log.w(TAG, "openApp: ${e.message}")
    }
  }

  /** Mở trang cài đặt "Hiển thị trên ứng dụng khác" của app */
  fun openOverlaySettings(context: Context) {
    val pkg = Uri.parse("package:${context.packageName}")
    val tries = listOf(
      Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg),
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg),
    )
    for (intent in tries) {
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return
      } catch (_: Exception) {
        // máy (vd HarmonyOS cũ) không có trang này: thử trang tiếp theo
      }
    }
  }

  /** Theo dõi màn hình nào của app đang mở: app đang mở thì ẩn bong bóng (như Messenger) */
  fun watch(application: Application) {
    application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityResumed(activity: Activity) {
        if (activity is BubbleActivity) {
          bubbleVisible = true
          ChatHeadService.instance?.expand()
          emit("bubble-shown", bubbleConv)
        } else {
          mainVisible = true
          ChatHeadService.instance?.onAppVisible()
        }
      }

      override fun onActivityPaused(activity: Activity) {
        if (activity is BubbleActivity) {
          bubbleVisible = false
          ChatHeadService.instance?.collapse()
          emit("bubble-hidden", bubbleConv)
        } else {
          mainVisible = false
        }
      }

      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
      override fun onActivityStarted(activity: Activity) {}
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
  }
}
