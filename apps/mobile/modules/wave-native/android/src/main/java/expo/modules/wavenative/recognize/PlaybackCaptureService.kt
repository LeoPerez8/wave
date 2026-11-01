package expo.modules.wavenative.recognize

import android.app.Notification
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
import expo.modules.wavenative.locale.NativeText

/**
 * Runs only for a phone-audio session, after Android has granted fresh consent. It is
 * started as well as bound, so its foreground call doesn't rest on Android tolerating
 * one from a service that is only bound.
 */
class PlaybackCaptureService : Service() {
  inner class LocalBinder : Binder() {
    val service get() = this@PlaybackCaptureService
  }

  override fun onBind(intent: Intent): IBinder = LocalBinder()

  /** A session never outlives Wave's process, so Android shouldn't restart the service. */
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY

  fun open(resultCode: Int, data: Intent, onReleased: () -> Unit, detached: Boolean): PlaybackAudio {
    val notification = if (detached) RecognizeListeningService.notification(this) else Notification.Builder(this, RecognizeNotifications.listeningChannel(this))
      .setSmallIcon(R.drawable.wave_notification)
      .setContentTitle(NativeText.get("recognize"))
      .setContentText(NativeText.get("listeningToPhone"))
      .setOngoing(true)
      .build()
    // Both foreground services share the tile's Listening notification and Cancel action.
    startForeground(if (detached) RecognizeListeningService.NOTIFICATION else NOTIFICATION,
      notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
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
    const val NOTIFICATION = 771
  }
}

/**
 * Main-thread start and binding after consent, from Wave or the tile consent host. Releasing the audio
 * unbinds and stops the service, which removes its foreground notification.
 */
fun openPlaybackCapture(
  context: Context,
  resultCode: Int,
  data: Intent,
  opened: (PlaybackAudio) -> Unit,
  failed: (Exception) -> Unit,
  detached: Boolean = false,
): () -> Unit {
  val main = Handler(Looper.getMainLooper())
  val service = Intent(context, PlaybackCaptureService::class.java)
  var started = false
  var bound = false
  var closed = false
  var audio: PlaybackAudio? = null
  lateinit var connection: ServiceConnection
  fun leave() {
    if (bound) {
      bound = false
      context.unbindService(connection)
    }
    if (started) {
      started = false
      context.stopService(service)
    }
  }
  fun close() {
    if (closed) return
    closed = true
    audio?.release()
    leave()
  }
  connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      if (closed) return
      try {
        val capture = (binder as PlaybackCaptureService.LocalBinder).service.open(resultCode, data, onReleased = {
          main.post { close() }
        }, detached = detached)
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
  try {
    started = context.startService(service) != null
    bound = context.bindService(service, connection, Context.BIND_AUTO_CREATE)
  } catch (e: Exception) {
    close()
    failed(e)
    return {}
  }
  if (!started || !bound) {
    close()
    failed(IllegalStateException("Phone audio service couldn't start"))
  }
  return { close() }
}
