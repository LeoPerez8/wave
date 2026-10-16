package expo.modules.wavenative.log

import android.content.Context
import android.util.Log
import expo.modules.wavenative.log.AppLogEntry.Level

/**
 * Native code's way into the app log (docs/spec.md, "App log"): each call goes to
 * logcat, as `android.util.Log` would, and to `files/logs/wave.log` under the same
 * tag, redacted and in Core's line shape ([AppLogEntry]). Callable from any thread,
 * before or without JS; it never throws. Until [install] (Application.onCreate,
 * `WaveNativePackage`), entries reach only logcat.
 *
 * ```
 * WaveLog.w("WaveDownloads", "A YouTube transfer failed (http 403)")
 * WaveLog.w("WaveResume", "Couldn't save the resume snapshot", error)
 * ```
 */
object WaveLog {
  @Volatile private var file: AppLogFile? = null
  @Volatile private var clock: () -> Long = System::currentTimeMillis

  /** Writes to Wave's log from now on. */
  fun install(context: Context) = writeTo(AppLogFile.of(context.applicationContext ?: context))

  /** Writes to [file] (none: logcat only), timing entries with [clock]. */
  fun writeTo(file: AppLogFile?, clock: () -> Long = System::currentTimeMillis) {
    this.clock = clock
    this.file = file
  }

  fun i(tag: String, message: String, error: Throwable? = null) = write(Level.INFO, tag, message, error)

  fun w(tag: String, message: String, error: Throwable? = null) = write(Level.WARN, tag, message, error)

  fun e(tag: String, message: String, error: Throwable? = null) = write(Level.ERROR, tag, message, error)

  /** Something that ends the process, such as an uncaught exception. */
  fun f(tag: String, message: String, error: Throwable? = null) = write(Level.FATAL, tag, message, error)

  private fun write(level: Level, tag: String, message: String, error: Throwable?) {
    runCatching {
      when (level) {
        Level.INFO -> Log.i(tag, message, error)
        Level.WARN -> Log.w(tag, message, error)
        // Not Log.wtf for a fatal one: Android may treat that as a failure of its own.
        Level.ERROR, Level.FATAL -> Log.e(tag, message, error)
      }
    }
    val log = file ?: return
    try {
      log.append(AppLogEntry.format(clock(), level, tag, AppLogEntry.withStack(message, error)))
    } catch (failure: Exception) {
      runCatching { Log.w("WaveLog", "Couldn't write the app log", failure) }
    }
  }
}
