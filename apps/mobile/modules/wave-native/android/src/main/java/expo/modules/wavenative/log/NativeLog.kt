package expo.modules.wavenative.log

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import com.facebook.react.bridge.ReactContext
import expo.modules.wavenative.download.AndroidDownloads
import expo.modules.wavenative.download.savedDownloadCounts
import expo.modules.wavenative.log.SessionRecord.Exit
import expo.modules.wavenative.log.SessionRecord.ExitReason
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.system.exitProcess

/**
 * What native code adds to the app log on its own (#331), started at
 * Application.onCreate (`WaveNativePackage`), before any JS: [WaveLog] writes to
 * the file, an uncaught exception is written before the process dies, the
 * launch says how the previous session ended ([SessionRecord], Android's
 * `ApplicationExitInfo`), and, while Wave is on screen, a watchdog notes when
 * the main thread or the JS thread stops responding ([FreezeWatchdog]). Android's memory
 * warnings are written with Wave's memory, and make JS write what it holds ([MemoryWarnings]).
 */
object NativeLog {
  /** How long a thread may not respond before it's a freeze. */
  private const val FREEZE_MS = 3_000L
  private const val TICK_MS = 1_000L

  private const val MEMORY_TAG = "WaveMemory"

  /** Android's records read at launch; only the latest and the unreported ones are reported. */
  private const val MAX_EXITS = 16

  /** The most of an ANR's thread dump read; the main thread comes first. */
  private const val MAX_TRACE_CHARS = 256 * 1024

  /** The screen showing (the JS route), for a freeze's entry. Set from JS. */
  @Volatile var screen: String? = null

  /** Ticks on a thread of its own, created the first time Wave shows. */
  private val ticker by lazy {
    Executors.newSingleThreadScheduledExecutor { tick -> Thread(tick, "WaveFreezeWatch").apply { isDaemon = true } }
  }

  private val watchdog = FreezeWatchdog { tick ->
    val ticking = ticker.scheduleWithFixedDelay(tick, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS)
    ({ ticking.cancel(false) })
  }

  private var started = false

  /** Each JS runtime's way to write the log entries it holds at once (`WaveAppLog`'s memoryWarning event). */
  private val memoryWarningListeners = CopyOnWriteArrayList<() -> Unit>()

  private val memoryWarnings = MemoryWarnings(
    memory = AndroidMemory::read,
    warn = { WaveLog.w(MEMORY_TAG, it) },
    warned = { for (listener in memoryWarningListeners) runCatching(listener) },
  )

  /**
   * The download service's minute check of Wave's memory [use] and whether the phone is low
   * ([phoneLow]): a warning when it turns short, as Android's own no longer come (`MemoryWarnings.checked`).
   */
  fun memoryChecked(use: MemoryUse, phoneLow: Boolean) = memoryWarnings.checked(use, phoneLow)

  /** [listener] runs at each memory warning of Android's, until the returned function is called. */
  fun onMemoryWarning(listener: () -> Unit): () -> Unit {
    memoryWarningListeners.add(listener)
    return { memoryWarningListeners.remove(listener) }
  }

  @Synchronized
  fun start(context: Context) {
    if (started) return
    started = true
    val app = context.applicationContext ?: context
    WaveLog.install(app)
    val record = SessionRecord(AppLogFile.of(app).file.parentFile!!)
    catchUncaught(record)
    // Read before the journal is opened, as a rule: what the service does next changes its counts.
    Thread({ record.reportPrevious(exits(app)) { savedDownloadCounts(AndroidDownloads.journal(app)) } }, "WaveLogLaunch").start()
    val main = Handler(Looper.getMainLooper())
    watchdog.watch(FreezeWatch("main", FREEZE_MS, SystemClock::uptimeMillis, main::post, { screen }, ::mainThreadStack))
    (app as? Application)?.registerActivityLifecycleCallbacks(OnScreen)
    app.registerComponentCallbacks(OnTrimMemory)
    // Started late, by the JS module (a host that didn't dispatch Application.onCreate): Wave's activity already started.
    if ((context as? ReactContext)?.hasCurrentActivity() == true) watchdog.activityStarted()
  }

  /** Watches the JS thread of [react] until the returned function is called. */
  fun watchJs(react: ReactContext): () -> Unit {
    // Until React Native has set up its JS queue, a ping isn't posted and the next tick tries again.
    val post = { ping: Runnable -> runCatching { react.runOnJSQueueThread(ping) }.getOrDefault(false) }
    return watchdog.watch(FreezeWatch("JS", FREEZE_MS, SystemClock::uptimeMillis, post, { screen }))
  }

  /** Tells the watchdog when Wave's activities start and stop, so it runs only while Wave is on screen. */
  private object OnScreen : Application.ActivityLifecycleCallbacks {
    override fun onActivityStarted(activity: Activity) = watchdog.activityStarted()

    override fun onActivityStopped(activity: Activity) = watchdog.activityStopped()

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

    override fun onActivityResumed(activity: Activity) = Unit

    override fun onActivityPaused(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit
  }

  /** Reads the memory for a warning off the main thread: the PSS reads `/proc`, slower when memory is short. */
  private val memoryThread by lazy {
    Executors.newSingleThreadExecutor { run -> Thread(run, "WaveMemory").apply { isDaemon = true } }
  }

  /** Android's memory warnings, which come on the main thread. */
  private object OnTrimMemory : ComponentCallbacks2 {
    override fun onTrimMemory(level: Int) {
      runCatching { memoryThread.execute { memoryWarnings.trimmed(level) } }
    }

    @Deprecated("Android's older call; still sent")
    override fun onLowMemory() {
      runCatching { memoryThread.execute { memoryWarnings.lowMemory() } }
    }

    override fun onConfigurationChanged(newConfig: Configuration) = Unit
  }

  private fun catchUncaught(record: SessionRecord) {
    val next = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        record.crashed(thread, error)
      } catch (_: Throwable) {
        // The log must never stand in the way of the crash.
      }
      if (next != null) {
        next.uncaughtException(thread, error)
      } else {
        Process.killProcess(Process.myPid())
        exitProcess(10)
      }
    }
  }

  private fun mainThreadStack(): String =
    Looper.getMainLooper().thread.stackTrace.joinToString("\n") { "at $it" }

  private fun exits(context: Context): List<Exit> {
    val activities = context.getSystemService(ActivityManager::class.java) ?: return emptyList()
    return activities.getHistoricalProcessExitReasons(context.packageName, 0, MAX_EXITS).map { info ->
      Exit(
        at = info.timestamp,
        reason = reasonOf(info.reason),
        description = info.description,
        status = info.status,
        pssKb = info.pss,
        rssKb = info.rss,
        importance = info.importance,
      ) {
        if (info.reason == ApplicationExitInfo.REASON_ANR) readTrace(info) else null
      }
    }
  }

  // The freezer's reason is Android 13's, the package's Android 14's: older versions never record them.
  @Suppress("InlinedApi")
  private fun reasonOf(reason: Int): ExitReason = when (reason) {
    ApplicationExitInfo.REASON_CRASH -> ExitReason.CRASH
    ApplicationExitInfo.REASON_CRASH_NATIVE -> ExitReason.CRASH_NATIVE
    ApplicationExitInfo.REASON_ANR -> ExitReason.ANR
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> ExitReason.INITIALIZATION_FAILURE
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> ExitReason.EXCESSIVE_RESOURCE_USAGE
    ApplicationExitInfo.REASON_LOW_MEMORY -> ExitReason.LOW_MEMORY
    ApplicationExitInfo.REASON_SIGNALED -> ExitReason.SIGNALED
    ApplicationExitInfo.REASON_EXIT_SELF -> ExitReason.EXIT_SELF
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> ExitReason.DEPENDENCY_DIED
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> ExitReason.PERMISSION_CHANGE
    ApplicationExitInfo.REASON_USER_REQUESTED -> ExitReason.USER_REQUESTED
    ApplicationExitInfo.REASON_USER_STOPPED -> ExitReason.USER_STOPPED
    ApplicationExitInfo.REASON_OTHER -> ExitReason.OTHER
    ApplicationExitInfo.REASON_FREEZER -> ExitReason.FREEZER
    ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> ExitReason.PACKAGE_STATE_CHANGE
    ApplicationExitInfo.REASON_PACKAGE_UPDATED -> ExitReason.PACKAGE_UPDATED
    else -> ExitReason.UNKNOWN
  }

  private fun readTrace(info: ApplicationExitInfo): String? = runCatching {
    info.traceInputStream?.bufferedReader()?.use { reader ->
      val buffer = CharArray(MAX_TRACE_CHARS)
      var read = 0
      while (read < buffer.size) {
        val n = reader.read(buffer, read, buffer.size - read)
        if (n < 0) break
        read += n
      }
      String(buffer, 0, read)
    }
  }.getOrNull()
}
