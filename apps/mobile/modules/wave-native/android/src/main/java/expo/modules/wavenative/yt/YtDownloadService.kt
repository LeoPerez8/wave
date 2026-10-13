package expo.modules.wavenative.yt

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import expo.modules.wavenative.R
import expo.modules.wavenative.download.AndroidDownloads
import expo.modules.wavenative.launcher.LauncherIconSwitcher

/** The existing dataSync notification now owns the persisted native Soulseek queue. */
class YtDownloadService : Service() {
  private val downloads get() = AndroidDownloads.get(this)
  private var wakeLock: PowerManager.WakeLock? = null
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Soulseek recordings being saved to the Library"; setShowBadge(false)
      },
    )
    wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wave:downloads").also {
      it.setReferenceCounted(false); it.acquire(15 * 60_000L)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    if (intent?.action == CANCEL) intent.getStringExtra("jobId")?.let { downloads.jobs.cancel(it, downloads.transport) }
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
    super.onDestroy()
  }

  private fun refresh() { getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification()) }
  private fun notification(): Notification {
    val current = downloads.jobs.snapshot().firstOrNull {
      it["phase"] !in listOf("failed", "cancelled") && !(it["phase"] == "completed" && (it["acknowledged"] == true || it["importFailure"] != null))
    }
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
    val received = (current?.get("received") as? Number)?.toLong() ?: 0L
    val total = (current?.get("total") as? Number)?.toLong() ?: 0L
    if (total > 0 && !saving && !queued) builder.setProgress(100, (received * 100 / total).toInt().coerceIn(0, 100), false)
    else builder.setProgress(0, 0, true)
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
  }
}
