package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * A quality replacement cut off at any moment picks up where it stopped (#456): killed at each
 * step it ends with the one new file (the old one untouched until publication), its import
 * replayed; the old file is only ever overwritten by a verified copy; Android stopping or refusing
 * the service puts started songs back in line; and a run's stop says what it did.
 */
class DurableReplacementRecoveryTest {
  private val kills = listOf(null, "queued", "searching", "downloading", "tagging", "publishing", "importing")

  @Test fun killedAtAnyStepAnUpgradeOverItsOwnPathEndsWithOneNewFile() {
    for (kill in kills) withFolder { folder ->
      val target = File(folder, "Recording.mp3").apply { writeText("old 128k audio") }
      val imports = drive(folder, target, replaces = target.path, kill = kill)
      assertEquals("$kill", listOf("Recording.mp3"), audioFiles(folder))
      assertEquals("$kill", "complete validated audio trusted tags", target.readText())
      assertEquals("$kill", target.path, imports.last())
    }
  }

  @Test fun killedAtAnyStepAReplacementBesideTheOldFileLeavesItForTheImportToDelete() {
    for (kill in kills) withFolder { folder ->
      val old = File(folder, "Recording.m4a").apply { writeText("old 128k audio") }
      val target = File(folder, "Recording.mp3")
      val imports = drive(folder, target, replaces = null, kill = kill, untilImport = { assertEquals("$kill", "old 128k audio", old.readText()) })
      // The journal publishes one new file, whatever the kill; the import (JS) deletes the old one.
      assertEquals("$kill", listOf("Recording.m4a", "Recording.mp3"), audioFiles(folder))
      assertEquals("$kill", "old 128k audio", old.readText())
      assertEquals("$kill", target.path, imports.last())
    }
  }

  @Test fun publishedButNotImportedTheImportIsAskedForAgainAfterAKill() {
    withFolder { folder ->
      val target = File(folder, "Recording.mp3")
      val imports = drive(folder, target, replaces = null, kill = "importing")
      assertEquals(listOf(target.path, target.path), imports)
    }
  }

  @Test fun theOldFileIsNeverOverwrittenByACopyWhoseDigestDoesNotMatch() {
    withFolder { folder ->
      val target = File(folder, "Recording.mp3").apply { writeText("old 128k audio") }
      var corrupted = false
      lateinit var owner: DurableDownloads
      // The moment publication has recorded the copy's digest, something changes the copy.
      owner = DurableDownloads(File(folder, "jobs"), clock = {
        val job = runCatching { owner.snapshot().singleOrNull() }.getOrNull()
        if (!corrupted && job?.get("phase") == "publishing" && job["digest"] != null) {
          corrupted = true; File(job["publishSource"] as String).writeText("truncated")
        }
        now
      })
      owner.enqueue(song, null)
      publish(owner, target, replaces = target.path)
      assertTrue(corrupted)
      assertEquals("old 128k audio", target.readText())
      assertEquals(listOf("Recording.mp3"), audioFiles(folder))
      assertEquals("failed", owner.snapshot().single()["phase"])
    }
  }

  @Test fun songsAndroidStopsGoBackInLineInTheirPlacesInsteadOfFailing() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, slots = 2)
      for (id in listOf("upgrade:1", "upgrade:2", "upgrade:3")) owner.enqueue(song + ("videoId" to id), null)
      owner.advance(GoodTransfer, GoodPublication)
      assertEquals(listOf("preparing", "preparing", "queued"), owner.snapshot().map { it["phase"] })
      val lease = owner.claim("upgrade:1")!!
      owner.interrupt(GoodTransfer)
      assertEquals(listOf("queued", "queued", "queued"), owner.snapshot().map { it["phase"] })
      assertEquals(listOf("upgrade:1", "upgrade:2", "upgrade:3"), owner.snapshot().map { it["id"] })
      assertTrue(owner.snapshot().none { it["reason"] != null })
      // An answer to a decision from before the stop no longer counts.
      assertFalse(owner.submit("upgrade:1", lease["generation"] as Long, lease["token"] as String, "prepare", prepareAnswer(File(folder, "Recording.mp3"))))
      // The next start goes on in the same order.
      owner.startWork()
      owner.advance(GoodTransfer, GoodPublication)
      assertEquals(listOf("preparing", "preparing", "queued"), owner.snapshot().map { it["phase"] })
    }
  }

  @Test fun aSongAndroidStopsOnceDownloadedGoesOnFromThereAtTheNextStart() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      val target = File(folder, "Recording.mp3")
      prepare(owner, target)
      owner.advance(GoodTransfer, GoodPublication)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(GoodTransfer, GoodPublication)
      assertEquals("awaitingPublication", owner.snapshot().single()["phase"])
      owner.interrupt(GoodTransfer)
      assertEquals("awaitingPublication", owner.snapshot().single()["phase"])
    }
  }

  @Test fun aRetryAfterTheFailedImportsFileWasRemovedDownloadsAgain() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      val target = File(folder, "Recording.mp3")
      publish(owner, target, replaces = null)
      repeat(DurableDownloads.MAX_DECISIONS.toInt()) {
        val lease = owner.claim("upgrade:7")!!
        owner.submit("upgrade:7", lease["generation"] as Long, lease["token"] as String, "import", mapOf("failure" to "failed"))
        now += 2_000
      }
      assertEquals("failed", owner.snapshot().single()["importFailure"])
      // The song keeps its old file: the failed replacement's new file goes.
      target.delete()
      owner.enqueue(song, null)
      assertEquals("queued", owner.snapshot().single()["phase"])
      assertNull(owner.snapshot().single()["saved"])
    }
  }

  @Test fun aRunThatEndsSaysWhatItDid() {
    withFolder { folder ->
      val notes = mutableListOf<String>()
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, note = { notes += it }, log = {})
      for (id in listOf("upgrade:1", "upgrade:2", "upgrade:3")) owner.enqueue(song + ("videoId" to id), null)
      owner.advance(GoodTransfer, GoodPublication)
      fun failPrepare(id: String, reason: String) {
        val lease = owner.claim(id)!!
        owner.submit(id, lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("failure" to reason))
      }
      failPrepare("upgrade:1", "notFound")
      assertEquals(DurableDownloads.ReplacementRun(replaced = 0, kept = 1, failed = 0, waiting = 2, cancelled = 0), owner.replacementRun())
      failPrepare("upgrade:2", "ytUnavailable")
      assertTrue(notes.none { it.startsWith("A quality replacement run") })
      owner.cancelJob("upgrade:3", GoodTransfer)
      assertEquals(listOf("A quality replacement run ended: 0 replaced, 1 kept with no better copy, 1 failed, 0 waiting, 1 cancelled"), notes.filter { it.startsWith("A quality replacement run") })
    }
  }

  /** The run line counts one run: an earlier run's failures aren't counted again. */
  @Test fun aRunCountsOnlyItsOwnSongs() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, log = {})
      owner.enqueue(song + ("videoId" to "upgrade:1"), null)
      owner.advance(GoodTransfer, GoodPublication)
      val lease = owner.claim("upgrade:1")!!
      owner.submit("upgrade:1", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("failure" to "ytUnavailable"))
      assertEquals(DurableDownloads.ReplacementRun(replaced = 0, kept = 0, failed = 1, waiting = 0, cancelled = 0), owner.replacementRun())
      // A later run, once the first is over.
      now += 60_000
      owner.enqueue(song + ("videoId" to "upgrade:2"), null)
      assertEquals(DurableDownloads.ReplacementRun(replaced = 0, kept = 0, failed = 0, waiting = 1, cancelled = 0), owner.replacementRun())
    }
  }

  /** Killed and resumed, a run still counts the songs it replaced before the kill, though the journal forgets them as it opens. */
  @Test fun aResumedRunCountsWhatItReplacedBeforeTheKill() {
    withFolder { folder ->
      val journal = File(folder, "jobs")
      fun job(id: String, phase: String, vararg more: Pair<String, Any?>) =
        mapOf("id" to id, "song" to song + ("videoId" to id), "generation" to 1L, "phase" to phase, "replacementRun" to 5L) + more
      JournalStore(journal).write(
        listOf(
          job("upgrade:1", "completed", "acknowledged" to true),
          job("upgrade:2", "cancelled"),
          job("upgrade:3", "queued"),
        ),
        emptyMap(),
        0L,
      )
      val expected = DurableDownloads.ReplacementRun(replaced = 1, kept = 0, failed = 0, waiting = 1, cancelled = 1)
      assertEquals(expected, DurableDownloads(journal, clock = { now }).replacementRun())
      // And again after another kill: what it carried isn't lost or counted twice.
      assertEquals(expected, DurableDownloads(journal, clock = { now }).replacementRun())
    }
  }

  @Test fun aJournalWithNoReplacementHasNoRun() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song + ("videoId" to "abc"), null)
      assertNull(owner.replacementRun())
    }
  }

  // The pipeline, driven to its import, with Wave killed (the journal reopened) once at [kill].

  private var now = 1_000L

  /**
   * Runs job `upgrade:7` from the queue to its import, killing Wave once at [kill]: holding a
   * decision ("searching", "importing"), or before a step's work ran ("downloading", "tagging",
   * "publishing"), or while it waited ("queued"). [untilImport] runs before each import. Returns
   * the paths the import decisions were asked with.
   */
  private fun drive(folder: File, target: File, replaces: String?, kill: String?, untilImport: () -> Unit = {}): List<String> {
    val journal = File(folder, "jobs")
    var owner = DurableDownloads(journal, clock = { now })
    owner.enqueue(song, null)
    var killed = false
    val imports = mutableListOf<String>()
    fun killNow(at: String): Boolean {
      if (killed || kill != at) return false
      killed = true
      owner = DurableDownloads(journal, clock = { now })
      return true
    }
    repeat(100) {
      val job = owner.snapshot().single()
      if (job["acknowledged"] == true) return imports
      if (job["phase"] == "queued" && killNow("queued")) return@repeat
      val lease = owner.claim("upgrade:7")
      if (lease != null) {
        val decision = lease["decision"] as String
        if (decision == "prepare" && killNow("searching")) return@repeat
        if (decision == "import") {
          imports += (lease["saved"] as Map<*, *>)["path"] as String
          untilImport()
          if (killNow("importing")) return@repeat
        }
        val payload = when (decision) {
          "prepare" -> prepareAnswer(target)
          "confirm" -> mapOf("acceptable" to true, "receiptId" to lease["receiptId"])
          "publish" -> mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList()), "replaces" to replaces)
          else -> mapOf("path" to (lease["saved"] as Map<*, *>)["path"])
        }
        assertTrue(owner.submit("upgrade:7", lease["generation"] as Long, lease["token"] as String, decision, payload))
        return@repeat
      }
      val step = owner.nextStep(GoodTransfer, GoodPublication)
      val phase = owner.snapshot().single()["phase"]
      if (step == null) { now += DurableDownloads.LEASE_MS + 1; owner.expire(GoodTransfer); return@repeat }
      val at = mapOf("transferring" to "downloading", "tagging" to "tagging", "publishing" to "publishing")[phase]
      if (at != null && killNow(at)) return@repeat
      step()
    }
    fail("The replacement never finished (killed at $kill): ${owner.snapshot()}")
    return imports
  }

  private fun withFolder(test: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-recovery").toFile()
    try { test(folder) } finally { folder.deleteRecursively() }
  }

  private fun audioFiles(folder: File) =
    folder.listFiles()!!.filter { (it.extension == "mp3" || it.extension == "m4a") && !it.name.startsWith(".") }.map { it.name }.sorted()

  private val song = mapOf("videoId" to "upgrade:7", "title" to "Recording", "durationMs" to 12_000L)
  private val candidate = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private fun prepareAnswer(target: File) =
    mapOf("candidates" to listOf(candidate), "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false))
  private val GoodTransfer = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      source.parentFile.mkdirs(); source.writeText("complete validated audio")
      return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
    }
  }
  private val GoodPublication = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>): String? { source.appendText(" trusted tags"); return null }
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private fun prepare(owner: DurableDownloads, target: File) {
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "prepare", prepareAnswer(target))
  }
  private fun publish(owner: DurableDownloads, target: File, replaces: String?) {
    prepare(owner, target)
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "confirm", mapOf("acceptable" to true))
    owner.advance(GoodTransfer, GoodPublication)
    val revision = owner.refreshPolicy(listOf(target.parentFile.path), emptyList())
    answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to revision, "replaces" to replaces))
    owner.advance(GoodTransfer, GoodPublication)
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("upgrade:7")!!
    assertTrue(owner.submit("upgrade:7", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
}
