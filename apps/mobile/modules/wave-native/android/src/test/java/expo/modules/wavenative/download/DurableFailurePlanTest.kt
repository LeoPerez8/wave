package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * The journal keeps no failure list of its own: what a failure leads to (try again, the next
 * peer, the end of the job, YouTube Music) is the plan Core put in the prepare answer.
 */
class DurableFailurePlanTest {
  @Test fun aFailureThePlanEndsTheJobWithNeverTriesTheNextPeer() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      val plan = CorePlans.soulseek(ytMusicOn = false) + ("end" to listOf("unavailable"))
      prepare(owner, File(folder, "Recording.mp3"), plan, listOf(peer, peer + ("username" to "other")))
      val asked = mutableListOf<Any?>()
      owner.advance(transfer { candidate -> asked += candidate["username"]; throw DurableFailure("unavailable") }, Untouched)
      assertEquals(listOf<Any?>("peer"), asked)
      assertEquals("failed", owner.snapshot().single()["phase"])
      assertEquals("unavailable", owner.snapshot().single()["reason"])
    }
  }

  @Test fun aFailureThePlanRetriesIsTriedAgainOnTheSamePeerAfterAPause() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepare(owner, File(folder, "Recording.mp3"), CorePlans.soulseek(ytMusicOn = false) + ("retry" to listOf("storage")), listOf(peer, peer + ("username" to "other")))
      val asked = mutableListOf<Any?>()
      val full = transfer { candidate -> asked += candidate["username"]; throw DurableFailure("storage") }
      owner.advance(full, Untouched)
      assertEquals("prepared", owner.snapshot().single()["phase"])
      owner.advance(full, Untouched)
      assertEquals(listOf<Any?>("peer"), asked)
      now += 2_000
      owner.advance(full, Untouched)
      assertEquals(listOf<Any?>("peer", "peer"), asked)
    }
  }

  @Test fun theFailureOnceEveryPeerIsTriedIsThePlans() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepare(owner, File(folder, "Recording.mp3"), CorePlans.soulseek(ytMusicOn = false) + ("exhausted" to "timedOut"))
      owner.advance(transfer { throw DurableFailure("unavailable") }, Untouched)
      assertEquals("timedOut", owner.snapshot().single()["reason"])
    }
  }

  @Test fun audioThatIsntTheSongFailsTheJobOnlyWhenThePlanSaysWith() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepare(owner, File(folder, "Recording.m4a"), CorePlans.youtube + ("rejected" to null), source = "youtube")
      owner.advance(Served, Untouched)
      answer(owner, "confirm", mapOf("acceptable" to false))
      // Nothing says the song is unavailable: YouTube's stream is tried again.
      assertEquals("prepared", owner.snapshot().single()["phase"])
    }
  }

  @Test fun aFallbackFollowsYoutubesOwnPlanOnceItTakesOver() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      val fallback = mapOf("source" to "youtube", "targetPath" to File(folder, "Recording.m4a").path, "failurePlan" to CorePlans.youtube + ("end" to listOf("failed")))
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("failure" to "unavailable", "failurePlan" to CorePlans.soulseek(ytMusicOn = true), "fallback" to fallback))
      assertEquals("youtube", owner.snapshot().single()["source"])
      owner.advance(transfer { throw DurableFailure("failed") }, Untouched)
      assertEquals("failed", owner.snapshot().single()["phase"])
      assertEquals(1L, owner.snapshot().single()["attempts"])
    }
  }

  @Test fun aJobPreparedBeforeAnswersBroughtAPlanAsksForOneAgainAfterAnUpdate() {
    withFolder { folder ->
      val journal = File(folder, "jobs")
      val owner = DurableDownloads(journal)
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("candidates" to listOf(peer), "targetPath" to File(folder, "Recording.mp3").path, "tags" to emptyMap<String, Any?>()))
      assertEquals("prepared", owner.snapshot().single()["phase"])
      val updated = DurableDownloads(journal)
      assertEquals("preparing", updated.snapshot().single()["phase"])
      assertEquals("prepare", updated.claim("song")!!["decision"])
    }
  }

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val peer = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)

  private fun withFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-plan").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  private fun transfer(receive: (Map<String, Any?>) -> Map<String, Any?>) = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit) = receive(candidate)
  }
  private val Served = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      source.parentFile.mkdirs(); source.writeText("audio")
      return mapOf("partPath" to source.path, "bytes" to source.length(), "mimeType" to "audio/mp4", "durationMs" to 12_000L)
    }
  }
  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object Untouched : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) {}
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private fun prepare(owner: DurableDownloads, target: File, plan: Map<String, Any?>, peers: List<Map<String, Any?>> = listOf(peer), source: String = "soulseek") {
    owner.advance(NoTransfer, Untouched)
    answer(owner, "prepare", mapOf("source" to source, "candidates" to peers, "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to plan))
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("song")!!
    assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
}
