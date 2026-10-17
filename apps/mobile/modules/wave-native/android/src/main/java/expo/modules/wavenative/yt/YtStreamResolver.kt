package expo.modules.wavenative.yt

import android.content.Context
import com.metrolist.innertubex.cipher.YouTubeCipherService
import com.metrolist.innertubex.extraction.AudioQuality
import com.metrolist.innertubex.extraction.ContentHints
import com.metrolist.innertubex.extraction.InnerTubeExtractor
import com.metrolist.innertubex.extraction.StreamResolveException
import com.metrolist.innertubex.extraction.YtConfigParser
import com.metrolist.innertubex.extraction.YtConfigParserImpl
import expo.modules.wavenative.yt.potoken.YtPoTokens

/**
 * A YT Music song's audio as googlevideo serves it: fetch [url] sending
 * [headers]. The address stops working at [expiresAtMs] (or sooner, when
 * googlevideo answers 403/410: see [YtStreamResolver.reject]). Never log it:
 * the address and headers are the session's.
 */
data class YtStream(
  val url: String,
  val headers: Map<String, String>,
  /** With its codecs, as `audio/webm; codecs="opus"`. */
  val mimeType: String,
  val itag: Int,
  /** Bits per second; 0 when YouTube doesn't say. */
  val bitrate: Int,
  val contentLength: Long?,
  val expiresAtMs: Long,
  /** What YouTube's answer said about the video; logged with each download. */
  val source: YtStreamSource = YtStreamSource.UNKNOWN,
) {
  override fun toString(): String = "YtStream(itag=$itag, mimeType=$mimeType, bitrate=$bitrate, source=$source)"
}

/**
 * The video a [YtStream] is the audio of, as YouTube's answer described it: its id, the
 * player client that answered, its type (`MUSIC_VIDEO_TYPE_ATV` for a song's audio track,
 * `…_OMV` for its music video, `…_UGC` for an upload; only some clients say) and its length.
 * Null where the answer didn't say.
 */
data class YtStreamSource(
  val videoId: String?,
  val client: String?,
  val videoType: String?,
  val lengthMs: Long?,
) {
  companion object {
    val UNKNOWN = YtStreamSource(null, null, null, null)
  }
}

/**
 * Turns a YT Music song into a stream address, for playback ([YtDataSource])
 * and downloads. innertubex's extractor does the work: it picks the player
 * client (falling back from one to the next), solves the signature and `n`
 * ciphers, and asks for the proof-of-origin token the web client needs, which
 * Wave mints in a hidden web view as Metrolist does ([YtPoTokens]). Only
 * audio with a plain address is taken (no HLS, no SABR, no ranged-only
 * clients), and nothing YouTube serves as an ad is ever requested.
 *
 * Addresses are cached until shortly before they expire ([YtStreamCache]), so
 * the player loading ahead, seeking and replaying don't ask again; one
 * googlevideo rejects is dropped with [reject] and resolved afresh. Requests
 * go through [YtClient.request]: refused while YT Music is off, failing as a
 * [YtException] (see [failureOf]).
 *
 * Get it with `YtClient.get(context).streams`.
 */
class YtStreamResolver(context: Context) {
  private val client = YtClient.get(context)
  private val cache = YtStreamCache()
  private val visitorData = YtVisitorData(context)
  private val poTokens = YtPoTokens(context)

  private val extractor: InnerTubeExtractor by lazy {
    val cipher = YouTubeCipherService(client.http)
    InnerTubeExtractor(
      configParser = YtConfigParserImpl(client.http, client.innerTube, cipherService = cipher).withEmbeddedFallback(),
      cipherService = cipher,
      innerTube = client.innerTube,
      tokenProvider = poTokens,
    )
  }

  /**
   * The stream for [videoId]. [preferM4a] takes the best AAC in M4A (itag 141
   * with Premium, else 140), for downloads; otherwise the best audio YouTube
   * serves the account. Throws [YtException] when it can't.
   */
  suspend fun resolve(videoId: String, preferM4a: Boolean = false): YtStream {
    cache.get(videoId, preferM4a, now())?.let { return it }
    return client.request {
      visitorData.restoreInto(client.innerTube)
      val stream = extract(videoId, preferM4a)
      visitorData.saveFrom(client.innerTube)
      stream
    }
  }

  /**
   * googlevideo turned down [videoId]'s address (403/410): forgets it, and
   * skips the client it came from for that song for a few minutes.
   */
  fun reject(videoId: String) = cache.reject(videoId, now())

  private suspend fun extract(videoId: String, preferM4a: Boolean): YtStream {
    val hints = ContentHints().withStreamCapabilities(allowHls = false, allowSabr = false, allowBoundedRange = false)
    val extracted = extractor.extract(
      videoId,
      hints,
      excludedClients = cache.excludedClients(videoId, now()),
      audioQuality = AudioQuality.valueOf(YtStreams.audioQuality(preferM4a)),
    ) ?: throw StreamResolveException(StreamResolveException.Reason.NO_PLAYABLE_STREAM, "No stream")
    val mimeType = extracted.mimeType
    if (extracted.sabrBootstrap != null || mimeType == null || !YtStreams.fits(mimeType, preferM4a)) {
      throw StreamResolveException(StreamResolveException.Reason.NO_PLAYABLE_STREAM, "No fitting audio stream")
    }
    val stream = YtStream(
      url = extracted.audioUrl,
      headers = extracted.headers,
      mimeType = YtStreams.mimeType(mimeType, extracted.codecs),
      itag = extracted.itag,
      bitrate = extracted.bitrate ?: 0,
      contentLength = extracted.contentLengthBytes,
      expiresAtMs = YtStreams.expiresAtMs(extracted.expiresAt?.toEpochMilliseconds(), extracted.audioUrl, now()),
      source = YtStreamSource(
        videoId = extracted.videoId,
        client = extracted.clientName,
        videoType = extracted.mediaMetadata?.musicVideoType,
        lengthMs = extracted.mediaMetadata?.durationSeconds?.let { it * 1000 },
      ),
    )
    cache.put(videoId, preferM4a, stream, extracted.clientName)
    return stream
  }

  private fun now() = System.currentTimeMillis()

  companion object {
    /** Why [error] (from [resolve]) means the song can't stream: offline, off, unavailable or failed. */
    fun failureOf(error: YtException): YtStreamFailure {
      val reason = generateSequence(error as Throwable) { it.cause }
        .filterIsInstance<StreamResolveException>()
        .firstOrNull()
        ?.reason
        ?.name
      return YtStreamFailure.of(error.failure, reason)
    }

    /**
     * Some songs have no watch page config innertubex can read; the embed
     * page's works for those (as Metrolist does).
     */
    private fun YtConfigParser.withEmbeddedFallback(): YtConfigParser =
      object : YtConfigParser by this {
        override suspend fun fetchConfig(videoId: String, useLoginCookies: Boolean) =
          try {
            this@withEmbeddedFallback.fetchConfig(videoId, useLoginCookies)
          } catch (_: IllegalStateException) {
            this@withEmbeddedFallback.fetchEmbeddedConfig(videoId, useLoginCookies = false)
          }
      }
  }
}
