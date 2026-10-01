package expo.modules.thinknative

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import java.lang.ref.WeakReference

/**
 * Khung chat nổi khi chạm bong bóng: cửa sổ trong suốt nằm trên app đang dùng, hiện màn hình
 * "ThinkBubble" (native/src/bubble/BubbleApp.tsx). Dùng chung JavaScript với app chính nên
 * tin nhắn, kết nối, bản nháp... là một.
 */
class BubbleActivity : ReactActivity() {
  override fun getMainComponentName(): String = "ThinkBubble"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      override fun getLaunchOptions(): Bundle = Bundle().apply { putInt("convId", ChatHeads.bubbleConv) }
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    val id = intent?.getIntExtra(ChatHeads.EXTRA_CONV, 0) ?: 0
    if (id > 0) ChatHeads.bubbleConv = id
    ChatHeads.bubble = WeakReference(this)
    super.onCreate(null)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val id = intent.getIntExtra(ChatHeads.EXTRA_CONV, 0)
    if (id > 0) {
      ChatHeads.bubbleConv = id
      ChatHeads.emit("open", id)
    }
  }

  /** Nút Quay lại khi JavaScript không xử lý: thu nhỏ khung chat (giữ lại để mở lại nhanh) */
  override fun invokeDefaultOnBackPressed() {
    if (!moveTaskToBack(true)) finish()
  }

  override fun onDestroy() {
    if (ChatHeads.bubble?.get() === this) ChatHeads.bubble = null
    super.onDestroy()
  }
}
