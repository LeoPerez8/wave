package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * A Soulseek download that Soulseek can't deliver carries on from YouTube Music in the same job,
 * for the failures Core's `downloadFallbackFailures` lists in the prepare answer.
 */
class DurableFallbackDownloadsTest {
  @Test fun aRecordingWhosePeersRunOutLandsFromYoutubeMusicInTheSameJob() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val m4a = File(folder, "Artist/Album/08 Recording.m4a")
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Artist/Album/08 Recording.mp3"), m4a)
      val asked = mutableListOf<Any?>()
      val transport = transfer { _, candidate, source ->
        asked += candidate["source"] ?: "soulseek"
        if (candidate["source"] != "youtube") { source.parentFile.mkdirs(); source.writeText("partial"); throw DurableFailure("unavailable") }
        source.parentFile.mkdirs(); source.writeBytes(SERVED); youtubeAudio(source)
      }
      owner.advance(transport, Untouched)
      val fellBack = owner.snapshot().single()
      assertEquals("prepared", fellBack["phase"])
      assertEquals("youtube", fellBack["source"])
      assertEquals("youtube-m4a", fellBack["policy"])
      assertEquals(m4a.path, fellBack["targetPath"])
      owner.advance(transport, Untouched)
      assertEquals(listOf<Any?>("soulseek", "youtube"), asked)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(transport, Untouched)
      answer(owner, "publish", mapOf("targetPath" to m4a.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList())))
      owner.advance(transport, Untouched)
      assertArrayEquals(SERVED, m4a.readBytes())
      assertEquals(listOf("08 Recording.m4a"), audioFiles(folder))
    }
  }

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val peer = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private val SERVED = ByteArray(70_000) { (it * 31 % 251).toByte() }
  private val FALLS_BACK = listOf("unavailable", "accountRejected", "account", "unreachable", "timedOut")

  private fun withFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-fallback").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  private fun audioFiles(folder: File) = folder.walk().filter { it.isFile && !it.name.startsWith(".") && it.extension in listOf("m4a", "mp3") }.map { it.name }.sorted().toList()
  private fun youtubeAudio(source: File) = mapOf("partPath" to source.path, "bytes" to source.length(), "mimeType" to "audio/mp4", "durationMs" to 12_000L)
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
  /** What JS's prepare answer carries with YT Music on: the M4A's place and the failures that fall back. */
  private fun fallback(m4a: File, failures: List<String> = FALLS_BACK) = mapOf("source" to "youtube", "targetPath" to m4a.path, "failures" to failures)
  private fun prepareSoulseek(owner: DurableDownloads, mp3: File, m4a: File?, peers: List<Map<String, Any?>> = listOf(peer)) {
    owner.advance(NoTransfer, Untouched)
    answer(owner, "prepare", mapOf("source" to "soulseek", "candidates" to peers, "targetPath" to mp3.path, "tags" to emptyMap<String, Any?>()) +
      (m4a?.let { mapOf("fallback" to fallback(it)) } ?: emptyMap()))
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("song")!!
    assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
}
