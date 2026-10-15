package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * A missing song's download: its job is named after its Track (`missing:<id>`), never after a
 * video, so the prepare answer says which YouTube video it downloads (`video`), and a Soulseek
 * job's fallback says it too.
 */
class DurableMissingSongDownloadsTest {
  @Test fun aMissingSongDownloadsTheVideoThePrepareAnswerNames() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      var asked: Map<String, Any?>? = null
      owner.enqueue(song, null, emptyMap(), "youtube")
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("source" to "youtube", "video" to "found", "targetPath" to File(folder, "Recording.m4a").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.youtube))
      assertEquals("found", owner.snapshot().single()["video"])
      owner.advance(transfer { _, candidate, source -> asked = candidate; served(source) }, Untouched)
      assertEquals("found", asked!!["videoId"])
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  @Test fun aMissingSongSoulseekCantDeliverFallsBackToTheVideoItsFallbackNames() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val asked = mutableListOf<Any?>()
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoTransfer, Untouched)
      val fallback = mapOf("source" to "youtube", "video" to "found", "targetPath" to File(folder, "Recording.m4a").path, "failurePlan" to CorePlans.youtube)
      answer(owner, "prepare", mapOf("source" to "soulseek", "candidates" to listOf(peer), "targetPath" to File(folder, "Recording.mp3").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = true), "fallback" to fallback))
      assertNull(owner.snapshot().single()["video"])
      val transport = transfer { _, candidate, source ->
        asked += candidate["videoId"] ?: candidate["username"]
        if (candidate["source"] != "youtube") throw DurableFailure("unavailable")
        served(source)
      }
      owner.advance(transport, Untouched)
      owner.advance(transport, Untouched)
      assertEquals(listOf<Any?>("peer", "found"), asked)
      assertEquals("found", owner.snapshot().single()["video"])
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  @Test fun retryForgetsTheVideoUntilThePrepareAnswerNamesOneAgain() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "youtube")
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("source" to "youtube", "video" to "found", "targetPath" to File(folder, "Recording.m4a").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.youtube))
      owner.advance(transfer { _, _, _ -> throw DurableFailure("ytUnavailable") }, Untouched)
      assertEquals("failed", owner.snapshot().single()["phase"])
      owner.enqueue(song, null, emptyMap(), "youtube")
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("failure" to "notFound"))
      assertEquals("notFound", owner.snapshot().single()["reason"])
      assertNull(owner.snapshot().single()["video"])
    }
  }

  private val song = mapOf("videoId" to "missing:7", "title" to "Recording", "durationMs" to 12_000L)
  private val peer = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)

  private fun withFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-missing").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  private fun served(source: File): Map<String, Any?> {
    source.parentFile.mkdirs(); source.writeBytes(ByteArray(1_000))
    return mapOf("partPath" to source.path, "bytes" to source.length(), "mimeType" to "audio/mp4", "durationMs" to 12_000L)
  }
  private fun transfer(receive: (String, Map<String, Any?>, File) -> Map<String, Any?>) = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit) = receive(id, candidate, source)
  }
  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object Untouched : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) {}
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("missing:7")!!
    assertTrue(owner.submit("missing:7", lease["generation"] as Long, lease["token"] as String, decision, payload))
  }
}
