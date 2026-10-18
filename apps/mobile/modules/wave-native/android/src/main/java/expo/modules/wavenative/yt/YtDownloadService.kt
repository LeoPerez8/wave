package expo.modules.wavenative.yt

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.wavenative.R
import expo.modules.wavenative.download.AndroidDownloads
import expo.modules.wavenative.download.DownloadServiceLines
import expo.modules.wavenative.download.DownloadServiceStop
import expo.modules.wavenative.download.DurableDownloads
import expo.modules.wavenative.download.describe
import expo.modules.wavenative.launcher.LauncherIconSwitcher
import expo.modules.wavenative.log.ServiceTimeout
import expo.modules.wavenative.log.WaveLog
import kotlin.concurrent.thread

/**
 * Runs the persisted download journal ([AndroidDownloads]), Soulseek's and
 * YouTube Music's downloads alike, as a
 * `dataSync` foreground service, so downloads continue with the screen off,
 * beside playback and after Android recreates the process (sticky restart).
 * Its notification shows the current job and offers Cancel; it stops once the
 * journal has no work left.
 */
class YtDownloadService : Service() {
  private val downloads get() = AndroidDownloads.get(this)
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  /** When it started (elapsed realtime), for the log line if Android ends it on its time limit. */
  private var startedAt = 0L
  /** Why it's stopping, once it asked to ([onIdle]); otherwise Android stopped it. */
  private var stopping: DownloadServiceStop? = null
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    startedAt = SystemClock.elapsedRealtime()
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Songs being saved to the Library"; setShowBadge(false)
      },
    )
    // With the screen off the CPU and Wi-Fi radio may sleep; both locks are renewed while work remains.
    wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wave:downloads").also {
      it.setReferenceCounted(false); it.acquire(LOCK_MS)
    }
    @Suppress("DEPRECATION")
    wifiLock = (applicationContext.getSystemService(WifiManager::class.java))?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "wave:downloads")?.also {
      it.setReferenceCounted(false); it.acquire()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } catch (e: RuntimeException) {
      // A sticky restart Android won't let into the foreground: the journal waits for Wave's next launch.
      WaveLog.w(TAG, DownloadServiceLines.refused(restart = intent == null, describe(e)))
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent?.action == CANCEL) intent.getStringExtra("jobId")?.let { id ->
      // Tagging or publication may hold the journal; the main thread never waits for it.
      thread(name = "Wave download cancel") { runCatching { downloads.jobs.cancelJob(id, downloads.transport); downloads.changed() } }
    }
    // A null intent is Android's sticky restart, after Wave's process was gone.
    downloads.start(onIdle = { stopping = downloads.jobs.idleStop(); stopSelf() }, refresh = { refresh() }, restarted = intent == null)
    return START_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    WaveLog.w(TAG, ServiceTimeout.line("the downloads service", SystemClock.elapsedRealtime() - startedAt))
    downloads.stop(DownloadServiceStop.TIME_LIMIT, timedOut = true)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    downloads.stop(stopping ?: DownloadServiceStop.ANDROID)
    wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null
    wifiLock?.let { if (it.isHeld) it.release() }; wifiLock = null
    super.onDestroy()
  }

  private fun refresh() {
    wakeLock?.acquire(LOCK_MS)
    val current = downloads.jobs.current()
    // Android drops notifications posted too often; only post what changed.
    val shown = listOf(current?.get("id"), current?.get("phase"), current?.get("queuePosition"), percent(current), downloads.jobs.counts(), downloads.jobs.youtubePause())
    if (shown == lastShown) return
    lastShown = shown
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(current))
  }
  private var lastShown: List<Any?>? = null
  private fun percent(job: Map<String, Any?>?): Int? {
    val received = (job?.get("received") as? Number)?.toLong() ?: 0L
    val total = (job?.get("total") as? Number)?.toLong() ?: 0L
    return if (total > 0) (received * 100 / total).toInt().coerceIn(0, 100) else null
  }

  private fun notification(current: Map<String, Any?>? = downloads.jobs.current()): Notification {
    val builder = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.wave_notification)
      .setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_PROGRESS)
      .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.component?.let { launch.component = LauncherIconSwitcher.launchTarget(packageManager, it) }
      builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
    }
    @Suppress("UNCHECKED_CAST")
    val song = current?.get("song") as? Map<String, Any?>
    val saving = current?.get("phase") in listOf("tagging", "awaitingPublication", "publishing", "completed")
    // As the rows say: YouTube has no peer to connect to, so its job waits until the audio flows.
    val waiting = if (current?.get("source") == DurableDownloads.YOUTUBE) listOf("queued", "preparing", "prepared") else listOf("queued", "preparing")
    val queued = current?.get("queuePosition") != null || current?.get("phase") in waiting
    // While YouTube limits downloads, its songs wait for the next try, which the notification counts down to.
    val pause = downloads.jobs.youtubePause()?.takeIf { current?.get("source") == DurableDownloads.YOUTUBE && current["phase"] == "prepared" }
    val title = when {
      saving -> "Saving to the Library"
      pause != null -> "Paused: YouTube is limiting downloads"
      queued -> "Waiting to download"
      else -> "Downloading"
    }
    builder.setContentTitle(title).setContentText(song?.get("title") as? String ?: "A YT Music song")
    if (pause != null) builder.setWhen(pause.until).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
    // Several songs (an album, or songs asked for one after another): how many download now and how many are left.
    val (running, left) = downloads.jobs.counts()
    if (running + left > 1) builder.setSubText(listOfNotNull("$running downloading".takeIf { running > 0 }, "$left left".takeIf { left > 0 }).joinToString(" · "))
    val percent = percent(current)
    if (percent != null && !saving && !queued) builder.setProgress(100, percent, false) else builder.setProgress(0, 0, true)
    if (current != null && !saving) {
      val intent = Intent(this, YtDownloadService::class.java).setAction(CANCEL).putExtra("jobId", current["id"] as String)
      builder.addAction(Notification.Action.Builder(null, "Cancel", PendingIntent.getService(this, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build())
    }
    return builder.build()
  }

  private companion object {
    const val TAG = "WaveDownloads"
    const val CHANNEL = "wave_downloads"
    const val NOTIFICATION_ID = 0x5759
    const val CANCEL = "wave.download.CANCEL"
    const val LOCK_MS = 15 * 60_000L
  }
}
