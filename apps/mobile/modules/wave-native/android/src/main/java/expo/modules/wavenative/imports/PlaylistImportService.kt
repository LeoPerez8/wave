package expo.modules.wavenative.imports

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
import expo.modules.wavenative.log.ServiceTimeout
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.player.JsRuntime

/**
 * Keeps Wave running while link imports fill their playlists, with a
 * notification showing the one going on and a Cancel action (a `dataSync`
 * foreground service, like the whole-Library lyrics and genre run's). The
 * imports themselves are JavaScript (`src/library/playlistImports.ts`); they
 * tell [PlaylistImportNotice] how far they are and the service shows it.
 */
class PlaylistImportService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  /** When it started (elapsed realtime), for the log line if Android ends it on its time limit. */
  private var startedAt = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    startedAt = SystemClock.elapsedRealtime()
    PlaylistImportNotice.createChannel(this)
    // Imports go on with the screen off: searches wait on the network and on JS timers.
    wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Wave:PlaylistImport")
      .apply {
        setReferenceCounted(false)
        acquire(WAKE_LOCK_MAX_MS)
      }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android requires startForeground after startForegroundService, even when the imports already ended.
    startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    if (intent?.action == ACTION_CANCEL) PlaylistImportNotice.cancelRequested()
    PlaylistImportNotice.attach(this)
    return START_NOT_STICKY
  }

  /** Android 15+ limits how long a data-sync service runs; the imports carry on without it. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    WaveLog.w("WavePlaylistImport", ServiceTimeout.line("the playlist import service", SystemClock.elapsedRealtime() - startedAt))
    PlaylistImportNotice.detach(this)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    PlaylistImportNotice.detach(this)
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  /** Shows the import as it is now. */
  internal fun refresh() {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
  }

  /** Takes the notification away and stops. */
  internal fun stop() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun notification(): Notification {
    val progress = PlaylistImportNotice.current()
    val builder = Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.wave_notification)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentTitle(progress?.title ?: DEFAULT_TITLE)
    PlaylistImportNotice.openApp(this)?.let(builder::setContentIntent)
    if (progress == null) return builder.build()
    progress.detail?.let(builder::setContentText)
    if (progress.total > 0) builder.setProgress(progress.total, progress.done.coerceIn(0, progress.total), false)
    else builder.setProgress(0, 0, true)
    if (!progress.cancelling) {
      val cancel = PendingIntent.getService(
        this,
        0,
        Intent(this, PlaylistImportService::class.java).setAction(ACTION_CANCEL),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      builder.addAction(
        Notification.Action.Builder(Icon.createWithResource(this, R.drawable.wave_notification), "Cancel", cancel)
          .build(),
      )
    }
    return builder.build()
  }

  internal companion object {
    const val CHANNEL = "wave_playlist_imports"
    const val NOTIFICATION_ID = 0x5770
    const val ACTION_CANCEL = "expo.modules.wavenative.imports.CANCEL"
    const val DEFAULT_TITLE = "Importing playlists…"
    /** A safety net: the imports release it long before, when they end. */
    const val WAKE_LOCK_MAX_MS = 12 * 60 * 60 * 1000L
  }
}

/**
 * Link imports as native sees them: whether one goes on, how far it is (the
 * text comes from Core's `playlistImportProgress`) and who to tell about
 * Cancel. While imports go on it holds Wave's JS runtime ([JsRuntime], as
 * downloads and the lyrics and genre run do), so React Native keeps JS
 * timers going with Wave in the background. Starts [PlaylistImportService]
 * at [start]; [end] stops it. Thread-safe; progress refreshes the
 * notification at most a few times a second.
 */
internal object PlaylistImportNotice {
  data class Progress(
    val title: String,
    val detail: String?,
    val done: Int,
    val total: Int,
    val cancelling: Boolean = false,
  )

  /** The imports' hold on [JsRuntime]. */
  private const val OWNER = "playlistImport"
  private const val REFRESH_MS = 500L

  private val main = Handler(Looper.getMainLooper())
  private var progress: Progress? = null
  @Volatile private var service: PlaylistImportService? = null
  @Volatile var onCancel: (() -> Unit)? = null
  private var lastRefreshAt = 0L

  fun current(): Progress? = synchronized(this) { progress }

  fun start(context: Context, title: String, detail: String?) {
    synchronized(this) { progress = Progress(title, detail, 0, 0) }
    main.post { if (current() != null) JsRuntime.ensureStarted(context, OWNER) }
    if (service != null) return refresh(force = true)
    try {
      context.startForegroundService(Intent(context, PlaylistImportService::class.java))
    } catch (e: ForegroundServiceStartNotAllowedException) {
      // Started with Wave in the background: the imports still go on, without the notification.
    } catch (e: SecurityException) {
      // Same, on builds that report it this way.
    }
  }

  fun progress(title: String, detail: String?, done: Int, total: Int) {
    synchronized(this) {
      val now = progress ?: return
      // A new import going on can be cancelled again.
      val cancelling = now.cancelling && now.title == title
      progress = now.copy(title = title, detail = detail, done = done, total = total, cancelling = cancelling)
    }
    refresh(force = false)
  }

  /** No import is going on: stops the service and lets go of the JS runtime. */
  fun end() {
    synchronized(this) { progress = null }
    main.post {
      // Unless imports started again meanwhile.
      if (current() != null) return@post
      service?.stop()
      service = null
      JsRuntime.release(OWNER)
    }
  }

  /** Cancel in the notification: tells JS, or, with no JS to tell, ends it here. */
  fun cancelRequested() {
    val listener = onCancel
    if (listener == null) return end()
    synchronized(this) { progress = progress?.copy(cancelling = true) }
    refresh(force = true)
    listener()
  }

  fun attach(running: PlaylistImportService) {
    service = running
    // The imports ended before the service got going.
    if (current() == null) {
      service = null
      running.stop()
    }
  }

  fun detach(stopped: PlaylistImportService) {
    if (service === stopped) service = null
  }

  fun createChannel(context: Context) {
    val channel = NotificationChannel(
      PlaylistImportService.CHANNEL,
      "Playlist imports",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Filling playlists imported from a link"
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

  private fun refresh(force: Boolean) {
    val now = SystemClock.elapsedRealtime()
    synchronized(this) {
      if (!force && now - lastRefreshAt < REFRESH_MS) return
      lastRefreshAt = now
    }
    service?.let { running -> main.post { running.refresh() } }
  }
}
