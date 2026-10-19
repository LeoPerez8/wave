package expo.modules.wavenative.download

import expo.modules.wavenative.log.LogUnits
import expo.modules.wavenative.log.MemoryUse

/** Why the download service stopped, as its stop line says. */
enum class DownloadServiceStop(val line: String) {
  /** Nothing is left to download: every song finished, failed or was cancelled. */
  QUEUE_EMPTY("its queue is empty"),
  /** Nothing is left because the last song on its way was cancelled. */
  CANCELLED("the last song was cancelled"),
  /** Android ended it on the time limit it gives data-sync services. */
  TIME_LIMIT("Android's time limit"),
  /** Android destroyed it with work left. */
  ANDROID("Android stopped it"),
}

/**
 * The app log's lines for the download service's life: when it starts (Android's sticky restart
 * after Wave was closed included), when it stops and why, and when Android refuses to start it.
 * With these, a log's gaps in download activity say whether the service was running. Its start and
 * stop lines, and a line about once a minute while it runs ([memory]), say how much memory Wave
 * uses, so a slowdown or a kill during a big queue can be matched to memory pressure (#450).
 */
object DownloadServiceLines {
  fun started(restarted: Boolean, counts: DownloadCounts, memory: MemoryUse): String =
    (if (restarted) "Android restarted the download service after Wave was closed" else "The download service started") +
      ": ${counts.line()}; ${memory.line()}"

  fun stopped(why: DownloadServiceStop, ranMs: Long, counts: DownloadCounts, memory: MemoryUse): String {
    val saving = if (counts.saving > 0) ", ${counts.saving} saving" else ""
    val left = if (counts.running + counts.left + counts.saving > 0) ", with ${counts.running} downloading$saving and ${counts.left} waiting" else ""
    return "The download service stopped after ${LogUnits.duration(ranMs)}: ${why.line}$left; ${memory.line()}"
  }

  /** The line written about once a minute while the service runs; [hermesHeap] when JS reported it. */
  fun memory(counts: DownloadCounts, memory: MemoryUse, hermesHeap: Long?): String =
    "Memory while downloading (${counts.line()}): ${memory.line(hermesHeap)}"

  /**
   * Android said no ([error]) to Wave's start, or to its own sticky [restart]. A refused restart
   * leaves the journal as it was; a refused start ends the started jobs (never unprotected work).
   */
  fun refused(restart: Boolean, error: String): String =
    if (restart) "Android refused to restart the download service after Wave was closed ($error); the downloads wait for Wave's next launch"
    else "Android refused to start the download service ($error); the downloads wait for Wave's next launch, started ones back in line"

  /**
   * A quality replacement run stopped: it [ended] (its last song finished, failed or was
   * cancelled), or the download service [stopped] under it, for that reason. Says what it did.
   */
  fun replacementRun(run: DurableDownloads.ReplacementRun, stopped: DownloadServiceStop?): String {
    val how = if (stopped == null) "ended" else "stopped (${stopped.line})"
    val cancelled = if (run.cancelled > 0) ", ${run.cancelled} cancelled" else ""
    return "A quality replacement run $how: ${run.replaced} replaced, ${run.kept} kept with no better copy, ${run.failed} failed, ${run.waiting} waiting$cancelled"
  }
}
