package expo.modules.wavenative.yt

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import java.io.FileNotFoundException
import java.io.IOException
import kotlinx.coroutines.runBlocking

/**
 * A YT Music song couldn't stream, for a reason that won't go away by trying
 * again now (YT Music off, a song YouTube won't serve, a failure): the player
 * stops on it at once. Its message carries the [YtStreamFailure] code to JS.
 * (A [FileNotFoundException], so ExoPlayer doesn't retry the load.)
 */
class YtStreamException(message: String?) : FileNotFoundException(message) {
  constructor(failure: YtStreamFailure, cause: Throwable?) : this(failure.message) {
    cause?.let(::initCause)
  }
}

/**
 * A YT Music song couldn't stream for want of a network: ExoPlayer retries
 * the load a few times, then stops with the message ([YtStreamFailure.OFFLINE]).
 */
class YtOfflineException(message: String?) : IOException(message) {
  constructor(cause: Throwable?) : this(YtStreamFailure.OFFLINE.message) {
    cause?.let(::initCause)
  }
}

/**
 * The player's data source: Library files and anything else go to [upstream]
 * as they are; a YT Music song (`yt:<videoId>`, see [YtMedia]) is resolved to
 * its stream address when the player loads it, so an address is always fresh
 * at play time, also mid-queue and after a cold start. An address googlevideo
 * rejects (403/410: expired, or its client turned down) is resolved again,
 * twice at most, before the song fails. Failures carry their reason
 * ([YtStreamFailure]) for JS. Resolution blocks the loader thread, which
 * ExoPlayer allows.
 */
@OptIn(UnstableApi::class)
class YtDataSource(
  private val upstream: DataSource,
  private val client: () -> YtClient,
) : DataSource {
  /** The `yt:` URI of the song open now, or null for anything else. */
  private var streamed: Uri? = null

  override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

  override fun open(dataSpec: DataSpec): Long {
    val videoId = YtMedia.videoIdOf(dataSpec.uri.toString())
    streamed = null
    if (videoId == null) return upstream.open(dataSpec)
    streamed = dataSpec.uri
    var attempt = 0
    while (true) {
      val stream = resolve(videoId)
      val spec = dataSpec.buildUpon()
        .setUri(Uri.parse(stream.url))
        .setHttpRequestHeaders(dataSpec.httpRequestHeaders + stream.headers)
        .build()
      try {
        return upstream.open(spec)
      } catch (e: HttpDataSource.InvalidResponseCodeException) {
        upstream.close()
        if (!YtStreams.resolveAgain(e.responseCode, attempt)) throw YtStreamException(YtStreamFailure.FAILED, e)
        client().streams.reject(videoId)
        attempt++
      } catch (e: IOException) {
        throw streamFailure(e)
      }
    }
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
    if (streamed == null) {
      upstream.read(buffer, offset, length)
    } else {
      try {
        upstream.read(buffer, offset, length)
      } catch (e: IOException) {
        throw streamFailure(e)
      }
    }

  /** The song's own URI while streaming: the stream address is the session's. */
  override fun getUri(): Uri? = streamed ?: upstream.uri

  override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

  override fun close() {
    streamed = null
    upstream.close()
  }

  private fun resolve(videoId: String): YtStream =
    try {
      runBlocking { client().streams.resolve(videoId) }
    } catch (e: YtException) {
      when (val failure = YtStreamResolver.failureOf(e)) {
        YtStreamFailure.OFFLINE -> throw YtOfflineException(e)
        else -> throw YtStreamException(failure, e)
      }
    }

  /**
   * The connection to googlevideo failed: the network dropped, or something
   * else went wrong on the way. Either way ExoPlayer tries again a few times,
   * from where it got to, before the song stops.
   */
  private fun streamFailure(error: IOException): IOException =
    if (YtFailure.of(error, client().hasNetwork()) == YtFailure.OFFLINE) {
      YtOfflineException(error)
    } else {
      IOException(YtStreamFailure.FAILED.message, error)
    }

  class Factory(
    private val upstream: DataSource.Factory,
    private val client: () -> YtClient,
  ) : DataSource.Factory {
    override fun createDataSource(): DataSource = YtDataSource(upstream.createDataSource(), client)
  }
}
