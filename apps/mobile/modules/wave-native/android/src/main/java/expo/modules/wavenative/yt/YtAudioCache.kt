package expo.modules.wavenative.yt

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.FileDataSource
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSink
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheEvictor
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import expo.modules.wavenative.log.WaveLog
import java.io.File
import java.util.Locale

/**
 * The audio of the YT Music songs the player streams, kept on the phone so
 * replaying or seeking back doesn't download it again (docs/spec.md, YT
 * Music, Streaming): 1 GB at most, the least recently played out first
 * ([evictor]). A song's bytes are keyed by its video id and format (itag),
 * not by the stream address, so a fresh address finds them, and a song
 * cached whole plays without asking YouTube at all ([wholeKey]). It isn't a
 * Library download: the star's M4A downloads go their own way.
 *
 * [YtDataSource] reads through it ([dataSource]) and tells the bytes it read
 * from the network from those it read from the cache ([loadLine]).
 */
@OptIn(UnstableApi::class)
class YtAudioCache(val cache: Cache) {
  /** The key [videoId]'s audio is cached under when it's all there: it plays without asking YouTube. */
  fun wholeKey(videoId: String): String? =
    keysOf(videoId).firstOrNull { key ->
      val length = lengthOf(key)
      length != null && cache.isCached(key, 0, length)
    }

  /**
   * The key [stream]'s audio is cached under: the song and its format, whatever
   * the address, so what an earlier play left (a part or all of it) is read
   * from the cache. The song's bytes in another format, or in this one at
   * another length (another file), leave the cache: they'd never play again.
   */
  fun keyFor(videoId: String, stream: YtStream): String {
    val key = prefix(videoId) + stream.itag
    for (cached in keysOf(videoId)) {
      val length = lengthOf(cached)
      val sameFile = cached == key && (stream.contentLength == null || length == null || length == stream.contentLength)
      if (!sameFile) forget(cached)
    }
    return key
  }

  /** Drops [key]'s bytes. */
  fun forget(key: String) {
    try {
      cache.removeResource(key)
    } catch (_: RuntimeException) {
      // Its files went already; the index follows on the next start.
    }
  }

  private fun keysOf(videoId: String): List<String> = cache.keys.filter { it.startsWith(prefix(videoId)) }

  private fun lengthOf(key: String): Long? =
    ContentMetadata.getContentLength(cache.getContentMetadata(key)).takeIf { it != C.LENGTH_UNSET.toLong() }

  /**
   * Reads a song's audio (a [DataSpec.key] from [wholeKey] or [keyFor])
   * through the cache: what's cached comes from it, the rest from [network]
   * (googlevideo), written to the cache as it's read, partial bytes included.
   * While another player reads the same song (a crossfade into it), the
   * overlap reads from the network. After a cache failure, its reads bypass
   * the cache.
   */
  fun dataSource(network: DataSource): CacheDataSource =
    CacheDataSource(
      cache,
      network,
      FileDataSource(),
      CacheDataSink(cache, CacheDataSink.DEFAULT_FRAGMENT_SIZE),
      CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR,
      null,
    )

  companion object {
    /** 1 GB, as Android counts storage. */
    const val MAX_BYTES = 1_000_000_000L

    /** Under the app's cache folder, so clearing Wave's storage (or its cache) clears it. */
    private const val FOLDER = "yt-audio"

    /** What leaves the cache for new audio: the least recently played, beyond [maxBytes]. */
    fun evictor(maxBytes: Long = MAX_BYTES): CacheEvictor = LeastRecentlyUsedCacheEvictor(maxBytes)

    @Volatile private var shared: YtAudioCache? = null

    @Volatile private var failed = false

    /**
     * The process-wide cache (one Media3 cache per folder and process), opened
     * on first use, which reads its index from disk: not on the main thread.
     * Null when it can't open: songs then stream as they did before it.
     */
    fun get(context: Context): YtAudioCache? {
      shared?.let { return it }
      if (failed) return null
      return synchronized(this) {
        shared ?: try {
          val app = context.applicationContext ?: context
          YtAudioCache(SimpleCache(File(app.cacheDir, FOLDER), evictor(), StandaloneDatabaseProvider(app))).also { shared = it }
        } catch (e: RuntimeException) {
          failed = true
          WaveLog.w(LOG_TAG, "The audio cache couldn't open; songs stream without it", e)
          null
        }
      }
    }

    /**
     * The app log line a streamed song's load writes when it ends: how much of
     * its audio came from the network and how much from the cache, in MB.
     */
    fun loadLine(videoId: String, networkBytes: Long, cacheBytes: Long): String =
      "Streamed $videoId: ${mb(networkBytes)} MB from the network, ${mb(cacheBytes)} MB from the cache"

    const val LOG_TAG = "WaveYtAudio"

    private fun mb(bytes: Long) = String.format(Locale.ROOT, "%.1f", bytes / 1_000_000.0)

    private fun prefix(videoId: String) = YtMedia.uriOf(videoId) + ":"
  }
}
