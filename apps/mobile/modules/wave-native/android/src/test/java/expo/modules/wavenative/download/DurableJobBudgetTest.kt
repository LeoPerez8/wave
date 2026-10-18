package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * A job's budget ([DurableDownloads.JOB_MS]) is charged while Wave runs its downloads, and only
 * until the file is downloaded: time with Wave closed, and saving to the Library, aren't charged.
 */
class DurableJobBudgetTest {
  @Test fun aJobKilledMidTransferContinuesWhenWaveOpensHoursLater() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now })
    owner.enqueue(song, null)
    prepare(owner, File(folder, "Recording.mp3"))
    var reopened: DurableDownloads? = null
    val killed = object : DurableTransfer {
      override fun cancel(id: String) {}
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        source.parentFile.mkdirs(); source.writeText("part")
        progress(4, 8, null)
        // Android kills Wave here; it opens again long after the job's budget.
        now += 6 * HOUR
        reopened = DurableDownloads(copyOf(journal), clock = { now })
        throw DurableFailure("cancelled")
      }
    }
    owner.advance(killed, GoodPublication)
    val restarted = reopened!!
    restarted.expire(NoTransfer)
    assertEquals("prepared", restarted.snapshot().single()["phase"])
    restarted.advance(GoodTransfer, GoodPublication)
    assertEquals("sourceReady", restarted.snapshot().single()["phase"])
  }

  @Test fun aJobGoesOnWithTheBudgetItHadLeftWhenWaveWasKilled() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now })
    owner.enqueue(song, null)
    owner.advance(NoTransfer, NoPublication)
    // Fifteen minutes with Wave running, the job waiting (for JS's search, say) and checked as ever.
    repeat(15 * 60) { now += 1_000; owner.expire(NoTransfer) }
    assertEquals("preparing", owner.snapshot().single()["phase"])
    // Killed; opened again hours later, the job has the five minutes it had left, give or take
    // what was charged since the journal last noted the time.
    now += 6 * HOUR
    val reopened = DurableDownloads(copyOf(journal), clock = { now })
    now += 5 * MINUTE - DurableDownloads.BUDGET_WRITE_MS - 1_000
    reopened.expire(NoTransfer)
    assertEquals("preparing", reopened.snapshot().single()["phase"])
    now += 2 * DurableDownloads.BUDGET_WRITE_MS + 1_000
    reopened.expire(NoTransfer)
    assertEquals("timedOut", reopened.snapshot().single()["reason"])
  }

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val candidate = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private fun prepare(owner: DurableDownloads, target: File) {
    owner.advance(NoTransfer, NoPublication)
    answer(owner, "prepare", mapOf("candidates" to listOf(candidate), "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("song")!!
    assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
  /** The journal as a process opening it now finds it; the first owner may go on writing its own. */
  private fun copyOf(journal: File): File = File(journal.parentFile, "reopened-${System.nanoTime()}").also { journal.copyTo(it) }
  private fun inFolder(test: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-job-budget").toFile()
    try { test(folder) } finally { folder.deleteRecursively() }
  }
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
  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object NoPublication : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) = error("No tag expected")
    override fun index(file: File): Map<String, Any?> = error("No publication expected")
  }
  private companion object { const val MINUTE = 60_000L; const val HOUR = 60 * MINUTE }
}
