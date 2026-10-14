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

  @Test
  fun failuresReachJsAsCodes() {
    assertEquals("ERR_YT_OFFLINE", YtFailure.OFFLINE.code)
    assertEquals("ERR_YT_FAILED", YtFailure.FAILED.code)
    assertEquals("ERR_YT_DISABLED", YtFailure.DISABLED.code)
  }
}
