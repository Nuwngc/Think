package expo.modules.thinknative

import android.app.Activity
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import android.view.WindowManager

/**
 * Âm thanh khi gọi thoại / gọi video (2.10.0, JavaScript: native/src/calls/).
 * WebRTC tự thu và phát tiếng; phần này chỉ đặt chế độ "đang gọi" để có khử tiếng vọng,
 * chọn loa ngoài hay loa trong (áp tai), giữ màn hình sáng và tắt màn hình khi áp tai (gọi thoại).
 */
object CallAudio {
  private var focus: AudioFocusRequest? = null
  private var proximity: PowerManager.WakeLock? = null
  private var savedMode = AudioManager.MODE_NORMAL

  private fun audio(context: Context) = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  /** Bắt đầu cuộc gọi: chế độ gọi điện, xin quyền phát tiếng, chọn loa */
  fun start(context: Context, speaker: Boolean) {
    val am = audio(context)
    if (focus == null) {
      savedMode = am.mode
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .build()
        am.requestAudioFocus(req)
        focus = req
      }
    }
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    setSpeaker(context, speaker)
  }

  /** Hết cuộc gọi: trả lại như cũ */
  fun stop(context: Context) {
    val am = audio(context)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice()
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = false
    } catch (_: Throwable) {
    }
    am.mode = if (savedMode == AudioManager.MODE_IN_COMMUNICATION) AudioManager.MODE_NORMAL else savedMode
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) focus?.let { am.abandonAudioFocusRequest(it) }
    focus = null
    setProximity(context, false)
  }

  /** Loa ngoài (true) hay loa trong để áp tai (false). Có tai nghe thì Android tự dùng tai nghe. */
  fun setSpeaker(context: Context, on: Boolean): Boolean {
    val am = audio(context)
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (on) {
          val dev = am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
          if (dev != null) am.setCommunicationDevice(dev) else false
        } else {
          val wired = am.availableCommunicationDevices.firstOrNull {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
              it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_USB_HEADSET
          }
          val ear = wired ?: am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
          if (ear != null) am.setCommunicationDevice(ear) else {
            am.clearCommunicationDevice()
            true
          }
        }
      } else {
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = on
        true
      }
    } catch (_: Throwable) {
      false
    }
  }

  /** Gọi thoại áp tai: tắt màn hình khi mặt gần cảm biến (tránh chạm nhầm) */
  fun setProximity(context: Context, on: Boolean) {
    try {
      if (on) {
        if (proximity?.isHeld == true) return
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
        proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "think:call").also { it.acquire(3 * 60 * 60 * 1000L) }
      } else {
        proximity?.let { if (it.isHeld) it.release() }
        proximity = null
      }
    } catch (_: Throwable) {
      proximity = null
    }
  }

  /** Giữ màn hình sáng trong lúc gọi */
  fun keepScreenOn(activity: Activity?, on: Boolean) {
    activity ?: return
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }
}
