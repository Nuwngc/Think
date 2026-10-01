package expo.modules.thinknative

import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import java.lang.ref.WeakReference
import kotlin.math.max

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
    keepAboveKeyboard()
  }

  /**
   * Bàn phím mở: đẩy khung chat lên trên bàn phím. Cửa sổ trong suốt có máy tự co lại, có máy không
   * (nhất là khi app vẽ tràn viền), nên tự đo phần bị bàn phím che rồi chừa đúng chừng đó ở dưới.
   */
  private fun keepAboveKeyboard() {
    val content = findViewById<View>(android.R.id.content) ?: return
    val visible = Rect()
    val loc = IntArray(2)
    val update = Runnable {
      content.getWindowVisibleDisplayFrame(visible)
      val rootH = content.rootView.height
      val covered = rootH - visible.bottom // bàn phím + thanh điều hướng
      var pad = 0
      if (rootH > 0 && covered > rootH * 0.15f) {
        content.getLocationOnScreen(loc)
        pad = max(0, loc[1] + content.height - visible.bottom)
      }
      if (content.paddingBottom != pad) content.setPadding(0, 0, 0, pad)
    }
    content.viewTreeObserver.addOnGlobalLayoutListener { update.run() }
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      v.post(update)
      ViewCompat.onApplyWindowInsets(v, insets)
    }
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
