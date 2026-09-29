package expo.modules.thinknative

import android.content.Context
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Các hàm Android riêng của app Think, gọi từ JavaScript qua native/src/native.ts */
class ThinkNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ThinkNative")

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

    // Chỉ dùng trong bản thử (workflow "Kiểm tra APK") để kiểm tra phần báo lỗi crash
    Function("crashForTest") {
      Thread { throw IllegalStateException("Think: crash thử để kiểm tra báo lỗi") }.start()
    }
  }
}
