package expo.modules.thinknative

import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.system.exitProcess

/**
 * Bắt lỗi crash của app (kể cả lỗi JavaScript làm app tắt) để báo cho admin.
 *
 * Khi app sắp tắt vì lỗi: ghi lỗi ra file trong bộ nhớ app, rồi thử gửi ngay lên máy chủ
 * (tối đa 2,5 giây, phòng khi app crash mỗi lần mở nên không kịp chạy phần gửi lại).
 * Lần mở app sau, phần JavaScript (src/errors.ts) đọc các file còn lại và gửi tiếp.
 */
object CrashCatcher {
  private const val TAG = "ThinkCrash"
  private const val DIR = "think-reports"
  private const val MAX_FILES = 20

  @Volatile
  private var installed = false

  fun install(app: Application) {
    if (installed) return
    installed = true
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        record(app, thread, error)
      } catch (_: Throwable) {
        // Không để phần báo lỗi gây thêm lỗi
      }
      if (previous != null) {
        previous.uncaughtException(thread, error)
      } else {
        android.os.Process.killProcess(android.os.Process.myPid())
        exitProcess(10)
      }
    }
  }

  fun versionName(context: Context): String = try {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    "${info.versionName} ($code)"
  } catch (_: Throwable) {
    "?"
  }

  fun deviceName(): String {
    val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
    val model = Build.MODEL.orEmpty()
    val name = if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model"
    val abi = Build.SUPPORTED_ABIS.firstOrNull().orEmpty()
    return "$name ($abi)".trim()
  }

  fun osVersion(): String {
    val harmony = harmonyVersion()
    val base = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
    return if (harmony != null) "$base, HarmonyOS $harmony" else base
  }

  /** Máy Huawei chạy HarmonyOS: đọc phiên bản HarmonyOS nếu có */
  private fun harmonyVersion(): String? = try {
    val cls = Class.forName("com.huawei.system.BuildEx")
    val os = cls.getMethod("getOsBrand").invoke(null) as? String
    if (os != null && os.contains("harmony", ignoreCase = true)) {
      val prop = Class.forName("android.os.SystemProperties").getMethod("get", String::class.java)
      (prop.invoke(null, "hw_sc.build.platform.version") as? String)?.takeIf { it.isNotBlank() } ?: "?"
    } else {
      null
    }
  } catch (_: Throwable) {
    null
  }

  private fun record(context: Context, thread: Thread, error: Throwable) {
    val root = rootCause(error)
    val message = buildString {
      append(error.javaClass.name)
      error.message?.let { append(": ").append(it) }
      if (root !== error) {
        append(" ← ").append(root.javaClass.simpleName)
        root.message?.let { append(": ").append(it) }
      }
    }
    val json = JSONObject().apply {
      put("kind", "crash")
      put("fatal", true)
      put("message", message.take(600))
      put("stack", Log.getStackTraceString(error).take(12000))
      put("platform", "android")
      put("appVersion", versionName(context))
      put("osVersion", osVersion())
      put("device", deviceName())
      put("where", "luồng ${thread.name}")
      put("at", System.currentTimeMillis())
    }
    val file = save(context, json.toString())
    // Thử gửi ngay, chờ tối đa 2,5 giây
    val sender = Thread {
      if (send(context, "{\"errors\":[$json]}")) file?.delete()
    }
    sender.start()
    sender.join(2500)
  }

  private fun rootCause(error: Throwable): Throwable {
    var e = error
    var depth = 0
    while (e.cause != null && e.cause !== e && depth < 10) {
      e = e.cause!!
      depth++
    }
    return e
  }

  private fun dir(context: Context) = File(context.filesDir, DIR).apply { mkdirs() }

  /** Ghi một báo lỗi (chuỗi JSON) ra file, chờ gửi */
  fun save(context: Context, json: String): File? = try {
    val d = dir(context)
    d.listFiles()?.sortedBy { it.lastModified() }?.dropLast(MAX_FILES - 1)?.forEach { it.delete() }
    File(d, "r-${System.currentTimeMillis()}-${(Math.random() * 1e6).toInt()}.json").apply { writeText(json) }
  } catch (e: Throwable) {
    Log.w(TAG, "Không ghi được báo lỗi", e)
    null
  }

  /** Lấy và xóa các báo lỗi đang chờ gửi */
  fun take(context: Context): List<String> {
    val files = dir(context).listFiles()?.sortedBy { it.lastModified() } ?: return emptyList()
    return files.mapNotNull { f ->
      try {
        f.readText().also { f.delete() }
      } catch (_: Throwable) {
        f.delete()
        null
      }
    }
  }

  /** Địa chỉ máy chủ Think lấy từ cấu hình app (expo-constants nhúng sẵn file app.config trong APK) */
  private fun apiUrl(context: Context): String? = try {
    val text = context.assets.open("app.config").bufferedReader().use { it.readText() }
    JSONObject(text).optJSONObject("extra")?.optString("apiUrl")?.trimEnd('/')?.takeIf { it.startsWith("http") }
  } catch (_: Throwable) {
    null
  }

  private fun send(context: Context, body: String): Boolean {
    val base = apiUrl(context) ?: return false
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL("$base/api/app/errors").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 2000
        readTimeout = 2000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
      }
      conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      conn.responseCode in 200..299
    } catch (_: Throwable) {
      false
    } finally {
      conn?.disconnect()
    }
  }
}
