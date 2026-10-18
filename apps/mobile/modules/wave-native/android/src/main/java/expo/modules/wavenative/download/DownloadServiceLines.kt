package expo.modules.wavenative.download

import expo.modules.wavenative.log.LogUnits

/** Why the download service stopped, as its stop line says. */
enum class DownloadServiceStop(val line: String) {
  /** Nothing is left to download: every song finished, failed or was cancelled. */
  QUEUE_EMPTY("its queue is empty"),
  /** Android ended it on the time limit it gives data-sync services. */
  TIME_LIMIT("Android's time limit"),
  /** Android destroyed it with work left. */
  ANDROID("Android stopped it"),
}

/**
 * The app log's lines for the download service's life: when it starts (Android's sticky restart
 * after Wave was closed included), when it stops and why, and when Android refuses to start it.
 * With these, a log's gaps in download activity say whether the service was running.
 */
object DownloadServiceLines {
  fun started(restarted: Boolean, counts: DownloadCounts): String =
    (if (restarted) "Android restarted the download service after Wave was closed" else "The download service started") +
      ": ${counts.running} downloading, ${counts.left} waiting"

  fun stopped(why: DownloadServiceStop, ranMs: Long, counts: DownloadCounts): String {
    val left = if (counts.running + counts.left > 0) ", with ${counts.running} downloading and ${counts.left} waiting" else ""
    return "The download service stopped after ${LogUnits.duration(ranMs)}: ${why.line}$left"
  }

  /**
   * Android said no ([error]) to Wave's start, or to its own sticky [restart]. A refused restart
   * leaves the journal as it was; a refused start ends the started jobs (never unprotected work).
   */
  fun refused(restart: Boolean, error: String): String =
    if (restart) "Android refused to restart the download service after Wave was closed ($error); the downloads wait for Wave's next launch"
    else "Android refused to start the download service ($error); started downloads fail with Retry, waiting ones wait for Wave's next launch"
}
