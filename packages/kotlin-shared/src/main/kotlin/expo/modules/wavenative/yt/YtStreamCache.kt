package expo.modules.wavenative.yt

/**
 * The stream addresses resolved lately, so seeking, replaying and the player
 * loading ahead don't ask YouTube again. An address is reused until shortly
 * before it expires; one googlevideo rejected is dropped, and the client it
 * came from is skipped for that song for a few minutes (as Metrolist does), so
 * the next resolution tries another. Thread-safe.
 */
class YtStreamCache(private val capacity: Int = 64) {
  private class Entry(val stream: YtStream, val client: String)

  private class Failed(val clients: Set<String>, val atMs: Long)

  private val streams = object : LinkedHashMap<String, Entry>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>?): Boolean = size > capacity
  }
  private val failed = HashMap<String, Failed>()

  private fun key(videoId: String, preferM4a: Boolean) = "$videoId/$preferM4a"

  /** The cached stream, while it has more than a few minutes left at [nowMs]. */
  @Synchronized
  fun get(videoId: String, preferM4a: Boolean, nowMs: Long): YtStream? {
    val entry = streams[key(videoId, preferM4a)] ?: return null
    return entry.stream.takeIf { it.expiresAtMs - EXPIRY_MARGIN_MS > nowMs }
  }

  /** Keeps [stream], resolved through innertubex's [client]. */
  @Synchronized
  fun put(videoId: String, preferM4a: Boolean, stream: YtStream, client: String) {
    streams[key(videoId, preferM4a)] = Entry(stream, client)
  }

  /** googlevideo rejected [videoId]'s address: drops it and skips its client for a while. */
  @Synchronized
  fun reject(videoId: String, nowMs: Long) {
    val clients = listOf(false, true).mapNotNull { streams.remove(key(videoId, it))?.client }
    if (clients.isEmpty()) return
    val before = excludedClients(videoId, nowMs)
    failed[videoId] = Failed(before + clients, nowMs)
  }

  /** The clients that failed [videoId] in the last few minutes, for innertubex to skip. */
  @Synchronized
  fun excludedClients(videoId: String, nowMs: Long): Set<String> {
    val entry = failed[videoId] ?: return emptySet()
    if (nowMs - entry.atMs >= CLIENT_FAILURE_MS) {
      failed.remove(videoId)
      return emptySet()
    }
    return entry.clients
  }

  private companion object {
    /** An address this close to expiring may not last a song (plus pauses): resolved again. */
    const val EXPIRY_MARGIN_MS = 10 * 60_000L

    const val CLIENT_FAILURE_MS = 5 * 60_000L
  }
}
