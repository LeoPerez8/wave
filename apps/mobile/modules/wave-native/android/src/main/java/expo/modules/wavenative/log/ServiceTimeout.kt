package expo.modules.wavenative.log

/**
 * The app log's line for Android ending a foreground service on its time limit (Android 15+
 * limits how long data-sync services run, `Service.onTimeout`), with how long it ran.
 */
object ServiceTimeout {
  fun line(service: String, ranMs: Long): String = "Android ended $service on its time limit after ${LogUnits.duration(ranMs)}"
}
