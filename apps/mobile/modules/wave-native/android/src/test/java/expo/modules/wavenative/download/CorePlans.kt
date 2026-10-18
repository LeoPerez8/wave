package expo.modules.wavenative.download

/**
 * Core's `downloadFailurePlan` (packages/core/src/downloadSource.ts) as JS's prepare answer
 * carries it, for the journal tests. Keep in step with Core.
 */
object CorePlans {
  private val ENDS = listOf("account", "accountRejected", "unreachable", "storage", "noFolder", "noSource", "ytUnavailable")
  private val FALLS_BACK = listOf("unavailable", "accountRejected", "account", "unreachable", "timedOut")

  val youtube: Map<String, Any?> = mapOf(
    "retry" to listOf("offline"), "end" to ENDS, "exhausted" to "failed", "rejected" to "ytUnavailable", "fallsBack" to emptyList<String>(),
    "refused" to mapOf("failure" to "ytRefused", "pausesMs" to listOf(30_000L, 90_000L, 240_000L), "exhausted" to "ytUnavailable"),
  )

  fun soulseek(ytMusicOn: Boolean): Map<String, Any?> = mapOf(
    "retry" to if (ytMusicOn) listOf("offline") else listOf("offline", "unreachable"),
    "end" to ENDS, "exhausted" to "unavailable", "rejected" to null,
    "fallsBack" to if (ytMusicOn) FALLS_BACK else emptyList(), "refused" to null,
  )
}
