package expo.modules.wavenative.yt

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Test

class YtFailureTest {
  @Test
  fun withoutANetworkEveryFailureIsOffline() {
    assertEquals(YtFailure.OFFLINE, YtFailure.of(IllegalStateException("HTTP 500"), online = false))
  }

  @Test
  fun notReachingYouTubeIsOffline() {
    for (error in listOf(UnknownHostException("music.youtube.com"), ConnectException(), SocketTimeoutException())) {
      assertEquals(error.toString(), YtFailure.OFFLINE, YtFailure.of(error, online = true))
    }
    val wrapped = IOException("request failed", UnknownHostException("music.youtube.com"))
    assertEquals(YtFailure.OFFLINE, YtFailure.of(wrapped, online = true))
  }

  @Test
  fun anErrorAnswerOrAnUnreadableOneFailed() {
    assertEquals(YtFailure.FAILED, YtFailure.of(IllegalStateException("search failed with HTTP 403"), online = true))
    assertEquals(YtFailure.FAILED, YtFailure.of(IllegalArgumentException("not JSON"), online = true))
  }

  /** Stands in for innertubex's HTTP exception, which is built for a newer Java than these tests run on. */
  private class HttpAnswer(val status: Int) : Exception("HTTP $status")

  private fun failedLine(what: String, error: YtException) = YtFailure.failedLine(what, error) { (it as? HttpAnswer)?.status }

  @Test
  fun aFailedSearchsLineSaysWhatNativeCodeSaw() {
    val refused = YtException(YtFailure.FAILED, IOException("request failed", HttpAnswer(403)))
    assertEquals("Songs search \"Within Daft Punk\" failed (failed): HTTP 403", failedLine("Songs search \"Within Daft Punk\"", refused))
    val unreadable = YtException(YtFailure.FAILED, IllegalArgumentException("not JSON"))
    assertEquals("Songs search \"x\" failed (failed): IllegalArgumentException: not JSON", failedLine("Songs search \"x\"", unreadable))
    val unreachable = YtException(YtFailure.OFFLINE, UnknownHostException("music.youtube.com"))
    assertEquals("Songs search \"x\" failed (offline): UnknownHostException: music.youtube.com", failedLine("Songs search \"x\"", unreachable))
    assertEquals("Songs search \"x\" failed (offline): no network", failedLine("Songs search \"x\"", YtException(YtFailure.OFFLINE)))
    assertEquals("Songs search \"x\" failed (YT Music off): YT Music is off", failedLine("Songs search \"x\"", YtException(YtFailure.DISABLED)))
    assertEquals("Songs search \"x\" failed (failed): SocketException", failedLine("Songs search \"x\"", YtException(YtFailure.FAILED, java.net.SocketException())))
  }

  @Test
  fun failuresReachJsAsCodes() {
    assertEquals("ERR_YT_OFFLINE", YtFailure.OFFLINE.code)
    assertEquals("ERR_YT_FAILED", YtFailure.FAILED.code)
    assertEquals("ERR_YT_DISABLED", YtFailure.DISABLED.code)
  }
}
