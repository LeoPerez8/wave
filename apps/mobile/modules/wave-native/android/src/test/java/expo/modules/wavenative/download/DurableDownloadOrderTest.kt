package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * Settings › Downloads' drag: the journal's move puts waiting jobs in a new order (Core's
 * `moveQueuedJobs`), which is the order they start in, kept across a restart.
 */
class DurableDownloadOrderTest {
  @Test fun movedJobsStartInTheirNewOrderAndKeepItAcrossRecreation() {
    val folder = Files.createTempDirectory("wave-order").toFile()
    try {
      val journal = File(folder, "jobs")
      val owner = DurableDownloads(journal, slots = 1)
      for (id in listOf("a1", "a2", "b1", "b2")) owner.enqueue(song(id), null)
      // Playlist B's header dragged above A's.
      owner.moveQueued(listOf("b1", "b2", "a1", "a2"))
      owner.flush()
      val restored = DurableDownloads(journal, slots = 1)
      assertEquals(listOf("b1", "b2", "a1", "a2"), restored.snapshot().map { it["id"] })
      restored.advance(NoTransfer, NoPublication)
      assertEquals("b1", restored.snapshot().single { it["phase"] == "preparing" }["id"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun onlyWaitingJobsMoveAndTheOthersKeepTheirPlaces() {
    val folder = Files.createTempDirectory("wave-order-started").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"), slots = 1)
      for (id in listOf("a1", "a2", "b1", "b2")) owner.enqueue(song(id), null)
      // a1 started while the drag was on; "gone" was never asked for.
      owner.advance(NoTransfer, NoPublication)
      owner.moveQueued(listOf("b1", "gone", "b2", "a1", "a2"))
      assertEquals(listOf("a1", "b1", "b2", "a2"), owner.snapshot().map { it["id"] })
      assertEquals("preparing", owner.snapshot().first()["phase"])
    } finally { folder.deleteRecursively() }
  }

  /** JS follows the journal by its changes: a move comes as the jobs' new order. */
  @Test fun readersFollowingChangesSeeTheNewOrder() {
    val folder = Files.createTempDirectory("wave-order-changes").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      for (id in listOf("a1", "a2", "b1")) owner.enqueue(song(id), null)
      val before = owner.changesSince(0)
      owner.moveQueued(listOf("a2", "a1"))
      val moved = owner.changesSince(before.revision)
      assertEquals(listOf("a2", "a1", "b1"), moved.ids)
      assertTrue(moved.revision > before.revision)
      // An order it already has changes nothing.
      owner.moveQueued(listOf("a2", "a1"))
      assertEquals(moved.revision, owner.changesSince(moved.revision).revision)
    } finally { folder.deleteRecursively() }
  }

  private fun song(id: String) = mapOf("videoId" to id, "title" to "Recording $id", "durationMs" to 12_000L)

  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object NoPublication : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) = error("No tag expected")
    override fun index(file: File): Map<String, Any?> = error("No publication expected")
  }
}
