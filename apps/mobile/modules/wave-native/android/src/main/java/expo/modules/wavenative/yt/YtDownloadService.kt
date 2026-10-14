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
import expo.modules.wavenative.R
import expo.modules.wavenative.download.AndroidDownloads
import expo.modules.wavenative.launcher.LauncherIconSwitcher
import kotlin.concurrent.thread

/**
 * Runs the persisted Soulseek download journal ([AndroidDownloads]) as a
 * `dataSync` foreground service, so downloads continue with the screen off,
 * beside playback and after Android recreates the process (sticky restart).
 * Its notification shows the current job and offers Cancel; it stops once the
 * journal has no work left.
 */
class YtDownloadService : Service() {
  private val downloads get() = AndroidDownloads.get(this)
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Soulseek recordings being saved to the Library"; setShowBadge(false)
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
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent?.action == CANCEL) intent.getStringExtra("jobId")?.let { id ->
      // Tagging or publication may hold the journal; the main thread never waits for it.
      thread(name = "Wave download cancel") { runCatching { downloads.jobs.cancelJob(id, downloads.transport); downloads.changed() } }
    }
    downloads.start(onIdle = { stopSelf() }, refresh = { refresh() })
    return START_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    downloads.stop(timedOut = true)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    downloads.stop()
    wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null
    wifiLock?.let { if (it.isHeld) it.release() }; wifiLock = null
    super.onDestroy()
  }

  private fun refresh() {
    wakeLock?.acquire(LOCK_MS)
    val current = downloads.jobs.current()
    // Android drops notifications posted too often; only post what changed.
    val shown = listOf(current?.get("id"), current?.get("phase"), current?.get("queuePosition"), percent(current), downloads.jobs.pendingCount())
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
    val queued = current?.get("queuePosition") != null || current?.get("phase") in listOf("queued", "preparing")
    builder.setContentTitle(if (saving) "Saving to the Library" else if (queued) "Waiting to download" else "Downloading")
      .setContentText(song?.get("title") as? String ?: "Soulseek")
    // An album's download (or several songs asked for) counts down the songs left.
    val left = downloads.jobs.pendingCount()
    if (left > 1) builder.setSubText("$left songs left")
    val percent = percent(current)
    if (percent != null && !saving && !queued) builder.setProgress(100, percent, false) else builder.setProgress(0, 0, true)
    if (current != null && !saving) {
      val intent = Intent(this, YtDownloadService::class.java).setAction(CANCEL).putExtra("jobId", current["id"] as String)
      builder.addAction(Notification.Action.Builder(null, "Cancel", PendingIntent.getService(this, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build())
    }
    return builder.build()
  }

  private companion object {
    const val CHANNEL = "wave_downloads"
    const val NOTIFICATION_ID = 0x5759
    const val CANCEL = "wave.download.CANCEL"
    const val LOCK_MS = 15 * 60_000L
  }
}
