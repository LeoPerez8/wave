package expo.modules.wavenative.player

data class ReconnectWait(val key: String, val positionMs: Long, val expiresAtMs: Long)
data class ReconnectResult(val waiting: ReconnectWait?, val resume: ReconnectWait? = null)

/** Core's streamReconnect rule, kept free of Android and innertubex for JDK 17 tests. */
object StreamReconnectPolicy {
  fun failed(key: String?, positionMs: Long, streamed: Boolean, code: String?, playWhenReady: Boolean, nowMs: Long,
    previous: ReconnectWait? = null): ReconnectResult {
    if (key == null || !streamed || code != "ytOffline" || !playWhenReady) return ReconnectResult(null)
    if (previous?.key == key) return timeout(previous, nowMs)
    return ReconnectResult(ReconnectWait(key, positionMs, nowMs + 600_000))
  }

  fun connection(waiting: ReconnectWait?, key: String?, online: Boolean, nowMs: Long): ReconnectResult =
    when {
      waiting == null || key != waiting.key || nowMs >= waiting.expiresAtMs -> ReconnectResult(null)
      online -> ReconnectResult(null, waiting)
      else -> ReconnectResult(waiting)
    }

  fun timeout(waiting: ReconnectWait?, nowMs: Long): ReconnectResult =
    ReconnectResult(waiting?.takeIf { nowMs < it.expiresAtMs })
}
