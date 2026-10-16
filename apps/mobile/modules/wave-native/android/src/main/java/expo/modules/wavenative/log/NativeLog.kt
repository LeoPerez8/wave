package expo.modules.wavenative.log

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import com.facebook.react.bridge.ReactContext
import expo.modules.wavenative.log.SessionRecord.Exit
import expo.modules.wavenative.log.SessionRecord.ExitReason
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.system.exitProcess

/**
 * What native code adds to the app log on its own (#331), started at
 * Application.onCreate (`WaveNativePackage`), before any JS: [WaveLog] writes to
 * the file, an uncaught exception is written before the process dies, the
 * launch says how the previous session ended ([SessionRecord], Android's
 * `ApplicationExitInfo`), and a watchdog notes when the main thread or the JS
 * thread stops responding ([FreezeWatch]).
 */
object NativeLog {
  /** How long a thread may not respond before it's a freeze. */
  private const val FREEZE_MS = 3_000L
  private const val TICK_MS = 1_000L

  /** Android's records read at launch; only the latest and the unreported ones are reported. */
  private const val MAX_EXITS = 16

  /** The most of an ANR's thread dump read; the main thread comes first. */
  private const val MAX_TRACE_CHARS = 256 * 1024

  /** The screen showing (the JS route), for a freeze's entry. Set from JS. */
  @Volatile var screen: String? = null

  private val watches = CopyOnWriteArrayList<FreezeWatch>()
  private var started = false

  @Synchronized
  fun start(context: Context) {
    if (started) return
    started = true
    val app = context.applicationContext ?: context
    WaveLog.install(app)
    val record = SessionRecord(AppLogFile.of(app).file.parentFile!!)
    catchUncaught(record)
    Thread({ record.reportPrevious(exits(app)) }, "WaveLogLaunch").start()
    val main = Handler(Looper.getMainLooper())
    watch(FreezeWatch("main", FREEZE_MS, SystemClock::uptimeMillis, main::post, { screen }, ::mainThreadStack))
    Thread(::watchdog, "WaveFreezeWatch").apply { isDaemon = true }.start()
  }

  /** Watches the JS thread of [react] until the returned function is called. */
  fun watchJs(react: ReactContext): () -> Unit {
    // Until React Native has set up its JS queue, a ping isn't posted and the next tick tries again.
    val post = { ping: Runnable -> runCatching { react.runOnJSQueueThread(ping) }.getOrDefault(false) }
    return watch(FreezeWatch("JS", FREEZE_MS, SystemClock::uptimeMillis, post, { screen }))
  }

  private fun watch(watch: FreezeWatch): () -> Unit {
    watches.add(watch)
    return { watches.remove(watch) }
  }

  private fun watchdog() {
    while (true) {
      try {
        Thread.sleep(TICK_MS)
        for (watch in watches) watch.tick()
      } catch (_: InterruptedException) {
        return
      } catch (error: Exception) {
        WaveLog.w(FreezeWatch.TAG, "The freeze watch failed", error)
        return
      }
    }
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
      Exit(info.timestamp, reasonOf(info.reason), info.description) {
        if (info.reason == ApplicationExitInfo.REASON_ANR) readTrace(info) else null
      }
    }
  }

  private fun reasonOf(reason: Int): ExitReason = when (reason) {
    ApplicationExitInfo.REASON_CRASH -> ExitReason.CRASH
    ApplicationExitInfo.REASON_CRASH_NATIVE -> ExitReason.CRASH_NATIVE
    ApplicationExitInfo.REASON_ANR -> ExitReason.ANR
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> ExitReason.INITIALIZATION_FAILURE
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> ExitReason.EXCESSIVE_RESOURCE_USAGE
    ApplicationExitInfo.REASON_USER_REQUESTED -> ExitReason.USER_REQUESTED
    else -> ExitReason.OTHER
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
