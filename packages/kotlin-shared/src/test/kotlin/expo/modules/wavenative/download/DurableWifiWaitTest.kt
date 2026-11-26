package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * Download only on Wi-Fi (#1502), as the journal mirrors Core's `downloadWaitsForWifi`: on a
 * metered network the songs not downloaded yet wait, marked `waitingForWifi`, and go on once an
 * unmetered network is back.
 */
class DurableWifiWaitTest {
  @Test fun onAMeteredNetworkSongsWaitAndTheWaitSurvivesARestart() = inFolder { folder ->
    val journal = File(folder, "jobs")
    val first = DurableDownloads(journal)
    assertTrue("the switch is on by default", first.wifiOnly())
    first.setNetwork(metered = true, NoTransfer)
    first.enqueue(song("a"), null, emptyMap(), "youtube")
    first.enqueue(song("b"), null, emptyMap(), "soulseek")
    first.advance(NoTransfer, Untouched)
    assertEquals(listOf("queued", "queued"), first.snapshot().map { it["phase"] })
    assertEquals(listOf(true, true), first.snapshot().map { it["waitingForWifi"] })
    assertNull(first.claim("a"))
    assertFalse("the service stops: no notification for the wait", first.hasWork())
    assertEquals(DownloadServiceStop.WAITING_FOR_WIFI, first.idleStop())
    assertEquals(2, first.wifiWaitingCount())
    first.flush()

    val restored = DurableDownloads(journal)
    assertTrue(restored.metered())
    restored.advance(NoTransfer, Untouched)
    assertEquals(listOf("queued", "queued"), restored.snapshot().map { it["phase"] })
    assertEquals(listOf(true, true), restored.snapshot().map { it["waitingForWifi"] })
    assertFalse(restored.hasWork())

    val before = restored.revision
    restored.setNetwork(metered = false, NoTransfer)
    assertTrue("readers hear the wait is over", restored.revision > before)
    assertEquals(listOf(null, null), restored.snapshot().map { it["waitingForWifi"] })
    assertTrue(restored.hasWork())
    restored.advance(NoTransfer, Untouched)
    assertEquals(listOf("preparing", "preparing"), restored.snapshot().map { it["phase"] })
  }

  @Test fun goingMeteredPausesTheSongsInFlightAndGoingUnmeteredResumesThem() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    val cancelled = mutableListOf<String>()
    val transport = transfer(onCancel = { cancelled += it }) { _, source -> served(source) }
    owner.enqueue(song("a"), null, emptyMap(), "soulseek")
    owner.enqueue(song("downloaded"), null, emptyMap(), "soulseek")
    prepareSoulseek(owner, "downloaded", folder)
    owner.advance(transport, Untouched)
    assertEquals("sourceReady", job(owner, "downloaded")["phase"])
    prepareSoulseek(owner, "a", folder)
    assertEquals("prepared", job(owner, "a")["phase"])

    owner.setNetwork(metered = true, transport)
    assertEquals("queued", job(owner, "a")["phase"])
    assertEquals(true, job(owner, "a")["waitingForWifi"])
    assertTrue("a" in cancelled)
    // A song already downloaded finishes saving.
    assertEquals("sourceReady", job(owner, "downloaded")["phase"])
    assertNull(job(owner, "downloaded")["waitingForWifi"])
    assertNotNull(owner.claim("downloaded"))
    repeat(3) { owner.advance(transport, Untouched) }
    assertEquals("queued", job(owner, "a")["phase"])

    owner.setNetwork(metered = false, transport)
    owner.advance(transport, Untouched)
    assertEquals("preparing", job(owner, "a")["phase"])
  }

  @Test fun turningTheSwitchOffStartsTheWaitingSongsOnAnyNetwork() = inFolder { folder ->
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal)
    owner.setNetwork(metered = true, NoTransfer)
    owner.enqueue(song("a"), null, emptyMap(), "youtube")
    owner.setWifiOnly(false, NoTransfer)
    assertNull(job(owner, "a")["waitingForWifi"])
    owner.advance(NoTransfer, Untouched)
    assertEquals("preparing", job(owner, "a")["phase"])
    owner.flush()
    assertFalse("the switch is kept for the service after a restart", DurableDownloads(journal).wifiOnly())

    owner.setWifiOnly(true, NoTransfer)
    assertEquals("queued", job(owner, "a")["phase"])
    assertEquals(true, job(owner, "a")["waitingForWifi"])
  }

  @Test fun thePauseOutranksTheWaitWhenTheServiceStops() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    owner.setNetwork(metered = true, NoTransfer)
    owner.enqueue(song("a"), null, emptyMap(), "youtube")
    owner.pauseAll(NoTransfer)
    assertEquals(DownloadServiceStop.PAUSED, owner.idleStop())
    owner.resumeAll()
    assertEquals(DownloadServiceStop.WAITING_FOR_WIFI, owner.idleStop())
    // Changing the library folders keeps the network and the switch.
    owner.refreshPolicy(listOf(folder.path), emptyList())
    assertTrue(owner.metered())
    assertEquals(true, job(owner, "a")["waitingForWifi"])
  }

  private fun song(id: String) = mapOf("videoId" to id, "title" to "Recording $id", "durationMs" to 12_000L)
  private fun job(owner: DurableDownloads, id: String) = owner.snapshot().single { it["id"] == id }
  private fun inFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-wifi-wait").toFile()
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
