package expo.modules.wavenative.player

/** Core's NetworkSignal, as the notification needs it. */
enum class NetworkSignal { PLAYING, OFFLINE, SLOW, BACK }

/**
 * Core's networkSignal rule (Ghost wave, #1498), kept free of Android for JDK 17
 * tests: the notification shows it with Wave's screen closed, where JS may not run.
 * Same inputs and answers as Core's public networkSignal tests.
 */
object NetworkSignalPolicy {
  /** Core's NETWORK_SLOW_GRACE_MS: an ordinary start never shows Slow. */
  const val SLOW_GRACE_MS = 1_500L

  /**
   * [loadingSinceMs]: when the player began buffering with play-when-ready, or null
   * while it isn't. [cutByNetwork]: the song stands on the offline stream error.
   */
  fun signal(waiting: Boolean, loadingSinceMs: Long?, cutByNetwork: Boolean, online: Boolean, nowMs: Long): NetworkSignal =
    when {
      waiting -> NetworkSignal.OFFLINE
      loadingSinceMs != null ->
        if (!cutByNetwork && nowMs - loadingSinceMs < SLOW_GRACE_MS) NetworkSignal.PLAYING
        else if (online) NetworkSignal.SLOW
        else NetworkSignal.OFFLINE
      cutByNetwork -> if (online) NetworkSignal.BACK else NetworkSignal.OFFLINE
      else -> NetworkSignal.PLAYING
    }

  /** In how many ms [signal] could answer differently with nothing else changing (the grace ending), or null. */
  fun recheckInMs(waiting: Boolean, loadingSinceMs: Long?, cutByNetwork: Boolean, nowMs: Long): Long? {
    if (waiting || loadingSinceMs == null || cutByNetwork) return null
    val left = SLOW_GRACE_MS - (nowMs - loadingSinceMs)
    return if (left > 0) left else null
  }

  /** The notification's sub text key (NativeText) for [signal]: "No internet" or "Slow connection". */
  fun subTextKey(signal: NetworkSignal): String? = when (signal) {
    NetworkSignal.OFFLINE -> "noInternet"
    NetworkSignal.SLOW -> "slowConnection"
    else -> null
  }
}
