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
        owner.flush()
        // More than a second into the transfer: the journal wrote its start.
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

  @Test fun aSongDownloadedAtTheEndOfItsBudgetIsStillSavedHoweverLongSavingTakes() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    val target = File(folder, "Recording.mp3")
    owner.enqueue(song, null)
    prepare(owner, target)
    val lastMinute = object : DurableTransfer {
      override fun cancel(id: String) {}
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        source.parentFile.mkdirs()
        // Bytes keep coming until the budget's last half minute (it started at 1 000).
        var received = 0L
        while (now + 30_000 < 1_000 + DurableDownloads.JOB_MS) { now += 30_000; progress(++received, 100, null) }
        source.writeText("complete validated audio")
        return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
      }
    }
    owner.advance(lastMinute, GoodPublication)
    assertEquals("sourceReady", owner.snapshot().single()["phase"])
    // From here on, each step waits far longer than the budget had left.
    fun later() { now += 30 * MINUTE; owner.expire(NoTransfer); assertNull(owner.snapshot().single()["reason"]) }
    later(); answer(owner, "confirm", mapOf("acceptable" to true))
    later(); owner.advance(GoodTransfer, GoodPublication)
    assertEquals("awaitingPublication", owner.snapshot().single()["phase"])
    later(); answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList())))
    later(); owner.advance(GoodTransfer, GoodPublication)
    assertEquals("completed", owner.snapshot().single()["phase"])
    later(); answer(owner, "import", mapOf("path" to target.path))
    val job = owner.snapshot().single()
    assertEquals(true, job["acknowledged"])
    assertNull(job["importFailure"])
    assertTrue(target.isFile)
  }

  /** Android can stop the download service and leave Wave running: no download runs meanwhile either. */
  @Test fun noBudgetIsChargedWhileTheDownloadServiceIsStopped() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    owner.enqueue(song, null)
    owner.advance(NoTransfer, NoPublication)
    now += 10 * MINUTE
    owner.stopWork(NoTransfer)
    now += 3 * HOUR
    owner.startWork()
    owner.expire(NoTransfer)
    assertEquals("preparing", owner.snapshot().single()["phase"])
    now += 10 * MINUTE
    owner.expire(NoTransfer)
    assertEquals("timedOut", owner.snapshot().single()["reason"])
  }

  /** Wave opens its journal before the download service starts: the time in between isn't charged. */
  @Test fun noBudgetIsChargedBeforeTheDownloadServiceStarts() = inFolder { folder ->
    var now = 1_000L
    val journal = File(folder, "jobs")
    val owner = DurableDownloads(journal, clock = { now })
    owner.enqueue(song, null)
    owner.advance(NoTransfer, NoPublication)
    now += 15 * MINUTE
    owner.expire(NoTransfer)
    // Killed with five minutes left; opened again, and the service starts an hour later.
    val reopened = DurableDownloads(copyOf(journal), clock = { now }, budgetRunning = false)
    now += HOUR
    reopened.startWork()
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
  private fun copyOf(journal: File): File = File(journal.parentFile, "reopened-${System.nanoTime()}").also { copy ->
    for ((file, to) in JournalStore.files(journal).zip(JournalStore.files(copy))) if (file.exists()) file.copyTo(to)
  }
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
    override fun tag(source: File, tags: Map<String, Any?>): String? { source.appendText(" trusted tags"); return null }
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
