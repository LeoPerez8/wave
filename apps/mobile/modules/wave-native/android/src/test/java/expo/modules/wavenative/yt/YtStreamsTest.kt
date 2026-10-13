package expo.modules.wavenative.yt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class YtStreamsTest {
  private val now = 1_700_000_000_000L

  @Test
  fun anAddressExpiresWhenYouTubeSaysSo() {
    val url = "https://rr1---sn.googlevideo.com/videoplayback?expire=1700021600&itag=251"
    assertEquals(now + 1_000, YtStreams.expiresAtMs(now + 1_000, url, now))
  }

  @Test
  fun withoutAnExpiryItIsReadFromTheAddress() {
    val url = "https://rr1---sn.googlevideo.com/videoplayback?itag=251&expire=1700021600&ei=x"
    assertEquals(1_700_021_600_000L, YtStreams.expiresAtMs(null, url, now))
  }

  @Test
  fun anAddressWithNoExpiryAtAllIsTrustedForFiveMinutes() {
    val url = "https://rr1---sn.googlevideo.com/videoplayback?itag=251"
    assertEquals(now + 5 * 60_000, YtStreams.expiresAtMs(null, url, now))
  }

  @Test
  fun downloadsAskForAacInM4aAndPlaybackForTheBestAudio() {
    assertEquals("MP4", YtStreams.audioQuality(preferM4a = true))
    assertEquals("HIGH", YtStreams.audioQuality(preferM4a = false))
  }

  @Test
  fun aDownloadOnlyTakesM4a() {
    assertTrue(YtStreams.fits("audio/mp4; codecs=\"mp4a.40.2\"", preferM4a = true))
    assertFalse(YtStreams.fits("audio/webm; codecs=\"opus\"", preferM4a = true))
    assertTrue(YtStreams.fits("audio/webm; codecs=\"opus\"", preferM4a = false))
    // Never a video stream.
    assertFalse(YtStreams.fits("video/mp4; codecs=\"avc1\"", preferM4a = false))
    assertFalse(YtStreams.fits(null, preferM4a = false))
  }

  @Test
  fun theMimeTypeCarriesTheCodecs() {
    assertEquals("audio/webm; codecs=\"opus\"", YtStreams.mimeType("audio/webm", "opus"))
    assertEquals("audio/mp4", YtStreams.mimeType("audio/mp4", null))
    assertEquals("audio/mp4; codecs=\"mp4a.40.2\"", YtStreams.mimeType("audio/mp4; codecs=\"mp4a.40.2\"", "mp4a.40.2"))
  }

  @Test
  fun aRejectedAddressIsResolvedAgainTwiceAtMost() {
    assertTrue(YtStreams.resolveAgain(httpStatus = 403, attempt = 0))
    assertTrue(YtStreams.resolveAgain(httpStatus = 410, attempt = 1))
    assertFalse(YtStreams.resolveAgain(httpStatus = 403, attempt = 2))
    // Anything else isn't the address's fault.
    assertFalse(YtStreams.resolveAgain(httpStatus = 500, attempt = 0))
    assertFalse(YtStreams.resolveAgain(httpStatus = 416, attempt = 0))
  }

  @Test
  fun whyASongCouldNotStreamTravelsInTheErrorMessage() {
    for (failure in YtStreamFailure.entries) {
      assertEquals(failure.code, YtStreamFailure.codeOf(failure.message))
    }
    assertNull(YtStreamFailure.codeOf("Source error"))
    assertNull(YtStreamFailure.codeOf(null))
  }

  @Test
  fun aSongYouTubeWontServeIsUnavailableNotAFailure() {
    assertEquals(YtStreamFailure.UNAVAILABLE, YtStreamFailure.of(YtFailure.FAILED, "UNAVAILABLE"))
    assertEquals(YtStreamFailure.UNAVAILABLE, YtStreamFailure.of(YtFailure.FAILED, "AGE_RESTRICTED"))
    assertEquals(YtStreamFailure.UNAVAILABLE, YtStreamFailure.of(YtFailure.FAILED, "NO_PLAYABLE_STREAM"))
    assertEquals(YtStreamFailure.FAILED, YtStreamFailure.of(YtFailure.FAILED, "UNKNOWN"))
    assertEquals(YtStreamFailure.FAILED, YtStreamFailure.of(YtFailure.FAILED, null))
    assertEquals(YtStreamFailure.OFFLINE, YtStreamFailure.of(YtFailure.OFFLINE, "NETWORK"))
    assertEquals(YtStreamFailure.DISABLED, YtStreamFailure.of(YtFailure.DISABLED, null))
  }
}
