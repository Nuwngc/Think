package expo.modules.thinknative

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Chạy ngay khi app khởi động (trước cả JavaScript): cài bộ bắt lỗi crash, theo dõi màn hình cho bong bóng chat */
class ThinkNativePackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          CrashCatcher.install(application)
          ChatHeads.watch(application)
        }
      }
    )
}
