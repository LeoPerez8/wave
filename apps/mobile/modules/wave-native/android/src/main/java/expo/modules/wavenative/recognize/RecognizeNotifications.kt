package expo.modules.wavenative.recognize

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.os.Handler
import android.os.Looper
import expo.modules.wavenative.R
import expo.modules.wavenative.locale.NativeText
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Recognize's notifications. A capture's ongoing one is quiet; a tile session's result
 * has its own channel, which shows heads-up. There is one result of each kind: a new
 * match replaces the last, and a new failure (No match among them) replaces the last.
 */
object RecognizeNotifications {
  const val RESULTS_CHANNEL = "wave-recognize-results"
  private const val LISTENING_CHANNEL = "wave-recognize"
  private const val MATCH = 772
  private const val FAILURE = 773
  private const val COVER_PX = 256
  private const val COVER_TIMEOUT_MS = 5_000

  private val main = Handler(Looper.getMainLooper())
  private var latestMatch = 0

  fun listeningChannel(context: Context): String {
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(LISTENING_CHANNEL, NativeText.get("recognize"), NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      },
    )
    return LISTENING_CHANNEL
  }

  /** Posts a match at once and adds its cover after, without alerting again. */
  fun postMatch(context: Context, title: String, text: String, coverUrl: String?) {
    val app = context.applicationContext
    val manager = app.getSystemService(NotificationManager::class.java)
    val match = synchronized(this) { ++latestMatch }
    val builder = result(app, title, text)
    manager.notify(MATCH, builder.build())
    if (coverUrl == null) return
    thread(name = "WaveRecognizeCover", isDaemon = true) {
      val cover = runCatching { cover(coverUrl) }.getOrNull() ?: return@thread
      main.post {
        // A newer match or the user may have cleared it while the cover loaded.
        val current = synchronized(this) { match == latestMatch }
        if (current && manager.activeNotifications.any { it.id == MATCH }) {
          manager.notify(MATCH, builder.setLargeIcon(cover).build())
        }
      }
    }
  }

  /**
   * Stays until dismissed. Its action reopens RecognizeTileActivity, because only an
   * activity on screen may start the microphone's service. Unlike a match it alerts
   * each time: it's the session's only answer, even over a failure still showing.
   */
  fun postFailure(context: Context, title: String, text: String, actionLabel: String, microphone: Boolean) {
    val app = context.applicationContext
    val action = PendingIntent.getActivity(
      app,
      if (microphone) 1 else 0,
      RecognizeTileActivity.retry(app, microphone),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = result(app, title, text)
      .setAutoCancel(false)
      .setOnlyAlertOnce(false)
      .addAction(
        Notification.Action.Builder(Icon.createWithResource(app, R.drawable.wave_notification), actionLabel, action)
          .setAuthenticationRequired(true)
          .build(),
      )
      .build()
    app.getSystemService(NotificationManager::class.java).notify(FAILURE, notification)
  }

  /** The failure's action was pressed: Android doesn't clear a notification for that. */
  fun clearFailure(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(FAILURE)
  }

  private fun result(context: Context, title: String, text: String): Notification.Builder {
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(RESULTS_CHANNEL, NativeText.get("recognizedSongs"), NotificationManager.IMPORTANCE_HIGH),
    )
    return Notification.Builder(context, RESULTS_CHANNEL)
      .setSmallIcon(R.drawable.wave_notification)
      .setContentTitle(title)
      .setContentText(text)
      .setCategory(Notification.CATEGORY_STATUS)
      .setOnlyAlertOnce(true)
      .setAutoCancel(true)
  }

  private fun cover(url: String): Bitmap? {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = COVER_TIMEOUT_MS
    connection.readTimeout = COVER_TIMEOUT_MS
    try {
      val bitmap = connection.inputStream.use(BitmapFactory::decodeStream) ?: return null
      return Bitmap.createScaledBitmap(bitmap, COVER_PX, COVER_PX, true)
    } finally {
      connection.disconnect()
    }
  }
}
