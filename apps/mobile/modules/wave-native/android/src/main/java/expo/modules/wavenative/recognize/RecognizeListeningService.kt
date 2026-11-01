package expo.modules.wavenative.recognize

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import expo.modules.wavenative.R
import expo.modules.wavenative.locale.NativeLanguage
import expo.modules.wavenative.locale.NativeText
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.player.JsRuntime

/**
 * Keeps a tile session alive without Wave's screen. In the foreground, with the
 * microphone type, while it listens: "Listening…" with Cancel, and the right to the
 * microphone. Then only started, so JS finishes the song's lookup. It holds the JS
 * runtime throughout (headless on a cold start), and JS opens the capture through
 * `RecognizeModule`. RecognizeTileActivity starts it, for a tap and for a failure
 * notification's action.
 */
class RecognizeListeningService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private val run = RecognizeTileRun.shared
  private var leave: (() -> Unit)? = null

  override fun onBind(intent: Intent): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    leave = run.listen {
      main.post { if (!run.listening) stopForeground(STOP_FOREGROUND_REMOVE) }
    }
  }

  /** A session never outlives Wave's process, so Android shouldn't restart the service. */
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_CANCEL) {
      cancel(this)
      return START_NOT_STICKY
    }
    try {
      NativeLanguage.init(this)
      startForeground(NOTIFICATION, notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } catch (e: RuntimeException) {
      WaveLog.w(LOG_TAG, "The tile's session couldn't start", e)
      stopSelf()
      return START_NOT_STICKY
    }
    if (!run.listening) run.request(intent?.getBooleanExtra(EXTRA_MICROPHONE, false) == true)
    JsRuntime.ensureStarted(this, RUNTIME_OWNER)
    return START_NOT_STICKY
  }


  override fun onDestroy() {
    leave?.invoke()
    leave = null
    // Without the service nothing keeps the microphone, so nothing is listening.
    run.cancel()
    stopForeground(STOP_FOREGROUND_REMOVE)
    JsRuntime.release(RUNTIME_OWNER)
    super.onDestroy()
  }

  companion object {
    /** Use Microphone: this session skips Core's source choice. */
    const val EXTRA_MICROPHONE = "expo.modules.wavenative.recognize.MICROPHONE"
    private const val ACTION_CANCEL = "expo.modules.wavenative.recognize.CANCEL"
    const val NOTIFICATION = 774
    private const val RUNTIME_OWNER = "recognize"
    private const val LOG_TAG = "WaveRecognize"


    fun notification(context: Context): Notification {
      val cancel = PendingIntent.getService(
        context,
        0,
        Intent(context, RecognizeListeningService::class.java).setAction(ACTION_CANCEL),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      return Notification.Builder(context, RecognizeNotifications.listeningChannel(context))
        .setSmallIcon(R.drawable.wave_notification)
        .setContentTitle(NativeText.get("listening"))
        .setOngoing(true)
        .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        .addAction(
          Notification.Action.Builder(Icon.createWithResource(context, R.drawable.wave_notification), NativeText.get("cancel"), cancel)
            .build(),
        )
        .build()
    }

    /** A second tap or Cancel: JS ends the session, and no result is told. */
    fun cancel(context: Context) {
      RecognizeTileRun.shared.cancel()
      stop(context)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, RecognizeListeningService::class.java))
    }
  }
}
