package expo.modules.wavenative.log

import android.app.ActivityManager.RunningAppProcessInfo
import expo.modules.wavenative.download.DownloadCounts
import java.io.File

/**
 * How a session's end reaches the app log (#331). An uncaught exception is
 * written, with its thread and stack, before the process dies ([crashed]), and
 * leaves a mark; the next launch starts with a line saying the previous session
 * ended in a crash ([reportPrevious]). That launch also writes what Android
 * recorded about sessions that ended badly since the last launch
 * (`ApplicationExitInfo`): crashes Wave couldn't see itself (native ones), ANRs
 * with the main thread's stack, a failed start, and every other end but the
 * user's and a package update (#449): a low-memory kill, a signal, a freeze…
 * Each with Wave's memory and what it was doing, where Android recorded them, and
 * the previous session's with the downloads its journal still had in progress.
 *
 * [folder] is the log's folder; creating a record takes the mark the last
 * session left, so it belongs before [crashed] can run in this one.
 */
class SessionRecord(private val folder: File) {
  /** Android's reasons (`ApplicationExitInfo.REASON_*`); the user's and the package's own ends say nothing. */
  enum class ExitReason {
    CRASH,
    CRASH_NATIVE,
    ANR,
    INITIALIZATION_FAILURE,
    EXCESSIVE_RESOURCE_USAGE,
    LOW_MEMORY,
    SIGNALED,
    EXIT_SELF,
    FREEZER,
    DEPENDENCY_DIED,
    PERMISSION_CHANGE,
    PACKAGE_STATE_CHANGE,
    OTHER,
    UNKNOWN,
    USER_REQUESTED,
    USER_STOPPED,
    PACKAGE_UPDATED,
  }

  /**
   * One of Android's records of how a session ended, at [at] ms since the epoch.
   * [status] is the signal that killed it ([ExitReason.SIGNALED]) or the status it
   * exited with ([ExitReason.EXIT_SELF]). [pssKb] and [rssKb] are Wave's last memory
   * Android knew of (0: not recorded), [importance] what Wave was doing
   * (`RunningAppProcessInfo.IMPORTANCE_*`, 0: not recorded). [trace] reads an ANR's
   * thread dump, only for the records that get reported.
   */
  class Exit(
    val at: Long,
    val reason: ExitReason,
    val description: String?,
    val status: Int = 0,
    val pssKb: Long = 0,
    val rssKb: Long = 0,
    val importance: Int = 0,
    val trace: () -> String? = { null },
  )

  private val crashMark = File(folder, CRASH_MARK)
  private val reportedFile = File(folder, REPORTED_UP_TO)

  /** Whether the last session died of an uncaught exception, taken when the record is created. */
  private val previousCrashed: Boolean = runCatching { crashMark.exists() && crashMark.delete() }.getOrDefault(false)

  /** Writes an uncaught exception and marks this session as ended in a crash. Never throws. */
  fun crashed(thread: Thread, error: Throwable) {
    WaveLog.f(TAG_CRASH, "Uncaught exception in thread ${thread.name}", error)
    runCatching {
      folder.mkdirs()
      crashMark.createNewFile()
    }
  }

  /**
   * Writes how the previous session ended, when it ended badly, and any session
   * before it that ended badly since the last report. [exits] are Android's
   * records, in any order; without an earlier report, only the latest is read,
   * not the history from before the log existed.
   *
   * [downloads] reads the download journal's counts as the previous session last
   * wrote them, only when that session's end is reported, and first of all (a
   * download service Android restarts may rewrite the journal meanwhile); its
   * line says whether downloads were running.
   *
   * An end while Wave was cached (Android trimming its cached processes, a
   * low-memory kill in the background) is information, not an error; a crash or
   * an ANR is an error however Wave stood.
   */
  fun reportPrevious(exits: List<Exit>, downloads: () -> DownloadCounts? = { null }) {
    val reportedUpTo = runCatching { reportedFile.readText().trim().toLong() }.getOrNull()
    val latest = exits.maxByOrNull { it.at }
    val unreported = if (reportedUpTo == null) listOfNotNull(latest) else exits.filter { it.at > reportedUpTo }
    val inProgress = if (previousCrashed || (latest != null && latest in unreported && !ordinary(latest))) {
      runCatching(downloads).getOrNull()
        ?.takeIf { it.running + it.left > 0 }
        ?.let { "Downloads were in progress: ${it.running} downloading, ${it.left} waiting" }
    } else null
    // Wave wrote its own crash: Android's record of it only adds what Wave was doing and its memory.
    val ownCrash = latest?.takeIf { previousCrashed && it.reason == ExitReason.CRASH && it in unreported }
    for (exit in unreported.sortedBy { it.at }) {
      if (exit === ownCrash) continue
      val previous = exit === latest
      val message = describe(exit, if (previous) "The previous session" else "An earlier session") {
        if (previous && !previousCrashed) inProgress else null
      } ?: continue
      if (routine(exit)) WaveLog.i(TAG_APP, message) else WaveLog.e(TAG_APP, message)
    }
    if (previousCrashed) {
      WaveLog.e(TAG_APP, listOfNotNull("The previous session ended in a crash", ownCrash?.let(::state), inProgress).joinToString("\n"))
    }
    if (latest != null && latest.at != reportedUpTo) {
      runCatching {
        folder.mkdirs()
        reportedFile.writeText(maxOf(latest.at, reportedUpTo ?: 0).toString())
      }
    }
  }

  /** Whether [exit] is an ordinary end, which writes nothing: the user's, a package update, swiping Wave away. */
  private fun ordinary(exit: Exit): Boolean = when (exit.reason) {
    ExitReason.USER_REQUESTED, ExitReason.USER_STOPPED, ExitReason.PACKAGE_UPDATED -> true
    ExitReason.OTHER -> exit.description == SWIPED_AWAY
    else -> false
  }

  /** Whether [exit] is routine, written as information: Wave was cached, and it wasn't a crash, an ANR or a failed start. */
  private fun routine(exit: Exit): Boolean =
    exit.importance == RunningAppProcessInfo.IMPORTANCE_CACHED &&
      exit.reason !in setOf(ExitReason.CRASH, ExitReason.CRASH_NATIVE, ExitReason.ANR, ExitReason.INITIALIZATION_FAILURE)

  /** [exit]'s entry, null for an ordinary end; [downloads] gives its downloads line, if it has one. */
  private fun describe(exit: Exit, session: String, downloads: () -> String?): String? {
    val record = "Android's record of ${AppLogEntry.time(exit.at)}"
    val what = when (exit.reason) {
      ExitReason.CRASH -> "$session ended in a crash ($record)"
      ExitReason.CRASH_NATIVE -> "$session ended in a crash (native, $record)"
      ExitReason.ANR -> "$session stopped responding and Android closed it (ANR, $record)"
      ExitReason.INITIALIZATION_FAILURE -> "$session failed to start ($record)"
      ExitReason.EXCESSIVE_RESOURCE_USAGE -> "$session used too many resources and Android closed it ($record)"
      ExitReason.LOW_MEMORY -> "$session was killed for low memory ($record)"
      ExitReason.SIGNALED -> "$session was killed by signal ${signal(exit.status)} ($record)"
      ExitReason.EXIT_SELF -> "$session exited on its own with status ${exit.status} ($record)"
      ExitReason.FREEZER -> "$session was killed while frozen in the background ($record)"
      ExitReason.DEPENDENCY_DIED -> "$session was closed because a process it depends on died ($record)"
      ExitReason.PERMISSION_CHANGE -> "$session was closed because a permission changed ($record)"
      ExitReason.PACKAGE_STATE_CHANGE -> "$session was closed because Wave's package changed state ($record)"
      ExitReason.UNKNOWN -> "$session ended for a reason Android didn't record ($record)"
      // Swiping Wave away from Recents (Android's description of an older version's record of it) is ordinary.
      ExitReason.OTHER -> if (ordinary(exit)) return null else "$session was closed by Android ($record)"
      ExitReason.USER_REQUESTED, ExitReason.USER_STOPPED, ExitReason.PACKAGE_UPDATED -> return null
    }
    val described = listOfNotNull(if (exit.description.isNullOrBlank()) what else "$what: ${exit.description}", state(exit), downloads())
      .joinToString("\n")
    val mainThread = exit.trace()?.let(::mainThreadStack) ?: return described
    return "$described\nMain thread:\n$mainThread"
  }

  /** "Wave was on screen; PSS 312 MB, RSS 401 MB": what Android recorded of Wave at the end, null when nothing. */
  private fun state(exit: Exit): String? {
    val doing = importance(exit.importance)?.let { "Wave was $it" }
    val memory = listOfNotNull(
      exit.pssKb.takeIf { it > 0 }?.let { "PSS ${megabytes(it)}" },
      exit.rssKb.takeIf { it > 0 }?.let { "RSS ${megabytes(it)}" },
    ).joinToString(", ").ifEmpty { null }
    return listOfNotNull(doing, memory).joinToString("; ").ifEmpty { null }
  }

  companion object {
    const val TAG_CRASH = "crash"
    const val TAG_APP = "app"

    private const val CRASH_MARK = "crashed"
    private const val REPORTED_UP_TO = "exits-reported"
    private const val SWIPED_AWAY = "remove task"

    /** Linux's names for the signals that end processes, by number. */
    private val SIGNALS = mapOf(
      1 to "SIGHUP", 2 to "SIGINT", 3 to "SIGQUIT", 4 to "SIGILL", 5 to "SIGTRAP", 6 to "SIGABRT", 7 to "SIGBUS",
      8 to "SIGFPE", 9 to "SIGKILL", 11 to "SIGSEGV", 13 to "SIGPIPE", 14 to "SIGALRM", 15 to "SIGTERM",
    )

    /** "9, SIGKILL": a signal's number and, when it's one that ends processes, its name. */
    private fun signal(number: Int): String = SIGNALS[number]?.let { "$number, $it" } ?: "$number"

    /** "312 MB" for [kb] kilobytes, as Android's memory tools count them (1 MB = 1024 KB). */
    private fun megabytes(kb: Long): String = "${Math.round(kb / 1024.0)} MB"

    /** What Wave was doing, in plain words, from Android's importance; null when not recorded. */
    private fun importance(value: Int): String? = when (value) {
      0 -> null
      RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "on screen"
      RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "a foreground service (playing or downloading)"
      RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "visible behind another app"
      RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE -> "in the background, noticeably"
      RunningAppProcessInfo.IMPORTANCE_SERVICE -> "in the background (a service)"
      @Suppress("DEPRECATION") RunningAppProcessInfo.IMPORTANCE_TOP_SLEEPING -> "on screen with the screen off"
      RunningAppProcessInfo.IMPORTANCE_CANT_SAVE_STATE -> "in the background"
      RunningAppProcessInfo.IMPORTANCE_CACHED -> "cached"
      else -> "of importance $value"
    }

    /** The frames an ANR's main thread keeps in the log. */
    private const val MAX_FRAMES = 60

    /**
     * The main thread's part of an ANR's thread dump: its header line and its
     * frames, without the `|` detail lines. Null when the dump has none.
     */
    fun mainThreadStack(trace: String): String? {
      val lines = trace.lines()
      val start = lines.indexOfFirst { it.trimStart().startsWith("\"main\"") }
      if (start < 0) return null
      val frames = lines.drop(start + 1)
        .takeWhile { it.isNotBlank() }
        .filterNot { it.trimStart().startsWith("|") }
      val kept = frames.take(MAX_FRAMES) + if (frames.size > MAX_FRAMES) listOf("  … ${frames.size - MAX_FRAMES} more") else emptyList()
      return (listOf(lines[start]) + kept).joinToString("\n")
    }
  }
}
