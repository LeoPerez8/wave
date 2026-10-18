package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * One player request innertubex's extractor sent while looking up a song's stream, as YouTube
 * answered it: the player [client] it went out as, the [httpStatus] (null when no answer came:
 * then [error] names the exception), the answer's playability [status] and [reason], whether it
 * carried a proof-of-origin token, and how long it took. Only these are kept: never the token,
 * cookies or visitor data the request and answer carry.
 */
data class YtPlayerAttempt(
  val client: String,
  val httpStatus: Int?,
  val status: String?,
  val reason: String?,
  val poToken: Boolean,
  val elapsedMs: Long,
  val error: String? = null,
) {
  companion object {
    private val json = Json { ignoreUnknownKeys = true }

    /** The song a player request (its JSON body) asks for; null when it isn't one. */
    fun videoIdOf(requestBody: String): String? = parse(requestBody)?.string("videoId")

    /** The attempt of [requestBody], answered with [httpStatus] and [responseBody] after [elapsedMs]. */
    fun answered(requestBody: String, httpStatus: Int, responseBody: String?, elapsedMs: Long): YtPlayerAttempt {
      val playability = responseBody?.let(::parse)?.get("playabilityStatus") as? JsonObject
      return sent(requestBody).copy(
        httpStatus = httpStatus,
        status = playability?.string("status"),
        reason = playability?.string("reason"),
        elapsedMs = elapsedMs,
      )
    }

    /** The attempt of [requestBody] that got no answer, failing with [error] after [elapsedMs]. */
    fun unanswered(requestBody: String, error: Throwable, elapsedMs: Long): YtPlayerAttempt =
      sent(requestBody).copy(elapsedMs = elapsedMs, error = error.javaClass.simpleName)

    private fun sent(requestBody: String): YtPlayerAttempt {
      val request = parse(requestBody)
      val client = ((request?.get("context") as? JsonObject)?.get("client") as? JsonObject)?.string("clientName")
      val token = (request?.get("serviceIntegrityDimensions") as? JsonObject)?.string("poToken")
      return YtPlayerAttempt(client ?: "unknown client", null, null, null, !token.isNullOrBlank(), 0)
    }

    private fun parse(text: String): JsonObject? =
      runCatching { json.parseToJsonElement(text) }.getOrNull() as? JsonObject

    private fun JsonObject.string(key: String): String? =
      (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content
  }
}

/**
 * The player requests sent for the songs being looked up right now, so a lookup that fails can
 * log each client's answer ([YtLookupLog]). Requests for a song nobody [watch]es are dropped, and
 * a song keeps at most [maxPerSong]. Two lookups of one song at once (playback and a download)
 * share what's collected until both are done. Thread-safe.
 */
class YtLookupAttempts(private val maxPerSong: Int = 24) {
  private class Watched(var watchers: Int, val attempts: MutableList<YtPlayerAttempt> = mutableListOf())

  private val songs = HashMap<String, Watched>()

  /** Starts collecting [videoId]'s requests. Each call needs its [take]. */
  @Synchronized
  fun watch(videoId: String) {
    songs.getOrPut(videoId) { Watched(0) }.watchers++
  }

  /** Keeps [attempt], when [videoId] is being looked up. */
  @Synchronized
  fun record(videoId: String, attempt: YtPlayerAttempt) {
    val song = songs[videoId] ?: return
    if (song.attempts.size < maxPerSong) song.attempts += attempt
  }

  /** What was collected for [videoId] so far; stops collecting once every [watch] is taken. */
  @Synchronized
  fun take(videoId: String): List<YtPlayerAttempt> {
    val song = songs[videoId] ?: return emptyList()
    if (--song.watchers <= 0) songs.remove(videoId)
    return song.attempts.toList()
  }
}

/** The app log's line for a stream lookup that failed (docs/spec.md, YT Music, Streaming). */
object YtLookupLog {
  private const val MAX_REASON = 160

  /**
   * One line for [videoId]'s failed lookup: the [failure] as Wave names it (offline, unavailable,
   * failed) and innertubex's [reason] when it gave one, how long it took, then each player
   * request's answer: client, HTTP status, playability status and reason, PO-token use and time.
   * When no player request was seen (the extractor gave up before one, or answered from a
   * cache), innertubex's own per-client [extractorOutcomes] go instead.
   */
  fun failedLine(
    videoId: String,
    failure: String,
    reason: String?,
    elapsedMs: Long,
    attempts: List<YtPlayerAttempt>,
    extractorOutcomes: List<String>,
  ): String {
    val why = listOfNotNull(failure, reason).joinToString(", ")
    val head = "Stream lookup for video $videoId failed ($why) in $elapsedMs ms: "
    if (attempts.isNotEmpty()) return head + attempts.joinToString("; ", transform = ::describe)
    val seen = "no player answer seen"
    if (extractorOutcomes.isEmpty()) return head + seen
    return head + seen + "; extractor: " + extractorOutcomes.joinToString("; ")
  }

  private fun describe(attempt: YtPlayerAttempt): String {
    val answer = if (attempt.httpStatus == null) {
      "no answer (${attempt.error ?: "unknown"})"
    } else {
      listOfNotNull("HTTP ${attempt.httpStatus}", attempt.status, attempt.reason?.let { "\"${oneLine(it)}\"" }).joinToString(" ")
    }
    val po = if (attempt.poToken) "with PO" else "without PO"
    return "${attempt.client} $answer $po, ${attempt.elapsedMs} ms"
  }

  /** A reason as one short line, its double quotes made single so the line's own quoting holds. */
  private fun oneLine(text: String): String {
    val flat = text.replace(Regex("\\s+"), " ").replace('"', '\'').trim()
    return if (flat.length <= MAX_REASON) flat else flat.take(MAX_REASON - 1) + "…"
  }
}
