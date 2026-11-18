package expo.modules.wavenative.download

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Paths waiting for Android's media scanner go to it together, at most every few seconds (#455);
 * a downloaded file only once its tags are written, with the file it replaces.
 */
class MediaScanBatchTest {
  private var now = 0L
  private val waiting = mutableListOf<Pair<Long, () -> Unit>>()
  private val scans = mutableListOf<List<String>>()
  private val batch = MediaScanBatch(
    clock = { now },
    later = { delay, run -> waiting += (now + delay) to run },
    scan = { scans += it },
    everyMs = 5_000L,
    holdMs = 60_000L,
  )

  /** Moves the clock to [ms], running what was due by then. */
  private fun at(ms: Long) {
    now = ms
    while (true) {
      val due = waiting.filter { it.first <= now }.minByOrNull { it.first } ?: break
      waiting.remove(due); due.second()
    }
  }

  @Test fun aDownloadedFileIsScannedOnceItsTagsAreWritten() {
    batch.hold("/music/Song.m4a")
    at(30_000L)
    assertEquals(emptyList<List<String>>(), scans)
    // The fill-in wrote its lyrics: the tag writer asks for a scan, then the fill-in is done.
    batch.add(listOf("/music/Song.m4a"))
    at(31_000L)
    assertEquals(emptyList<List<String>>(), scans)
    batch.release("/music/Song.m4a")
    at(40_000L)
    assertEquals(listOf(listOf("/music/Song.m4a")), scans)
  }

  @Test fun aReplacementAndTheFileItReplacesGoInTheSameBatchAfterItsTags() {
    batch.hold("/music/Song.m4a")
    // The import deleted the old file before the fill-in.
    batch.add(listOf("/music/Song.mp3"), with = "/music/Song.m4a")
    at(20_000L)
    assertEquals(emptyList<List<String>>(), scans)
    batch.release("/music/Song.m4a")
    at(30_000L)
    assertEquals(listOf(listOf("/music/Song.m4a", "/music/Song.mp3")), scans)
  }

  @Test fun filesLandingCloseTogetherGoInOneBatchAtMostEveryFewSeconds() {
    batch.add(listOf("/music/A.m4a"))
    at(0L)
    batch.add(listOf("/music/B.m4a"))
    at(1_000L)
    batch.add(listOf("/music/C.m4a", "/music/B.m4a"))
    at(4_999L)
    assertEquals(listOf(listOf("/music/A.m4a")), scans)
    at(5_000L)
    assertEquals(listOf(listOf("/music/A.m4a"), listOf("/music/B.m4a", "/music/C.m4a")), scans)
    // Long after the last batch, a file goes at once.
    at(60_000L)
    batch.add(listOf("/music/D.m4a"))
    at(60_000L)
    assertEquals(listOf("/music/D.m4a"), scans.last())
  }

  @Test fun aDownloadWhoseFillInNeverComesIsScannedAllTheSameWithWhatGoesAlong() {
    batch.hold("/music/Song.m4a")
    batch.add(listOf("/music/Song.mp3"), with = "/music/Song.m4a")
    at(59_999L)
    assertEquals(emptyList<List<String>>(), scans)
    at(60_000L)
    assertEquals(listOf(listOf("/music/Song.m4a", "/music/Song.mp3")), scans)
    // A fill-in done after all asks for nothing more.
    batch.release("/music/Song.m4a")
    at(120_000L)
    assertEquals(1, scans.size)
  }

  @Test fun theRunsEndHandsOverWhatIsReadyAtOnceAndLeavesHeldFilesToTheirTags() {
    batch.add(listOf("/music/A.m4a"))
    at(0L)
    batch.add(listOf("/music/B.m4a"))
    batch.hold("/music/C.m4a")
    at(1_000L)
    batch.flush()
    assertEquals(listOf(listOf("/music/A.m4a"), listOf("/music/B.m4a")), scans)
    at(10_000L)
    assertEquals(2, scans.size)
    batch.release("/music/C.m4a")
    at(10_000L)
    assertEquals(listOf("/music/C.m4a"), scans.last())
  }

  @Test fun saysHowManyFilesWentToTheScannerInHowManyBatchesSinceItLastSaid() {
    assertEquals("Media scans: none", batch.takeLine())
    batch.add(listOf("/music/A.m4a", "/music/B.m4a"))
    at(0L)
    batch.add(listOf("/music/C.m4a"))
    at(5_000L)
    assertEquals("Media scans: 3 files in 2 batches", batch.takeLine())
    batch.add(listOf("/music/D.m4a"))
    at(10_000L)
    assertEquals("Media scans: 1 file in 1 batch", batch.takeLine())
  }

  @Test fun aFileGoingWithOneNoLongerHeldGoesWithTheNextBatch() {
    batch.add(listOf("/music/Old.mp3"), with = "/music/Gone.m4a")
    at(1_000L)
    assertEquals(listOf(listOf("/music/Old.mp3")), scans)
  }
}
