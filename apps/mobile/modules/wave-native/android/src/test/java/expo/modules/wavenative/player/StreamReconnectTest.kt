package expo.modules.wavenative.player

import org.junit.Assert.*
import org.junit.Test

/** Same inputs and answers as Core's public streamReconnect tests. No innertubex types. */
class StreamReconnectTest {
  @Test fun anOfflineStreamResumesAtItsSavedPosition() {
    val stopped = StreamReconnectPolicy.failed("entry-a", 42_000, true, "ytOffline", true, 1_000)
    assertEquals(ReconnectWait("entry-a", 42_000, 601_000), stopped.waiting)
    assertNull(stopped.resume)
    assertEquals(ReconnectResult(null, stopped.waiting),
      StreamReconnectPolicy.connection(stopped.waiting, "entry-a", true, 60_000))
  }

  @Test fun onlyAnOfflineStreamMeantToPlayWaits() {
    assertEquals(0L, StreamReconnectPolicy.failed("a", 0, true, "ytOffline", true, 0).waiting?.positionMs)
    for (code in listOf("ytDisabled", "ytUnavailable", "ytFailed", null)) {
      assertNull(StreamReconnectPolicy.failed("a", 0, true, code, true, 0).waiting)
    }
    assertNull(StreamReconnectPolicy.failed("a", 0, false, "ytOffline", true, 0).waiting)
    assertNull(StreamReconnectPolicy.failed("a", 0, true, "ytOffline", false, 0).waiting)
    assertNull(StreamReconnectPolicy.failed(null, 0, true, "ytOffline", true, 0).waiting)
  }

  @Test fun offlineHoldsTheWaitAndTenMinutesEndsItWithoutAConnectionCallback() {
    val wait = ReconnectWait("a", 0, 600_000)
    assertEquals(ReconnectResult(wait), StreamReconnectPolicy.connection(wait, "a", false, 30_000))
    assertEquals(ReconnectResult(wait), StreamReconnectPolicy.timeout(wait, 599_999))
    for (now in listOf(600_000L, 600_001L, 900_000L)) {
      assertEquals(ReconnectResult(null), StreamReconnectPolicy.connection(wait, "a", true, now))
      assertEquals(ReconnectResult(null), StreamReconnectPolicy.timeout(wait, now))
    }
  }

  @Test fun aChangedEntryOrACancelledWaitNeverResumes() {
    val wait = ReconnectWait("a", 42_000, 600_000)
    for (key in listOf("b", null)) {
      assertEquals(ReconnectResult(null), StreamReconnectPolicy.connection(wait, key, true, 1_000))
    }
    assertEquals(ReconnectResult(null), StreamReconnectPolicy.connection(null, "a", true, 2_000))
  }

  @Test fun aRetryThatFailsBeforePlayingKeepsTheFirstDeadline() {
    val wait = ReconnectWait("a", 42_000, 600_000)
    assertEquals(ReconnectResult(wait), StreamReconnectPolicy.failed("a", 42_000, true, "ytOffline", true, 500_000, wait))
    assertEquals(ReconnectResult(null), StreamReconnectPolicy.failed("a", 42_000, true, "ytOffline", true, 600_000, wait))
  }
}
