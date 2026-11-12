package expo.modules.wavenative.player

data class ReconnectWait(val key: String, val positionMs: Long, val expiresAtMs: Long)

/** [gaveUp]: the wait ended with nobody ending it; the service stops if Wave was swiped away meanwhile. */
data class ReconnectResult(val waiting: ReconnectWait?, val resume: ReconnectWait? = null, val gaveUp: Boolean = false)

/** Core's streamReconnect rule, kept free of Android and innertubex for JDK 17 tests. */
object StreamReconnectPolicy {
  fun failed(key: String?, positionMs: Long, streamed: Boolean, code: String?, playWhenReady: Boolean, nowMs: Long,
    previous: ReconnectWait? = null): ReconnectResult {
    val same = previous != null && previous.key == key
    if (key == null || !streamed || code != "ytOffline" || !playWhenReady) return ReconnectResult(null, gaveUp = same)
    if (same) return timeout(previous, nowMs)
    return ReconnectResult(ReconnectWait(key, positionMs, nowMs + 600_000))
  }

  /** [otherAudio]: another app is playing right now, so a resume would take it over. */
  fun connection(waiting: ReconnectWait?, key: String?, online: Boolean, nowMs: Long,
    otherAudio: Boolean = false): ReconnectResult =
    when {
      waiting == null || key != waiting.key -> ReconnectResult(null)
      nowMs >= waiting.expiresAtMs -> ReconnectResult(null, gaveUp = true)
      online -> if (otherAudio) ReconnectResult(null, gaveUp = true) else ReconnectResult(null, waiting)
      else -> ReconnectResult(waiting)
    }

  /**
   * Whether what other apps play now is music a resume would take over: Android's media (1),
   * game (14) and unknown (0) usages. Navigation prompts, notifications and calls are not.
   */
  fun otherAudio(usages: List<Int>): Boolean = usages.any { it == 1 || it == 14 || it == 0 }

  /**
   * Whether the removed outputs ([android.media.AudioDeviceInfo] types) include one music
   * plays on instead of the phone's speaker: wired headsets and headphones (3, 4), line outs
   * (5, 6, 19), Bluetooth A2DP (8), HDMI (9), USB (11, 12, 22), docks (13, 31), hearing aids
   * (23) and Bluetooth LE audio (26, 27, 30). The speaker, earpiece and call routes are not.
   */
  fun outputGone(removedTypes: List<Int>): Boolean = removedTypes.any { it in PRIVATE_OUTPUTS }

  private val PRIVATE_OUTPUTS = setOf(3, 4, 5, 6, 8, 9, 11, 12, 13, 19, 22, 23, 26, 27, 30, 31)

  /** The audio output went away (headphones unplugged, Bluetooth disconnected). */
  fun outputLost(waiting: ReconnectWait?): ReconnectResult = ReconnectResult(null, gaveUp = waiting != null)

  fun timeout(waiting: ReconnectWait?, nowMs: Long): ReconnectResult =
    if (waiting == null || nowMs < waiting.expiresAtMs) ReconnectResult(waiting) else ReconnectResult(null, gaveUp = true)
}
