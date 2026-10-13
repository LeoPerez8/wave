package expo.modules.wavenative.yt

import android.content.Context
import com.metrolist.innertubex.cipher.YouTubeCipherService
import com.metrolist.innertubex.extraction.AudioQuality
import com.metrolist.innertubex.extraction.ContentHints
import com.metrolist.innertubex.extraction.InnerTubeExtractor
import com.metrolist.innertubex.extraction.YtConfigParserImpl
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** A song's audio stream: where to fetch it, with which headers, and until when. */
data class YtStream(
  val url: String,
  val headers: Map<String, String>,
  val mimeType: String,
  val itag: Int,
  val bitrate: Int,
  val contentLength: Long?,
  val expiresAtMs: Long,
)

/**
 * Finds a YT Music song's audio stream (owned by #109, which replaces this
 * file). A minimal stand-in with the same contract, so downloads (#110) build
 * meanwhile: innertubex's extractor over the shared session, direct streams
 * only, the best one YouTube serves the account ([preferM4a]: the best M4A).
 */
class YtStreamResolver(context: Context) {
  private val client = YtClient.get(context)

  suspend fun resolve(videoId: String, preferM4a: Boolean = false): YtStream {
    val stream = extractor.extract(
      videoId,
      hints = ContentHints().withStreamCapabilities(allowHls = false, allowSabr = false, allowBoundedRange = false),
      audioQuality = if (preferM4a) AudioQuality.MP4 else AudioQuality.HIGH,
    ) ?: throw IllegalStateException("No stream for $videoId")
    return YtStream(
      url = stream.audioUrl,
      headers = stream.headers,
      mimeType = stream.mimeType ?: "",
      itag = stream.itag,
      bitrate = stream.bitrate ?: 0,
      contentLength = stream.contentLengthBytes,
      expiresAtMs = stream.expiresAt?.toEpochMilliseconds() ?: (System.currentTimeMillis() + DEFAULT_LIFETIME_MS),
    )
  }

  private val extractor: InnerTubeExtractor by lazy {
    val cipher = YouTubeCipherService(http)
    InnerTubeExtractor(
      configParser = YtConfigParserImpl(http, client.innerTube, cipherService = cipher),
      cipherService = cipher,
      innerTube = client.innerTube,
    )
  }

  private companion object {
    const val DEFAULT_LIFETIME_MS = 5 * 60_000L

    /** innertubex sends `@Serializable` bodies; its own requests go through [YtClient]'s session. */
    val http: HttpClient by lazy {
      HttpClient(OkHttp) {
        expectSuccess = false
        install(ContentNegotiation) {
          json(Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true })
        }
        install(HttpTimeout) {
          requestTimeoutMillis = 30_000
          connectTimeoutMillis = 10_000
          socketTimeoutMillis = 30_000
        }
      }
    }
  }
}
