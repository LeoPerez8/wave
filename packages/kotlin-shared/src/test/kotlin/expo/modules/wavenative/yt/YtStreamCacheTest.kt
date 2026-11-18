package expo.modules.wavenative.yt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class YtStreamCacheTest {
  private val hour = 60 * 60 * 1000L

  private fun stream(itag: Int, expiresAtMs: Long) =
    YtStream(
      url = "https://rr1---sn.googlevideo.com/videoplayback?itag=$itag",
      headers = mapOf("User-Agent" to "Wave"),
      mimeType = "audio/webm",
      itag = itag,
      bitrate = 160_000,
      contentLength = 4_000_000,
      expiresAtMs = expiresAtMs,
    )

  @Test
  fun aStreamIsReusedUntilShortlyBeforeItsAddressExpires() {
    val cache = YtStreamCache()
    val playback = stream(251, expiresAtMs = 6 * hour)
    cache.put("v1", preferM4a = false, playback, client = "WEB_REMIX")
    assertEquals(playback, cache.get("v1", preferM4a = false, nowMs = 5 * hour))
    // Too close to the end to finish a song on it: resolved again.
    assertNull(cache.get("v1", preferM4a = false, nowMs = 6 * hour - 60_000))
  }

  @Test
  fun playbackAndDownloadStreamsAreKeptApart() {
    val cache = YtStreamCache()
    cache.put("v1", preferM4a = false, stream(251, 6 * hour), client = "WEB_REMIX")
    assertNull(cache.get("v1", preferM4a = true, nowMs = 0))
    cache.put("v1", preferM4a = true, stream(140, 6 * hour), client = "WEB_REMIX")
    assertEquals(140, cache.get("v1", preferM4a = true, nowMs = 0)?.itag)
    assertEquals(251, cache.get("v1", preferM4a = false, nowMs = 0)?.itag)
  }

  @Test
  fun aRejectedStreamIsDroppedAndItsClientSkippedForAWhile() {
    val cache = YtStreamCache()
    cache.put("v1", preferM4a = false, stream(251, 6 * hour), client = "WEB_REMIX")
    cache.put("v2", preferM4a = false, stream(251, 6 * hour), client = "WEB_REMIX")
    cache.reject("v1", nowMs = 0)
    assertNull(cache.get("v1", preferM4a = false, nowMs = 0))
    assertEquals(setOf("WEB_REMIX"), cache.excludedClients("v1", nowMs = 60_000))
    // Other songs keep theirs.
    assertEquals(251, cache.get("v2", preferM4a = false, nowMs = 0)?.itag)
    assertTrue(cache.excludedClients("v2", nowMs = 0).isEmpty())
    // Five minutes on, the client is tried again.
    assertTrue(cache.excludedClients("v1", nowMs = 5 * 60_000L).isEmpty())
  }

  @Test
  fun rejectingASongWithNothingCachedSkipsNothing() {
    val cache = YtStreamCache()
    cache.reject("v1", nowMs = 0)
    assertTrue(cache.excludedClients("v1", nowMs = 0).isEmpty())
  }

  @Test
  fun keepsOnlyTheMostRecentlyUsedStreams() {
    val cache = YtStreamCache(capacity = 2)
    cache.put("v1", preferM4a = false, stream(251, 6 * hour), client = "WEB_REMIX")
    cache.put("v2", preferM4a = false, stream(251, 6 * hour), client = "WEB_REMIX")
    cache.get("v1", preferM4a = false, nowMs = 0)
    cache.put("v3", preferM4a = false, stream(251, 6 * hour), client = "WEB_REMIX")
    assertNull(cache.get("v2", preferM4a = false, nowMs = 0))
    assertEquals(251, cache.get("v1", preferM4a = false, nowMs = 0)?.itag)
  }
}
