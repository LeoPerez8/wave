package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/** #452: the journal's snapshot and log on disk, read back after a crash at any point. */
class JournalStoreTest {
  /**
   * A new process writes its first snapshot one epoch past the journal it read, so a crash between
   * the snapshot and the log never replays the previous session's records onto the new snapshot.
   */
  @Test fun aCrashBetweenTheSnapshotAndTheLogDoesNotReplayTheLastSessionsRecords() = inFolder { folder ->
    val journal = File(folder, "jobs")
    val log = File(journal.path + ".log")
    val first = JournalStore(journal)
    first.load()
    first.write(listOf(job("a"), job("b")), emptyMap(), 0L)
    // The last session removed "a" in a record appended to its log.
    first.write(listOf(job("b")), emptyMap(), 0L)
    // The next process reads it, gets "a" asked for again, and writes its first (whole) snapshot...
    val second = JournalStore(journal)
    assertEquals(listOf("b"), ids(second.load()))
    val oldLog = log.readBytes()
    second.write(listOf(job("b"), job("a")), emptyMap(), 0L)
    // ...but is killed before its new log replaces the old one.
    log.writeBytes(oldLog)
    assertEquals(listOf("b", "a"), ids(JournalStore(journal).load()))
  }

  @Suppress("UNCHECKED_CAST")
  private fun ids(journal: Map<String, Any?>?): List<String> = (journal!!["jobs"] as Map<String, Any?>).keys.toList()

  private fun job(id: String): Map<String, Any?> = mapOf("id" to id, "phase" to "queued")

  private fun inFolder(test: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-journal-store").toFile()
    try { test(folder) } finally { folder.deleteRecursively() }
  }
}
