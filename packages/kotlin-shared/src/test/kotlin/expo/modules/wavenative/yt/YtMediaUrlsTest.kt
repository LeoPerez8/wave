package expo.modules.wavenative.yt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class YtMediaUrlsTest {
  private val url = "https://rr3---sn-x.googlevideo.com/videoplayback?expire=1&itag=141&clen=8312345&mime=audio%2Fmp4&sig=AB"

  @Test
  fun asksForAByteRangeInTheAddress() {
    assertEquals("$url&range=0-1048575", YtMediaUrls.withRange(url, 0, 1_048_575))
  }

  @Test
  fun replacesARangeTheAddressAlreadyHas() {
    assertEquals("$url&range=10-20", YtMediaUrls.withRange("$url&range=0-5", 10, 20))
    assertEquals(
      "https://x.googlevideo.com/videoplayback?itag=140&clen=9&range=10-20",
      YtMediaUrls.withRange("https://x.googlevideo.com/videoplayback?range=0-5&itag=140&clen=9", 10, 20),
    )
  }

  @Test
  fun readsTheFilesLengthFromTheAddress() {
    assertEquals(8_312_345L, YtMediaUrls.contentLength(url))
    assertNull(YtMediaUrls.contentLength("https://x.googlevideo.com/videoplayback?itag=140"))
    assertNull(YtMediaUrls.contentLength("https://x.googlevideo.com/videoplayback?clen=abc"))
  }
}
