package expo.modules.wavenative.lookup

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.wavenative.R
import expo.modules.wavenative.launcher.LauncherIconSwitcher
import expo.modules.wavenative.locale.NativeText
import expo.modules.wavenative.log.ServiceTimeout
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.player.JsRuntime

/**
 * Keeps Wave running while Fix Songs runs on the whole Library (Settings)
 * goes on, with a notification showing its progress and a Cancel action (a
 * `dataSync` foreground service, like YT Music downloads'). The run itself is
 * JavaScript (`src/library/findLyricsAndGenre.ts`); it tells
 * [LibraryLookupNotice] how far it is and the service shows it.
 */
class LibraryLookupService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  /** When it started (elapsed realtime), for the log line if Android ends it on its time limit. */
  private var startedAt = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    startedAt = SystemClock.elapsedRealtime()
    LibraryLookupNotice.createChannel(this)
    // The run goes on with the screen off: lookups wait on the network and on JS timers.
    wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Wave:LibraryLookup")
      .apply {
        setReferenceCounted(false)
        acquire(WAKE_LOCK_MAX_MS)
      }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android requires startForeground after startForegroundService, even when the run already ended.
    startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    if (intent?.action == ACTION_CANCEL) LibraryLookupNotice.cancelRequested(this)
    LibraryLookupNotice.attach(this)
    return START_NOT_STICKY
  }

  /** Android 15+ limits how long a data-sync service runs; the run carries on without it. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    WaveLog.w("WaveLookup", ServiceTimeout.line("the lyrics and genre service", SystemClock.elapsedRealtime() - startedAt))
    LibraryLookupNotice.detach(this)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    LibraryLookupNotice.detach(this)
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  /** Shows the run as it is now. */
  internal fun refresh() {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
  }

  /** Takes the progress notification away and stops. */
  internal fun stop() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun notification(): Notification {
    val progress = LibraryLookupNotice.current()
    val builder = Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.wave_notification)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentTitle(progress?.title ?: NativeText.get("fixingSongs"))
    LibraryLookupNotice.openApp(this)?.let(builder::setContentIntent)
    if (progress == null) return builder.build()
    progress.detail?.let(builder::setContentText)
    if (progress.total > 0) builder.setProgress(progress.total, progress.done.coerceIn(0, progress.total), false)
    else builder.setProgress(0, 0, true)
    if (!progress.cancelling) {
      val cancel = PendingIntent.getService(
        this,
        0,
        Intent(this, LibraryLookupService::class.java).setAction(ACTION_CANCEL),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      builder.addAction(
        Notification.Action.Builder(Icon.createWithResource(this, R.drawable.wave_notification), NativeText.get("cancel"), cancel)
          .build(),
      )
    }
    return builder.build()
  }

  internal companion object {
    const val CHANNEL = "wave_lyrics_and_genre"
    const val NOTIFICATION_ID = 0x5760
    const val SUMMARY_ID = 0x5761
    const val ACTION_CANCEL = "expo.modules.wavenative.lookup.CANCEL"
    /** A safety net: the run releases it long before, when it ends. */
    const val WAKE_LOCK_MAX_MS = 12 * 60 * 60 * 1000L
  }
}

/**
 * The whole-Library run as native sees it: whether it runs, how far it is
 * (the text comes from Core's `libraryLookupProgress`) and who to tell about
 * Cancel. While it runs it holds Wave's JS runtime ([JsRuntime], as downloads
 * and Auto do), so React Native keeps JS timers going with Wave in the
 * background. Starts
 * [LibraryLookupService] at [start]; [end] stops it and posts the summary.
 * Thread-safe; progress refreshes the notification at most a few times a second.
 */
internal object LibraryLookupNotice {
  data class Progress(
    val title: String,
    val detail: String?,
    val done: Int,
    val total: Int,
    val cancelling: Boolean = false,
  )

  /** This run's hold on [JsRuntime]. */
  private const val OWNER = "libraryLookup"
  private const val REFRESH_MS = 500L

  private val main = Handler(Looper.getMainLooper())
  private var progress: Progress? = null
  @Volatile private var service: LibraryLookupService? = null
  @Volatile var onCancel: (() -> Unit)? = null
  private var lastRefreshAt = 0L

  fun current(): Progress? = synchronized(this) { progress }

  fun start(context: Context, title: String, detail: String?) {
    synchronized(this) { progress = Progress(title, detail, 0, 0) }
    main.post { if (current() != null) JsRuntime.ensureStarted(context, OWNER) }
    if (service != null) return refresh(force = true)
    try {
      context.startForegroundService(Intent(context, LibraryLookupService::class.java))
    } catch (e: ForegroundServiceStartNotAllowedException) {
      // Started with Wave in the background: the run still goes on, without the notification.
    } catch (e: SecurityException) {
      // Same, on builds that report it this way.
    }
  }

  fun progress(title: String, detail: String?, done: Int, total: Int) {
    synchronized(this) {
      val now = progress ?: return
      progress = now.copy(title = title, detail = detail, done = done, total = total)
    }
    refresh(force = false)
  }

  /** The run is over: stops the service, lets go of the JS runtime and shows [summary] (title, message), if any. */
  fun end(context: Context, summary: Pair<String, String>?) {
    synchronized(this) { progress = null }
    main.post {
      // Unless another run started meanwhile.
      if (current() != null) return@post
      service?.stop()
      service = null
      JsRuntime.release(OWNER)
    }
    if (summary != null) postSummary(context, summary.first, summary.second)
  }

  /** Cancel in the notification: tells the run, or, with no JS to tell, ends it here. */
  fun cancelRequested(context: Context) {
    val listener = onCancel
    if (listener == null) return end(context, null)
    synchronized(this) { progress = progress?.copy(cancelling = true) }
    refresh(force = true)
    listener()
  }

  fun attach(running: LibraryLookupService) {
    service = running
    // The run ended before the service got going.
    if (current() == null) {
      service = null
      running.stop()
    }
  }

  fun detach(stopped: LibraryLookupService) {
    if (service === stopped) service = null
  }

  fun dismissSummary(context: Context) {
    context.getSystemService(NotificationManager::class.java)
      .cancel(LibraryLookupService.SUMMARY_ID)
  }

  fun createChannel(context: Context) {
    val channel = NotificationChannel(
      LibraryLookupService.CHANNEL,
      NativeText.get("fixSongs"),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = NativeText.get("fixSongsDescription")
      setShowBadge(false)
    }
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  /** Opens Wave: MainActivity rather than the launcher icon's alias, which a theme change can turn off. */
  fun openApp(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.component?.let { launch.component = LauncherIconSwitcher.launchTarget(context.packageManager, it) }
    return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE)
  }

  private fun postSummary(context: Context, title: String, message: String) {
    createChannel(context)
    val builder = Notification.Builder(context, LibraryLookupService.CHANNEL)
      .setSmallIcon(R.drawable.wave_notification)
      .setContentTitle(title)
      .setContentText(message.substringBefore("\n"))
      .setStyle(Notification.BigTextStyle().bigText(message))
      .setAutoCancel(true)
    openApp(context)?.let { builder.setContentIntent(it) }
    val notification = builder.build()
    context.getSystemService(NotificationManager::class.java)
      .notify(LibraryLookupService.SUMMARY_ID, notification)
  }

  private fun refresh(force: Boolean) {
    val now = SystemClock.elapsedRealtime()
    synchronized(this) {
      if (!force && now - lastRefreshAt < REFRESH_MS) return
      lastRefreshAt = now
    }
    service?.let { running -> main.post { running.refresh() } }
  }
}
