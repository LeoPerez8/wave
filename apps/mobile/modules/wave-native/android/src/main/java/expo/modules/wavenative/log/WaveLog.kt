package expo.modules.wavenative.log

import android.content.Context
import android.util.Log
import expo.modules.wavenative.log.AppLogEntry.Level

/**
 * Native code's way into the app log (docs/spec.md, "App log"): each call goes to
 * logcat, as `android.util.Log` would, and to `files/logs/wave.log` under the same
 * tag, redacted and in Core's line shape ([AppLogEntry]). Callable from any thread,
 * before or without JS; it never throws, and never waits for the file: entries
 * are written by a thread of their own ([AppLogWriter]), except a fatal one ([f]),
 * which is in the file when the call returns. Until [install] (Application.onCreate,
 * `WaveNativePackage`), entries reach only logcat.
 *
 * ```
 * WaveLog.w("WaveDownloads", "A YouTube transfer failed (http 403)")
 * WaveLog.w("WaveResume", "Couldn't save the resume snapshot", error)
 * ```
 */
object WaveLog {
  @Volatile private var writer: AppLogWriter? = null
  @Volatile private var clock: () -> Long = System::currentTimeMillis

  /** Writes to Wave's log from now on. */
  fun install(context: Context) = writeTo(AppLogFile.of(context.applicationContext ?: context))

  /** Writes to [file] (none: logcat only), timing entries with [clock]. What was queued for the last file goes there first. */
  @Synchronized
  fun writeTo(file: AppLogFile?, clock: () -> Long = System::currentTimeMillis) {
    this.clock = clock
    val last = writer
    writer = file?.let(::writerFor)
    last?.close()
  }

  fun i(tag: String, message: String, error: Throwable? = null) = write(Level.INFO, tag, message, error)

  fun w(tag: String, message: String, error: Throwable? = null) = write(Level.WARN, tag, message, error)

  fun e(tag: String, message: String, error: Throwable? = null) = write(Level.ERROR, tag, message, error)

  /** Something that ends the process, such as an uncaught exception: written, with what was queued before it, by the time this returns. */
  fun f(tag: String, message: String, error: Throwable? = null) {
    write(Level.FATAL, tag, message, error)
    flush()
  }

  /** Writes the entries still queued, on the calling thread, before returning. */
  fun flush() {
    writer?.flush()
  }

  private fun write(level: Level, tag: String, message: String, error: Throwable?) {
    runCatching {
      when (level) {
        Level.INFO -> Log.i(tag, message, error)
        Level.WARN -> Log.w(tag, message, error)
        // Not Log.wtf for a fatal one: Android may treat that as a failure of its own.
        Level.ERROR, Level.FATAL -> Log.e(tag, message, error)
      }
    }
    val log = writer ?: return
    // The time is taken now; formatting and redacting wait for the writer's thread.
    val at = clock()
    log.write { AppLogEntry.format(at, level, tag, AppLogEntry.withStack(message, error)) }
  }

  private fun writerFor(file: AppLogFile) = AppLogWriter(
    append = { text ->
      try {
        file.append(text)
      } catch (failure: Exception) {
        runCatching { Log.w(TAG, "Couldn't write the app log", failure) }
      }
    },
    dropped = { count ->
      AppLogEntry.format(clock(), Level.WARN, TAG, "$count native entries were left out: they came faster than the log could take them")
    },
  )

  private const val TAG = "WaveLog"
}
