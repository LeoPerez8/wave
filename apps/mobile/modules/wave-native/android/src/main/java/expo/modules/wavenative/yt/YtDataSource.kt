package expo.modules.wavenative.yt

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import expo.modules.wavenative.log.WaveLog
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
 *
 * A song's audio goes through the audio cache ([YtAudioCache], when
 * [audioCache] gives one): a song cached whole plays from it without asking
 * YouTube (offline too; YT Music still has to be on), one cached in part reads
 * what's there from it and the rest from googlevideo, which the cache keeps as
 * it plays. Each load reports, as it closes, how many bytes it read from the
 * network and how many from the cache ([onLoaded]; by default a line in the
 * app log, [YtAudioCache.loadLine]). Reading a `yt:` item to its end also
 * fills the cache, which is how audio is fetched ahead of playback on Wi-Fi
 * ([ahead], [PreDownloads]): a song only fetched ahead is marked so in the
 * cache, and the player's next load of it counts it as played
 * ([YtAudioCache.notePlayed]).
 */
@OptIn(UnstableApi::class)
class YtDataSource(
  private val upstream: DataSource,
  private val client: () -> YtClient,
  audioCache: () -> YtAudioCache? = { null },
  private val onLoaded: (videoId: String, networkBytes: Long, cacheBytes: Long) -> Unit = ::logLoad,
  /** Reads fetch audio ahead of playback (the Wi-Fi pre-download), not for the player. */
  private val ahead: Boolean = false,
) : DataSource {
  /** The `yt:` URI of the song open now, or null for anything else. */
  private var streamed: Uri? = null

  /** The video id of the song open now, or null for anything else. */
  private var videoId: String? = null

  /** What the song open now reads from: [upstream], [network] or [cached]. */
  private var current: DataSource = upstream

  /** The bytes the song open now has read, from the network or the cache. */
  private var bytesRead = 0L

  private val network = Network()

  private val audio: YtAudioCache? by lazy(LazyThreadSafetyMode.NONE) { audioCache() }

  /** One for the source's life, so after a cache failure the next loads keep off the cache. */
  private val cached: DataSource? by lazy(LazyThreadSafetyMode.NONE) { audio?.dataSource(network) }

  override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

  override fun open(dataSpec: DataSpec): Long {
    val videoId = YtMedia.videoIdOf(dataSpec.uri.toString())
    streamed = null
    this.videoId = null
    current = upstream
    bytesRead = 0
    network.bytesRead = 0
    if (videoId == null) return upstream.open(dataSpec)
    streamed = dataSpec.uri
    this.videoId = videoId
    val audio = audio
    val cached = cached
    if (audio == null || cached == null) {
      network.prepare(videoId, stream = null, key = null)
      current = network
      return network.open(dataSpec)
    }
    val whole = audio.wholeKey(videoId)
    if (whole != null && !client().enabled) throw YtStreamException(YtStreamFailure.DISABLED, null)
    val stream = if (whole == null) resolve(videoId) else null
    val aheadOnly = ahead && audio.aheadOnly(videoId)
    val key = whole ?: audio.keyFor(videoId, checkNotNull(stream))
    if (!ahead) audio.notePlayed(key) else if (aheadOnly) audio.markFetchedAhead(key)
    network.prepare(videoId, stream, key)
    current = cached
    return cached.open(dataSpec.buildUpon().setKey(key).build())
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    val read = current.read(buffer, offset, length)
    if (read > 0 && streamed != null) bytesRead += read
    return read
  }

  /** The song's own URI while streaming: the stream address is the session's. */
  override fun getUri(): Uri? = streamed ?: upstream.uri

  override fun getResponseHeaders(): Map<String, List<String>> = current.responseHeaders

  override fun close() {
    val videoId = videoId
    val total = bytesRead
    val fromNetwork = network.bytesRead
    streamed = null
    this.videoId = null
    try {
      current.close()
    } finally {
      current = upstream
      if (videoId != null && total > 0) onLoaded(videoId, fromNetwork, maxOf(0L, total - fromNetwork))
    }
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
    if (YtFailure.of(error, client().online()) == YtFailure.OFFLINE) {
      YtOfflineException(error)
    } else {
      IOException(YtStreamFailure.FAILED.message, error)
    }

  /**
   * The song's audio from googlevideo, over [upstream]: at the address
   * [prepare] gave, else one resolved now, and resolved again when googlevideo
   * rejects it. What it reads is what the load took from the network. Reading
   * for the cache under a key, an address for another format of the song (or
   * another file) drops what the cache had of it and fails the read, which
   * ExoPlayer tries again, keyed by the new format.
   */
  private inner class Network : DataSource {
    private var videoId = ""
    private var stream: YtStream? = null
    private var key: String? = null
    var bytesRead = 0L

    fun prepare(videoId: String, stream: YtStream?, key: String?) {
      this.videoId = videoId
      this.stream = stream
      this.key = key
    }

    override fun open(dataSpec: DataSpec): Long {
      var attempt = 0
      while (true) {
        val stream = this.stream ?: resolve(videoId).also { this.stream = it }
        val key = key
        if (key != null && audio?.keyFor(videoId, stream) != key) {
          this.key = null
          throw IOException(YtStreamFailure.FAILED.message + " (its audio changed format)")
        }
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
          this.stream = null
          attempt++
        } catch (e: IOException) {
          throw streamFailure(e)
        }
      }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
      val read = try {
        upstream.read(buffer, offset, length)
      } catch (e: IOException) {
        throw streamFailure(e)
      }
      if (read > 0) bytesRead += read
      return read
    }

    /** The song's own URI, so the cache never keeps a stream address. */
    override fun getUri(): Uri? = streamed

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() = upstream.close()

    /** [upstream] has the player's listeners already ([YtDataSource.addTransferListener]). */
    override fun addTransferListener(transferListener: TransferListener) = Unit
  }

  /** [audioCache] is asked on the loader thread, as opening the cache reads from disk. */
  class Factory(
    private val upstream: DataSource.Factory,
    private val audioCache: () -> YtAudioCache? = { null },
    private val client: () -> YtClient,
  ) : DataSource.Factory {
    override fun createDataSource(): DataSource = YtDataSource(upstream.createDataSource(), client, audioCache)
  }

  private companion object {
    fun logLoad(videoId: String, networkBytes: Long, cacheBytes: Long) =
      WaveLog.i(YtAudioCache.LOG_TAG, YtAudioCache.loadLine(videoId, networkBytes, cacheBytes))
  }
}
