package expo.modules.wavenative.yt

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import expo.modules.wavenative.R

/**
 * Keeps Wave running while YT Music songs download, with a notification
 * showing the song and its progress (a `dataSync` foreground service). The
 * downloads themselves run in the `WaveYtDownloads` module; they tell
 * [YtDownloadNotice] what they're doing and the service shows it. It stops a
 * moment after the last download ends, so the next one in the queue finds it
 * still running.
 */
class YtDownloadService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val channel = NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
      description = "YT Music songs being downloaded into the Library"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    YtDownloadNotice.attach(this)
    return START_NOT_STICKY
  }

  /** Android 15+ limits how long a data-sync service runs; the downloads carry on without it. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    YtDownloadNotice.detach(this)
    stopSelf()
  }

  override fun onDestroy() {
    YtDownloadNotice.detach(this)
    super.onDestroy()
  }

  /** Shows the downloads as they are now. */
  internal fun refresh() {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
  }

  private fun notification(): Notification {
    val current = YtDownloadNotice.current()
    val builder = Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.wave_notification)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
    }
    if (current == null) return builder.setContentTitle("Downloading").build()
    builder.setContentText(current.title)
    if (current.saving) {
      builder.setContentTitle("Saving to the Library").setProgress(0, 0, true)
    } else {
      builder.setContentTitle("Downloading")
      if (current.total > 0) {
        val percent = (current.received * 100 / current.total).toInt().coerceIn(0, 100)
        builder.setProgress(100, percent, false).setSubText("$percent%")
      } else {
        builder.setProgress(0, 0, true)
      }
    }
    return builder.build()
  }

  internal companion object {
    const val CHANNEL = "wave_downloads"
    const val NOTIFICATION_ID = 0x5759
  }
}

/**
 * What the download notification shows: the downloads running now (one at a
 * time from JS's queue, but any number is fine), each from [start] to
 * [finish]. Starts [YtDownloadService] with the first and lets it stop after
 * the last. Thread-safe; progress refreshes the notification at most a few
 * times a second.
 */
internal object YtDownloadNotice {
  data class Entry(val title: String, val received: Long, val total: Long, val saving: Boolean)

  private val entries = LinkedHashMap<String, Entry>()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var service: YtDownloadService? = null
  private var lastRefreshAt = 0L
  private val stopIfIdle = Runnable {
    val idle = synchronized(this) { entries.isEmpty() }
    if (idle) {
      // Forgotten first, so a download starting meanwhile starts the service again.
      val stopping = service
      service = null
      stopping?.stopSelf()
    }
  }

  fun start(context: Context, videoId: String, title: String) {
    synchronized(this) { entries[videoId] = Entry(title, 0, 0, saving = false) }
    main.removeCallbacks(stopIfIdle)
    if (service != null) return refresh(force = true)
    try {
      context.startForegroundService(Intent(context, YtDownloadService::class.java))
    } catch (e: ForegroundServiceStartNotAllowedException) {
      // Started from the background (rare: the queue moved on after Wave left the screen).
      // The download still runs, without the notification.
    } catch (e: SecurityException) {
      // Same, on builds that report it this way.
    }
  }

  fun progress(videoId: String, received: Long, total: Long) {
    synchronized(this) {
      val entry = entries[videoId] ?: return
      entries[videoId] = entry.copy(received = received, total = total)
    }
    refresh(force = false)
  }

  fun saving(videoId: String) {
    synchronized(this) {
      val entry = entries[videoId] ?: return
      entries[videoId] = entry.copy(saving = true)
    }
    refresh(force = true)
  }

  fun finish(videoId: String) {
    val idle = synchronized(this) {
      entries.remove(videoId)
      entries.isEmpty()
    }
    if (idle) main.postDelayed(stopIfIdle, IDLE_STOP_MS) else refresh(force = true)
  }

  fun current(): Entry? = synchronized(this) { entries.values.firstOrNull() }

  fun attach(running: YtDownloadService) {
    service = running
    if (synchronized(this) { entries.isEmpty() }) main.postDelayed(stopIfIdle, IDLE_STOP_MS)
  }

  fun detach(stopped: YtDownloadService) {
    if (service === stopped) service = null
  }

  private fun refresh(force: Boolean) {
    val now = SystemClock.elapsedRealtime()
    synchronized(this) {
      if (!force && now - lastRefreshAt < REFRESH_MS) return
      lastRefreshAt = now
    }
    service?.let { running -> main.post { running.refresh() } }
  }

  /** Long enough for the queue's next song to start, short enough not to linger. */
  private const val IDLE_STOP_MS = 3_000L
  private const val REFRESH_MS = 500L
}
