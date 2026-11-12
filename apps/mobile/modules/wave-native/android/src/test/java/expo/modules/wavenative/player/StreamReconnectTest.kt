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
      assertEquals(ReconnectResult(null, gaveUp = true), StreamReconnectPolicy.connection(wait, "a", true, now))
      assertEquals(ReconnectResult(null, gaveUp = true), StreamReconnectPolicy.timeout(wait, now))
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
    assertEquals(ReconnectResult(null, gaveUp = true),
      StreamReconnectPolicy.failed("a", 42_000, true, "ytOffline", true, 600_000, wait))
  }

  @Test fun anotherAppsAudioWhenTheNetworkReturnsEndsTheWaitWithoutPlaying() {
    val wait = ReconnectWait("a", 42_000, 600_000)
    assertEquals(ReconnectResult(null, gaveUp = true),
      StreamReconnectPolicy.connection(wait, "a", true, 30_000, otherAudio = true))
    assertEquals(ReconnectResult(wait), StreamReconnectPolicy.connection(wait, "a", false, 30_000, otherAudio = true))
  }

  @Test fun onlyAnotherAppsMusicCountsAsOtherAudio() {
    for (usage in listOf(1, 14, 0)) assertTrue(StreamReconnectPolicy.otherAudio(listOf(5, usage)))
    // Notification (5), ringtone (6), navigation prompt (12), assistant (16).
    assertFalse(StreamReconnectPolicy.otherAudio(listOf(5, 6, 12, 16)))
    assertFalse(StreamReconnectPolicy.otherAudio(emptyList()))
  }

  @Test fun losingTheAudioOutputEndsTheWait() {
    val wait = ReconnectWait("a", 42_000, 600_000)
    val lost = StreamReconnectPolicy.outputLost(wait)
    assertEquals(ReconnectResult(null, gaveUp = true), lost)
    assertEquals(ReconnectResult(null), StreamReconnectPolicy.connection(lost.waiting, "a", true, 31_000))
    assertEquals(ReconnectResult(null), StreamReconnectPolicy.outputLost(null))
  }

  @Test fun onlyRemovingAHeadsetOrExternalOutputCountsAsLosingTheOutput() {
    // Wired headset (3) and headphones (4), Bluetooth A2DP (8), USB headset (22), BLE headset (26).
    for (type in listOf(3, 4, 8, 22, 26)) assertTrue(StreamReconnectPolicy.outputGone(listOf(type)))
    // Built-in speaker (2), earpiece (1), Bluetooth SCO for calls (7), telephony (18), remote submix (25).
    assertFalse(StreamReconnectPolicy.outputGone(listOf(1, 2, 7, 18, 25)))
    assertFalse(StreamReconnectPolicy.outputGone(emptyList()))
  }

  @Test fun aRetryThatFailsForAReasonThatIsNotAStreamFailureGivesUp() {
    val wait = ReconnectWait("a", 0, 600_000)
    assertEquals(ReconnectResult(null, gaveUp = true),
      StreamReconnectPolicy.failed("a", 0, true, null, true, 1_000, wait))
  }

  @Test fun aWaitGivesUpWhenNobodyEndedIt() {
    val wait = ReconnectWait("a", 0, 600_000)
    assertTrue(StreamReconnectPolicy.timeout(wait, 600_000).gaveUp)
    assertFalse(StreamReconnectPolicy.timeout(null, 600_000).gaveUp)
    assertFalse(StreamReconnectPolicy.connection(wait, "b", true, 1_000).gaveUp)
    assertEquals(ReconnectResult(null, gaveUp = true),
      StreamReconnectPolicy.failed("a", 0, true, "ytUnavailable", true, 1_000, wait))
    assertFalse(StreamReconnectPolicy.failed("b", 0, true, "ytUnavailable", true, 1_000, wait).gaveUp)
  }

  @Test fun listenersLearnWhetherTheWaitEndedByResuming() {
    val seen = mutableListOf<Pair<Boolean, Boolean>>()
    val stop = StreamReconnectLink.listen { resuming -> seen += StreamReconnectLink.waitingForConnection to resuming }
    try {
      StreamReconnectLink.setWaiting(true)
      StreamReconnectLink.setWaiting(false, resuming = true)
      StreamReconnectLink.setWaiting(true)
      StreamReconnectLink.setWaiting(false)
      StreamReconnectLink.setWaiting(false)
      assertEquals(listOf(true to false, false to true, true to false, false to false), seen)
    } finally {
      stop()
      StreamReconnectLink.setWaiting(false)
    }
  }
}
