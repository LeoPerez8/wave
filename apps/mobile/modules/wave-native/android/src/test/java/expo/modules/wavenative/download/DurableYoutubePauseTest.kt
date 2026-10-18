package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * YouTube refusing a song, and YouTube downloads paused while YouTube limits them (#468): a lone
 * refusal is tried again after Core's pauses (`downloadFailurePlan`'s `refused`), and while JS
 * has the journal pause YouTube (Core's `ytThrottle`), no YouTube transfer starts, Soulseek's go
 * on, and nothing a paused job waits through counts against it.
 */
class DurableYoutubePauseTest {
  @Test fun aLoneRefusalIsTriedAgainAfterEachPauseThenTheSongIsUnavailable() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    var tries = 0
    val refusing = transfer { _, _ -> tries++; throw DurableFailure("ytRefused") }
    owner.enqueue(song("a"), null, emptyMap(), "youtube")
    prepareYoutube(owner, "a", folder)
    owner.advance(refusing, Untouched)
    assertEquals(1, tries)
    assertEquals("prepared", job(owner, "a")["phase"])
    assertEquals(now, job(owner, "a")["refusedAt"])
    for (pause in REFUSAL_PAUSES) {
      now += pause - 1
      owner.advance(refusing, Untouched)
      now += 1
      owner.advance(refusing, Untouched)
    }
    assertEquals(4, tries)
    assertEquals("failed", job(owner, "a")["phase"])
    assertEquals("ytUnavailable", job(owner, "a")["reason"])
  }

  @Test fun aSongServedAfterARefusalIsDownloadedAndMarkedServed() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    var refuses = true
    val youtube = transfer { _, source -> if (refuses) throw DurableFailure("ytRefused") else served(source) }
    owner.enqueue(song("a"), null, emptyMap(), "youtube")
    prepareYoutube(owner, "a", folder)
    owner.advance(youtube, Untouched)
    refuses = false
    now += REFUSAL_PAUSES[0]
    owner.advance(youtube, Untouched)
    assertEquals("sourceReady", job(owner, "a")["phase"])
    assertEquals(now, job(owner, "a")["servedAt"])
  }

  @Test fun whileYoutubeIsPausedNoYoutubeTransferStartsAndSoulseekGoesOn() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    val asked = mutableListOf<String>()
    val any = transfer { candidate, source -> asked += candidate["source"] as? String ?: "soulseek"; served(source) }
    owner.pauseYoutube(now + 5 * MINUTE, 1)
    owner.enqueue(song("a"), null, emptyMap(), "youtube")
    prepareYoutube(owner, "a", folder)
    owner.enqueue(song("b"), null, emptyMap(), "soulseek")
    prepareSoulseek(owner, "b", folder)
    repeat(3) { owner.advance(any, Untouched) }
    assertEquals(listOf("soulseek"), asked)
    assertEquals("prepared", job(owner, "a")["phase"])
    now += 5 * MINUTE
    owner.advance(any, Untouched)
    assertEquals(listOf("soulseek", "youtube"), asked)
  }

  @Test fun aPausedYoutubeJobIsntChargedForThePause() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    owner.enqueue(song("a"), null, emptyMap(), "youtube")
    prepareYoutube(owner, "a", folder)
    owner.pauseYoutube(now + 30 * MINUTE, 5)
    repeat(30) { now += MINUTE; owner.expire(NoTransfer) }
    assertEquals("prepared", job(owner, "a")["phase"])
    owner.advance(transfer { _, source -> served(source) }, Untouched)
    assertEquals("sourceReady", job(owner, "a")["phase"])
  }

  @Test fun aRefusalDuringThePauseDoesntCountAndWaitsForTheNextTry() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    val until = now + 2 * MINUTE
    // The burst that pauses YouTube lands while this song's transfer is under way.
    val refusedMidPause = transfer { _, _ -> owner.pauseYoutube(until, 1); throw DurableFailure("ytRefused") }
    owner.enqueue(song("a"), null, emptyMap(), "youtube")
    prepareYoutube(owner, "a", folder)
    owner.advance(refusedMidPause, Untouched)
    assertEquals("prepared", job(owner, "a")["phase"])
    assertEquals(0L, job(owner, "a")["refusals"] ?: 0L)
    assertEquals(until, job(owner, "a")["retryAt"])
  }

  @Test fun pausingGivesBackTheRefusalsCountedBeforeIt() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    var tries = 0
    val refusing = transfer { _, _ -> tries++; throw DurableFailure("ytRefused") }
    owner.enqueue(song("a"), null, emptyMap(), "youtube")
    prepareYoutube(owner, "a", folder)
    owner.advance(refusing, Untouched)
    now += REFUSAL_PAUSES[0]
    owner.advance(refusing, Untouched)
    assertEquals(2L, job(owner, "a")["refusals"])
    owner.pauseYoutube(now + MINUTE, 1)
    assertEquals(0L, job(owner, "a")["refusals"] ?: 0L)
    now += MINUTE
    // The full round of tries again after the pause.
    owner.advance(refusing, Untouched)
    for (pause in REFUSAL_PAUSES) { now += pause; owner.advance(refusing, Untouched) }
    assertEquals(2 + 4, tries)
    assertEquals("ytUnavailable", job(owner, "a")["reason"])
  }

  @Test fun thePauseOutlivesARestartAndADownloadFolderChange() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now })
    owner.pauseYoutube(now + 4 * MINUTE, 2)
    owner.refreshPolicy(listOf(folder.path), emptyList())
    owner.flush()
    assertEquals(DurableDownloads.YoutubePause(now + 4 * MINUTE, 2), owner.youtubePause())
    val reopened = DurableDownloads(journal, clock = { now })
    assertEquals(DurableDownloads.YoutubePause(now + 4 * MINUTE, 2), reopened.youtubePause())
  }

  @Test fun noPauseIsReportedOnceItsOver() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    assertNull(owner.youtubePause())
    owner.pauseYoutube(now + MINUTE, 1)
    now += MINUTE
    assertNull(owner.youtubePause())
  }

  private val REFUSAL_PAUSES = ((CorePlans.youtube["refused"] as Map<*, *>)["pausesMs"] as List<*>).map { (it as Number).toLong() }
  private val MINUTE = 60_000L

  private fun song(id: String) = mapOf("videoId" to id, "title" to "Recording $id", "durationMs" to 12_000L)
  private fun job(owner: DurableDownloads, id: String) = owner.snapshot().single { it["id"] == id }
  private fun inFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-yt-pause").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  private fun served(source: File): Map<String, Any?> {
    source.parentFile.mkdirs(); source.writeBytes(ByteArray(1_000) { it.toByte() })
    return mapOf("partPath" to source.path, "bytes" to source.length(), "mimeType" to "audio/mp4", "durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
  }
  private fun transfer(receive: (Map<String, Any?>, File) -> Map<String, Any?>) = object : DurableTransfer {
    override fun cancel(id: String) {}
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
  private fun prepareYoutube(owner: DurableDownloads, id: String, folder: File) {
    owner.advance(NoTransfer, Untouched)
    answer(owner, id, mapOf("source" to "youtube", "targetPath" to File(folder, "$id.m4a").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.youtube))
  }
  private fun prepareSoulseek(owner: DurableDownloads, id: String, folder: File) {
    owner.advance(NoTransfer, Untouched)
    answer(owner, id, mapOf("source" to "soulseek", "candidates" to listOf(mapOf("username" to "peer", "filename" to "$id.mp3", "bitrateKbps" to 320)), "targetPath" to File(folder, "$id.mp3").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
  }
  private fun answer(owner: DurableDownloads, id: String, payload: Map<String, Any?>) {
    val lease = owner.claim(id)!!
    assertTrue(owner.submit(id, lease["generation"] as Long, lease["token"] as String, "prepare", payload))
  }
}
