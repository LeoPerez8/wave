package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * What the app log says about a download's time (#385): each YouTube attempt's bytes, time and
 * speed and why it ended, silent restarts, jobs out of attempts and Soulseek's successes.
 */
class DurableDownloadLogTest {
  @Test fun aFinishedYoutubeDownloadLogsItsSizeTimeAndSpeed() {
    withFolder { folder ->
      var now = 1_000L
      val log = mutableListOf<String>()
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, log = { log += it })
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      owner.advance(transfer { source, _ -> now += 120_000; served(source, bytes = 3_600_000) }, Untouched)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
      assertTrue(log.joinToString("\n"), "Download song (youtube) attempt 1 finished: 3.6 MB in 2 min (30 KB/s)" in log)
    }
  }

  @Test fun anAttemptGoingOnFromTheOneBeforeCountsOnlyTheBytesItReceived() {
    withFolder { folder ->
      var now = 1_000L
      val log = mutableListOf<String>()
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, log = { log += it })
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      owner.advance(transfer { source, progress ->
        source.parentFile.mkdirs(); source.writeBytes(ByteArray(1_000_000))
        now += 10_000; progress(1_000_000, 3_000_000, null)
        throw java.io.IOException("Cut off")
      }, Untouched)
      assertTrue(log.joinToString("\n"), "Download song (youtube) attempt 1 failed (unavailable): 1.0 MB in 10 s (100 KB/s)" in log)
      now += DurableDownloads.RETRY_PAUSE_MS
      owner.advance(transfer { source, progress ->
        now += 100_000; progress(3_000_000, 3_000_000, null)
        mapOf("partPath" to source.path, "bytes" to 3_000_000L, "mimeType" to "audio/mp4", "durationMs" to 12_000L)
      }, Untouched)
      assertTrue(log.joinToString("\n"), "Download song (youtube) attempt 2 finished: 2.0 MB in 1 min 40 s (20 KB/s)" in log)
    }
  }

  @Test fun aYoutubeTransferCancelledForSilenceSaysSoWithTheJobAndTheAttempt() {
    withFolder { folder ->
      var now = 1_000L
      val log = mutableListOf<String>()
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, log = { log += it })
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      lateinit var quiet: DurableTransfer
      quiet = transfer { source, progress ->
        source.parentFile.mkdirs(); source.writeText("first bytes")
        now += 30_000; progress(1_200_000, 3_600_000, null)
        now += DurableDownloads.YOUTUBE_STALL_MS; owner.expire(quiet)
        throw DurableFailure("cancelled")
      }
      owner.advance(quiet, Untouched)
      assertEquals("prepared", owner.snapshot().single()["phase"])
      val lines = log.joinToString("\n")
      assertTrue(lines, "Download song (youtube) transferring: cancelled for silence; Attempt 1 went quiet for 4 min after 1.2 MB" in log)
      assertTrue(lines, "Download song (youtube) attempt 1 cancelled for silence: 1.2 MB in 4 min 30 s (4 KB/s)" in log)
    }
  }

  @Test fun aYoutubeAttemptEndedByTheJobsBudgetSaysItRanOutOfTime() {
    withFolder { folder ->
      var now = 1_000L
      val log = mutableListOf<String>()
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, log = { log += it })
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      lateinit var slow: DurableTransfer
      slow = transfer { _, progress ->
        now += DurableDownloads.JOB_MS / 2; progress(2_000_000, 3_600_000, null)
        now += DurableDownloads.JOB_MS / 2; owner.expire(slow)
        throw DurableFailure("cancelled")
      }
      owner.advance(slow, Untouched)
      assertEquals("timedOut", owner.snapshot().single()["reason"])
      assertTrue(log.joinToString("\n"), "Download song (youtube) attempt 1 out of time: 2.0 MB in 20 min (2 KB/s)" in log)
    }
  }

  @Test fun aJobOutOfAttemptsFailsWithThatAsItsCauseAndTheLastError() {
    withFolder { folder ->
      var now = 1_000L
      val log = mutableListOf<String>()
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, log = { log += it })
      val broken = transfer { source, _ -> source.parentFile.mkdirs(); source.writeText("partial"); throw java.io.IOException("Cut off") }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      repeat(10) { owner.advance(broken, Untouched); now += 15_000 }
      val job = owner.snapshot().single()
      assertEquals("failed", job["phase"])
      assertEquals("Out of attempts (6 of 6); last error: java.io.IOException: Cut off", job["cause"])
      assertTrue(log.joinToString("\n"), log.last().endsWith(": failed; Out of attempts (6 of 6); last error: java.io.IOException: Cut off"))
    }
  }

  @Test fun aJobOutOfRetriesFailsWithThatAsItsCauseAndTheLastError() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      val offline = transfer { _, _ -> throw DurableFailure("offline", java.net.UnknownHostException("rr1.googlevideo.com")) }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      repeat(10) { owner.advance(offline, Untouched); now += 15_000 }
      val job = owner.snapshot().single()
      assertEquals("offline", job["reason"])
      assertEquals("Out of attempts (6 of 6); last error: java.net.UnknownHostException: rr1.googlevideo.com", job["cause"])
    }
  }

  @Test fun aFinishedSoulseekDownloadLogsItsPeerSizeAndTime() {
    withFolder { folder ->
      var now = 1_000L
      val log = mutableListOf<String>()
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now }, log = { log += it })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoCancel, Untouched)
      answer(owner, "prepare", mapOf(
        "candidates" to listOf(mapOf("username" to "vinylcat", "filename" to "Recording.mp3", "bitrateKbps" to 320)),
        "targetPath" to File(folder, "Recording.mp3").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = true),
      ))
      owner.advance(transfer { source, _ -> now += 62_000; served(source, bytes = 9_800_000) }, Untouched)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
      assertTrue(log.joinToString("\n"), "Download song (soulseek) finished from vinylcat: 9.8 MB in 1 min 2 s (158 KB/s)" in log)
    }
  }

  /** The service's stop line says "cancelled" when the user cancelled the last song, not "its queue is empty". */
  @Test fun theServiceStopsBecauseTheLastSongWasCancelledOrBecauseTheQueueRanOut() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { 1_000L })
      owner.enqueue(song, null, emptyMap(), "youtube")
      owner.enqueue(song + ("videoId" to "other"), null, emptyMap(), "youtube")
      owner.cancel("song", NoCancel)
      assertTrue(owner.hasWork())
      owner.advance(NoCancel, Untouched)
      answer(owner, "prepare", mapOf("source" to "youtube", "targetPath" to File(folder, "Other.m4a").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.youtube), id = "other")
      owner.advance(transfer { _, _ -> throw DurableFailure("ytUnavailable") }, Untouched)
      assertFalse(owner.hasWork())
      assertEquals(DownloadServiceStop.QUEUE_EMPTY, owner.idleStop())

      owner.enqueue(song + ("videoId" to "third"), null, emptyMap(), "youtube")
      owner.cancelJob("third", NoCancel)
      assertFalse(owner.hasWork())
      assertEquals(DownloadServiceStop.CANCELLED, owner.idleStop())
    }
    assertEquals(
      "The download service stopped after 5 s: the last song was cancelled",
      DownloadServiceLines.stopped(DownloadServiceStop.CANCELLED, 5_000L, DownloadCounts(0, 0)),
    )
  }

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)

  private fun withFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-download-log").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  /** What YouTube served: a small part file, said to be [bytes] long. */
  private fun served(source: File, bytes: Long): Map<String, Any?> {
    source.parentFile.mkdirs(); source.writeText("audio")
    return mapOf("partPath" to source.path, "bytes" to bytes, "mimeType" to "audio/mp4", "durationMs" to 12_000L)
  }
  private fun transfer(cancel: (String) -> Unit = {}, receive: (File, (Long, Long, Long?) -> Unit) -> Map<String, Any?>) = object : DurableTransfer {
    override fun cancel(id: String) = cancel(id)
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit) = receive(source, progress)
  }
  private object NoCancel : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object Untouched : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) {}
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private fun prepareYoutube(owner: DurableDownloads, target: File) {
    owner.advance(NoCancel, Untouched)
    answer(owner, "prepare", mapOf("source" to "youtube", "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.youtube))
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>, id: String = "song") {
    val lease = owner.claim(id)!!
    assertTrue(owner.submit(id, lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
}
