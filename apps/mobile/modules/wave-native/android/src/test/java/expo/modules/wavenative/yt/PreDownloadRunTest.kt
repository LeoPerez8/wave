package expo.modules.wavenative.yt

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PreDownloadRunTest {
  /** A phone whose cache holds [cached], fetching a song whole unless [fails] says otherwise. */
  private class Phone(cached: Set<String> = emptySet()) {
    val cache = cached.toMutableSet()
    val fetched = mutableListOf<String>()
    var stopped = false
    var fails: (String) -> IOException? = { null }
    var stopsDuring: String? = null

    fun run(videoIds: List<String>) = PreDownloadRun(
      cached = { it in cache },
      fetch = { videoId, stopped ->
        fetched += videoId
        if (videoId == stopsDuring) this.stopped = true
        fails(videoId)?.let { throw it }
        if (!stopped()) cache += videoId
      },
      stopped = { stopped },
    ).run(videoIds)
  }

  @Test
  fun theListIsFetchedInItsOrderSkippingWhatTheCacheHasWhole() {
    val phone = Phone(cached = setOf("b"))
    val outcome = phone.run(listOf("a", "b", "c"))
    assertEquals(listOf("a", "c"), phone.fetched)
    assertEquals(PreDownloadOutcome(fetched = 2, cachedAlready = 1, failed = 0, left = 0, ended = PreDownloadOutcome.Ended.DONE), outcome)
    assertFalse(outcome.again)
  }

  @Test
  fun leavingWiFiOrLowBatteryStopsTheRunWhichGoesOnLater() {
    val phone = Phone()
    phone.stopsDuring = "b"
    val outcome = phone.run(listOf("a", "b", "c"))
    assertEquals(listOf("a", "b"), phone.fetched)
    assertEquals(PreDownloadOutcome(fetched = 1, cachedAlready = 0, failed = 0, left = 2, ended = PreDownloadOutcome.Ended.STOPPED), outcome)
    assertTrue(outcome.again)
    // Conditions back: the next run picks up from what's missing.
    phone.stopped = false
    phone.stopsDuring = null
    phone.fetched.clear()
    assertEquals(PreDownloadOutcome(fetched = 2, cachedAlready = 1, failed = 0, left = 0, ended = PreDownloadOutcome.Ended.DONE), phone.run(listOf("a", "b", "c")))
    assertEquals(listOf("b", "c"), phone.fetched)
  }

  @Test
  fun aSongThatWontStreamIsSkippedAndGoingOfflineStopsTheRun() {
    val phone = Phone()
    phone.fails = { if (it == "a") YtStreamException(YtStreamFailure.UNAVAILABLE, null) else if (it == "c") YtOfflineException(null as Throwable?) else null }
    val outcome = phone.run(listOf("a", "b", "c", "d"))
    assertEquals(PreDownloadOutcome(fetched = 1, cachedAlready = 0, failed = 1, left = 2, ended = PreDownloadOutcome.Ended.OFFLINE), outcome)
    assertTrue(outcome.again)
  }

  @Test
  fun aRunWritesOneLineWithTheSongsItFetchedAndItsBytes() {
    assertEquals(
      "Wi-Fi pre-download (12 songs fetched, 28 cached already) took 84.2 s: 54.30 MB from the network",
      PreDownloadRun.line(PreDownloadOutcome(12, 28, 0, 0, PreDownloadOutcome.Ended.DONE), networkBytes = 56_937_267, durationMs = 84_180),
    )
    assertEquals(
      "Wi-Fi pre-download (1 song fetched, 0 cached already, 1 failed, stopped with 10 left) took 3.0 s: 612.4 KB from the network",
      PreDownloadRun.line(PreDownloadOutcome(1, 0, 1, 10, PreDownloadOutcome.Ended.STOPPED), networkBytes = 627_098, durationMs = 2_960),
    )
    assertEquals(
      "Wi-Fi pre-download (0 songs fetched, 40 cached already, offline with 2 left) took 0.1 s: 0 B from the network",
      PreDownloadRun.line(PreDownloadOutcome(0, 40, 0, 2, PreDownloadOutcome.Ended.OFFLINE), networkBytes = 0, durationMs = 120),
    )
  }
}
