package expo.modules.wavenative.yt

import java.io.IOException
import java.util.Locale

/** How a Wi-Fi pre-download run went ([PreDownloadRun]). */
data class PreDownloadOutcome(
  /** Songs it put in the audio cache whole. */
  val fetched: Int,
  /** Songs the cache had whole already. */
  val cachedAlready: Int,
  /** Songs that couldn't be fetched (YouTube won't serve them, a failure). */
  val failed: Int,
  /** Songs it didn't get to, stopped or offline. */
  val left: Int,
  val ended: Ended,
) {
  enum class Ended { DONE, STOPPED, OFFLINE }

  /** The run should go on later, when the phone is on Wi-Fi with battery not low again. */
  val again: Boolean
    get() = ended != Ended.DONE
}

/**
 * One run of the Wi-Fi pre-download (docs/spec.md, YT Music, Wi-Fi
 * pre-download): the day's list of songs (Core's `mixPreDownload`), in its
 * order, each fetched whole into the audio cache ([fetch]) unless the cache
 * has it whole already ([cached]). It ends when the list does, when
 * [stopped] says the phone left Wi-Fi or its battery got low (checked before
 * each song, and by [fetch] as it reads), or when the phone goes offline; a
 * song that won't stream is skipped. A song stopped halfway keeps its bytes,
 * so the next run reads only the rest.
 */
class PreDownloadRun(
  private val cached: (videoId: String) -> Boolean,
  private val fetch: (videoId: String, stopped: () -> Boolean) -> Unit,
  private val stopped: () -> Boolean,
) {
  fun run(videoIds: List<String>): PreDownloadOutcome {
    var fetched = 0
    var cachedAlready = 0
    var failed = 0
    for ((at, videoId) in videoIds.withIndex()) {
      fun ended(ended: PreDownloadOutcome.Ended) = PreDownloadOutcome(fetched, cachedAlready, failed, videoIds.size - at, ended)
      if (stopped()) return ended(PreDownloadOutcome.Ended.STOPPED)
      if (cached(videoId)) {
        cachedAlready++
        continue
      }
      try {
        fetch(videoId, stopped)
      } catch (_: YtOfflineException) {
        return ended(PreDownloadOutcome.Ended.OFFLINE)
      } catch (e: IOException) {
        if (stopped()) return ended(PreDownloadOutcome.Ended.STOPPED)
        failed++
        continue
      }
      when {
        cached(videoId) -> fetched++
        stopped() -> return ended(PreDownloadOutcome.Ended.STOPPED)
        else -> failed++
      }
    }
    return PreDownloadOutcome(fetched, cachedAlready, failed, 0, PreDownloadOutcome.Ended.DONE)
  }

  companion object {
    const val LOG_TAG = "WaveNetwork"

    /**
     * The app log's line for a run (tag [LOG_TAG], beside the mix builds'):
     * "Wi-Fi pre-download (12 songs fetched, 28 cached already) took 84.2 s:
     * 54.30 MB from the network", with the songs that failed and, for a run
     * that stopped, how many were left. Bytes in units of 1,024, as Core's
     * `networkUseLine`.
     */
    fun line(outcome: PreDownloadOutcome, networkBytes: Long, durationMs: Long): String {
      val parts = buildList {
        add("${outcome.fetched} ${if (outcome.fetched == 1) "song" else "songs"} fetched")
        add("${outcome.cachedAlready} cached already")
        if (outcome.failed > 0) add("${outcome.failed} failed")
        when (outcome.ended) {
          PreDownloadOutcome.Ended.DONE -> Unit
          PreDownloadOutcome.Ended.STOPPED -> add("stopped with ${outcome.left} left")
          PreDownloadOutcome.Ended.OFFLINE -> add("offline with ${outcome.left} left")
        }
      }
      val seconds = String.format(Locale.ROOT, "%.1f", Math.round(durationMs / 100.0) / 10.0)
      return "Wi-Fi pre-download (${parts.joinToString(", ")}) took $seconds s: ${bytes(networkBytes)} from the network"
    }

    private const val KB = 1024L
    private const val MB = 1024L * KB

    private fun bytes(bytes: Long): String = when {
      bytes < KB -> "$bytes B"
      bytes < MB -> String.format(Locale.ROOT, "%.1f KB", bytes.toDouble() / KB)
      else -> String.format(Locale.ROOT, "%.2f MB", bytes.toDouble() / MB)
    }
  }
}
