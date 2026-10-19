package expo.modules.wavenative.yt

import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.ContentMetadataMutations
import androidx.media3.datasource.cache.SimpleCache
import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class YtAudioCacheTest {
  private val dir: File = Files.createTempDirectory("yt-audio").toFile()
  private var opened: SimpleCache? = null

  @After
  fun tearDown() {
    opened?.release()
    dir.deleteRecursively()
  }

  /** A real Media3 cache on disk, as the player's, holding at most [maxBytes]. */
  @Suppress("DEPRECATION")
  private fun audioCache(maxBytes: Long = YtAudioCache.MAX_BYTES): YtAudioCache {
    val cache = SimpleCache(dir, YtAudioCache.evictor(maxBytes))
    // The JVM's android.os.ConditionVariable doesn't wait: wait for the cache's own start.
    Thread.getAllStackTraces().keys.filter { it.name == "ExoPlayer:SimpleCacheInit" }.forEach { it.join() }
    opened = cache
    return YtAudioCache(cache)
  }

  private fun stream(itag: Int, length: Long?, url: String = "https://rr1---sn.googlevideo.com/videoplayback?itag=$itag") =
    YtStream(
      url = url,
      headers = emptyMap(),
      mimeType = "audio/webm; codecs=\"opus\"",
      itag = itag,
      bitrate = 160_000,
      contentLength = length,
      expiresAtMs = 0,
    )

  /** What playing [length] bytes of a song from [from] leaves in the cache under [key], as the player's reads write it. */
  private fun Cache.played(key: String, length: Long, songLength: Long, from: Long = 0) {
    val hole = startReadWrite(key, from, length)
    val file = startFile(key, from, length)
    file.writeBytes(ByteArray(length.toInt()))
    commitFile(file, length)
    releaseHoleSpan(hole)
    applyContentMetadataMutations(key, ContentMetadataMutations().also { ContentMetadataMutations.setContentLength(it, songLength) })
  }

  @Test
  fun aSongCachedWholePlaysFromTheCacheWhateverItsAddress() {
    val audio = audioCache()
    val key = audio.keyFor("v1", stream(251, 4_000))
    audio.cache.played(key, 4_000, songLength = 4_000)
    assertEquals(key, audio.wholeKey("v1"))
    // A fresh address for the same audio finds the same bytes.
    assertEquals(key, audio.keyFor("v1", stream(251, 4_000, url = "https://rr5---sn.googlevideo.com/videoplayback?itag=251&expire=2")))
    assertNull(audio.wholeKey("v2"))
  }

  /** A replay reading [key]'s bytes from the cache. */
  private fun Cache.replayed(key: String) {
    Thread.sleep(5)
    startReadWrite(key, 0, 1)
    Thread.sleep(5)
  }

  @Test
  fun theCacheKeepsWithinItsSizeDroppingTheLeastRecentlyPlayed() {
    val audio = audioCache(maxBytes = 10_000)
    val (a, b, c) = listOf("a", "b", "c").map { audio.keyFor(it, stream(251, 4_000)) }
    audio.cache.played(a, 4_000, songLength = 4_000)
    audio.cache.replayed(a)
    audio.cache.played(b, 4_000, songLength = 4_000)
    audio.cache.replayed(a)
    audio.cache.played(c, 4_000, songLength = 4_000)
    assertEquals(8_000L, audio.cache.cacheSpace)
    assertEquals(a, audio.wholeKey("a"))
    assertNull(audio.wholeKey("b"))
    assertEquals(c, audio.wholeKey("c"))
  }

  @Test
  fun aLoadSaysHowMuchCameFromTheNetworkAndHowMuchFromTheCache() {
    assertEquals(
      "Streamed v1: 4.1 MB from the network, 0.3 MB from the cache",
      YtAudioCache.loadLine("v1", networkBytes = 4_123_456, cacheBytes = 250_001),
    )
    assertEquals(
      "Streamed v1: 0.0 MB from the network, 3.9 MB from the cache",
      YtAudioCache.loadLine("v1", networkBytes = 0, cacheBytes = 3_900_000),
    )
  }

  @Test
  fun theCacheHoldsAGigabyte() {
    assertEquals(1_000_000_000L, YtAudioCache.MAX_BYTES)
  }

  @Test
  fun aSongLeftHalfwayKeepsItsBytesForTheNextPlay() {
    val audio = audioCache()
    val key = audio.keyFor("v1", stream(251, 4_000))
    audio.cache.played(key, 1_500, songLength = 4_000)
    // Not whole: YouTube is asked for an address, and the next play reads the first part from the cache.
    assertNull(audio.wholeKey("v1"))
    assertEquals(key, audio.keyFor("v1", stream(251, 4_000)))
    assertEquals(1_500L, audio.cache.getCachedBytes(key, 0, 4_000))
  }

  @Test
  fun anotherFormatOfTheSongReplacesTheBytesCachedBefore() {
    val audio = audioCache()
    val opus = audio.keyFor("v1", stream(251, 4_000))
    audio.cache.played(opus, 1_500, songLength = 4_000)
    val aac = audio.keyFor("v1", stream(140, 5_000))
    assertNotEquals(opus, aac)
    assertEquals(0L, audio.cache.getCachedBytes(opus, 0, 4_000))
    assertFalse(opus in audio.cache.keys)
  }

  @Test
  fun theSameFormatAtAnotherLengthIsAnotherFile() {
    val audio = audioCache()
    val before = audio.keyFor("v1", stream(251, 4_000))
    audio.cache.played(before, 1_500, songLength = 4_000)
    audio.keyFor("v1", stream(251, 4_200))
    assertEquals(0L, audio.cache.getCachedBytes(before, 0, 4_000))
    // A length the address doesn't say keeps what's there.
    audio.cache.played(before, 1_500, songLength = 4_200)
    audio.keyFor("v1", stream(251, null))
    assertEquals(1_500L, audio.cache.getCachedBytes(before, 0, 4_200))
  }
}
