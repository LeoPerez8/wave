package expo.modules.wavenative.log

import java.util.Locale

/** How app log lines write a duration, a size and a speed. */
object LogUnits {
  /** "30 s", "42 min 5 s", "6 h 2 min", "6 h": as Core's `logDuration`. */
  fun duration(ms: Long): String {
    val seconds = Math.round(ms / 1000.0)
    if (seconds < 60) return "$seconds s"
    val minutes = seconds / 60
    if (minutes < 60) return if (seconds % 60 == 0L) "$minutes min" else "$minutes min ${seconds % 60} s"
    val hours = minutes / 60
    return if (minutes % 60 == 0L) "$hours h" else "$hours h ${minutes % 60} min"
  }

  /** "640 KB", "3.6 MB" (decimal units, as a speed's). */
  fun size(bytes: Long): String =
    if (bytes < 1_000_000) "${Math.round(bytes / 1000.0)} KB" else String.format(Locale.ROOT, "%.1f MB", bytes / 1_000_000.0)

  /** "30 KB/s": [bytes] over [ms]; "no time" when no time passed. */
  fun speed(bytes: Long, ms: Long): String = if (ms <= 0) "no time" else "${Math.round(bytes.toDouble() / ms)} KB/s"

  /** "3.6 MB in 2 min (30 KB/s)": what a transfer received and how long it took. */
  fun transfer(bytes: Long, ms: Long): String = "${size(bytes)} in ${duration(ms)} (${speed(bytes, ms)})"
}
