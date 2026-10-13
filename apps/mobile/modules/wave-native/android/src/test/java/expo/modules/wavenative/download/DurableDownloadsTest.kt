package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
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
    answer(owner, "prepare", mapOf("candidates" to candidates, "targetPath" to target.path, "tags" to emptyMap<String, Any?>()))
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
      answer(owner, "prepare", mapOf("candidates" to listOf(mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)), "targetPath" to target.path, "tags" to emptyMap<String, Any?>()))
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

  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object NoPublication : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) = error("No tag expected")
    override fun index(file: File): Map<String, Any?> = error("No publication expected")
  }
}
