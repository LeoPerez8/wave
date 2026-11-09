package expo.modules.wavenative.normalize

/**
 * One run of the charging job ([LibraryMeasurements]): measures the files of [list] without a
 * result, in its order, one at a time ([measure]: null when the queue's measurements took the
 * meter, and the file is measured again), keeping each result as it's done ([kept] hears of it).
 * It ends when every file is done, when [stopped] says so (unplugged, Normalize Volume off,
 * Android stopping the job), or once its share of time ([budgetMs]) is up, so a run fits
 * Android's limits for a background job and the next one goes on from there.
 */
class ChargingRun(
  private val list: LibraryToMeasure,
  private val measure: (path: String, stop: () -> Boolean) -> FileLoudness.Outcome?,
  private val stopped: () -> Boolean,
  private val now: () -> Long,
  private val budgetMs: Long,
  private val kept: (LibraryResult) -> Unit = {},
) {
  enum class Ended { DONE, OUT_OF_TIME, STOPPED }

  /** What a run did: files measured, unmeasurable and not opened, and those [left] after it. */
  data class Summary(val measured: Int, val unmeasurable: Int, val unreadable: Int, val left: Int, val ended: Ended) {
    /** Whether the job runs again for what's left (a stopped one is rescheduled by Android). */
    val again: Boolean get() = ended == Ended.OUT_OF_TIME
  }

  fun run(): Summary {
    val startedAt = now()
    var measured = 0
    var unmeasurable = 0
    var unreadable = 0
    fun ended(how: Ended) = Summary(measured, unmeasurable, unreadable, list.left(), how)
    while (true) {
      if (stopped()) return ended(Ended.STOPPED)
      val song = list.next() ?: return ended(Ended.DONE)
      if (now() - startedAt >= budgetMs) return ended(Ended.OUT_OF_TIME)
      val outcome = measure(song.path, stopped) ?: continue
      val result = when (outcome) {
        is FileLoudness.Outcome.Measured -> {
          measured++
          list.record(song, LibraryResult.Kind.MEASURED, outcome.loudness, outcome.peak)
        }
        is FileLoudness.Outcome.Unmeasurable -> {
          unmeasurable++
          list.record(song, LibraryResult.Kind.UNMEASURABLE, 0.0, 0.0)
        }
        FileLoudness.Outcome.Unreadable -> {
          unreadable++
          list.record(song, LibraryResult.Kind.UNREADABLE, 0.0, 0.0)
        }
        FileLoudness.Outcome.Cancelled -> return ended(Ended.STOPPED)
      }
      kept(result)
    }
  }

  companion object {
    /**
     * The app log's line for a run, which never names a song: "Charging run measured 12 songs,
     * 1 unmeasurable; 340 left (time's up, going on in the next run)". [stopped] says why a
     * stopped run stopped.
     */
    fun line(summary: Summary, stopped: String? = null): String {
      val counts = buildList {
        add("measured ${summary.measured} song${if (summary.measured == 1) "" else "s"}")
        if (summary.unmeasurable > 0) add("${summary.unmeasurable} unmeasurable")
        if (summary.unreadable > 0) add("${summary.unreadable} unreadable")
      }
      val why = when (summary.ended) {
        Ended.DONE -> "nothing left to measure"
        Ended.OUT_OF_TIME -> "time's up, going on in the next run"
        Ended.STOPPED -> stopped ?: "stopped"
      }
      return "Charging run ${counts.joinToString(", ")}; ${summary.left} left ($why)"
    }
  }
}
