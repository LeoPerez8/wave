package expo.modules.wavenative.log

/**
 * The app log's line for Android ending a foreground service on its time limit (Android 15+
 * limits how long data-sync services run, `Service.onTimeout`), with how long it ran.
 */
object ServiceTimeout {
  fun line(service: String, ranMs: Long): String = "Android ended $service on its time limit after ${duration(ranMs)}"

  /** "30 s", "42 min 5 s", "6 h 2 min", "6 h": as Core's `logDuration`. */
  private fun duration(ms: Long): String {
    val seconds = Math.round(ms / 1000.0)
    if (seconds < 60) return "$seconds s"
    val minutes = seconds / 60
    if (minutes < 60) return if (seconds % 60 == 0L) "$minutes min" else "$minutes min ${seconds % 60} s"
    val hours = minutes / 60
    return if (minutes % 60 == 0L) "$hours h" else "$hours h ${minutes % 60} min"
  }
}
