package expo.modules.wavenative.recognize

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import expo.modules.wavenative.R

/** Bound only for a phone-audio session, after Android has granted fresh consent. */
class PlaybackCaptureService : Service() {
  inner class LocalBinder : Binder() {
    val service get() = this@PlaybackCaptureService
  }

  override fun onBind(intent: Intent): IBinder = LocalBinder()

  fun open(resultCode: Int, data: Intent, onReleased: () -> Unit): PlaybackAudio {
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "Recognize Song", NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      },
    )
    startForeground(NOTIFICATION, Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.wave_notification)
      .setContentTitle("Recognize Song")
      .setContentText("Listening to audio from this phone")
      .setOngoing(true)
      .build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    val projection = checkNotNull(getSystemService(MediaProjectionManager::class.java).getMediaProjection(resultCode, data)) {
      "Android didn't grant a media projection"
    }
    try {
      return PlaybackAudio.open(projection, onReleased)
    } catch (e: Exception) {
      projection.stop()
      throw e
    }
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private companion object {
    const val CHANNEL = "wave-recognize"
    const val NOTIFICATION = 771
  }
}

/** Main-thread binding. Releasing the audio removes its binding and foreground notification. */
fun openPlaybackCapture(
  context: Context,
  resultCode: Int,
  data: Intent,
  opened: (PlaybackAudio) -> Unit,
  failed: (Exception) -> Unit,
): () -> Unit {
  val main = Handler(Looper.getMainLooper())
  var bound = false
  var closed = false
  var audio: PlaybackAudio? = null
  lateinit var connection: ServiceConnection
  fun unbind() {
    if (!bound) return
    bound = false
    context.unbindService(connection)
  }
  fun close() {
    if (closed) return
    closed = true
    audio?.release()
    unbind()
  }
  connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      if (closed) return
      try {
        val capture = (binder as PlaybackCaptureService.LocalBinder).service.open(resultCode, data) {
          main.post { close() }
        }
        audio = capture
        opened(capture)
      } catch (e: Exception) {
        close()
        failed(e)
      }
    }

    override fun onServiceDisconnected(name: ComponentName) {
      audio?.stop()
    }

    override fun onBindingDied(name: ComponentName) {
      close()
      failed(IllegalStateException("Phone audio service disconnected"))
    }

    override fun onNullBinding(name: ComponentName) {
      close()
      failed(IllegalStateException("Phone audio service couldn't open"))
    }
  }
  bound = context.bindService(Intent(context, PlaybackCaptureService::class.java), connection, Context.BIND_AUTO_CREATE)
  if (!bound) {
    closed = true
    failed(IllegalStateException("Phone audio service couldn't bind"))
  }
  return { close() }
}
