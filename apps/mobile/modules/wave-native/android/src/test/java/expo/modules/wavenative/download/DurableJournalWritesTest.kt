package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * #452: a big queue's journal is written in small, coalesced writes. A write costs what changed,
 * never the jobs' tags or lyrics again, and changes close together share one write.
 */
class DurableJournalWritesTest {
  @Test fun aChangesWriteDoesNotCarryTheJobsTagsOrLyrics() {
    fun changeBytes(lyrics: String, jobs: Int): Long = inFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), slots = jobs)
      for (index in 1..jobs) owner.enqueue(song("song-$index"), null)
      owner.advance(NoTransfer, NoPublication)
      for (index in 1..jobs) prepare(owner, "song-$index", File(folder, "song-$index.mp3"), lyrics)
      owner.flush()
      owner.takeWriteStats()
      // One job's phase changes.
      owner.cancel("song-2", NoTransfer)
      owner.flush()
      val stats = owner.takeWriteStats()
      assertEquals(1, stats.writes)
      stats.bytes
    }
    val small = changeBytes(lyrics = "", jobs = 2)
    val big = changeBytes(lyrics = "la ".repeat(20_000), jobs = 20)
    assertTrue("a change wrote $big bytes", big < 2_000)
    assertEquals(small.toDouble(), big.toDouble(), 64.0)
  }

  /** The Oct-18 run: 700 songs waiting, five on their way, each changing several times a second. */
  @Test fun aBigQueueWritesAboutOnceASecond() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    owner.enqueueAll((1..700).map { DurableDownloads.Request(song("song-$it"), equivalentId = null) })
    owner.advance(NoTransfer, NoPublication)
    owner.flush()
    val leases = (1..5).map { owner.claim("song-$it")!! }
    owner.takeWriteStats()
    // A minute: the deadline thread checks twice a second, and the five leases are renewed each time.
    repeat(120) {
      now += 500
      for (lease in leases) assertTrue(owner.renew(lease["id"] as String, lease["generation"] as Long, lease["token"] as String))
      owner.expire(NoTransfer)
    }
    val stats = owner.takeWriteStats()
    assertTrue("${stats.writes} writes in a minute", stats.writes in 50..61)
    assertEquals(0, stats.whole)
    assertTrue("${stats.bytes / stats.writes} bytes a write", stats.bytes / stats.writes < 2_000)
    assertEquals(60_000L, stats.spanMs)
  }

  /** Without [DurableDownloads.expire] running (no download service), a waiting change is written by [later]. */
  @Test fun aWaitingChangeIsWrittenOnceItsSecondIsOver() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val delays = mutableListOf<Long>()
    val waiting = mutableListOf<() -> Unit>()
    val owner = DurableDownloads(journal, clock = { now }, later = { delay, run -> delays += delay; waiting += run })
    for (id in listOf("song-1", "song-2", "song-3")) owner.enqueue(song(id), null)
    now += 300
    owner.moveQueued(listOf("song-3", "song-1"))
    owner.moveQueued(listOf("song-2", "song-3"))
    // One write waits for the two, 700 ms on.
    assertEquals(listOf(700L), delays)
    assertEquals(listOf("song-1", "song-2", "song-3"), reopened(journal).map { it["id"] })
    now += 700
    waiting.single()()
    assertEquals(listOf("song-2", "song-3", "song-1"), reopened(journal).map { it["id"] })
  }

  /** "A crash still loses no job": a song asked for is in the journal before [DurableDownloads.enqueue] returns. */
  @Test fun aNewJobIsWrittenAtOnce() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now }, later = { _, _ -> })
    owner.enqueue(song("song-1"), null)
    now += 300
    owner.enqueue(song("song-2"), null)
    assertEquals(listOf("song-1", "song-2"), reopened(journal).map { it["id"] })
  }

  /** A replacement run of 725 songs is asked for in one write, not 725. */
  @Test fun aBatchOfNewJobsIsOneWrite() = inFolder { folder ->
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, later = { _, _ -> })
    owner.flush(); owner.takeWriteStats()
    val ids = owner.enqueueAll((1..725).map { DurableDownloads.Request(song("song-$it"), equivalentId = null) })
    assertEquals((1..725).map { "song-$it" }, ids)
    assertEquals(1, owner.takeWriteStats().writes)
    assertEquals(ids, reopened(journal).map { it["id"] })
  }

  /**
   * Wave killed at any point of a download (before or inside each step), whether the journal wrote
   * the steps before (a second apart) or nothing since the song was asked for (all within a second),
   * then opened again and left to finish: the job is there, the song lands once under its own name,
   * imported from that one path, and no part file is left.
   */
  @Test fun killingWaveAtAnyPointKeepsTheJobAndNeverLeavesADuplicateOrAnOrphanedFile() {
    for (writtenBetween in listOf(false, true)) for (killAt in 0 until 13) inFolder { folder ->
      val at = "killed at $killAt, ${if (writtenBetween) "written between steps" else "nothing written since the enqueue"}"
      var now = 1_000L
      val journal = File(folder, "jobs")
      val target = File(folder, "Recording.mp3")
      val imported = mutableListOf<Any?>()
      val first = DurableDownloads(journal, clock = { now })
      var point = 0
      fun die() {
        if (writtenBetween) first.flush()
        if (point++ == killAt) throw ProcessDeath()
      }
      val transfer = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("audio of $id"); die()
          return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
        }
      }
      val publication = object : DurablePublication {
        override fun tag(source: File, tags: Map<String, Any?>): String? { source.appendText(" tagged"); die(); return null }
        override fun index(file: File): Map<String, Any?> { die(); return indexed(file) }
      }
      try {
        die(); first.enqueue(song("song"), null)
        val revision = first.refreshPolicy(listOf(folder.path), emptyList())
        die(); first.advance(transfer, publication)
        die(); decide(first, "song", target, revision, imported)
        die(); first.advance(transfer, publication)
        die(); decide(first, "song", target, revision, imported)
        die(); first.advance(transfer, publication)
        die(); decide(first, "song", target, revision, imported)
        die(); first.advance(transfer, publication)
        die(); decide(first, "song", target, revision, imported)
        die()
      } catch (_: ProcessDeath) {}

      val second = DurableDownloads(journal, clock = { now })
      // Asked for and killed before the journal's first write: JS asks again. Imported, and the
      // journal wrote it: nothing left to show (the journal forgets imported jobs as it opens).
      val landed = imported.isNotEmpty() && second.snapshot().isEmpty()
      if (killAt == 0) second.enqueue(song("song"), null) else if (!landed) assertEquals(at, listOf("song"), second.snapshot().map { it["id"] })
      val revision = second.refreshPolicy(listOf(folder.path), emptyList())
      repeat(40) {
        now += 5_000
        second.advance(GoodTransfer, GoodPublication)
        decide(second, "song", target, revision, imported)
      }
      if (!landed) {
        val job = second.snapshot().single()
        assertEquals(at, "completed", job["phase"])
        assertEquals(at, true, job["acknowledged"])
      }
      assertEquals(at, listOf("Recording.mp3"), folder.listFiles()!!.map { it.name }.filter { it.endsWith(".mp3") || it.contains(".part.") })
      assertEquals(at, setOf(target.path), imported.toSet())
    }
  }

  /** A transfer that started within a second of the last write, its part file not in the journal yet. */
  @Test fun aPartFileTheJournalNeverRecordedIsDeletedAsItOpens() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now })
    owner.enqueue(song("song"), null)
    owner.advance(NoTransfer, NoPublication)
    decide(owner, "song", File(folder, "Recording.mp3"), 0L, mutableListOf())
    val offline = object : DurableTransfer {
      override fun cancel(id: String) {}
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        source.parentFile.mkdirs(); source.writeText("partial"); throw DurableFailure("offline")
      }
    }
    owner.advance(offline, NoPublication)
    owner.flush()
    // The pause before trying again; another song asked for meanwhile is written at once.
    now += 3_000
    owner.enqueue(song("other"), null)
    var part: File? = null
    val dying = object : DurableTransfer {
      override fun cancel(id: String) {}
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        source.parentFile.mkdirs(); source.writeText("partial"); part = source; throw ProcessDeath()
      }
    }
    assertThrows(ProcessDeath::class.java) { owner.advance(dying, NoPublication) }
    assertTrue(part!!.isFile)
    val reopened = DurableDownloads(journal, clock = { now })
    assertEquals(listOf("song", "other"), reopened.snapshot().map { it["id"] })
    assertFalse(part!!.exists())
    assertEquals(emptyList<String>(), folder.listFiles()!!.map { it.name }.filter { it.contains(".part.") })
  }

  @Test fun aJournalWrittenByThePreviousVersionIsReadWithEveryJob() = inFolder { folder ->
    val journal = File(folder, "jobs")
    // As 0.11 wrote it: one serialized map, rewritten whole on every change.
    val jobs = linkedMapOf<String, Any?>(
      "a" to linkedMapOf("id" to "a", "song" to song("a"), "generation" to 1L, "phase" to "queued", "attempts" to 0L, "candidateIndex" to 0L, "aliases" to arrayListOf<Any?>()),
      "b" to linkedMapOf("id" to "b", "song" to song("b"), "generation" to 2L, "phase" to "failed", "reason" to "unavailable", "aliases" to arrayListOf<Any?>()),
    )
    java.io.ObjectOutputStream(journal.outputStream()).use {
      it.writeObject(linkedMapOf("jobs" to jobs, "libraryPolicy" to linkedMapOf("roots" to arrayListOf(folder.path), "excluded" to arrayListOf<String>(), "revision" to 3L), "budgetClock" to 1_000L))
    }
    val owner = DurableDownloads(journal)
    assertEquals(listOf("a" to "queued", "b" to "failed"), owner.snapshot().map { it["id"] to it["phase"] })
    assertEquals(3L, owner.refreshPolicy(listOf(folder.path), emptyList()))
    // And written in the new way from then on.
    owner.enqueue(song("c"), null)
    owner.flush()
    assertEquals(listOf("a", "b", "c"), reopened(journal).map { it["id"] })
  }

  /** The log is folded into a new snapshot now and then; a journal read at any point has every job as last written. */
  @Test fun theLogIsFoldedIntoTheSnapshotOnceItOutgrowsIt() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now })
    for (index in 1..3) owner.enqueue(song("song-$index"), null)
    owner.advance(NoTransfer, NoPublication)
    val leases = (1..3).associate { "song-$it" to owner.claim("song-$it")!! }
    owner.takeWriteStats()
    var whole = 0
    repeat(3_000) {
      now += 1_000
      for ((id, lease) in leases) owner.renew(id, lease["generation"] as Long, lease["token"] as String)
      owner.expire(NoTransfer)
      whole += owner.takeWriteStats().whole
    }
    assertTrue("$whole whole writes", whole >= 1)
    assertTrue(JournalStore.files(journal)[1].length() < JournalStore.MIN_LOG_BYTES + 4_096)
    val reread = reopened(journal)
    assertEquals(listOf("song-1", "song-2", "song-3"), reread.map { it["id"] })
    assertEquals(owner.snapshot().map { it["leaseUntil"] }, reread.map { it["leaseUntil"] })
  }

  /** The download service's line about once a minute (tag `WaveDownloads`). */
  @Test fun theJournalLineSaysWritesBytesAndTimeSinceTheLastOne() {
    assertEquals("The download journal wrote 58 times (1 whole) in 1 min: 41 KB in 120 ms", JournalWrites(58, 1, 41_200, 120, 60_000).line())
    assertEquals("The download journal wrote 1 time in 1 min 2 s: 1 KB in 0 ms", JournalWrites(1, 0, 900, 0, 62_000).line())
  }

  /** Answers the job's pending decision as JS would, if it has one; an import adds its path to [imported]. */
  private fun decide(owner: DurableDownloads, id: String, target: File, revision: Long, imported: MutableList<Any?>) {
    val lease = owner.claim(id) ?: return
    val payload = when (lease["decision"]) {
      "prepare" -> mapOf("candidates" to listOf(candidate), "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false))
      "confirm" -> mapOf("acceptable" to true, "receiptId" to lease["receiptId"])
      "publish" -> mapOf("targetPath" to target.path, "revision" to revision)
      "import" -> mapOf("path" to (lease["saved"] as Map<*, *>)["path"]).also { imported += it["path"] }
      else -> error("Unexpected decision ${lease["decision"]}")
    }
    assertTrue(owner.submit(id, lease["generation"] as Long, lease["token"] as String, lease["decision"] as String, payload))
  }
  private class ProcessDeath : Error()
  private fun indexed(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  private val GoodTransfer = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      source.parentFile.mkdirs(); source.writeText("audio of $id")
      return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
    }
  }
  private val GoodPublication = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>): String? { source.appendText(" tagged"); return null }
    override fun index(file: File): Map<String, Any?> = indexed(file)
  }
  /** What a new process finds in [journal]'s files now (a copy, so this one may go on writing its own). */
  private fun reopened(journal: File): List<Map<String, Any?>> {
    val copy = File(journal.parentFile, "reopened-${System.nanoTime()}")
    for ((file, to) in JournalStore.files(journal).zip(JournalStore.files(copy))) if (file.exists()) file.copyTo(to)
    return DurableDownloads(copy).snapshot()
  }

  private fun prepare(owner: DurableDownloads, id: String, target: File, lyrics: String) {
    val lease = owner.claim(id)!!
    val tags = mapOf("title" to id, "artists" to listOf("Artist"), "lyrics" to lyrics, "genre" to "Pop")
    assertTrue(owner.submit(id, lease["generation"] as Long, lease["token"] as String, "prepare",
      mapOf("candidates" to listOf(candidate), "targetPath" to target.path, "tags" to tags, "failurePlan" to CorePlans.soulseek(ytMusicOn = false))))
  }
  private val candidate = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private fun song(id: String) = mapOf("videoId" to id, "title" to id, "durationMs" to 12_000L)
  private fun <T> inFolder(test: (File) -> T): T {
    val folder = Files.createTempDirectory("wave-journal-writes").toFile()
    try { return test(folder) } finally { folder.deleteRecursively() }
  }

  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object NoPublication : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) = error("No tag expected")
    override fun index(file: File): Map<String, Any?> = error("No publication expected")
  }
}
