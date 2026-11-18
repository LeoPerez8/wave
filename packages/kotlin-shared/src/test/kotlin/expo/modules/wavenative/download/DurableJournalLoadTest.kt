package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.*
import org.junit.Test

/**
 * A big queue mustn't starve Wave: the journal is written when a job changes in a way a restart
 * must keep, with the changes around it ([DurableDownloads.WRITE_MS]), and at a bounded rate for
 * progress, never on every deadline check or chunk.
 */
class DurableJournalLoadTest {
  @Test fun checkingDeadlinesWithNothingDueLeavesTheJournalFileAlone() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now })
    for (id in ids) owner.enqueue(song(id), null)
    owner.advance(NoTransfer, NoPublication)
    owner.flush()
    owner.takeWriteStats()
    // Android's deadline thread and the worker check twice a second; nothing is due.
    repeat(10) { now += 500; owner.expire(NoTransfer); owner.advance(NoTransfer, NoPublication) }
    assertEquals(0, owner.takeWriteStats().writes)
    // A change a restart must keep is written within a second.
    owner.enqueue(song("song-13"), null)
    now += DurableDownloads.WRITE_MS; owner.expire(NoTransfer)
    assertEquals(ids + "song-13", reopened(journal).map { it["id"] })
  }

  /** A crash loses at most [DurableDownloads.PROGRESS_WRITE_MS] of progress, never a job or its phase. */
  @Test fun progressIsWrittenAtABoundedRateAndAPhaseChangeWithinASecond() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now })
    owner.enqueue(song("song-1"), null)
    owner.advance(NoTransfer, NoPublication)
    prepare(owner, "song-1", File(folder, "song-1.mp3"))
    val written = mutableListOf<Any?>()
    val trickle = object : DurableTransfer {
      override fun cancel(id: String) {}
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        source.parentFile.mkdirs(); source.writeText("audio of $id")
        // Chunks arrive many times a second.
        for (received in 1L..40L) { now += 100; progress(received, 80, null); written += reopened(journal).single()["received"] }
        // The deadline thread writes what's left once it's due, though no chunk came since.
        now += DurableDownloads.PROGRESS_WRITE_MS; owner.expire(this); written += reopened(journal).single()["received"]
        return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
      }
    }
    owner.advance(trickle, NoPublication)
    val distinct = written.distinct()
    // Four seconds of chunks: written about once in [PROGRESS_WRITE_MS], not forty times.
    assertTrue("written ${distinct.size} times: $distinct", distinct.size in 2..3)
    assertEquals(40L, written.last())
    now += DurableDownloads.WRITE_MS; owner.expire(NoTransfer)
    assertEquals("sourceReady", reopened(journal).single()["phase"])
  }

  /** JS asks for what changed since the revision it last saw, not the whole journal. */
  @Test fun readersGetOnlyTheJobsThatChangedSinceTheirRevision() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    val all = owner.changesSince(0)
    assertEquals(0, all.jobs.size)
    for (id in ids) owner.enqueue(song(id), null)
    val first = owner.changesSince(0)
    assertEquals(ids, first.jobs.map { it["id"] })
    assertEquals(ids, first.ids)
    // Nothing changed: nothing to send, and the revision stays.
    now += 500; owner.expire(NoTransfer)
    val quiet = owner.changesSince(first.revision)
    assertEquals(first.revision, quiet.revision)
    assertEquals(emptyList<Any?>(), quiet.jobs)
    assertNull(quiet.ids)
    // One job changes: only it comes, and the order isn't sent again.
    owner.cancel("song-5", NoTransfer)
    val cancelled = owner.changesSince(quiet.revision)
    assertEquals(listOf("song-5"), cancelled.jobs.map { it["id"] })
    assertEquals("cancelled", cancelled.jobs.single()["phase"])
    assertNull(cancelled.ids)
    // Asked for again, it goes to the end of the queue: the new order comes with it.
    owner.enqueue(song("song-5"), null)
    val retried = owner.changesSince(cancelled.revision)
    assertEquals(listOf("song-5"), retried.jobs.map { it["id"] })
    assertEquals(ids - "song-5" + "song-5", retried.ids)
    // Starting five songs (song-5 now waits at the end) changes those five.
    owner.advance(NoTransfer, NoPublication)
    val started = owner.changesSince(retried.revision)
    assertEquals(listOf("song-1", "song-2", "song-3", "song-4", "song-6"), started.jobs.map { it["id"] })
    // A reader that missed several changes gets each changed job once, as it is now.
    assertEquals(listOf("song-1", "song-2", "song-3", "song-4", "song-5", "song-6"), owner.changesSince(quiet.revision).jobs.map { it["id"] }.sortedBy { ids.indexOf(it) })
  }

  /** Chunks arrive many times a second; readers (JS, the notification) see progress about once a second. */
  @Test fun readersSeeTransferProgressAtABoundedRateAndOnlyForThatJob() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    for (id in ids) owner.enqueue(song(id), null)
    owner.advance(NoTransfer, NoPublication)
    prepare(owner, "song-1", File(folder, "song-1.mp3"))
    val before = owner.revision
    val seen = mutableListOf<Long>()
    val trickle = object : DurableTransfer {
      override fun cancel(id: String) {}
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        source.parentFile.mkdirs(); source.writeText("audio of $id")
        val start = owner.revision
        for (received in 1L..40L) { now += 100; progress(received, 80, null); seen += owner.revision }
        val changed = owner.changesSince(start)
        assertEquals(listOf("song-1"), changed.jobs.map { it["id"] })
        // What readers see is never more than a second behind.
        assertTrue((changed.jobs.single()["received"] as Long) >= 31L)
        throw DurableFailure("cancelled")
      }
    }
    owner.advance(trickle, NoPublication)
    assertTrue(owner.revision > before)
    // Four seconds of chunks: about four updates (one more as progress is written), not forty.
    assertTrue("seen ${seen.distinct().size} updates", seen.distinct().size in 3..6)
  }

  /**
   * Saving a song (moving, hashing and indexing its file) is slow. It runs outside the journal's
   * lock, so another song's transfer keeps reporting progress and finishing meanwhile, and the
   * deadline thread isn't held up either.
   */
  @Test fun transfersGoOnWhileAnotherSongIsSavedToTheLibrary() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    val revision = owner.refreshPolicy(listOf(folder.path), emptyList())
    owner.enqueue(song("song-1"), null); owner.enqueue(song("song-2"), null)
    owner.advance(NoTransfer, NoPublication)
    val target = File(folder, "song-1.mp3")
    prepare(owner, "song-1", target)
    owner.nextStep(GoodTransfer, NoPublication)!!()
    answer(owner, "song-1", "confirm", mapOf("acceptable" to true))
    owner.nextStep(NoTransfer, GoodPublication)!!()
    answer(owner, "song-1", "publish", mapOf("targetPath" to target.path, "revision" to revision))
    prepare(owner, "song-2", File(folder, "song-2.mp3"))
    val indexing = CountDownLatch(1)
    val indexed = CountDownLatch(1)
    val slowIndex = object : DurablePublication {
      override fun tag(source: File, tags: Map<String, Any?>) = error("No tag expected")
      override fun index(file: File): Map<String, Any?> {
        indexing.countDown(); indexed.await(10, TimeUnit.SECONDS)
        return mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
      }
    }
    val saving = thread { owner.nextStep(NoTransfer, slowIndex)!!() }
    try {
      assertTrue(indexing.await(2, TimeUnit.SECONDS))
      val reported = CountDownLatch(1)
      val sending = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("audio of $id")
          progress(4, 8, null); reported.countDown()
          return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
        }
      }
      val transfer = CompletableFuture.runAsync { owner.nextStep(sending, slowIndex)!!() }
      transfer.get(2, TimeUnit.SECONDS)
      assertTrue(reported.await(0, TimeUnit.SECONDS))
      assertEquals(listOf("publishing", "sourceReady"), phases(owner))
      // The saving song isn't timed out halfway through being saved.
      now += DurableDownloads.JOB_MS
      CompletableFuture.runAsync { owner.expire(NoTransfer) }.get(2, TimeUnit.SECONDS)
      assertEquals("publishing", phases(owner)[0])
    } finally { indexed.countDown(); saving.join(5_000) }
    assertEquals("completed", phases(owner)[0])
    assertEquals(target.path, (owner.snapshot()[0]["saved"] as Map<*, *>)["path"])
    assertTrue(target.isFile)
  }

  private fun prepare(owner: DurableDownloads, id: String, target: File) =
    answer(owner, id, "prepare", mapOf("candidates" to listOf(candidate), "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
  private fun answer(owner: DurableDownloads, id: String, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim(id)!!
    assertTrue(owner.submit(id, lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
  private val candidate = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)

  private fun reopened(journal: File): List<Map<String, Any?>> {
    val copy = File(journal.parentFile, "reopened-${System.nanoTime()}")
    for ((file, to) in JournalStore.files(journal).zip(JournalStore.files(copy))) if (file.exists()) file.copyTo(to)
    return DurableDownloads(copy).snapshot()
  }
  private val GoodTransfer = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      source.parentFile.mkdirs(); source.writeText("audio of $id")
      return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
    }
  }
  private val GoodPublication = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>): String? { source.appendText(" trusted tags"); return null }
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private fun phases(owner: DurableDownloads) = owner.snapshot().map { it["phase"] }
  private val ids = (1..12).map { "song-$it" }
  private fun song(id: String) = mapOf("videoId" to id, "title" to id, "durationMs" to 12_000L)
  private fun inFolder(test: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-journal-load").toFile()
    try { test(folder) } finally { folder.deleteRecursively() }
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
