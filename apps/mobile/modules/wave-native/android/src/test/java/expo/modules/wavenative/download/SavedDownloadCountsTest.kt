package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The journal's counts as a session last wrote them, read at the next launch without opening the journal. */
class SavedDownloadCountsTest {
  private val folder: File = Files.createTempDirectory("wave-journal").toFile()
  private val journal = File(folder, "jobs")

  @Test
  fun theNextLaunchReadsTheSongsDownloadingAndWaitingAsTheJournalLastSavedThem() {
    val owner = DurableDownloads(journal)
    for (n in 1..12) owner.enqueue(mapOf("videoId" to "song-$n", "title" to "Song $n", "durationMs" to 12_000L), null)
    owner.advance(NoTransfer, NoPublication)
    owner.cancel("song-2", NoTransfer)
    owner.cancel("song-12", NoTransfer)

    assertEquals(DownloadCounts(running = 4, left = 6), savedDownloadCounts(journal))
  }

  @Test
  fun aJournalWithNothingLeftCountsNothing() {
    val owner = DurableDownloads(journal)
    owner.enqueue(mapOf("videoId" to "song", "title" to "Song", "durationMs" to 12_000L), null)
    owner.cancel("song", NoTransfer)

    assertEquals(DownloadCounts(running = 0, left = 0), savedDownloadCounts(journal))
  }

  @Test
  fun noJournalOrAnUnreadableOneHasNoCounts() {
    assertNull(savedDownloadCounts(journal))

    journal.writeText("not a journal")
    assertNull(savedDownloadCounts(journal))
  }

  private object NoTransfer : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> =
      error("No transfer expected")
  }

  private object NoPublication : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) = error("No publication expected")
    override fun index(file: File): Map<String, Any?> = error("No publication expected")
  }
}
