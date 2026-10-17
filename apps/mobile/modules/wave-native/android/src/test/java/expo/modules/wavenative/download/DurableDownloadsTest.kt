package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.*
import org.junit.Test
import expo.modules.wavenative.player.RuntimeOwners

class DurableDownloadsTest {
  @Test fun unavailablePeerFailsOverAndNeverLeavesItsPartialFile() {
    val folder = Files.createTempDirectory("wave-failover").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"), listOf(candidate, candidate + ("username" to "replacement")))
      val offlinePeer = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("partial")
          throw DurableFailure("unavailable")
        }
      }
      owner.advance(offlinePeer, GoodPublication)
      assertEquals("prepared", owner.snapshot().single()["phase"])
      assertFalse(File(owner.snapshot().single()["sourcePath"] as String).exists())
      owner.advance(GoodTransfer, GoodPublication)
      assertEquals("replacement", (owner.snapshot().single()["peer"] as Map<*, *>)["username"])
      assertEquals(2L, owner.snapshot().single()["attempts"])
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun transientNetworkRetriesAreBoundedAcrossRecreation() {
    val folder = Files.createTempDirectory("wave-network").toFile()
    try {
      var now = 1_000L
      val journal = File(folder, "jobs")
      var owner = DurableDownloads(journal, clock = { now })
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"))
      var attempts = 0
      val disconnected = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          attempts++; source.parentFile.mkdirs(); source.writeText("partial")
          throw DurableFailure("offline")
        }
      }
      repeat(8) {
        owner.advance(disconnected, GoodPublication)
        owner = DurableDownloads(journal, clock = { now })
        now += 15_000
      }
      assertEquals(6, attempts)
      assertEquals("failed", owner.snapshot().single()["phase"])
      assertEquals("offline", owner.snapshot().single()["reason"])
      assertTrue(folder.listFiles()!!.none { it.name.endsWith(".mp3") })
    } finally { folder.deleteRecursively() }
  }

  @Test fun storageAndAccountFailuresPreserveExistingLibraryFiles() {
    for (reason in listOf("storage", "account")) {
      val folder = Files.createTempDirectory("wave-failure").toFile()
      try {
        val target = File(folder, "Recording.mp3").apply { writeText("owner's old audio") }
        val owner = DurableDownloads(File(folder, "jobs"))
        owner.enqueue(song, null)
        prepare(owner, target)
        val failing = object : DurableTransfer {
          override fun cancel(id: String) {}
          override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
            source.writeText("partial"); throw DurableFailure(reason)
          }
        }
        owner.advance(failing, GoodPublication)
        assertEquals(reason, owner.snapshot().single()["reason"])
        assertEquals("owner's old audio", target.readText())
        assertFalse(File(owner.snapshot().single()["sourcePath"] as String).exists())
        assertNull(owner.snapshot().single()["saved"])
      } finally { folder.deleteRecursively() }
    }
  }

  @Test fun changedExclusionsRejectAStalePublicationDecision() {
    val folder = Files.createTempDirectory("wave-policy").toFile()
    try {
      val target = File(folder, "Recording.mp3")
      val owner = DurableDownloads(File(folder, "jobs"))
      val before = owner.refreshPolicy(listOf(folder.path), emptyList())
      owner.enqueue(song, null); prepare(owner, target)
      owner.advance(GoodTransfer, GoodPublication)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(GoodTransfer, GoodPublication)
      val stale = owner.claim("song")!!
      val current = owner.refreshPolicy(listOf(folder.path), listOf(folder.path))
      assertFalse(owner.submit("song", stale["generation"] as Long, stale["token"] as String, "publish", mapOf("targetPath" to target.path, "revision" to before)))
      answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to current))
      owner.advance(GoodTransfer, GoodPublication)
      assertEquals("noFolder", owner.snapshot().single()["reason"])
      assertFalse(target.exists())
      assertTrue(folder.listFiles()!!.none { it.name.endsWith(".mp3") })
    } finally { folder.deleteRecursively() }
  }

  @Test fun runtimeOwnersDoNotReleaseEachOther() {
    val owners = RuntimeOwners()
    owners.acquire("auto"); owners.acquire("downloads"); owners.release("auto")
    assertTrue(owners.isWanted())
    owners.acquire("auto"); owners.release("downloads")
    assertTrue(owners.isWanted())
    owners.release("auto"); assertFalse(owners.isWanted())
  }
  @Test fun peerQueueAndAttemptDeadlinesDoNotRestartAfterProcessDeath() {
    val folder = Files.createTempDirectory("wave-peer-queue").toFile()
    try {
      var now = 1_000L
      val journal = File(folder, "jobs")
      var owner = DurableDownloads(journal, clock = { now })
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"))
      class ProcessDeath : Error()
      val waiting = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("partial")
          progress(0, 0, 7)
          throw ProcessDeath()
        }
      }
      assertThrows(ProcessDeath::class.java) { owner.advance(waiting, GoodPublication) }
      val before = owner.snapshot().single()
      assertEquals(7L, before["queuePosition"])
      assertEquals("peer", (before["peer"] as Map<*, *>)["username"])
      now += 90_000
      owner = DurableDownloads(journal, clock = { now })
      assertFalse(File(before["sourcePath"] as String).exists())
      owner.advance(GoodTransfer, GoodPublication)
      val after = owner.snapshot().single()
      assertEquals(before["queueDeadline"], after["queueDeadline"])
      assertEquals(before["attemptDeadline"], after["attemptDeadline"])
      assertEquals(2L, after["attempts"])
    } finally { folder.deleteRecursively() }
  }
  @Test fun aDeletedCompletedFileCanBeDownloadedAgain() {
    val folder = Files.createTempDirectory("wave-redownload").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.refreshPolicy(listOf(folder.path), emptyList())
      val target = File(folder, "Recording.mp3")
      owner.enqueue(song, null)
      complete(owner, target)
      val before = owner.snapshot().single()["generation"] as Long
      assertTrue(target.delete())
      owner.enqueue(song, null)
      assertEquals("queued", owner.snapshot().single()["phase"])
      assertTrue((owner.snapshot().single()["generation"] as Long) > before)
      complete(owner, target)
      assertTrue(target.isFile)
      assertEquals("completed", owner.snapshot().single()["phase"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun forgettingACompletedDownloadKeepsTheFileAndStartsAFreshJobWhenAskedAgain() {
    val folder = Files.createTempDirectory("wave-forget-completed").toFile()
    try {
      val journal = File(folder, "jobs")
      val owner = DurableDownloads(journal)
      val target = File(folder, "Recording.mp3")
      owner.enqueue(song, null)
      owner.enqueue(song + ("videoId" to "alias"), "song")
      complete(owner, target)
      val generation = owner.snapshot().single()["generation"] as Long

      assertTrue(owner.forgetCompleted("song", generation))
      assertTrue(owner.snapshot().isEmpty())
      assertTrue(DurableDownloads(journal).snapshot().isEmpty())
      assertTrue(target.isFile)

      owner.enqueue(song, null)
      val fresh = owner.snapshot().single()
      assertEquals("queued", fresh["phase"])
      assertNull(fresh["saved"])
      assertNull(fresh["acknowledged"])
      assertTrue((fresh["aliases"] as? List<*>)?.isEmpty() != false)
      assertEquals("queued", DurableDownloads(journal).snapshot().single()["phase"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun forgettingACompletedDownloadCannotRemoveItsRetryOrAnUnimportedFile() {
    val folder = Files.createTempDirectory("wave-forget-stale").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      val target = File(folder, "Recording.mp3")
      owner.enqueue(song, null)
      assertFalse(owner.forgetCompleted("song", owner.snapshot().single()["generation"] as Long))
      publish(owner, target)
      assertFalse(owner.forgetCompleted("song", owner.snapshot().single()["generation"] as Long))
      assertEquals("completed", owner.snapshot().single()["phase"])
      answer(owner, "import", mapOf("path" to target.path))
      val oldGeneration = owner.snapshot().single()["generation"] as Long
      assertTrue(target.delete())
      owner.enqueue(song, null)
      assertFalse(owner.forgetCompleted("song", oldGeneration))
      assertEquals("queued", owner.snapshot().single()["phase"])
      complete(owner, target)
      assertFalse(owner.forgetCompleted("song", oldGeneration))
      assertTrue(owner.snapshot().single()["acknowledged"] as Boolean)
    } finally { folder.deleteRecursively() }
  }

  @Test fun queuedJobsGetTheirFullTimeOnceTheyStart() {
    val folder = Files.createTempDirectory("wave-serial").toFile()
    try {
      var now = 1_000L
      // One slot, so the second song waits for it.
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, slots = 1)
      owner.enqueue(song, null)
      owner.enqueue(song + ("videoId" to "later"), null)
      now += DurableDownloads.JOB_MS + 1
      owner.expire(NoTransfer)
      assertEquals(listOf("queued", "queued"), owner.snapshot().map { it["phase"] })
      owner.advance(NoTransfer, NoPublication)
      assertNotNull(owner.claim("song"))
      assertEquals("queued", owner.snapshot().last()["phase"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun anUnreadableJournalStartsEmptyAndAcceptsNewDownloads() {
    val folder = Files.createTempDirectory("wave-corrupt").toFile()
    try {
      val journal = File(folder, "jobs").apply { writeText("not a journal") }
      val owner = DurableDownloads(journal)
      assertEquals(emptyList<Any>(), owner.snapshot())
      owner.enqueue(song, null)
      assertEquals("queued", DurableDownloads(journal).snapshot().single()["phase"])
    } finally { folder.deleteRecursively() }
  }

  /** The download service and Wave's start both open the journal; a full disk must not crash them. */
  @Test fun aJournalThatCantBeRewrittenStillOpensWithItsDownloads() {
    val folder = Files.createTempDirectory("wave-full-disk").toFile()
    try {
      val journal = File(folder, "jobs")
      DurableDownloads(journal).enqueue(song, null)
      val unwritable = File(folder, "jobs.tmp").apply { mkdirs() } // where the next write would go
      val reopened = DurableDownloads(journal)
      assertEquals("queued", reopened.snapshot().single()["phase"])
      unwritable.delete()
      reopened.enqueue(song + ("videoId" to "second"), null)
      assertEquals(listOf("song", "second"), DurableDownloads(journal).snapshot().map { it["id"] })
    } finally { folder.deleteRecursively() }
  }

  @Test fun stoppingTheServiceMidTransferKeepsThePeerForTheNextStart() {
    val folder = Files.createTempDirectory("wave-stop").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"), listOf(candidate, candidate + ("username" to "replacement")))
      val stopped = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("partial")
          owner.stopWork(this)
          throw DurableFailure("cancelled")
        }
      }
      owner.advance(stopped, GoodPublication)
      val job = owner.snapshot().single()
      assertEquals("prepared", job["phase"])
      assertEquals(0L, job["candidateIndex"])
      assertFalse(File(job["sourcePath"] as String).exists())
      owner.startWork()
      owner.advance(GoodTransfer, GoodPublication)
      assertEquals("peer", (owner.snapshot().single()["peer"] as Map<*, *>)["username"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun anOfflineSearchIsRetriedAFewTimesBeforeFailing() {
    val folder = Files.createTempDirectory("wave-search-offline").toFile()
    try {
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      owner.advance(NoTransfer, NoPublication)
      var searches = 0
      while (searches < 10) {
        val lease = owner.claim("song") ?: break
        searches++
        assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("failure" to "offline", "failurePlan" to CorePlans.soulseek(ytMusicOn = false))))
        assertNull(owner.claim("song"))
        now += 30_000
      }
      assertEquals(DurableDownloads.MAX_DECISIONS.toInt(), searches)
      assertEquals("failed", owner.snapshot().single()["phase"])
      assertEquals("offline", owner.snapshot().single()["reason"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun peersThatKeepUsQueuedTooLongEndInAFailureWithRetry() {
    val folder = Files.createTempDirectory("wave-queue-wait").toFile()
    try {
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"), listOf(candidate, candidate + ("username" to "replacement")))
      val cancelled = mutableListOf<String>()
      val queued = object : DurableTransfer {
        override fun cancel(id: String) { cancelled += id }
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("")
          progress(0, 0, 40)
          now += DurableDownloads.QUEUE_MS + 1
          owner.expire(this) // Android's deadline thread
          throw DurableFailure("cancelled")
        }
      }
      owner.advance(queued, GoodPublication)
      assertEquals("prepared", owner.snapshot().single()["phase"])
      assertEquals(1L, owner.snapshot().single()["candidateIndex"])
      owner.advance(queued, GoodPublication)
      val job = owner.snapshot().single()
      assertEquals("failed", job["phase"])
      assertEquals("unavailable", job["reason"])
      assertEquals(listOf("song", "song"), cancelled)
      assertTrue(folder.listFiles()!!.none { it.name.endsWith(".mp3") })
      // Retry starts over with a fresh search rather than reusing the exhausted peers.
      owner.enqueue(song, null)
      assertEquals("queued", owner.snapshot().single()["phase"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun cancellingRemovesPartialAndTaggedFilesButNotLibraryFiles() {
    val folder = Files.createTempDirectory("wave-cancel").toFile()
    try {
      val existing = File(folder, "Recording.mp3").apply { writeText("owner's old audio") }
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      prepare(owner, existing)
      var partial: File? = null
      val cancelledMidway = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          partial = source.apply { parentFile.mkdirs(); writeText("partial") }
          owner.cancel("song", this) // the notification's Cancel
          throw DurableFailure("cancelled")
        }
      }
      owner.advance(cancelledMidway, GoodPublication)
      assertEquals("cancelled", owner.snapshot().single()["phase"])
      assertFalse(partial!!.exists())

      owner.enqueue(song, null)
      prepare(owner, existing)
      owner.advance(GoodTransfer, GoodPublication)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(GoodTransfer, GoodPublication)
      val tagged = File(owner.snapshot().single()["sourcePath"] as String)
      assertTrue(tagged.isFile)
      owner.cancel("song", GoodTransfer) // the row's Cancel Download
      assertFalse(tagged.exists())
      assertEquals("owner's old audio", existing.readText())
      assertEquals(listOf("Recording.mp3"), folder.listFiles()!!.filter { it.extension == "mp3" }.map { it.name })
    } finally { folder.deleteRecursively() }
  }

  @Test fun aDifferentOrUndecodableRecordingIsNeverPublished() {
    val folder = Files.createTempDirectory("wave-mismatch").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.refreshPolicy(listOf(folder.path), emptyList())
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"), listOf(candidate, candidate + ("username" to "live")))
      owner.advance(GoodTransfer, GoodPublication)
      val received = File(owner.snapshot().single()["sourcePath"] as String)
      answer(owner, "confirm", mapOf("acceptable" to false)) // received tags say it's a live take
      assertFalse(received.exists())
      val undecodable = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.writeText("truncated frames"); throw DurableFailure("unavailable")
        }
      }
      owner.advance(undecodable, GoodPublication)
      val job = owner.snapshot().single()
      assertEquals("failed", job["phase"])
      assertEquals("unavailable", job["reason"])
      assertTrue(folder.listFiles()!!.none { it.name.endsWith(".mp3") })
    } finally { folder.deleteRecursively() }
  }

  @Test fun finishedJobsAreForgottenOnTheNextStartAndFailuresOnceCleared() {
    val folder = Files.createTempDirectory("wave-prune").toFile()
    try {
      var now = 1_000L
      val journal = File(folder, "jobs")
      val owner = DurableDownloads(journal, clock = { now })
      owner.refreshPolicy(listOf(folder.path), emptyList())
      owner.enqueue(song, null)
      complete(owner, File(folder, "Recording.mp3"))
      owner.enqueue(song + ("videoId" to "cancelled"), null); owner.cancel("cancelled", NoTransfer)
      owner.enqueue(song + ("videoId" to "failed"), null)
      owner.advance(NoTransfer, NoPublication)
      val lease = owner.claim("failed")!!
      owner.submit("failed", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("failure" to "unavailable"))
      assertEquals(listOf("failed"), DurableDownloads(journal, clock = { now }).snapshot().map { it["id"] })
      // A failure waits on Settings › Downloads however long it takes, until it's cleared there.
      now += 30L * 24 * 60 * 60_000L
      val later = DurableDownloads(journal, clock = { now })
      assertEquals(listOf("failed"), later.snapshot().map { it["id"] })
      assertEquals("unavailable", later.snapshot().single()["reason"])
      later.cancel("failed", NoTransfer)
      assertEquals(emptyList<Any>(), DurableDownloads(journal, clock = { now }).snapshot())
    } finally { folder.deleteRecursively() }
  }

  @Test fun theQueueKeepsItsOrderAcrossRecreation() {
    val folder = Files.createTempDirectory("wave-order").toFile()
    try {
      val journal = File(folder, "jobs")
      val owner = DurableDownloads(journal)
      val ids = (1..12).map { "song-$it" }
      for (id in ids) owner.enqueue(song + ("videoId" to id), null)
      val restored = DurableDownloads(journal)
      assertEquals(ids, restored.snapshot().map { it["id"] })
      restored.advance(NoTransfer, NoPublication)
      assertNotNull(restored.claim("song-1"))
    } finally { folder.deleteRecursively() }
  }

  @Test fun retryingAFailureQueuesItBehindTheDownloadInProgress() {
    val folder = Files.createTempDirectory("wave-retry-order").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      owner.advance(NoTransfer, NoPublication)
      val lease = owner.claim("song")!!
      owner.submit("song", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("failure" to "unavailable"))
      owner.enqueue(song + ("videoId" to "next"), null)
      owner.advance(NoTransfer, NoPublication)
      owner.enqueue(song, null) // Retry Download
      assertEquals(listOf("next", "song"), owner.snapshot().map { it["id"] })
      assertEquals("next", owner.current()!!["id"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun onlyOriginalMp3320CandidatesAreEverTransferred() {
    val folder = Files.createTempDirectory("wave-policy-320").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      owner.advance(NoTransfer, NoPublication)
      val lease = owner.claim("song")!!
      val lowerRate = candidate + ("bitrateKbps" to 256.0)
      assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, "prepare",
        mapOf("candidates" to listOf(lowerRate), "targetPath" to File(folder, "Recording.mp3").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false))))
      owner.advance(NoTransfer, NoPublication)
      assertEquals("failed", owner.snapshot().single()["phase"])
      assertEquals("unavailable", owner.snapshot().single()["reason"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun aSlowPeerKeepsItsTurnWhileBytesKeepArriving() {
    val folder = Files.createTempDirectory("wave-slow").toFile()
    try {
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"))
      val slow = object : DurableTransfer {
        override fun cancel(id: String) = error("A peer still sending must not be cancelled")
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("complete validated audio")
          for (received in 1L..8L) { // eight minutes at a trickle
            now += 60_000; progress(received, 8, null); owner.expire(this)
          }
          return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
        }
      }
      owner.advance(slow, GoodPublication)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun aPeerThatStopsSendingIsReplacedByTheNextOne() {
    val folder = Files.createTempDirectory("wave-stall").toFile()
    try {
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"), listOf(candidate, candidate + ("username" to "replacement")))
      val cancelled = mutableListOf<String>()
      val stalled = object : DurableTransfer {
        override fun cancel(id: String) { cancelled += id }
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("partial")
          progress(1, 8, null)
          now += DurableDownloads.STALL_MS + 1; owner.expire(this)
          throw DurableFailure("cancelled")
        }
      }
      owner.advance(stalled, GoodPublication)
      assertEquals(listOf("song"), cancelled)
      assertEquals("prepared", owner.snapshot().single()["phase"])
      assertEquals(1L, owner.snapshot().single()["candidateIndex"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun aTransferIsWantedOnlyWhileTheJournalsStartQueueAndStallRulesAllowIt() {
    val folder = Files.createTempDirectory("wave-wanted").toFile()
    try {
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"), listOf(candidate, candidate + ("username" to "queued")))
      val wanted = mutableListOf<Boolean>()
      val slowToStart = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          wanted += owner.transferWanted(id)
          now += DurableDownloads.ATTEMPT_MS - 1; wanted += owner.transferWanted(id)
          progress(1, 8, null)
          now += DurableDownloads.STALL_MS - 1; wanted += owner.transferWanted(id)
          progress(2, 8, null)
          now += DurableDownloads.STALL_MS - 1; wanted += owner.transferWanted(id)
          now += 2; wanted += owner.transferWanted(id)
          throw DurableFailure("cancelled")
        }
      }
      owner.advance(slowToStart, GoodPublication)
      // Well past a flat two minutes, a peer keeps its turn while it starts in time and keeps sending.
      assertEquals(listOf(true, true, true, true, false), wanted)
      assertEquals("prepared", owner.snapshot().single()["phase"])

      wanted.clear()
      val waiting = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          progress(0, 0, 4)
          now += DurableDownloads.QUEUE_MS - 1; wanted += owner.transferWanted(id)
          now += 2; wanted += owner.transferWanted(id)
          throw DurableFailure("cancelled")
        }
      }
      owner.advance(waiting, GoodPublication)
      assertEquals(listOf(true, false), wanted)
      assertFalse(owner.transferWanted("song"))
    } finally { folder.deleteRecursively() }
  }

  @Test fun aCancelledTransferIsNoLongerWanted() {
    val folder = Files.createTempDirectory("wave-unwanted").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"))
      val wanted = mutableListOf<Boolean>()
      val cancelled = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          wanted += owner.transferWanted(id)
          owner.cancel("song", this)
          wanted += owner.transferWanted(id)
          throw DurableFailure("cancelled")
        }
      }
      owner.advance(cancelled, GoodPublication)
      assertEquals(listOf(true, false), wanted)
    } finally { folder.deleteRecursively() }
  }

  @Test fun aPublishedFileAwaitingImportPastTheDeadlineIsAnImportFailureNotAFailedDownload() {
    val folder = Files.createTempDirectory("wave-late-import").toFile()
    try {
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      val target = File(folder, "Recording.mp3")
      owner.enqueue(song, null)
      publish(owner, target)
      now += DurableDownloads.JOB_MS + 1
      assertNull(owner.claim("song"))
      val job = owner.snapshot().single()
      assertEquals("completed", job["phase"])
      assertEquals("failed", job["importFailure"])
      assertNull(job["reason"])
      assertTrue(target.isFile)
    } finally { folder.deleteRecursively() }
  }

  @Test fun cancellingAnImportFailureClearsItsRowAndKeepsTheLibraryFile() {
    val folder = Files.createTempDirectory("wave-cancel-import").toFile()
    try {
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      val target = File(folder, "Recording.mp3")
      owner.enqueue(song, null)
      publish(owner, target)
      // Waiting for the Library, the row offers no Cancel and there's nothing to cancel.
      owner.cancel("song", NoTransfer)
      assertEquals("completed", owner.snapshot().single()["phase"])
      repeat(DurableDownloads.MAX_DECISIONS.toInt()) {
        val lease = owner.claim("song")!!
        assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, "import", mapOf("failure" to "storage")))
        now += 2_000
      }
      assertEquals("storage", owner.snapshot().single()["importFailure"])
      // The row shows a failure with Retry and Cancel Download; Cancel clears it.
      owner.cancel("song", NoTransfer)
      assertEquals("cancelled", owner.snapshot().single()["phase"])
      assertTrue(target.isFile)
    } finally { folder.deleteRecursively() }
  }

  @Test fun cancellingOneRequesterLeavesASharedDownloadToTheOthers() {
    val folder = Files.createTempDirectory("wave-alias-cancel").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      val other = song + ("videoId" to "other")
      val cancelled = mutableListOf<String>()
      val transport = object : DurableTransfer by NoTransfer {
        override fun cancel(id: String) { cancelled += id }
      }
      fun requesters() = owner.snapshot().single().let { job ->
        listOf((job["song"] as Map<*, *>)["videoId"]) + (job["aliases"] as List<*>).map { (it as Map<*, *>)["videoId"] }
      }
      owner.enqueue(song, null)
      owner.enqueue(other, "song")
      assertEquals(listOf("song", "other"), requesters())

      owner.cancel("other", transport)
      assertEquals("queued", owner.snapshot().single()["phase"])
      assertEquals(listOf("song"), requesters())

      owner.enqueue(other, "song")
      owner.cancel("song", transport)
      assertEquals("queued", owner.snapshot().single()["phase"])
      assertEquals(listOf("other"), requesters())
      assertEquals(emptyList<String>(), cancelled)

      owner.cancel("other", transport)
      assertEquals("cancelled", owner.snapshot().single()["phase"])
      assertEquals(listOf("song"), cancelled)
    } finally { folder.deleteRecursively() }
  }

  @Test fun theNotificationsCancelStopsTheDownloadForEveryRequester() {
    val folder = Files.createTempDirectory("wave-notification-cancel").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      owner.enqueue(song + ("videoId" to "other"), "song")
      owner.cancelJob("song", NoTransfer)
      assertEquals("cancelled", owner.snapshot().single()["phase"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun anUnwritableLibraryFolderFailsWithoutTouchingExistingFiles() {
    val folder = Files.createTempDirectory("wave-unwritable").toFile()
    try {
      val existing = File(folder, "Recording.mp3").apply { writeText("owner's old audio") }
      File(folder, "Revoked").writeText("a file where the album folder should go")
      val owner = DurableDownloads(File(folder, "jobs"))
      val revision = owner.refreshPolicy(listOf(folder.path), emptyList())
      owner.enqueue(song, null)
      prepare(owner, existing)
      owner.advance(GoodTransfer, GoodPublication)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(GoodTransfer, GoodPublication)
      val tagged = File(owner.snapshot().single()["sourcePath"] as String)
      answer(owner, "publish", mapOf("targetPath" to File(folder, "Revoked/Album/Recording.mp3").path, "revision" to revision))
      owner.advance(GoodTransfer, GoodPublication)
      val job = owner.snapshot().single()
      assertEquals("failed", job["phase"])
      assertEquals("storage", job["reason"])
      assertNull(job["saved"])
      assertFalse(tagged.exists())
      assertEquals("owner's old audio", existing.readText())
      assertEquals(listOf("Recording.mp3"), folder.walk().filter { it.isFile && it.extension == "mp3" }.map { it.name }.toList())
    } finally { folder.deleteRecursively() }
  }

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val candidate = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private val GoodTransfer = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      source.parentFile.mkdirs(); source.writeText("complete validated audio")
      return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
    }
  }
  private val GoodPublication = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) { source.appendText(" trusted tags") }
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private fun prepare(owner: DurableDownloads, target: File, candidates: List<Map<String, Any?>> = listOf(candidate)) {
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "prepare", mapOf("candidates" to candidates, "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
  }
  /** Up to a published file the Library hasn't imported yet. */
  private fun publish(owner: DurableDownloads, target: File) {
    prepare(owner, target)
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "confirm", mapOf("acceptable" to true))
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(target.parentFile.path), emptyList())))
    owner.advance(GoodTransfer, GoodPublication)
    assertTrue(target.isFile)
  }
  private fun complete(owner: DurableDownloads, target: File) {
    prepare(owner, target)
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "confirm", mapOf("acceptable" to true))
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(target.parentFile.path), emptyList())))
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "import", mapOf("path" to target.path))
  }
  @Test fun completedFileIsRecoveredAfterPublicationAndImportedExactlyOnce() {
    val folder = Files.createTempDirectory("wave-publish").toFile()
    try {
      val target = File(folder, "Recording.mp3")
      var owner = DurableDownloads(File(folder, "jobs"))
      owner.refreshPolicy(listOf(folder.path), emptyList())
      owner.enqueue(mapOf("videoId" to "song", "title" to "Recording"), null)
      val transport = object : DurableTransfer {
        override fun cancel(id: String) {}
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          source.parentFile.mkdirs(); source.writeText("complete validated audio")
          return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
        }
      }
      var scannerFails = true
      val publisher = object : DurablePublication {
        override fun tag(source: File, tags: Map<String, Any?>) { source.appendText(" trusted tags") }
        override fun index(file: File): Map<String, Any?> {
          if (scannerFails) throw java.io.IOException("Scanner interrupted")
          return mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
        }
      }
      owner.advance(transport, publisher)
      answer(owner, "prepare", mapOf("candidates" to listOf(mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)), "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
      owner.advance(transport, publisher)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(transport, publisher)
      answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList())))
      owner.advance(transport, publisher)
      assertTrue(target.isFile)
      owner = DurableDownloads(File(folder, "jobs"))
      scannerFails = false
      owner.advance(transport, publisher)
      val completion = owner.claim("song")!!
      assertEquals(target.path, (completion["saved"] as Map<*, *>)["path"])
      assertTrue(owner.submit("song", completion["generation"] as Long, completion["token"] as String, "import", mapOf("path" to target.path)))
      assertFalse(owner.submit("song", completion["generation"] as Long, completion["token"] as String, "import", mapOf("path" to target.path)))
      assertEquals(listOf("Recording.mp3"), folder.listFiles()!!.filter { it.extension == "mp3" && !it.name.startsWith(".") }.map { it.name })
      assertNull(DurableDownloads(File(folder, "jobs")).claim("song"))
    } finally { folder.deleteRecursively() }
  }

  /**
   * The notification reads the journal on the main thread every half second. Tagging fetches the
   * cover over the network and rewrites the file, so a reader that waits for it can freeze Wave.
   */
  @Test fun readingTheJournalDoesNotWaitWhileADownloadIsTagged() {
    val folder = Files.createTempDirectory("wave-readers").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      prepare(owner, File(folder, "Recording.mp3"))
      owner.advance(GoodTransfer, GoodPublication)
      answer(owner, "confirm", mapOf("acceptable" to true))
      val tagging = CountDownLatch(1)
      val coverArrives = CountDownLatch(1)
      val slowCover = object : DurablePublication {
        override fun tag(source: File, tags: Map<String, Any?>) { tagging.countDown(); coverArrives.await(10, TimeUnit.SECONDS) }
        override fun index(file: File): Map<String, Any?> = error("No publication expected")
      }
      val worker = thread { owner.advance(GoodTransfer, slowCover) }
      try {
        assertTrue(tagging.await(2, TimeUnit.SECONDS))
        val reads = CompletableFuture.supplyAsync { Triple(owner.current(), owner.hasWork(), owner.snapshot()) }
        val (current, hasWork, snapshot) = reads.get(1, TimeUnit.SECONDS)
        assertEquals("tagging", current!!["phase"])
        assertTrue(hasWork)
        assertEquals("tagging", snapshot.single()["phase"])
      } finally { coverArrives.countDown(); worker.join(5_000) }
      assertEquals("awaitingPublication", owner.snapshot().single()["phase"])
    } finally { folder.deleteRecursively() }
  }

  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("song")!!
    assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
  @Test fun requestAndDecisionLeaseSurviveRecreationBeforePreparation() {
    val folder = Files.createTempDirectory("wave-jobs").toFile()
    try {
      var now = 1_000L
      val first = DurableDownloads(File(folder, "jobs"), clock = { now })
      first.enqueue(mapOf("videoId" to "song", "title" to "Recording"), null)
      first.advance(NoTransfer, NoPublication)
      val lease = first.claim("song")!!
      val restored = DurableDownloads(File(folder, "jobs"), clock = { now })
      assertEquals("Recording", (restored.snapshot().single()["song"] as Map<*, *>)["title"])
      now += DurableDownloads.LEASE_MS + 1
      restored.advance(NoTransfer, NoPublication)
      val next = restored.claim("song")!!
      assertNotEquals(lease["token"], next["token"])
      assertFalse(restored.submit("song", lease["generation"] as Long, lease["token"] as String, "prepare", emptyMap()))
      assertEquals("mp3-320", restored.snapshot().single()["policy"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun theNotificationCountsTheSongsLeftOfAnAlbum() {
    val folder = Files.createTempDirectory("wave-album").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      for (id in listOf("one", "two", "three")) owner.enqueue(mapOf("videoId" to id, "title" to id), null)
      assertEquals(DownloadCounts(running = 0, left = 3), owner.counts())
      owner.cancel("two", NoTransfer)
      assertEquals(DownloadCounts(running = 0, left = 2), owner.counts())
    } finally { folder.deleteRecursively() }
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
