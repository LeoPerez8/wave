package expo.modules.wavenative.download

import expo.modules.wavenative.log.LogUnits

/**
 * What writing the download journal cost over [spanMs]: how many writes, how many of them were
 * whole (a new snapshot, [DurableDownloads]' compaction), the bytes written and the time spent
 * writing. The download service logs it about once a minute.
 */
data class JournalWrites(val writes: Int, val whole: Int, val bytes: Long, val writingMs: Long, val spanMs: Long) {
  fun line(): String {
    val whole = if (whole > 0) " ($whole whole)" else ""
    return "The download journal wrote ${writes}${if (writes == 1) " time" else " times"}$whole in ${LogUnits.duration(spanMs)}: " +
      "${LogUnits.size(bytes)} in $writingMs ms"
  }
}
