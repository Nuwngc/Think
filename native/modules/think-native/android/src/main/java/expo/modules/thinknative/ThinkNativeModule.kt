package expo.modules.thinknative

import android.content.Context
import android.os.Build
import android.os.Bundle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Các hàm Android riêng của app Think, gọi từ JavaScript qua native/src/native.ts */
class ThinkNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ThinkNative")

    // Bong bóng chat báo cho JavaScript: mở cuộc trò chuyện khác, bị tắt từ thông báo, bị kéo vào ✕...
    Events("onChatHead")

    OnCreate {
      ChatHeads.emitter = { type, convId ->
        sendEvent("onChatHead", Bundle().apply {
          putString("type", type)
          putInt("convId", convId)
        })
      }
    }

    OnDestroy {
      ChatHeads.emitter = null
    }

    // Báo lỗi đang chờ gửi (crash lần trước), lấy xong là xóa
    Function("takeReports") {
      CrashCatcher.take(context)
    }

    // Lỗi JavaScript làm app tắt: ghi ngay (đồng bộ) trước khi app tắt, lần mở sau gửi
    Function("saveReport") { json: String ->
      CrashCatcher.save(context, json) != null
    }

    Function("deviceInfo") {
      mapOf(
        "device" to CrashCatcher.deviceName(),
        "osVersion" to CrashCatcher.osVersion(),
        "appVersion" to CrashCatcher.versionName(context),
        "sdk" to Build.VERSION.SDK_INT,
        "manufacturer" to Build.MANUFACTURER.orEmpty(),
      )
    }

    /* ---------------- Bong bóng chat ---------------- */

    Function("bubblesState") {
      mapOf(
        "supported" to ChatHeads.supported(),
        "on" to ChatHeads.isOn(context),
        "canDraw" to ChatHeads.canDraw(context),
        "running" to (ChatHeadService.instance != null),
      )
    }

    // Bật / tắt bong bóng. Bật: lưu lại và chạy dịch vụ (cần quyền "Hiển thị trên ứng dụng khác")
    Function("setBubbles") { on: Boolean ->
      ChatHeads.setOn(context, on)
      if (on) ChatHeads.start(context) else {
        ChatHeads.stop(context)
        false
      }
    }

    Function("openOverlaySettings") {
      ChatHeads.openOverlaySettings(context)
    }

    // Có tin mới khi app không mở: hiện bong bóng (ảnh, tên, số tin chưa đọc, xem trước nội dung)
    Function("showHead") { info: Map<String, Any?> ->
      val b = Bundle()
      for ((k, v) in info) {
        when (v) {
          is Boolean -> b.putBoolean(k, v)
          is Number -> b.putInt(k, v.toInt())
          is String -> b.putString(k, v)
          null -> {}
          else -> b.putString(k, v.toString())
        }
      }
      ChatHeads.show(context, b)
    }

    Function("hideHead") {
      ChatHeads.hide()
    }

    Function("bubbleVisible") {
      ChatHeads.bubbleVisible
    }

    Function("bubbleConv") {
      ChatHeads.bubbleConv
    }

    Function("minimizeBubble") {
      ChatHeads.minimizeBubble()
    }

    Function("openApp") {
      ChatHeads.minimizeBubble()
      ChatHeads.openApp(context)
    }

    // Chỉ dùng trong bản thử (workflow "Kiểm tra APK") để kiểm tra phần báo lỗi crash
    Function("crashForTest") {
      Thread { throw IllegalStateException("Think: crash thử để kiểm tra báo lỗi") }.start()
    }
  }
}
