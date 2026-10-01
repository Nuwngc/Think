package expo.modules.thinknative

import android.animation.ValueAnimator
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.text.TextUtils
import android.util.LruCache
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Bong bóng chat nổi trên màn hình (giống Messenger): ảnh người nhắn hình tròn, số tin chưa đọc,
 * kéo đi đâu cũng được, kéo xuống dấu ✕ để ẩn, chạm để mở khung chat nhỏ (BubbleActivity).
 *
 * Chạy dưới dạng dịch vụ "nổi" (foreground service) có thông báo "Bong bóng chat đang bật":
 * nhờ vậy app được chạy nền để giữ kết nối và nhận tin ngay, kể cả máy không có dịch vụ Google.
 */
class ChatHeadService : Service() {
  companion object {
    @Volatile var instance: ChatHeadService? = null
      private set

    private const val NOTIFICATION_ID = 7201
    private const val CHANNEL = "chat_heads"
    private const val HEAD_TITLE = "ThinkChatHead"
    private val avatars = LruCache<String, Bitmap>(24)
    private val loader = Executors.newSingleThreadExecutor()
  }

  private val main = Handler(Looper.getMainLooper())
  private lateinit var wm: WindowManager
  private var density = 1f
  private var headSize = 0
  private var headBox = 0
  private var touchSlop = 0

  private var head: FrameLayout? = null
  private var headImage: ImageView? = null
  private var headBadge: TextView? = null
  private var headParams: WindowManager.LayoutParams? = null
  private var headShown = false
  private var restX = -1
  private var restY = -1
  private var expanded = false

  private var closeTarget: FrameLayout? = null
  private var closeShown = false

  private var preview: TextView? = null
  private var previewShown = false
  private val hidePreview = Runnable { removePreview() }

  private var convId = 0
  private var general = false
  private var title = "Think"
  private var initial = "T"
  private var color = Color.parseColor("#0E7C66")
  private var avatarUrl = ""
  private var unread = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    wm = getSystemService(WINDOW_SERVICE) as WindowManager
    density = resources.displayMetrics.density
    headSize = dp(56f)
    headBox = headSize + dp(12f)
    touchSlop = ViewConfiguration.get(this).scaledTouchSlop
    goForeground()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    goForeground() // mỗi lần gọi bằng startForegroundService đều phải báo lại
    when (intent?.action) {
      ChatHeads.ACTION_DISABLE -> {
        ChatHeads.setOn(this, false)
        ChatHeads.emit("disabled")
        stopEverything()
        stopSelf()
        return START_NOT_STICKY
      }
    }
    ChatHeads.pendingShow?.let {
      ChatHeads.pendingShow = null
      show(it)
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopEverything()
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val p = headParams ?: return
    if (headShown && !expanded) {
      p.x = clampX(p.x)
      p.y = clampY(p.y)
      update()
      snapToEdge()
    }
  }

  /* ======================= Thông báo "đang chạy" (Android bắt buộc) ======================= */

  private fun goForeground() {
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      val ch = NotificationChannel(CHANNEL, "Bong bóng chat", NotificationManager.IMPORTANCE_MIN)
      ch.description = "Android bắt buộc hiện thông báo này khi bong bóng chat đang bật"
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
    val immutable = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 1, it, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
    }
    val disable = PendingIntent.getService(
      this, 2,
      Intent(this, ChatHeadService::class.java).setAction(ChatHeads.ACTION_DISABLE),
      PendingIntent.FLAG_UPDATE_CURRENT or immutable,
    )
    val n = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(smallIcon())
      .setColor(Color.parseColor("#0E7C66"))
      .setContentTitle("Bong bóng chat đang bật")
      .setContentText("Think chạy nền để báo tin nhắn mới ngay.")
      .setContentIntent(open)
      .addAction(0, "Tắt bong bóng", disable)
      .setOngoing(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
    val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type)
  }

  private fun smallIcon(): Int {
    val id = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (id != 0) id else applicationInfo.icon
  }

  /* ======================= Bong bóng ======================= */

  private fun dp(v: Float) = (v * density).roundToInt()

  @Suppress("DEPRECATION")
  private fun overlayType() =
    if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE

  private fun screenW() = resources.displayMetrics.widthPixels
  private fun screenH() = resources.displayMetrics.heightPixels

  private fun statusBar(): Int {
    val id = resources.getIdentifier("status_bar_height", "dimen", "android")
    return if (id > 0) resources.getDimensionPixelSize(id) else dp(24f)
  }

  private fun clampX(x: Int) = max(0, min(x, screenW() - headBox))
  private fun clampY(y: Int) = max(statusBar(), min(y, screenH() - headBox - dp(56f)))

  private fun night() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  private fun buildHead() {
    val root = FrameLayout(this)
    val img = ImageView(this)
    img.scaleType = ImageView.ScaleType.CENTER_CROP
    img.elevation = dp(6f).toFloat()
    root.addView(img, FrameLayout.LayoutParams(headSize, headSize, Gravity.BOTTOM or Gravity.START).apply {
      setMargins(dp(4f), 0, 0, dp(4f))
    })
    val badge = TextView(this)
    badge.setTextColor(Color.WHITE)
    badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
    badge.typeface = Typeface.DEFAULT_BOLD
    badge.gravity = Gravity.CENTER
    badge.minWidth = dp(20f)
    badge.setPadding(dp(5f), 0, dp(5f), 0)
    badge.elevation = dp(8f).toFloat()
    badge.background = GradientDrawable().apply {
      setColor(Color.parseColor("#E0245E"))
      cornerRadius = dp(10f).toFloat()
      setStroke(dp(2f), Color.WHITE)
    }
    root.addView(badge, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(20f), Gravity.TOP or Gravity.END))
    val params = WindowManager.LayoutParams(
      headBox, headBox, overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    )
    params.gravity = Gravity.TOP or Gravity.START
    params.title = HEAD_TITLE
    root.setOnTouchListener(HeadTouch())
    head = root
    headImage = img
    headBadge = badge
    headParams = params
  }

  /** Có tin mới: hiện bong bóng của cuộc trò chuyện đó (app đang mở thì thôi) */
  fun show(info: Bundle) {
    if (!ChatHeads.canDraw(this)) return
    val force = info.getBoolean("force", false)
    if (ChatHeads.mainVisible && !force) return
    val newConv = info.getInt("convId", 0)
    val changed = newConv != convId
    convId = newConv
    general = info.getBoolean("general", false)
    title = info.getString("title") ?: "Think"
    initial = info.getString("initial")?.takeIf { it.isNotEmpty() } ?: "?"
    color = try {
      Color.parseColor(info.getString("color") ?: "#0E7C66")
    } catch (_: Exception) {
      Color.parseColor("#0E7C66")
    }
    avatarUrl = info.getString("avatarUrl") ?: ""
    unread = info.getInt("unread", 0)
    try {
      showHead()
    } catch (e: Exception) {
      // Mất quyền hiện trên ứng dụng khác giữa chừng
      headShown = false
      return
    }
    refresh(changed)
    if (!expanded) {
      pulse()
      val text = info.getString("preview")
      if (!text.isNullOrBlank()) showPreview(text)
    }
  }

  private fun showHead() {
    if (headShown) return
    if (head == null) buildHead()
    val p = headParams!!
    if (restX < 0) {
      restX = screenW() - headBox - dp(2f)
      restY = (screenH() * 0.24f).roundToInt()
    }
    p.x = clampX(restX)
    p.y = clampY(restY)
    wm.addView(head, p)
    headShown = true
  }

  private fun refresh(changed: Boolean) {
    val img = headImage ?: return
    img.contentDescription = "Bong bóng chat: $title"
    val cached = if (avatarUrl.isNotEmpty()) avatars.get(avatarUrl) else null
    when {
      general -> img.setImageBitmap(appIcon())
      cached != null -> img.setImageBitmap(circle(cached))
      else -> {
        if (changed || img.drawable == null) img.setImageBitmap(letterCircle())
        if (avatarUrl.isNotEmpty()) loadAvatar(avatarUrl, convId)
      }
    }
    val badge = headBadge ?: return
    badge.visibility = if (unread > 0 && !expanded) View.VISIBLE else View.GONE
    badge.text = if (unread > 99) "99+" else unread.toString()
  }

  private fun loadAvatar(url: String, forConv: Int) {
    loader.execute {
      val bmp = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        conn.inputStream.use { BitmapFactory.decodeStream(it) }
      } catch (_: Exception) {
        null
      }
      if (bmp != null) {
        avatars.put(url, bmp)
        main.post {
          if (headShown && forConv == convId && url == avatarUrl) headImage?.setImageBitmap(circle(bmp))
        }
      }
    }
  }

  private fun circle(photo: Bitmap): Bitmap {
    val out = Bitmap.createBitmap(headSize, headSize, Bitmap.Config.ARGB_8888)
    val s = min(photo.width, photo.height)
    val square = Bitmap.createBitmap(photo, (photo.width - s) / 2, (photo.height - s) / 2, s, s)
    val scaled = Bitmap.createScaledBitmap(square, headSize, headSize, true)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    p.shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    val canvas = Canvas(out)
    canvas.drawOval(RectF(0f, 0f, headSize.toFloat(), headSize.toFloat()), p)
    drawRing(canvas)
    return out
  }

  private fun letterCircle(): Bitmap {
    val out = Bitmap.createBitmap(headSize, headSize, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    bg.color = color
    canvas.drawOval(RectF(0f, 0f, headSize.toFloat(), headSize.toFloat()), bg)
    val text = Paint(Paint.ANTI_ALIAS_FLAG)
    text.color = Color.WHITE
    text.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    text.textAlign = Paint.Align.CENTER
    text.textSize = headSize * 0.44f
    val fm = text.fontMetrics
    canvas.drawText(initial, headSize / 2f, headSize / 2f - (fm.ascent + fm.descent) / 2f, text)
    drawRing(canvas)
    return out
  }

  private fun drawRing(canvas: Canvas) {
    val ring = Paint(Paint.ANTI_ALIAS_FLAG)
    ring.style = Paint.Style.STROKE
    ring.strokeWidth = dp(2f).toFloat()
    ring.color = Color.WHITE
    val inset = ring.strokeWidth / 2f
    canvas.drawOval(RectF(inset, inset, headSize - inset, headSize - inset), ring)
  }

  private fun appIcon(): Bitmap {
    val out = Bitmap.createBitmap(headSize, headSize, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val d = try {
      packageManager.getApplicationIcon(packageName)
    } catch (_: Exception) {
      null
    }
    if (d != null) {
      d.setBounds(0, 0, headSize, headSize)
      d.draw(canvas)
    } else {
      return letterCircle()
    }
    return out
  }

  private fun pulse() {
    val img = headImage ?: return
    img.scaleX = 0.7f
    img.scaleY = 0.7f
    img.animate().scaleX(1f).scaleY(1f).setDuration(320).setInterpolator(OvershootInterpolator(3f)).start()
  }

  private fun update() {
    val h = head ?: return
    try {
      wm.updateViewLayout(h, headParams)
    } catch (_: Exception) {
      // bong bóng đã bị gỡ
    }
  }

  private fun snapToEdge() {
    val p = headParams ?: return
    if (!headShown) return
    val center = p.x + headBox / 2
    val target = if (center < screenW() / 2) dp(2f) else screenW() - headBox - dp(2f)
    val anim = ValueAnimator.ofInt(p.x, target)
    anim.duration = 220
    anim.interpolator = OvershootInterpolator(1.2f)
    anim.addUpdateListener {
      if (headShown && !expanded) {
        p.x = it.animatedValue as Int
        update()
      }
    }
    anim.start()
    restX = target
    restY = p.y
  }

  /** Mở khung chat nổi: bong bóng lên góc trên bên phải */
  fun expand() {
    removePreview()
    unread = 0 // đang đọc trong khung chat: bỏ số chưa đọc trên bong bóng
    if (!headShown || expanded) {
      expanded = true
      return
    }
    expanded = true
    val p = headParams ?: return
    restX = p.x
    restY = p.y
    p.x = screenW() - headBox - dp(6f)
    p.y = statusBar() + dp(4f)
    update()
    refresh(false)
  }

  /** Đóng / thu nhỏ khung chat nổi: bong bóng về chỗ cũ */
  fun collapse() {
    if (!expanded) return
    expanded = false
    val p = headParams ?: return
    if (!headShown) return
    p.x = clampX(restX)
    p.y = clampY(restY)
    update()
    refresh(false)
  }

  /** Người dùng mở app: ẩn bong bóng (tin mới đã hiện trong app) */
  fun onAppVisible() {
    if (!ChatHeads.bubbleVisible) hideHead()
  }

  fun hideHead() {
    removePreview()
    hideClose()
    if (headShown) {
      try {
        wm.removeViewImmediate(head)
      } catch (_: Exception) {
        // đã gỡ
      }
    }
    headShown = false
    unread = 0
  }

  fun stopEverything() {
    hideHead()
    main.removeCallbacksAndMessages(null)
  }

  /* ======================= Xem trước tin nhắn cạnh bong bóng ======================= */

  private fun showPreview(text: String) {
    removePreview()
    val p = headParams ?: return
    val dark = night()
    val tv = TextView(this)
    tv.text = text
    tv.maxLines = 2
    tv.ellipsize = TextUtils.TruncateAt.END
    tv.maxWidth = min(dp(240f), screenW() - headBox - dp(24f))
    tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
    tv.setTextColor(if (dark) Color.parseColor("#E8EEEA") else Color.parseColor("#17201C"))
    tv.setPadding(dp(12f), dp(8f), dp(12f), dp(8f))
    tv.elevation = dp(4f).toFloat()
    tv.background = GradientDrawable().apply {
      setColor(if (dark) Color.parseColor("#22302A") else Color.WHITE)
      cornerRadius = dp(16f).toFloat()
    }
    val onRight = p.x + headBox / 2 > screenW() / 2
    val lp = WindowManager.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    )
    lp.gravity = Gravity.TOP or (if (onRight) Gravity.END else Gravity.START)
    lp.x = if (onRight) screenW() - p.x + dp(2f) else p.x + headBox + dp(2f)
    lp.y = p.y + dp(10f)
    lp.title = "ThinkChatPreview"
    try {
      wm.addView(tv, lp)
      preview = tv
      previewShown = true
      main.postDelayed(hidePreview, 4000)
    } catch (_: Exception) {
      previewShown = false
    }
  }

  private fun removePreview() {
    main.removeCallbacks(hidePreview)
    if (previewShown) {
      try {
        wm.removeViewImmediate(preview)
      } catch (_: Exception) {
        // đã gỡ
      }
    }
    previewShown = false
  }

  /* ======================= Kéo thả, chạm ======================= */

  private inner class HeadTouch : View.OnTouchListener {
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false

    override fun onTouch(v: View, e: MotionEvent): Boolean {
      val p = headParams ?: return false
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = e.rawX
          downY = e.rawY
          startX = p.x
          startY = p.y
          dragging = false
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          if (expanded) return true // đang mở khung chat: chỉ chạm để thu nhỏ
          val dx = e.rawX - downX
          val dy = e.rawY - downY
          if (!dragging && hypot(dx, dy) > touchSlop) {
            dragging = true
            removePreview()
            showClose()
          }
          if (dragging) {
            p.x = clampX(startX + dx.roundToInt())
            p.y = clampY(startY + dy.roundToInt())
            update()
            highlightClose(isOverClose(e.rawX, e.rawY))
          }
          return true
        }
        MotionEvent.ACTION_UP -> {
          if (dragging) {
            val over = isOverClose(e.rawX, e.rawY)
            hideClose()
            if (over) {
              hideHead() // kéo vào dấu ✕: ẩn đến khi có tin mới
              ChatHeads.emit("dismissed", convId)
            } else {
              snapToEdge()
            }
          } else if (abs(e.rawX - downX) < touchSlop * 2 && abs(e.rawY - downY) < touchSlop * 2) {
            removePreview()
            if (expanded) ChatHeads.minimizeBubble() else ChatHeads.openBubble(this@ChatHeadService, convId)
          }
          dragging = false
          return true
        }
        MotionEvent.ACTION_CANCEL -> {
          if (dragging) {
            hideClose()
            snapToEdge()
          }
          dragging = false
          return true
        }
      }
      return false
    }
  }

  /* ======================= Dấu ✕ để ẩn bong bóng ======================= */

  private fun showClose() {
    if (closeShown) return
    if (closeTarget == null) {
      val box = FrameLayout(this)
      box.background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#CC1B1F1D"))
        setStroke(dp(2f), Color.parseColor("#66FFFFFF"))
      }
      val x = TextView(this)
      x.text = "✕"
      x.setTextColor(Color.WHITE)
      x.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
      x.gravity = Gravity.CENTER
      box.addView(x, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      closeTarget = box
    }
    val lp = WindowManager.LayoutParams(
      dp(64f), dp(64f), overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    )
    lp.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
    lp.y = dp(64f)
    lp.title = "ThinkChatHeadClose"
    try {
      wm.addView(closeTarget, lp)
      closeShown = true
    } catch (_: Exception) {
      closeShown = false
    }
  }

  private fun hideClose() {
    if (!closeShown) return
    try {
      wm.removeViewImmediate(closeTarget)
    } catch (_: Exception) {
      // đã gỡ
    }
    closeShown = false
  }

  private fun isOverClose(rawX: Float, rawY: Float): Boolean {
    if (!closeShown) return false
    val cx = screenW() / 2f
    val cy = screenH() - dp(64f) - dp(32f)
    return hypot(rawX - cx, rawY - cy) < dp(84f)
  }

  private fun highlightClose(on: Boolean) {
    val box = closeTarget ?: return
    val s = if (on) 1.25f else 1f
    box.scaleX = s
    box.scaleY = s
  }
}
