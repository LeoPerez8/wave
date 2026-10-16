package expo.modules.wavenative.log

import java.io.File

/**
 * How a session's end reaches the app log (#331). An uncaught exception is
 * written, with its thread and stack, before the process dies ([crashed]), and
 * leaves a mark; the next launch starts with a line saying the previous session
 * ended in a crash ([reportPrevious]). That launch also writes what Android
 * recorded about sessions that ended badly since the last launch
 * (`ApplicationExitInfo`): crashes Wave couldn't see itself (native ones), ANRs
 * with the main thread's stack, a failed start.
 *
 * [folder] is the log's folder; creating a record takes the mark the last
 * session left, so it belongs before [crashed] can run in this one.
 */
class SessionRecord(private val folder: File) {
  enum class ExitReason { CRASH, CRASH_NATIVE, ANR, INITIALIZATION_FAILURE, EXCESSIVE_RESOURCE_USAGE, USER_REQUESTED, OTHER }

  /**
   * One of Android's records of how a session ended, at [at] ms since the epoch.
   * [trace] reads an ANR's thread dump, only for the records that get reported.
   */
  class Exit(val at: Long, val reason: ExitReason, val description: String?, val trace: () -> String? = { null })

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
   */
  fun reportPrevious(exits: List<Exit>) {
    val reportedUpTo = runCatching { reportedFile.readText().trim().toLong() }.getOrNull()
    val latest = exits.maxByOrNull { it.at }
    val unreported = if (reportedUpTo == null) listOfNotNull(latest) else exits.filter { it.at > reportedUpTo }
    for (exit in unreported.sortedBy { it.at }) {
      if (exit === latest && previousCrashed && exit.reason == ExitReason.CRASH) continue
      val message = describe(exit, if (exit === latest) "The previous session" else "An earlier session") ?: continue
      WaveLog.e(TAG_APP, message)
    }
    if (previousCrashed) WaveLog.e(TAG_APP, "The previous session ended in a crash")
    if (latest != null && latest.at != reportedUpTo) {
      runCatching {
        folder.mkdirs()
        reportedFile.writeText(maxOf(latest.at, reportedUpTo ?: 0).toString())
      }
    }
  }

  private fun describe(exit: Exit, session: String): String? {
    val record = "Android's record of ${AppLogEntry.time(exit.at)}"
    val what = when (exit.reason) {
      ExitReason.CRASH -> "$session ended in a crash ($record)"
      ExitReason.CRASH_NATIVE -> "$session ended in a crash (native, $record)"
      ExitReason.ANR -> "$session stopped responding and Android closed it (ANR, $record)"
      ExitReason.INITIALIZATION_FAILURE -> "$session failed to start ($record)"
      ExitReason.EXCESSIVE_RESOURCE_USAGE -> "$session used too many resources and Android closed it ($record)"
      ExitReason.USER_REQUESTED, ExitReason.OTHER -> return null
    }
    val described = if (exit.description.isNullOrBlank()) what else "$what: ${exit.description}"
    val mainThread = exit.trace()?.let(::mainThreadStack) ?: return described
    return "$described\nMain thread:\n$mainThread"
  }

  companion object {
    const val TAG_CRASH = "crash"
    const val TAG_APP = "app"

    private const val CRASH_MARK = "crashed"
    private const val REPORTED_UP_TO = "exits-reported"

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
