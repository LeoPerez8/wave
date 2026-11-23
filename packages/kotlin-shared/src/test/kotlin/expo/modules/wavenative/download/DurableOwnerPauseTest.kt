package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * The owner's Pause, Resume and Cancel All, from Settings › Downloads and the notification (#1474),
 * and one group's Pause and Resume (#1475), as the journal mirrors Core's `downloadHeld`, `downloadRequested` and `downloadsToCancelAll`.
 */
class DurableOwnerPauseTest {
  @Test fun pauseStopsEverySongNotDownloadedAndNothingStartsUntilResume() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    val cancelled = mutableListOf<String>()
    val transport = transfer(onCancel = { cancelled += it }) { _, source -> served(source) }
    owner.enqueue(song("a"), null, emptyMap(), "soulseek")
    owner.enqueue(song("b"), null, emptyMap(), "soulseek")
    prepareSoulseek(owner, "a", folder)
    assertEquals("prepared", job(owner, "a")["phase"])

    val before = owner.revision
    owner.pauseAll(transport)
    assertTrue(owner.ownerPaused())
    assertTrue("readers hear of the pause", owner.revision > before)
    assertEquals("queued", job(owner, "a")["phase"])
    assertTrue("a" in cancelled)
    repeat(3) { owner.advance(transport, Untouched) }
    assertEquals(listOf("queued", "queued"), owner.snapshot().map { it["phase"] })
    assertNull(owner.claim("a"))
    assertFalse("the service stops once only paused songs are left", owner.hasWork())
    assertEquals(DownloadServiceStop.PAUSED, owner.idleStop())
    assertEquals(2, owner.heldCount())

    owner.resumeAll()
    assertFalse(owner.ownerPaused())
    assertEquals(0, owner.heldCount())
    owner.advance(transport, Untouched)
    assertEquals("preparing", job(owner, "a")["phase"])
    assertTrue(owner.hasWork())
  }

  @Test fun aSongAlreadyDownloadedFinishesSaving() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    val transport = transfer { _, source -> served(source) }
    owner.enqueue(song("a"), null, emptyMap(), "soulseek")
    prepareSoulseek(owner, "a", folder)
    owner.advance(transport, Untouched)
    assertEquals("sourceReady", job(owner, "a")["phase"])
    owner.pauseAll(transport)
    assertEquals("sourceReady", job(owner, "a")["phase"])
    assertTrue(owner.hasWork())
    assertNotNull(owner.claim("a"))
  }

  @Test fun thePauseSurvivesARestart() = inFolder { folder ->
    val journal = File(folder, "jobs")
    val first = DurableDownloads(journal)
    first.enqueue(song("a"), null, emptyMap(), "soulseek")
    first.enqueue(song("b"), null, emptyMap(), "soulseek")
    first.pauseAll(NoTransfer)
    first.flush()
    val restored = DurableDownloads(journal)
    assertTrue(restored.ownerPaused())
    restored.advance(NoTransfer, Untouched)
    assertEquals(listOf("queued", "queued"), restored.snapshot().map { it["phase"] })
    // Changing the library folders keeps it too.
    restored.refreshPolicy(listOf(folder.path), emptyList())
    assertTrue(restored.ownerPaused())
    assertTrue(DurableDownloads(journal).ownerPaused())
  }

  @Test fun aNewRequestWhilePausedDownloadsAndTheRestStaysPaused() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    owner.enqueue(song("a"), null, emptyMap(), "soulseek")
    owner.enqueue(song("b"), null, emptyMap(), "soulseek")
    owner.pauseAll(NoTransfer)
    owner.enqueueAll(listOf(DurableDownloads.Request(song("c"), null, source = "soulseek", release = true)))
    owner.advance(NoTransfer, Untouched)
    assertEquals("preparing", job(owner, "c")["phase"])
    assertEquals("queued", job(owner, "a")["phase"])
    assertTrue(owner.hasWork())
    // A song asked for again (its list's Download again) downloads too.
    owner.enqueueAll(listOf(DurableDownloads.Request(song("a"), null, source = "soulseek", release = true)))
    owner.advance(NoTransfer, Untouched)
    assertEquals("preparing", job(owner, "a")["phase"])
    // Asked for by Retry or Wave itself, it waits for Resume.
    owner.enqueueAll(listOf(DurableDownloads.Request(song("d"), null, source = "soulseek")))
    owner.advance(NoTransfer, Untouched)
    assertEquals("queued", job(owner, "b")["phase"])
    assertEquals("queued", job(owner, "d")["phase"])
    // Pause again holds the songs asked for in between.
    owner.pauseAll(NoTransfer)
    assertEquals(listOf("queued"), owner.snapshot().map { it["phase"] }.distinct())
  }

  @Test fun cancelAllRemovesTheSongsWaitingOrDownloadingAndKeepsTheRest() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    val cancelled = mutableListOf<String>()
    val transport = transfer(onCancel = { cancelled += it }) { _, source -> served(source) }
    owner.enqueue(song("downloaded"), null, emptyMap(), "soulseek")
    prepareSoulseek(owner, "downloaded", folder)
    owner.advance(transport, Untouched)
    owner.enqueue(song("failed"), null, emptyMap(), "soulseek")
    owner.advance(transport, Untouched)
    val lease = owner.claim("failed")!!
    owner.submit("failed", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("failure" to "unavailable"))
    owner.enqueue(song("a"), null, emptyMap(), "soulseek")
    owner.enqueue(song("b"), null, emptyMap(), "soulseek")
    owner.enqueue(song("c"), null, emptyMap(), "soulseek")
    owner.advance(transport, Untouched)

    owner.cancelAll(listOf("a", "downloaded"), transport)
    assertFalse(owner.snapshot().any { it["id"] == "a" && it["phase"] != "cancelled" })
    assertEquals("sourceReady", job(owner, "downloaded")["phase"])

    owner.cancelAll(null, transport)
    assertEquals("sourceReady", job(owner, "downloaded")["phase"])
    assertEquals("failed", job(owner, "failed")["phase"])
    for (id in listOf("a", "b", "c")) assertEquals("cancelled", job(owner, id)["phase"])
    assertTrue(cancelled.containsAll(listOf("a", "b", "c")))
  }

  @Test fun aGroupsPauseHoldsOnlyItsSongs() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    val cancelled = mutableListOf<String>()
    val transport = transfer(onCancel = { cancelled += it }) { _, source -> served(source) }
    owner.enqueue(song("a"), null, emptyMap(), "soulseek", roadTrip)
    owner.enqueue(song("b"), null, emptyMap(), "soulseek", album)
    prepareSoulseek(owner, "a", folder)

    owner.pauseGroup("playlist:12", transport)
    assertEquals(setOf("playlist:12"), owner.pausedGroups())
    assertFalse("the global pause stays off", owner.ownerPaused())
    assertEquals("queued", job(owner, "a")["phase"])
    assertTrue("a" in cancelled)
    owner.advance(transport, Untouched)
    assertEquals("queued", job(owner, "a")["phase"])
    assertEquals("preparing", job(owner, "b")["phase"])
    assertNull(owner.claim("a"))
    assertEquals(1, owner.heldCount())

    owner.resumeGroup("playlist:12")
    assertEquals(emptySet<String>(), owner.pausedGroups())
    assertEquals(0, owner.heldCount())
    owner.advance(transport, Untouched)
    assertEquals("preparing", job(owner, "a")["phase"])
  }

  @Test fun songsAskedForOnTheirOwnPauseAsAGroup() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    owner.enqueue(song("a"), null, emptyMap(), "soulseek")
    owner.enqueue(song("b"), null, emptyMap(), "soulseek", roadTrip)
    owner.pauseGroup("songs", NoTransfer)
    owner.advance(NoTransfer, Untouched)
    assertEquals("queued", job(owner, "a")["phase"])
    assertEquals("preparing", job(owner, "b")["phase"])
  }

  @Test fun theGlobalResumeResumesEveryGroupAndItsPauseKeepsThem() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    owner.enqueue(song("a"), null, emptyMap(), "soulseek", roadTrip)
    owner.pauseGroup("playlist:12", NoTransfer)
    owner.pauseAll(NoTransfer)
    owner.resumeAll()
    assertEquals(emptySet<String>(), owner.pausedGroups())
    owner.pauseGroup("playlist:12", NoTransfer)
    owner.pauseAll(NoTransfer)
    assertEquals(setOf("playlist:12"), owner.pausedGroups())
  }

  @Test fun downloadPlaylistAgainResumesItsGroupAndASongDownloadsAlone() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    owner.enqueue(song("a"), null, emptyMap(), "soulseek", roadTrip)
    owner.enqueue(song("b"), null, emptyMap(), "soulseek", roadTrip)
    owner.enqueue(song("c"), null, emptyMap(), "soulseek", album)
    owner.pauseGroup("playlist:12", NoTransfer)
    owner.pauseGroup("album:3", NoTransfer)
    // A song's own Download: it downloads, and its playlist stays paused.
    owner.enqueueAll(listOf(DurableDownloads.Request(song("a"), null, source = "soulseek", release = true)))
    owner.advance(NoTransfer, Untouched)
    assertEquals("preparing", job(owner, "a")["phase"])
    assertEquals("queued", job(owner, "b")["phase"])
    // Retry stays paused.
    owner.enqueueAll(listOf(DurableDownloads.Request(song("b"), null, source = "soulseek", origin = roadTrip)))
    assertEquals(setOf("playlist:12", "album:3"), owner.pausedGroups())
    // Download Playlist again resumes the playlist, and only it.
    owner.enqueueAll(listOf(DurableDownloads.Request(song("b"), null, source = "soulseek", origin = roadTrip, release = true, resumesGroup = true)))
    assertEquals(setOf("album:3"), owner.pausedGroups())
    owner.advance(NoTransfer, Untouched)
    assertEquals("preparing", job(owner, "b")["phase"])
    assertEquals("queued", job(owner, "c")["phase"])
  }

  @Test fun aPausedGroupStaysPausedAcrossARestart() = inFolder { folder ->
    val journal = File(folder, "jobs")
    val first = DurableDownloads(journal)
    first.enqueue(song("a"), null, emptyMap(), "soulseek", roadTrip)
    first.enqueue(song("b"), null, emptyMap(), "soulseek")
    first.pauseGroup("playlist:12", NoTransfer)
    first.flush()
    val restored = DurableDownloads(journal)
    assertEquals(setOf("playlist:12"), restored.pausedGroups())
    assertFalse(restored.ownerPaused())
    restored.refreshPolicy(listOf(folder.path), emptyList())
    restored.advance(NoTransfer, Untouched)
    assertEquals("queued", job(restored, "a")["phase"])
    assertEquals("preparing", job(restored, "b")["phase"])
    assertEquals(setOf("playlist:12"), DurableDownloads(journal).pausedGroups())
  }

  private val roadTrip = mapOf("kind" to "playlist", "id" to "12", "name" to "Road Trip")
  private val album = mapOf("kind" to "album", "id" to "3", "name" to "Album")

  private fun song(id: String) = mapOf("videoId" to id, "title" to "Recording $id", "durationMs" to 12_000L)
  private fun job(owner: DurableDownloads, id: String) = owner.snapshot().single { it["id"] == id }
  private fun inFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-owner-pause").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  private fun served(source: File): Map<String, Any?> {
    source.parentFile.mkdirs(); source.writeBytes(ByteArray(1_000) { it.toByte() })
    return mapOf("partPath" to source.path, "bytes" to source.length(), "mimeType" to "audio/mpeg", "durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
  }
  private fun transfer(onCancel: (String) -> Unit = {}, receive: (Map<String, Any?>, File) -> Map<String, Any?>) = object : DurableTransfer {
    override fun cancel(id: String) = onCancel(id)
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit) = receive(candidate, source)
  }
  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object Untouched : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>): String? = null
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private fun prepareSoulseek(owner: DurableDownloads, id: String, folder: File) {
    owner.advance(NoTransfer, Untouched)
    val lease = owner.claim(id)!!
    assertTrue(owner.submit(id, lease["generation"] as Long, lease["token"] as String, "prepare", mapOf(
      "source" to "soulseek",
      "candidates" to listOf(mapOf("username" to "peer", "filename" to "$id.mp3", "bitrateKbps" to 320)),
      "targetPath" to File(folder, "$id.mp3").path, "tags" to emptyMap<String, Any?>(),
      "failurePlan" to CorePlans.soulseek(ytMusicOn = false),
    )))
  }
}
