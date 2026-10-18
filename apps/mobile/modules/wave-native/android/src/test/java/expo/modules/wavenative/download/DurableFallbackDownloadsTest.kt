package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * A Soulseek download that Soulseek can't deliver carries on from YouTube Music in the same job,
 * for the failures Core's `downloadFailurePlan` says fall back, in the prepare answer.
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

  @Test fun aFallbackThatAsksForItsVideoStartsYoutubesTurnWithAPrepareDecision() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val m4a = File(folder, "Recording.m4a")
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("source" to "soulseek", "candidates" to listOf(peer), "targetPath" to File(folder, "Recording.mp3").path, "tags" to mapOf("title" to "Recording"), "failurePlan" to CorePlans.soulseek(ytMusicOn = true), "fallback" to fallback(m4a) + ("prepare" to true)))
      val asked = mutableListOf<Any?>()
      val transport = transfer { _, candidate, source ->
        if (candidate["source"] != "youtube") throw DurableFailure("unavailable")
        asked += candidate["videoId"]
        source.parentFile.mkdirs(); source.writeBytes(SERVED); youtubeAudio(source)
      }
      owner.advance(transport, Untouched)
      // YouTube's turn has come: JS names the video now (the song's audio track), not at Soulseek's prepare.
      val fellBack = owner.claim("song")!!
      assertEquals("prepare", fellBack["decision"])
      assertEquals("youtube", fellBack["source"])
      assertEquals("unavailable", fellBack["fellBackFrom"])
      assertEquals(m4a.path, fellBack["targetPath"])
      assertEquals(mapOf("title" to "Recording"), fellBack["tags"])
      assertTrue(owner.submit("song", fellBack["generation"] as Long, fellBack["token"] as String, "prepare", mapOf("source" to "youtube", "video" to "audioTrack", "candidates" to emptyList<Any?>(), "tags" to fellBack["tags"], "targetPath" to fellBack["targetPath"], "failurePlan" to CorePlans.youtube)))
      owner.advance(transport, Untouched)
      assertEquals(listOf<Any?>("audioTrack"), asked)
      val ready = owner.snapshot().single()
      assertEquals("sourceReady", ready["phase"])
      assertEquals("audioTrack", ready["video"])
      assertEquals("unavailable", ready["fellBackFrom"])
    }
  }

  @Test fun ytMusicTurnedOffBeforeAFallbacksPrepareLeavesSoulseeksFailure() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("failure" to "unavailable", "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = true), "fallback" to fallback(File(folder, "Recording.m4a")) + ("prepare" to true)))
      assertEquals("preparing", owner.snapshot().single()["phase"])
      answer(owner, "prepare", mapOf("failure" to "noSource", "failurePlan" to CorePlans.youtube))
      val failed = owner.snapshot().single()
      assertEquals("failed", failed["phase"])
      assertEquals("unavailable", failed["reason"])
    }
  }

  @Test fun aRejectedAccountOrAnUnreachableServerFallsBackAtOnce() {
    for (reason in listOf("accountRejected", "account", "unreachable")) withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      owner.advance(transfer { _, _, _ -> throw DurableFailure(reason) }, Untouched)
      val job = owner.snapshot().single()
      assertEquals(reason, "youtube", job["source"])
      assertEquals(reason, "prepared", job["phase"])
      assertEquals(reason, 0L, job["attempts"])
      assertEquals(reason, job["fellBackFrom"])
    }
  }

  @Test fun withYtMusicOffSoulseekFailuresEndTheJobAsBefore() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), m4a = null)
      owner.advance(transfer { _, _, _ -> throw DurableFailure("unavailable") }, Untouched)
      assertEquals("unavailable", owner.snapshot().single()["reason"])
      assertEquals("soulseek", owner.snapshot().single()["source"])
    }
    // A rejected account ends the job without trying the next peer.
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), m4a = null, peers = listOf(peer, peer + ("username" to "other")))
      owner.advance(transfer { _, _, _ -> throw DurableFailure("accountRejected") }, Untouched)
      assertEquals("accountRejected", owner.snapshot().single()["reason"])
    }
    // An unreachable server is retried as a dropped connection is, then the job fails saying so.
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      var attempts = 0
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), m4a = null)
      repeat(8) { owner.advance(transfer { _, _, _ -> attempts++; throw DurableFailure("unreachable") }, Untouched); now += 15_000 }
      assertEquals(DurableDownloads.MAX_ATTEMPTS.toInt(), attempts)
      assertEquals("unreachable", owner.snapshot().single()["reason"])
    }
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("failure" to "unreachable", "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
      assertEquals("preparing", owner.snapshot().single()["phase"])
      repeat(2) { now += 20_000; answer(owner, "prepare", mapOf("failure" to "unreachable", "failurePlan" to CorePlans.soulseek(ytMusicOn = false))) }
      assertEquals("unreachable", owner.snapshot().single()["reason"])
    }
  }

  @Test fun aSoulseekFailureWhilePreparingFallsBackWithTheTagsItFound() {
    for (reason in listOf("unavailable", "accountRejected", "unreachable")) withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val m4a = File(folder, "Recording.m4a")
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoTransfer, Untouched)
      answer(owner, "prepare", mapOf("failure" to reason, "tags" to mapOf("title" to "Recording"), "failurePlan" to CorePlans.soulseek(ytMusicOn = true), "fallback" to fallback(m4a)))
      val job = owner.snapshot().single()
      assertEquals(reason, "youtube", job["source"])
      assertEquals(reason, "prepared", job["phase"])
      assertEquals(reason, m4a.path, job["targetPath"])
      assertEquals(reason, mapOf("title" to "Recording"), job["tags"])
    }
  }

  @Test fun offlineFullStorageAndAnUnwritableFolderNeverFallBack() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      repeat(8) { owner.advance(transfer { _, _, _ -> throw DurableFailure("offline") }, Untouched); now += 15_000 }
      assertEquals("soulseek", owner.snapshot().single()["source"])
      assertEquals("offline", owner.snapshot().single()["reason"])
    }
    for (reason in listOf("storage", "noFolder")) withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      owner.advance(transfer { _, _, _ -> throw DurableFailure(reason) }, Untouched)
      assertEquals(reason, "failed", owner.snapshot().single()["phase"])
      assertEquals(reason, reason, owner.snapshot().single()["reason"])
      assertEquals(reason, "soulseek", owner.snapshot().single()["source"])
    }
    for (reason in listOf("offline", "noFolder", "storage")) withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoTransfer, Untouched)
      repeat(3) {
        owner.claim("song")?.let { lease -> owner.submit("song", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("failure" to reason, "failurePlan" to CorePlans.soulseek(ytMusicOn = true), "fallback" to fallback(File(folder, "Recording.m4a")))) }
        now += 20_000
      }
      assertEquals(reason, "failed", owner.snapshot().single()["phase"])
      assertEquals(reason, reason, owner.snapshot().single()["reason"])
    }
  }

  @Test fun cancellingASoulseekDownloadNeverFallsBack() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      owner.advance(transfer { _, _, _ -> owner.cancel("song", NoTransfer); throw DurableFailure("cancelled") }, Untouched)
      assertEquals("cancelled", owner.snapshot().single()["phase"])
      assertEquals("soulseek", owner.snapshot().single()["source"])
    }
  }

  @Test fun aFailureSavingSoulseeksAudioNeverFallsBack() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      owner.advance(GoodSoulseek, Untouched)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(GoodSoulseek, object : DurablePublication {
        override fun tag(source: File, tags: Map<String, Any?>) = throw java.io.IOException("write failed: ENOSPC (No space left on device)")
        override fun index(file: File): Map<String, Any?> = error("No publication expected")
      })
      assertEquals("storage", owner.snapshot().single()["reason"])
      assertEquals("soulseek", owner.snapshot().single()["source"])
    }
  }

  @Test fun soulseekUsingUpItsTwentyMinutesLeavesYoutubeMusicItsOwnBudget() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      // A peer that trickles bytes keeps its turn until the job's time is up.
      val trickle = transfer { id, candidate, source ->
        if (candidate["source"] == "youtube") { source.parentFile.mkdirs(); source.writeBytes(SERVED); return@transfer youtubeAudio(source) }
        progress(id, 64_000)
        now += DurableDownloads.JOB_MS
        owner.expire(NoTransfer)
        throw DurableFailure("cancelled")
      }
      owner.advance(trickle, Untouched)
      val job = owner.snapshot().single()
      assertEquals("youtube", job["source"])
      assertEquals("timedOut", job["fellBackFrom"])
      assertEquals("Out of time while transferring", job["fellBackCause"])
      assertEquals(now + DurableDownloads.JOB_MS, job["deadline"])
      now += 60_000
      owner.advance(trickle, Untouched)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  @Test fun aSongNoSoulseekPeerDeliversGoesToYoutubeMusicTwoMinutesAfterItWentToSoulseek() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      // The job goes to Soulseek at 1 s; three peers, none of which ever connects back.
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"), peers = listOf(peer, peer + ("username" to "b"), peer + ("username" to "c")))
      val cancelled = mutableListOf<String>()
      var wantedJustBefore: Boolean? = null
      var wantedAt: Boolean? = null
      val connecting = object : DurableTransfer {
        override fun cancel(id: String) { cancelled += id }
        override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
          if (candidate["source"] == "youtube") { source.parentFile.mkdirs(); source.writeBytes(SERVED); return youtubeAudio(source) }
          now = 1_000L + 119_999; owner.expire(this); wantedJustBefore = owner.transferWanted(id)
          now = 1_000L + 120_000; owner.expire(this); wantedAt = owner.transferWanted(id)
          throw DurableFailure("cancelled")
        }
      }
      owner.advance(connecting, Untouched)
      assertEquals(true, wantedJustBefore)
      assertEquals(false, wantedAt)
      assertEquals(listOf("song"), cancelled)
      val job = owner.snapshot().single()
      assertEquals("youtube", job["source"])
      assertEquals("prepared", job["phase"])
      assertEquals("timedOut", job["fellBackFrom"])
      assertEquals("Soulseek didn't start a transfer within 2 minutes", job["fellBackCause"])
      // YouTube Music has its own 20 minutes from the hand-over.
      assertEquals(now + DurableDownloads.JOB_MS, job["deadline"])
      owner.advance(connecting, Untouched)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  @Test fun soulseeksTwoMinutesDoNotRunWhileTheDownloadWorkIsStopped() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      now += 60_000
      owner.stopWork(NoTransfer)
      now += 600_000
      owner.startWork()
      now += 59_000; owner.expire(NoTransfer)
      assertEquals("soulseek", owner.snapshot().single()["source"])
      now += 1_000; owner.expire(NoTransfer)
      assertEquals("youtube", owner.snapshot().single()["source"])
    }
  }

  @Test fun aPlaceInAPeersQueueIsNoStartedTransfer() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      owner.advance(transfer { id, candidate, source ->
        if (candidate["source"] == "youtube") { source.parentFile.mkdirs(); source.writeBytes(SERVED); return@transfer youtubeAudio(source) }
        now += 30_000; progressOf.getValue(id)(0, 0, 4)
        now += 90_000; owner.expire(NoTransfer)
        throw DurableFailure("cancelled")
      }, Untouched)
      assertEquals("youtube", owner.snapshot().single()["source"])
      assertEquals("timedOut", owner.snapshot().single()["fellBackFrom"])
    }
  }

  @Test fun aSoulseekTransferStartedWithinTwoMinutesIsNotCutOffAtTheTwoMinuteMark() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      val wanted = mutableListOf<Boolean>()
      val slowPeer = transfer { id, _, source ->
        now += 90_000; progress(id, 64_000)
        // Well past the 2 minutes, bytes still arriving: Soulseek's quality keeps its chance.
        now += 50_000; owner.expire(NoTransfer); wanted += owner.transferWanted(id); progress(id, 128_000)
        now += 50_000; owner.expire(NoTransfer); wanted += owner.transferWanted(id)
        source.parentFile.mkdirs(); source.writeText("complete validated audio")
        mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
      }
      owner.advance(slowPeer, Untouched)
      assertEquals(listOf(true, true), wanted)
      val job = owner.snapshot().single()
      assertEquals("sourceReady", job["phase"])
      assertEquals("soulseek", job["source"])
      assertNull(job["fellBackFrom"])
    }
  }

  @Test fun aSearchThatOutlastsSoulseeksTwoMinutesHandsTheSongToYoutubeMusicWithoutTryingAPeer() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      owner.advance(NoTransfer, Untouched)
      val lease = owner.claim("song")!!
      // The search takes its time; JS keeps its lease meanwhile.
      repeat(5) { now += 25_000; assertTrue(owner.renew("song", lease["generation"] as Long, lease["token"] as String)) }
      assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("source" to "soulseek", "candidates" to listOf(peer), "targetPath" to File(folder, "Recording.mp3").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = true), "fallback" to fallback(File(folder, "Recording.m4a")))))
      val asked = mutableListOf<Any?>()
      val transport = transfer { _, candidate, source ->
        asked += candidate["source"] ?: "soulseek"
        source.parentFile.mkdirs(); source.writeBytes(SERVED); youtubeAudio(source)
      }
      repeat(2) { owner.advance(transport, Untouched) }
      assertEquals(listOf<Any?>("youtube"), asked)
      assertEquals("timedOut", owner.snapshot().single()["fellBackFrom"])
    }
  }

  @Test fun withYtMusicOffSoulseekKeepsTheJobsWholeTime() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), m4a = null)
      var wanted: Boolean? = null
      owner.advance(transfer { id, _, source ->
        // A peer that takes its time to connect still has its 3 minutes.
        now += 150_000; owner.expire(NoTransfer); wanted = owner.transferWanted(id)
        progress(id, 64_000)
        source.parentFile.mkdirs(); source.writeText("complete validated audio")
        mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
      }, Untouched)
      assertEquals(true, wanted)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
      assertEquals("soulseek", owner.snapshot().single()["source"])
    }
  }

  @Test fun aPeerThatStartedInTimeKeepsSoulseeksTurnAcrossProcessDeath() {
    withFolder { folder ->
      var now = 1_000L
      val journal = File(folder, "jobs")
      val owner = DurableDownloads(journal, clock = { now })
      class ProcessDeath : Error()
      owner.enqueue(song, null, emptyMap(), "soulseek")
      // Soulseek's 2 minutes run from 1 s to 121 s; the search takes until 100 s, when the peer's own windows start.
      owner.advance(NoTransfer, Untouched)
      val lease = owner.claim("song")!!
      repeat(3) { now += 33_000; assertTrue(owner.renew("song", lease["generation"] as Long, lease["token"] as String)) }
      assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("source" to "soulseek", "candidates" to listOf(peer), "targetPath" to File(folder, "Recording.mp3").path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = true), "fallback" to fallback(File(folder, "Recording.m4a")))))
      // The peer's first bytes come at 103 s, and Wave dies straight after.
      assertThrows(ProcessDeath::class.java) {
        owner.advance(transfer { id, _, _ -> now += 3_000; progress(id, 64_000); throw ProcessDeath() }, Untouched)
      }
      // Relaunched later; the budget's clock goes on from 103 s, so 22 s on it is at 125 s: past
      // Soulseek's 2 minutes, within the peer's windows.
      now += 3_600_000
      val relaunched = DurableDownloads(journal, clock = { now })
      now += 22_000
      val asked = mutableListOf<Any?>()
      relaunched.advance(transfer { _, candidate, source ->
        asked += candidate["source"] ?: "soulseek"
        source.parentFile.mkdirs(); source.writeText("complete validated audio")
        mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
      }, Untouched)
      assertEquals(listOf<Any?>("soulseek"), asked)
      assertEquals("sourceReady", relaunched.snapshot().single()["phase"])
    }
  }

  @Test fun aJobCutOffByProcessDeathAfterFallingBackResumesFromYoutubeMusic() {
    withFolder { folder ->
      var now = 1_000L
      val journal = File(folder, "jobs")
      var owner = DurableDownloads(journal, clock = { now })
      class ProcessDeath : Error()
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      owner.advance(transfer { _, _, _ -> throw DurableFailure("unavailable") }, Untouched)
      assertThrows(ProcessDeath::class.java) {
        owner.advance(transfer { _, _, source -> source.parentFile.mkdirs(); source.writeText("half"); throw ProcessDeath() }, Untouched)
      }
      now += 10_000
      owner = DurableDownloads(journal, clock = { now })
      val asked = mutableListOf<Any?>()
      val transport = transfer { _, candidate, source ->
        asked += candidate["source"]
        if (candidate["source"] != "youtube") throw DurableFailure("unavailable")
        source.parentFile.mkdirs(); source.writeBytes(SERVED); youtubeAudio(source)
      }
      repeat(3) { owner.advance(transport, Untouched) }
      assertEquals(listOf<Any?>("youtube"), asked)
      assertEquals("sourceReady", owner.snapshot().single()["phase"])
    }
  }

  @Test fun whenYoutubeMusicFailsTooTheRowShowsItsFailureAndRetryStartsFromSoulseek() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      val asked = mutableListOf<Any?>()
      val neither = transfer { _, candidate, _ ->
        asked += candidate["source"] ?: "soulseek"
        throw DurableFailure(if (candidate["source"] == "youtube") "ytUnavailable" else "unavailable")
      }
      repeat(2) { owner.advance(neither, Untouched) }
      assertEquals(listOf<Any?>("soulseek", "youtube"), asked)
      val failed = owner.snapshot().single()
      assertEquals("failed", failed["phase"])
      assertEquals("ytUnavailable", failed["reason"])

      owner.enqueue(song, null, emptyMap(), "soulseek")
      val retried = owner.snapshot().single()
      assertEquals("queued", retried["phase"])
      assertEquals("soulseek", retried["source"])
      assertEquals("mp3-320", retried["policy"])
      assertNull(retried["fellBackFrom"])
      assertNull(retried["fallback"])
      // Soulseek goes first again, and its failure falls back again.
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      repeat(2) { owner.advance(neither, Untouched) }
      assertEquals(listOf<Any?>("soulseek", "youtube", "soulseek", "youtube"), asked)
    }
  }

  @Test fun ytMusicTurnedOffBeforeYoutubeTakesOverLeavesSoulseeksFailure() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      val off = transfer { _, candidate, _ -> throw DurableFailure(if (candidate["source"] == "youtube") "noSource" else "unavailable") }
      repeat(2) { owner.advance(off, Untouched) }
      assertEquals("unavailable", owner.snapshot().single()["reason"])
    }
  }

  @Test fun youtubeAudioOfAnotherLengthFailsWithItsOwnCauseNotSoulseeks() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      val transport = transfer { _, candidate, source ->
        if (candidate["source"] != "youtube") throw DurableFailure("unavailable", java.io.IOException("The peer is unavailable. Retry the download"))
        source.parentFile.mkdirs(); source.writeBytes(SERVED); youtubeAudio(source)
      }
      repeat(2) { owner.advance(transport, Untouched) }
      assertNull(owner.snapshot().single()["cause"])
      answer(owner, "confirm", mapOf("acceptable" to false, "cause" to "YouTube's audio is 0:30 long, but the song is 0:12"))
      val failed = owner.snapshot().single()
      assertEquals("ytUnavailable", failed["reason"])
      assertEquals("YouTube's audio is 0:30 long, but the song is 0:12", failed["cause"])
    }
  }

  @Test fun aYoutubeRejectionWithoutACauseLeavesNoneOfSoulseeks() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      val transport = transfer { _, candidate, source ->
        if (candidate["source"] != "youtube") throw DurableFailure("unavailable", java.io.IOException("The peer is unavailable. Retry the download"))
        source.parentFile.mkdirs(); source.writeBytes(SERVED); youtubeAudio(source)
      }
      repeat(2) { owner.advance(transport, Untouched) }
      answer(owner, "confirm", mapOf("acceptable" to false))
      val failed = owner.snapshot().single()
      assertEquals("ytUnavailable", failed["reason"])
      assertNull(failed["cause"])
    }
  }

  @Test fun soulseeksFailureLeftStandingKeepsSoulseeksCause() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "soulseek")
      prepareSoulseek(owner, File(folder, "Recording.mp3"), File(folder, "Recording.m4a"))
      val off = transfer { _, candidate, _ ->
        if (candidate["source"] == "youtube") throw DurableFailure("noSource", java.io.IOException("YT Music is off"))
        throw DurableFailure("unavailable", java.io.IOException("The peer is unavailable. Retry the download"))
      }
      repeat(2) { owner.advance(off, Untouched) }
      val failed = owner.snapshot().single()
      assertEquals("unavailable", failed["reason"])
      assertEquals("java.io.IOException: The peer is unavailable. Retry the download", failed["cause"])
      // Retry starts from Soulseek with nothing of the last attempt's failure.
      owner.enqueue(song, null, emptyMap(), "soulseek")
      assertNull(owner.snapshot().single()["cause"])
      assertNull(owner.snapshot().single()["fellBackCause"])
    }
  }

  private val GoodSoulseek = transfer { _, _, source ->
    source.parentFile.mkdirs(); source.writeText("complete validated audio")
    mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
  }
  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val peer = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private val SERVED = ByteArray(70_000) { (it * 31 % 251).toByte() }

  private fun withFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-fallback").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  private fun audioFiles(folder: File) = folder.walk().filter { it.isFile && !it.name.startsWith(".") && it.extension in listOf("m4a", "mp3") }.map { it.name }.sorted().toList()
  private fun youtubeAudio(source: File) = mapOf("partPath" to source.path, "bytes" to source.length(), "mimeType" to "audio/mp4", "durationMs" to 12_000L)
  /** The progress callback of the transfer under way, which [progress] reports through. */
  private val progressOf = HashMap<String, (Long, Long, Long?) -> Unit>()
  private fun progress(id: String, received: Long) = progressOf.getValue(id)(received, 1_000_000L, null)
  private fun transfer(receive: (String, Map<String, Any?>, File) -> Map<String, Any?>) = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      progressOf[id] = progress
      return receive(id, candidate, source)
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
  /** What JS's prepare answer carries with YT Music on: the M4A's place and YouTube's failure plan. */
  private fun fallback(m4a: File) = mapOf("source" to "youtube", "targetPath" to m4a.path, "failurePlan" to CorePlans.youtube)
  private fun prepareSoulseek(owner: DurableDownloads, mp3: File, m4a: File?, peers: List<Map<String, Any?>> = listOf(peer)) {
    owner.advance(NoTransfer, Untouched)
    answer(owner, "prepare", mapOf("source" to "soulseek", "candidates" to peers, "targetPath" to mp3.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = m4a != null)) +
      (m4a?.let { mapOf("fallback" to fallback(it)) } ?: emptyMap()))
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("song")!!
    assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
}
