package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/** A YT Music song downloaded from YouTube Music: the M4A it serves goes through the same journal. */
class DurableYoutubeDownloadsTest {
  @Test fun theM4aYoutubeServedIsPublishedByteForByteWhereASoulseekDownloadWouldLand() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val target = File(folder, "Artist/Album/08 Recording.m4a")
      var asked: Map<String, Any?>? = null
      val youtube = transfer { _, candidate, source ->
        asked = candidate
        source.parentFile.mkdirs(); source.writeBytes(SERVED)
        audio(source)
      }
      owner.enqueue(song, null, emptyMap(), "youtube")
      assertEquals("youtube", owner.snapshot().single()["source"])
      prepareYoutube(owner, target)
      assertEquals("youtube-m4a", owner.snapshot().single()["policy"])
      owner.advance(youtube, Untouched)
      assertEquals("youtube", asked!!["source"])
      assertEquals("song", asked!!["videoId"])
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(youtube, Untouched)
      answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList())))
      owner.advance(youtube, Untouched)
      assertArrayEquals(SERVED, target.readBytes())
      assertEquals(target.path, (owner.snapshot().single()["saved"] as Map<*, *>)["path"])
      assertEquals(listOf("08 Recording.m4a"), audioFiles(folder))
    }
  }

  @Test fun aTakenNameGetsAFreeOneKeepingTheM4aExtension() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val target = File(folder, "Recording.m4a").apply { writeText("owner's old audio") }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, target)
      owner.advance(Served, Untouched)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(Served, Untouched)
      answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList())))
      owner.advance(Served, Untouched)
      assertEquals("owner's old audio", target.readText())
      assertArrayEquals(SERVED, File(folder, "Recording (2).m4a").readBytes())
    }
  }

  @Test fun aYoutubeDownloadIsOnlyEverSavedAsM4a() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.mp3"))
      assertEquals("failed", owner.snapshot().single()["phase"])
      assertEquals("failed", owner.snapshot().single()["reason"])
    }
  }

  @Test fun audioOfAnotherLengthIsNeverPublished() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val target = File(folder, "Recording.m4a")
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, target)
      owner.advance(Served, Untouched)
      val part = File(owner.snapshot().single()["sourcePath"] as String)
      assertTrue(part.isFile)
      answer(owner, "confirm", mapOf("acceptable" to false))
      val job = owner.snapshot().single()
      assertEquals("failed", job["phase"])
      assertEquals("ytUnavailable", job["reason"])
      assertFalse(part.exists())
      assertEquals(emptyList<String>(), audioFiles(folder))
    }
  }

  @Test fun aSongYoutubeWontServeFailsAtOnceAndRetryDownloadsItAgain() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val target = File(folder, "Recording.m4a")
      var refuses = true
      val youtube = transfer { _, _, source ->
        if (refuses) throw DurableFailure("ytUnavailable")
        source.parentFile.mkdirs(); source.writeBytes(SERVED); audio(source)
      }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, target)
      owner.advance(youtube, Untouched)
      assertEquals("ytUnavailable", owner.snapshot().single()["reason"])
      assertEquals(1L, owner.snapshot().single()["attempts"])
      refuses = false
      owner.enqueue(song, null, emptyMap(), "youtube")
      assertEquals("queued", owner.snapshot().single()["phase"])
      prepareYoutube(owner, target)
      owner.advance(youtube, Untouched)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  @Test fun offlineIsRetriedAFewTimesThenFailsAsOffline() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      var attempts = 0
      val offline = transfer { _, _, source -> attempts++; source.parentFile.mkdirs(); source.writeText("partial"); throw DurableFailure("offline") }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      repeat(8) { owner.advance(offline, Untouched); now += 15_000 }
      assertEquals(DurableDownloads.MAX_ATTEMPTS.toInt(), attempts)
      assertEquals("offline", owner.snapshot().single()["reason"])
      assertEquals(emptyList<String>(), audioFiles(folder))
    }
  }

  @Test fun aBrokenOrStalledTransferStartsAgainFromYoutubeInsteadOfFailingTheSong() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      var attempts = 0
      val broken = transfer { _, _, source -> attempts++; source.parentFile.mkdirs(); source.writeText("partial"); throw java.io.IOException("Cut off") }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      owner.advance(broken, Untouched)
      assertEquals("prepared", owner.snapshot().single()["phase"])
      // What arrived stays for the next attempt to go on from.
      assertEquals("partial", File(owner.snapshot().single()["sourcePath"] as String).readText())
      now += DurableDownloads.RETRY_PAUSE_MS
      owner.advance(Served, Untouched)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])

      // Each restart is bounded: a stream that keeps breaking fails the song with Retry.
      owner.enqueue(song + ("videoId" to "other"), null, emptyMap(), "youtube")
      owner.cancel("song", NoCancel)
      owner.advance(broken, Untouched)
      answer(owner, "prepare", mapOf("source" to "youtube", "targetPath" to File(folder, "Other.m4a").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.youtube), id = "other")
      repeat(10) { owner.advance(broken, Untouched); now += 15_000 }
      val job = owner.snapshot().single { it["id"] == "other" }
      assertEquals("failed", job["phase"])
      assertEquals("failed", job["reason"])
      assertEquals(1 + DurableDownloads.MAX_ATTEMPTS.toInt(), attempts)
      // Out of attempts, nothing will go on from the part file.
      assertEquals(emptyList<String>(), folder.walk().filter { it.isFile && it.name.contains(".part.") }.map { it.name }.toList())
    }
  }

  @Test fun eachAttemptAtAYoutubeTransferGoesOnInThePartFileTheOneBeforeLeft() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      val parts = mutableListOf<Pair<String, String>>()
      val broken = transfer { _, _, source ->
        parts += source.path to (if (source.isFile) source.readText() else "")
        source.parentFile.mkdirs(); source.appendText("more ")
        throw DurableFailure("offline")
      }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      repeat(3) { owner.advance(broken, Untouched); now += 15_000 }
      assertEquals(3, parts.size)
      assertEquals(1, parts.map { it.first }.distinct().size)
      assertEquals(listOf("", "more ", "more more "), parts.map { it.second })
    }
  }

  @Test fun aYoutubeTransferStillReceivingIsLeftToTheRangeRetriesItsSilenceLimitOutlasts() {
    assertTrue(DurableDownloads.YOUTUBE_STALL_MS > RangeDownload.RETRY_CYCLE_MS)
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      val wanted = mutableListOf<Boolean>()
      var part: File? = null
      val slow = object : DurableTransfer {
        var cancels = 0
        override fun cancel(id: String) { cancels++ }
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          part = source; source.parentFile.mkdirs()
          // Slow to start and then slow to go on, as while ranges are being retried: never quiet for the whole limit.
          now += RangeDownload.RETRY_CYCLE_MS
          owner.expire(this); wanted += owner.transferWanted(id)
          source.writeText("first bytes"); progress(11, SERVED.size.toLong(), null)
          now += RangeDownload.RETRY_CYCLE_MS
          owner.expire(this); wanted += owner.transferWanted(id)
          // Then truly dead: the journal steps in.
          now += DurableDownloads.YOUTUBE_STALL_MS - RangeDownload.RETRY_CYCLE_MS
          owner.expire(this); wanted += owner.transferWanted(id)
          throw DurableFailure("cancelled")
        }
      }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      owner.advance(slow, Untouched)
      assertEquals(listOf(true, true, false), wanted)
      assertEquals(1, slow.cancels)
      val job = owner.snapshot().single()
      assertEquals("prepared", job["phase"])
      // The next attempt goes on from what the stalled one saved.
      assertEquals(part!!.path, job["sourcePath"])
      assertEquals("first bytes", part!!.readText())
      now += DurableDownloads.RETRY_PAUSE_MS
      var resumedFrom: String? = null
      owner.advance(transfer { _, _, source -> resumedFrom = source.readText(); source.writeBytes(SERVED); audio(source) }, Untouched)
      assertEquals("first bytes", resumedFrom)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  /** The stream returning just as the journal cancels it for silence: the next attempt still has its bytes. */
  @Test fun aYoutubeTransferEndingAsItsSilenceCancelLandsKeepsItsPartFile() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      var part: File? = null
      val late = transfer { id, _, source ->
        part = source; source.parentFile.mkdirs(); source.writeText("first bytes")
        now += DurableDownloads.YOUTUBE_STALL_MS + 1_000
        owner.expire(NoCancel)
        assertFalse(owner.transferWanted(id))
        // The request returns normally all the same, as a read already under way can.
        audio(source)
      }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      owner.advance(late, Untouched)
      val job = owner.snapshot().single()
      assertEquals("prepared", job["phase"])
      assertEquals(part!!.path, job["sourcePath"])
      assertEquals("first bytes", part!!.readText())
    }
  }

  /** Each restart downloads the song again from its first byte: on mobile data, never back to back. */
  @Test fun aBrokenTransferStartsAgainOnlyAfterAPauseThatGrowsWithEachAttempt() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      var attempts = 0
      val broken = transfer { _, _, source -> attempts++; source.parentFile.mkdirs(); source.writeText("partial"); throw java.io.IOException("Cut off") }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      owner.advance(broken, Untouched)
      repeat(3) { owner.advance(broken, Untouched) }
      assertEquals(1, attempts)
      now += 1_999
      owner.advance(broken, Untouched)
      assertEquals(1, attempts)
      now += 1
      owner.advance(broken, Untouched)
      assertEquals(2, attempts)
      // The second pause is longer.
      now += 2_000
      owner.advance(broken, Untouched)
      assertEquals(2, attempts)
      now += 2_000
      owner.advance(broken, Untouched)
      assertEquals(3, attempts)
    }
  }

  /** It starts over from byte 0 with an address resolved afresh: what was left of the old stall window isn't its time. */
  @Test fun aTransferCutOffByProcessDeathGetsAFreshWindowToStartIn() {
    withFolder { folder ->
      var now = 1_000L
      val journal = File(folder, "jobs")
      var owner = DurableDownloads(journal, clock = { now })
      class ProcessDeath : Error()
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      assertThrows(ProcessDeath::class.java) { owner.advance(transfer { _, _, _ -> throw ProcessDeath() }, Untouched) }
      owner.flush()
      now += DurableDownloads.ATTEMPT_MS - 10_000
      owner = DurableDownloads(journal, clock = { now })
      val restored = owner
      var wanted: Boolean? = null
      owner.advance(transfer { _, _, source ->
        // Resolving the address and the first bytes take a while.
        now += 20_000
        wanted = restored.transferWanted("song")
        source.parentFile.mkdirs(); source.writeBytes(SERVED); audio(source)
      }, Untouched)
      assertEquals(true, wanted)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  @Test fun aTransferCutOffByProcessDeathStartsOverWithAFreshPartFile() {
    withFolder { folder ->
      var now = 1_000L
      val journal = File(folder, "jobs")
      var owner = DurableDownloads(journal, clock = { now })
      class ProcessDeath : Error()
      val dying = transfer { _, _, source ->
        source.parentFile.mkdirs(); source.writeText("half of the audio")
        throw ProcessDeath()
      }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      assertThrows(ProcessDeath::class.java) { owner.advance(dying, Untouched) }
      owner.flush()
      val before = owner.snapshot().single()
      now += 10_000
      owner = DurableDownloads(journal, clock = { now })
      assertFalse(File(before["sourcePath"] as String).exists())
      assertEquals("youtube", owner.snapshot().single()["source"])
      var restartedIn: File? = null
      owner.advance(transfer { _, candidate, source ->
        assertEquals("youtube", candidate["source"])
        restartedIn = source; assertFalse(source.exists())
        source.parentFile.mkdirs(); source.writeBytes(SERVED); audio(source)
      }, Untouched)
      assertNotEquals(before["sourcePath"], restartedIn!!.path)
      assertArrayEquals(SERVED, restartedIn!!.readBytes())
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  @Test fun cancelDeletesThePartFile() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      var part: File? = null
      val cancelled = transfer { _, _, source ->
        part = source; source.parentFile.mkdirs(); source.writeText("partial")
        owner.cancel("song", NoCancel)
        throw DurableFailure("cancelled")
      }
      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, File(folder, "Recording.m4a"))
      owner.advance(cancelled, Untouched)
      assertEquals("cancelled", owner.snapshot().single()["phase"])
      assertFalse(part!!.exists())
      assertEquals(emptyList<String>(), audioFiles(folder))
    }
  }

  @Test fun retryingTakesTheSourceDecidedAgain() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), null)
      owner.advance(NoCancel, Untouched)
      answer(owner, "prepare", mapOf("failure" to "noSource"))
      assertEquals("noSource", owner.snapshot().single()["reason"])
      owner.enqueue(song, null, emptyMap(), "youtube")
      assertEquals("queued", owner.snapshot().single()["phase"])
      assertEquals("youtube", owner.snapshot().single()["source"])
    }
  }

  @Test fun soulseekJobsKeepTheirMp3320Policy() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoCancel, Untouched)
      answer(owner, "prepare", mapOf("source" to "soulseek", "candidates" to listOf(mapOf("username" to "peer", "filename" to "Recording.m4a", "bitrateKbps" to 320)), "targetPath" to File(folder, "Recording.m4a").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
      assertEquals("unavailable", owner.snapshot().single()["reason"])
      assertEquals("mp3-320", owner.snapshot().single()["policy"])
    }
  }

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val SERVED = ByteArray(70_000) { (it * 31 % 251).toByte() }

  private fun withFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-youtube").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  private fun audioFiles(folder: File) = folder.walk().filter { it.isFile && !it.name.startsWith(".") && it.extension in listOf("m4a", "mp3") }.map { it.name }.sorted().toList()
  private fun audio(source: File) = mapOf("partPath" to source.path, "bytes" to source.length(), "mimeType" to "audio/mp4", "durationMs" to 12_000L)
  private fun transfer(receive: (String, Map<String, Any?>, File) -> Map<String, Any?>) = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit) = receive(id, candidate, source)
  }
  private val Served = transfer { _, _, source -> source.parentFile.mkdirs(); source.writeBytes(SERVED); audio(source) }
  private object NoCancel : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  /** Tagging leaves the audio as it is, so the published file can be compared with what YouTube served. */
  private object Untouched : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>): String? = null
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
