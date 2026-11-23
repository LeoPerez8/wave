package expo.modules.wavenative.yt

import expo.modules.wavenative.locale.NativeText
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
 * Its notification shows the current job, or with several songs the whole run
 * as JS follows it ([AndroidDownloads.runNotice]), and offers Cancel, Pause or
 * Resume, and Cancel All; it stops once the journal has no work left. Stopping
 * with only paused songs left, it leaves a "Paused" notification that resumes
 * or cancels them.
 */
class YtDownloadService : Service() {
  private val downloads get() = AndroidDownloads.get(this)
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var stopLanguage: (() -> Unit)? = null
  /** When it started (elapsed realtime), for the log line if Android ends it on its time limit. */
  private var startedAt = 0L
  /** Why it's stopping, once it asked to ([onIdle]); otherwise Android stopped it. */
  private var stopping: DownloadServiceStop? = null
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    expo.modules.wavenative.locale.NativeLanguage.init(this)
    stopLanguage = NativeText.listen {
      createChannel()
      lastShown = null
      lastPostedAt = 0L
      refresh()
    }
    startedAt = SystemClock.elapsedRealtime()
    createChannel()
    // With the screen off the CPU and Wi-Fi radio may sleep; both locks are renewed while work remains.
    wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wave:downloads").also {
      it.setReferenceCounted(false); it.acquire(LOCK_MS)
    }
    @Suppress("DEPRECATION")
    wifiLock = (applicationContext.getSystemService(WifiManager::class.java))?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "wave:downloads")?.also {
      it.setReferenceCounted(false); it.acquire()
    }
  }

  private fun createChannel() {
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, NativeText.get("downloads"), NotificationManager.IMPORTANCE_LOW).apply {
        description = NativeText.get("downloadsDescription"); setShowBadge(false)
      },
    )
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
    val owner: (() -> Unit)? = when (intent?.action) {
      PAUSE -> downloads::pauseAll
      RESUME -> downloads::resumeAll
      // The notification's Cancel All acts at once: no alert can open over it.
      CANCEL_ALL -> { { downloads.cancelAll(null) } }
      else -> null
    }
    if (owner != null) {
      // The work starts once the journal took the tap, so it doesn't stop on the state before it.
      thread(name = "Wave download owner") {
        runCatching(owner).onFailure { WaveLog.w(TAG, "The notification's download action failed", it) }
        mainExecutor.execute { startWork(restarted = false) }
      }
    } else startWork(restarted = intent == null) // A null intent is Android's sticky restart, after Wave's process was gone.
    return START_STICKY
  }

  private fun startWork(restarted: Boolean) {
    downloads.start(onIdle = ::idle, refresh = { refresh() }, restarted = restarted)
  }

  /** No work left: it stops, leaving a "Paused" notification when only paused songs are left. */
  private fun idle() {
    stopping = downloads.jobs.idleStop()
    if (stopping == DownloadServiceStop.PAUSED) {
      stopForeground(STOP_FOREGROUND_DETACH)
      getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, pausedNotification())
    }
    stopSelf()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    WaveLog.w(TAG, ServiceTimeout.line("the downloads service", SystemClock.elapsedRealtime() - startedAt))
    downloads.stop(DownloadServiceStop.TIME_LIMIT, timedOut = true)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    stopLanguage?.invoke()
    stopLanguage = null
    downloads.stop(stopping ?: DownloadServiceStop.ANDROID)
    wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null
    wifiLock?.let { if (it.isHeld) it.release() }; wifiLock = null
    super.onDestroy()
  }

  private fun refresh() {
    wakeLock?.acquire(LOCK_MS)
    val current = downloads.jobs.current()
    // Android drops notifications posted too often; only post what changed.
    val shown = listOf(current?.get("id"), current?.get("phase"), current?.get("queuePosition"), percent(current), downloads.jobs.counts(), downloads.jobs.youtubePausedNow(), downloads.runNotice, downloads.jobs.ownerPaused())
    if (shown == lastShown) return
    // A run's songs change many times a second; its notification follows at most about once a second (the tick reposts).
    val now = SystemClock.elapsedRealtime()
    if (downloads.runNotice != null && now - lastPostedAt < RUN_NOTIFY_MS) return
    lastShown = shown
    lastPostedAt = now
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(current))
  }
  private var lastShown: List<Any?>? = null
  private var lastPostedAt = 0L
  private fun percent(job: Map<String, Any?>?): Int? {
    val received = (job?.get("received") as? Number)?.toLong() ?: 0L
    val total = (job?.get("total") as? Number)?.toLong() ?: 0L
    return if (total > 0) (received * 100 / total).toInt().coerceIn(0, 100) else null
  }

  private fun builder(): Notification.Builder {
    val builder = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.wave_notification)
      .setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_PROGRESS)
      .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.component?.let { launch.component = LauncherIconSwitcher.launchTarget(packageManager, it) }
      builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
    }
    return builder
  }

  /** Pause or Resume, and Cancel All (#1474); each starts the service, which acts on it. */
  private fun ownerActions(builder: Notification.Builder) {
    val paused = downloads.jobs.ownerPaused()
    builder.addAction(ownerAction(if (paused) RESUME else PAUSE, NativeText.get(if (paused) "resume" else "pause"), if (paused) 3 else 2))
    builder.addAction(ownerAction(CANCEL_ALL, NativeText.get("cancelAll"), 4))
  }
  private fun ownerAction(action: String, label: String, code: Int): Notification.Action {
    val intent = Intent(this, YtDownloadService::class.java).setAction(action)
    return Notification.Action.Builder(null, label, PendingIntent.getForegroundService(this, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build()
  }

  /** What stays once the service stopped with only paused songs left: it can be swiped away. */
  private fun pausedNotification(): Notification {
    val builder = builder().setOngoing(false).setContentTitle(NativeText.get("paused"))
      .setContentText(countText("leftCount", downloads.jobs.heldCount()))
    ownerActions(builder)
    return builder.build()
  }

  private fun notification(current: Map<String, Any?>? = downloads.jobs.current()): Notification {
    val builder = builder().setOngoing(true)
    @Suppress("UNCHECKED_CAST")
    val song = current?.get("song") as? Map<String, Any?>
    val saving = current?.get("phase") in listOf("tagging", "awaitingPublication", "publishing", "completed")
    // As the rows say: YouTube has no peer to connect to, so its job waits until the audio flows.
    val waiting = if (current?.get("source") == DurableDownloads.YOUTUBE) listOf("queued", "preparing", "prepared") else listOf("queued", "preparing")
    val queued = current?.get("queuePosition") != null || current?.get("phase") in waiting
    // While YouTube limits downloads, its songs wait for the next try, which the notification counts down to.
    val pause = downloads.jobs.youtubePausedNow()?.takeIf { current?.get("source") == DurableDownloads.YOUTUBE && current["phase"] == "prepared" }
    // With several songs on their way, the whole run (Core's `downloadRunNotice`, as Settings › Downloads counts it).
    val run = downloads.runNotice
    // Paused by the owner with nothing asked for since on its way: "Paused", and no time left (JS's run says the same).
    val held = downloads.jobs.ownerPaused() && !downloads.jobs.hasWork()
    val title = when {
      pause != null -> NativeText.get("pausedYoutube")
      run != null -> run.title
      held -> NativeText.get("paused")
      saving -> NativeText.get("saving")
      queued -> NativeText.get("waiting")
      else -> NativeText.get("downloading")
    }
    builder.setContentTitle(title).setContentText(run?.text ?: song?.get("title") as? String ?: NativeText.get("ytSong"))
    if (pause != null) builder.setWhen(pause.until).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
    if (run != null) builder.setProgress(run.total, run.finished, false) else songProgress(builder, current, saving, queued)
    if (current != null && !saving) {
      val intent = Intent(this, YtDownloadService::class.java).setAction(CANCEL).putExtra("jobId", current["id"] as String)
      builder.addAction(Notification.Action.Builder(null, NativeText.get("cancel"), PendingIntent.getService(this, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build())
    }
    if (current != null) ownerActions(builder)
    return builder.build()
  }

  /** A song on its own: its percent, and how many songs download, wait to be saved and are left. */
  private fun songProgress(builder: Notification.Builder, current: Map<String, Any?>?, saving: Boolean, queued: Boolean) {
    // Several songs (an album, or songs asked for one after another): how many download now (hold a slot), how many
    // wait their turn to be saved, and how many are left (Core's `queuedDownloadCounts`, the same rule).
    val (running, left, toSave) = downloads.jobs.counts()
    if (running + left + toSave > 1) builder.setSubText(listOfNotNull(countText("runningCount", running).takeIf { running > 0 }, countText("savingCount", toSave).takeIf { toSave > 0 }, countText("leftCount", left).takeIf { left > 0 }).joinToString(" · "))
    val percent = percent(current)
    if (percent != null && !saving && !queued) builder.setProgress(100, percent, false) else builder.setProgress(0, 0, true)
  }

  private fun countText(key: String, count: Int): String {
    val form = if (key == "leftCount" && count == 1) "leftOne" else key
    val number = if (NativeText.language == "en") count.toString() else java.text.NumberFormat.getNumberInstance(java.util.Locale.forLanguageTag(NativeText.language)).format(count)
    return NativeText.get(form).replace("%s", number)
  }

  internal companion object {
    const val TAG = "WaveDownloads"
    const val CHANNEL = "wave_downloads"
    const val NOTIFICATION_ID = 0x5759
    const val CANCEL = "wave.download.CANCEL"
    const val PAUSE = "wave.download.PAUSE"
    const val RESUME = "wave.download.RESUME"
    const val CANCEL_ALL = "wave.download.CANCEL_ALL"
    const val LOCK_MS = 15 * 60_000L
    const val RUN_NOTIFY_MS = 900L

    /** Takes away the "Paused" notification the stopped service left ([idle]), once nothing is paused any more. */
    fun dismissPaused(context: android.content.Context) {
      context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }
  }
}
