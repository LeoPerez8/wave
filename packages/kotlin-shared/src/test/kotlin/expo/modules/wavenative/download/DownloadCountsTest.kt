package expo.modules.wavenative.download

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The download notification's and the app log's counts: the same rule as Core's
 * `queuedDownloadCounts` (`queuedDownloads.test.ts`), case for case.
 */
class DownloadCountsTest {
  private fun job(id: String, phase: String, vararg more: Pair<String, Any?>): Map<String, Any?> =
    mapOf("id" to id, "phase" to phase) + more

  @Test fun theSongsThatFailedOrFinishedArentCounted() {
    val jobs = listOf(
      job("a", "transferring"),
      job("b", "queued"),
      job("c", "queued"),
      job("failed", "failed", "reason" to "failed"),
      job("cancelled", "cancelled"),
      job("unimported", "completed", "importFailure" to "storage"),
    )
    assertEquals(DownloadCounts(running = 1, left = 2, saving = 0), DownloadCounts.of(jobs))
  }

  @Test fun aSongWaveWasKilledWhileDownloadingWaitsAgainUntilTheQueueTakesItUp() {
    val jobs = listOf(
      job("a", "prepared", "source" to "soulseek", "resumed" to true),
      job("b", "transferring"),
      job("c", "preparing", "source" to "youtube", "resumed" to true),
    )
    assertEquals(DownloadCounts(running = 1, left = 2, saving = 0), DownloadCounts.of(jobs))
  }

  @Test fun anOct18ReplacementRunCountsOnlyTheSongsHoldingASlotAsDownloading() {
    fun run(count: Int, phase: String, vararg more: Pair<String, Any?>) =
      (0 until count).map { job("downgrade:$phase$it", phase, "source" to "youtube", *more) }
    val jobs = run(1325, "completed", "acknowledged" to true, "saved" to mapOf("path" to "/m/s.m4a")) +
      run(5, "transferring", "received" to 10L, "total" to 100L) +
      run(1, "prepared") +
      run(1, "preparing") +
      run(3, "tagging") +
      run(600, "awaitingPublication") +
      run(1, "publishing") +
      run(1, "completed") +
      run(428, "queued")
    assertEquals(2365, jobs.size)
    val counts = DownloadCounts.of(jobs)
    assertEquals(DownloadCounts(running = 10, left = 428, saving = 602), counts)
    assertEquals("10 downloading, 602 saving, 428 waiting", counts.line())
  }
}
