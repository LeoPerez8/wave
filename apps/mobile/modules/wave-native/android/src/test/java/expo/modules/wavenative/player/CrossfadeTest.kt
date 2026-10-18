package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossfadeTest {
  private class Deck : CrossfadeDeck {
    override var positionMs = 0L
    override var ended = false

    // Plain fields under other names: a `var volume` would clash with setVolume on the JVM.
    var sounding = true
    var level = 1f
    var rate = 1f
    var wanted = true
    val seeks = mutableListOf<Long>()

    override val isPlaying get() = sounding

    override fun setVolume(volume: Float) {
      level = volume
    }

    override fun setSpeed(speed: Float) {
      rate = speed
    }

    override fun seekTo(positionMs: Long) {
      seeks += positionMs
      this.positionMs = positionMs
    }

    override fun setPlaying(playing: Boolean) {
      wanted = playing
    }
  }

  /** The playback service: a 3-minute song playing, with another one after it. */
  private class Service : CrossfadeHost {
    override val main = Deck().apply { positionMs = 100_000 }
    override var mainDurationMs: Long? = 180_000
    override var mainWantsToPlay = true
    override var movesOnNaturally = true
    override var nextReady = true
    override var currentKey: String? = "a"
    override var nextKey: String? = "b"
    var tail: Deck? = null
    val opened = mutableListOf<Long>()
    var advanced = 0
    var fadesEnded = 0
    var prefetches = 0

    /** What the app log heard of late next songs: how late, and the overlap left (0: none). */
    val late = mutableListOf<Pair<Long, Long>>()

    override fun openTail(positionMs: Long): CrossfadeDeck {
      opened += positionMs
      return Deck().apply { this.positionMs = positionMs }.also { tail = it }
    }

    override fun closeTail() {
      tail = null
    }

    override fun advance() {
      advanced++
      main.positionMs = 0
      currentKey = nextKey
      nextKey = "c"
    }

    override fun fadeEnded() {
      fadesEnded++
    }

    override fun prefetchNext() {
      prefetches++
    }

    override fun nextLate(lateMs: Long, overlapMs: Long) {
      late += lateMs to overlapMs
    }

    /** What the app log heard of overlaps (or pre-rolls) ending early, and whether the overlap had begun. */
    val endedEarly = mutableListOf<Pair<CrossfadeEnd, Boolean>>()

    override fun endedEarly(why: CrossfadeEnd, overlapping: Boolean) {
      endedEarly += why to overlapping
    }
  }

  private fun crossfade(service: Service, overlapMs: Long = 5000) =
    Crossfade(service).apply { this.overlapMs = overlapMs }

  /** Plays up to [mainMs] of the outgoing song, with its copy in step, and ticks. */
  private fun Crossfade.playTo(service: Service, mainMs: Long) {
    service.main.positionMs = mainMs
    service.tail?.positionMs = mainMs
    tick()
  }

  @Test
  fun atZeroPlaybackStaysGapless() {
    val service = Service().apply { main.positionMs = 177_000 }
    val crossfade = crossfade(service, overlapMs = 0)
    assertNull(crossfade.tick())
    assertTrue(service.opened.isEmpty())
    assertEquals(0, service.advanced)
  }

  @Test
  fun aSongEndingOnItsOwnMovesToTheNextAsTheOverlapStartsWithBothFading() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    val outgoing = service.tail!!
    assertEquals(0f, outgoing.level)

    crossfade.playTo(service, 175_000)
    assertEquals(1, service.advanced)
    assertEquals(1f, outgoing.level)
    assertEquals(0f, service.main.level)

    service.main.positionMs = 2500
    outgoing.positionMs = 177_500
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, service.main.level, 0.01f)
    assertEquals(0, service.fadesEnded)

    service.main.positionMs = 5000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
  }

  @Test
  fun atFifteenSecondsThePreRollGetsInStepAndTheOverlapRunsItsWholeLength() {
    // #407's longest setting, on a 3-minute song: next song asked for at 2:12, the tail opened at
    // 2:42 (3 s before the overlap) and brought in step, the move at 2:45.
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 15_000)
    crossfade.playTo(service, 131_900)
    assertEquals(0, service.prefetches)
    crossfade.playTo(service, 132_000)
    assertEquals(1, service.prefetches)
    crossfade.playTo(service, 161_900)
    assertNull(service.tail)
    crossfade.playTo(service, 162_000)
    val outgoing = service.tail!!
    // Opened a little behind, the tail catches up by speed.
    outgoing.positionMs = 162_100
    service.main.positionMs = 162_250
    crossfade.tick()
    assertTrue(outgoing.rate > 1f)
    crossfade.playTo(service, 164_000)
    assertEquals(1f, outgoing.rate)
    assertEquals(0, service.advanced)

    crossfade.playTo(service, 165_000)
    assertEquals(1, service.advanced)
    service.main.positionMs = 7500
    outgoing.positionMs = 172_500
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, service.main.level, 0.01f)
    service.main.positionMs = 15_000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(1f, service.main.level)
    assertTrue(service.endedEarly.isEmpty())
    assertTrue(service.late.isEmpty())
  }

  @Test
  fun aSongThatDoesNotMoveOnNaturallyDoesNotFade() {
    // Repeat one, the last song, or an end-of-song sleep timer.
    val service = Service().apply { movesOnNaturally = false }
    val crossfade = crossfade(service)
    crossfade.playTo(service, 174_000)
    crossfade.playTo(service, 175_000)
    assertTrue(service.opened.isEmpty())
    assertEquals(0, service.advanced)
  }

  @Test
  fun anEndOfSongSleepTimerSetBeforeTheOverlapCancelsIt() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    service.movesOnNaturally = false
    crossfade.playTo(service, 175_000)
    assertNull(service.tail)
    assertEquals(0, service.advanced)
  }

  @Test
  fun aManualChangeDuringTheFadeSwitchesAtOnce() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    crossfade.interrupt(CrossfadeEnd.Moved)
    assertNull(service.tail)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
  }

  @Test
  fun anOutgoingCopyThatStallsOrFailsIsDroppedSoonAfterTheOverlap() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    val outgoing = service.tail!!
    // It stops moving 1 s into the fade (an error, or a stream that stalls), never ending.
    outgoing.positionMs = 176_000
    outgoing.sounding = false

    service.main.positionMs = 5000
    crossfade.tick()
    assertEquals(0, service.fadesEnded)

    service.main.positionMs = 7000
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)

    // The next song ending on its own fades as usual.
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    assertEquals(2, service.advanced)
  }

  @Test
  fun aManualChangeBeforeTheOverlapDropsTheOutgoingCopy() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.interrupt(CrossfadeEnd.Moved)
    assertNull(service.tail)
    assertEquals(0, service.fadesEnded)
  }

  @Test
  fun pausingDuringTheFadePausesBothSongs() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    val outgoing = service.tail!!

    service.mainWantsToPlay = false
    crossfade.onPlayingChanged()
    assertFalse(outgoing.wanted)
    assertNull(crossfade.tick())

    service.mainWantsToPlay = true
    crossfade.onPlayingChanged()
    assertTrue(outgoing.wanted)
  }

  @Test
  fun theOutgoingCopyIsBroughtInStepBeforeTheOverlap() {
    val service = Service()
    val crossfade = crossfade(service)
    service.main.positionMs = 172_000
    crossfade.tick()
    val outgoing = service.tail!!

    outgoing.positionMs = 172_100
    crossfade.tick()
    assertTrue(outgoing.rate < 1f)

    outgoing.positionMs = 171_900
    crossfade.tick()
    assertTrue(outgoing.rate > 1f)

    outgoing.positionMs = 174_000
    crossfade.tick()
    assertEquals(1, outgoing.seeks.size)

    // Out of step at the overlap: the handoff waits for it.
    service.main.positionMs = 175_000
    outgoing.positionMs = 175_100
    crossfade.tick()
    assertEquals(0, service.advanced)
    outgoing.positionMs = 175_000
    crossfade.tick()
    assertEquals(1, service.advanced)
    assertEquals(1f, outgoing.rate)
  }

  @Test
  fun aShortSongFadesOverHalfItsLength() {
    val service = Service().apply { mainDurationMs = 6000 }
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.playTo(service, 1000)
    crossfade.playTo(service, 3000)
    assertEquals(1, service.advanced)
  }

  @Test
  fun aSongOfUnknownLengthPlaysThrough() {
    val service = Service().apply { mainDurationMs = null }
    val crossfade = crossfade(service)
    crossfade.playTo(service, 179_000)
    assertTrue(service.opened.isEmpty())
  }

  @Test
  fun theNextSongIsMadeReadyWellBeforeTheOverlap() {
    // 3 minutes, a 10 s overlap: 30 s before the pre-roll (Core's crossfadePrefetchAt).
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.playTo(service, 136_900)
    assertEquals(0, service.prefetches)
    crossfade.playTo(service, 137_000)
    assertEquals(1, service.prefetches)
    crossfade.playTo(service, 150_000)
    assertEquals(1, service.prefetches)
  }

  @Test
  fun aQueueSyncReportingTheSameSongAgainDoesntAskForTheNextOneAgain() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    assertTrue(crossfade.moved("a"))
    crossfade.playTo(service, 137_000)
    assertEquals(1, service.prefetches)
    // JS syncs the queue: the player reports the song it's on again.
    assertFalse(crossfade.moved("a"))
    crossfade.playTo(service, 140_000)
    assertEquals(1, service.prefetches)
    // Another song: its next one is asked for in its turn.
    assertTrue(crossfade.moved("c"))
    crossfade.playTo(service, 137_000)
    assertEquals(2, service.prefetches)
  }

  @Test
  fun onlyAMoveToAnotherSongCountsAsTheSongChangingDuringThePreRollAndTheOverlap() {
    // The service turns the next song's preload off again only when the song changes.
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.moved("a")
    crossfade.playTo(service, 172_000)
    assertFalse(crossfade.moved("a"))
    crossfade.playTo(service, 175_000)
    assertTrue(crossfade.moved("b"))
    assertFalse(crossfade.moved("b"))
    assertTrue(service.endedEarly.isEmpty())
  }

  @Test
  fun aLateNextSongKeepsTheOutgoingOneAtFullVolumeThenOverlapsForWhatIsLeft() {
    val service = Service().apply { nextReady = false }
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.playTo(service, 167_000)
    val outgoing = service.tail!!

    // The overlap should begin at 2:50, but the next song isn't buffered.
    crossfade.playTo(service, 170_000)
    crossfade.playTo(service, 172_000)
    assertEquals(0, service.advanced)
    assertEquals(1f, service.main.level)
    assertEquals(0, service.fadesEnded)

    // Buffered 4 s late: the two overlap for the 6 s left.
    service.nextReady = true
    crossfade.playTo(service, 174_000)
    assertEquals(1, service.advanced)
    assertEquals(1f, outgoing.level)

    service.main.positionMs = 3000
    outgoing.positionMs = 177_000
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, service.main.level, 0.01f)
    assertEquals(listOf(4000L to 6000L), service.late)
  }

  @Test
  fun aNextSongNeverReadyBeforeTheEndPlaysGaplessWithNoFadeOut() {
    val service = Service().apply { nextReady = false }
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.playTo(service, 167_000)
    crossfade.playTo(service, 175_000)
    crossfade.playTo(service, 179_100)
    assertNull(service.tail)
    assertEquals(0, service.advanced)
    assertEquals(1f, service.main.level)
    assertEquals(1, service.late.size)
    assertEquals(0L, service.late.single().second)
  }

  @Test
  fun aNextSongStillBufferingAfterTheMoveWaitsWithTheOutgoingOneAtFullVolume() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.playTo(service, 167_000)
    crossfade.playTo(service, 170_000)
    assertEquals(1, service.advanced)
    val outgoing = service.tail!!

    // The session's player is on the next song, still buffering at its start.
    service.main.sounding = false
    outgoing.positionMs = 172_000
    crossfade.tick()
    assertEquals(1f, outgoing.level)
    assertEquals(0f, service.main.level)

    // It sounds 4 s late: the overlap is the 6 s left, both fading together.
    service.main.sounding = true
    outgoing.positionMs = 174_000
    crossfade.tick()
    assertEquals(1f, outgoing.level, 0.01f)
    service.main.positionMs = 3000
    outgoing.positionMs = 177_000
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, service.main.level, 0.01f)
    assertEquals(listOf(4000L to 6000L), service.late)
  }

  @Test
  fun aNextSongThatSoundsOnlyAfterTheOutgoingOneEndedStartsAtFullVolume() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.playTo(service, 167_000)
    crossfade.playTo(service, 170_000)
    val outgoing = service.tail!!
    service.main.sounding = false
    outgoing.positionMs = 179_000
    crossfade.tick()
    assertEquals(1f, outgoing.level)

    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
    assertEquals(0L, service.late.single().second)
  }

  @Test
  fun theQueueSyncAfterTheMoveKeepsTheOverlapGoing() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    val outgoing = service.tail!!

    // The player reports the move to the song being faded into, again and again.
    crossfade.moved("b")
    crossfade.moved("b")
    service.main.positionMs = 2500
    outgoing.positionMs = 177_500
    crossfade.tick()
    assertEquals(outgoing, service.tail)
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0, service.fadesEnded)
    assertTrue(service.endedEarly.isEmpty())
  }

  @Test
  fun aMoveToAnotherSongDuringTheOverlapEndsItAndSaysWhy() {
    // A skip, picking a song, or the song being faded into replaced.
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    crossfade.moved("c")
    assertNull(service.tail)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
    assertEquals(listOf(CrossfadeEnd.Moved to true), service.endedEarly)
  }

  @Test
  fun theNextSongReplacedBeforeTheOverlapKeepsThePreRollAndFadesIntoTheNewOne() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    val outgoing = service.tail!!

    // A queue sync mid-way: the next song gone for a moment, then another in its place.
    service.movesOnNaturally = false
    crossfade.playTo(service, 172_500)
    service.movesOnNaturally = true
    service.nextKey = "d"
    crossfade.moved("a")
    crossfade.playTo(service, 173_000)
    assertEquals(outgoing, service.tail)

    crossfade.playTo(service, 175_000)
    assertEquals(1, service.advanced)
    crossfade.moved("d")
    assertEquals(outgoing, service.tail)
    assertTrue(service.endedEarly.isEmpty())
  }

  @Test
  fun aBriefRebufferOfTheSessionsPlayerBeforeTheOverlapHoldsTheOutgoingCopy() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    val outgoing = service.tail!!

    service.main.sounding = false
    crossfade.playTo(service, 174_000)
    assertEquals(outgoing, service.tail)
    assertFalse(outgoing.wanted)

    service.main.sounding = true
    crossfade.playTo(service, 174_500)
    assertTrue(outgoing.wanted)
    crossfade.playTo(service, 175_000)
    assertEquals(1, service.advanced)
    assertTrue(service.endedEarly.isEmpty())
  }

  @Test
  fun aCopyLateToGetInStepOverlapsForWhatIsLeftOnceItIs() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.playTo(service, 167_000)
    val outgoing = service.tail!!

    // Still buffering at 2:50, and past where half the overlap is gone.
    outgoing.sounding = false
    service.main.positionMs = 176_000
    crossfade.tick()
    assertEquals(outgoing, service.tail)
    assertEquals(0, service.advanced)
    assertEquals(1f, service.main.level)

    // Sounding 30 ms off: close enough this late. The overlap is the 3 s left.
    outgoing.sounding = true
    service.main.positionMs = 177_000
    outgoing.positionMs = 177_030
    crossfade.tick()
    assertEquals(1, service.advanced)
    assertEquals(1f, outgoing.level)
    service.main.positionMs = 1500
    outgoing.positionMs = 178_530
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.02f)
    assertEquals(0.707f, service.main.level, 0.02f)
  }

  @Test
  fun aCopyThatNeverGetsInStepLeavesTheSongGaplessAndSaysWhy() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    service.tail!!.sounding = false
    service.main.positionMs = 179_100
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(0, service.advanced)
    assertEquals(1f, service.main.level)
    assertEquals(listOf(CrossfadeEnd.NotInStep to false), service.endedEarly)
  }

  @Test
  fun aStallOfTheMainThreadDuringTheOverlapLandsTheFadesWhereTheyShouldBe() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    val outgoing = service.tail!!
    service.main.positionMs = 500
    outgoing.positionMs = 175_500
    crossfade.tick()

    // No tick for 2 s; both players kept going.
    service.main.positionMs = 2500
    outgoing.positionMs = 177_500
    crossfade.tick()
    assertEquals(outgoing, service.tail)
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, service.main.level, 0.01f)
    assertTrue(service.endedEarly.isEmpty())
  }

  @Test
  fun aStallOfTheMainThreadAcrossTheHandoffStillOverlaps() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 4000)
    crossfade.playTo(service, 173_000)
    // The last tick before the overlap left the copy catching up, and the next came 3 s late.
    service.tail!!.positionMs = 173_100
    crossfade.tick()
    service.main.positionMs = 178_100
    service.tail!!.positionMs = 177_900
    crossfade.tick()
    assertEquals(0, service.advanced)
    service.main.positionMs = 178_300
    service.tail!!.positionMs = 178_310
    crossfade.tick()
    assertEquals(1, service.advanced)
    assertTrue(service.endedEarly.isEmpty())
  }

  @Test
  fun aSeekOrAPlayerErrorDuringTheOverlapEndsItAndSaysWhy() {
    for (why in listOf(CrossfadeEnd.Seek, CrossfadeEnd.Error)) {
      val service = Service()
      val crossfade = crossfade(service)
      crossfade.playTo(service, 172_000)
      crossfade.playTo(service, 175_000)
      crossfade.interrupt(why)
      assertNull(service.tail)
      assertEquals(1f, service.main.level)
      assertEquals(listOf(why to true), service.endedEarly)
    }
  }

  @Test
  fun anOutgoingCopyThatStallsIsLoggedAsEndingEarly() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    service.tail!!.positionMs = 176_000
    service.tail!!.sounding = false
    service.main.positionMs = 7000
    crossfade.tick()
    assertEquals(listOf(CrossfadeEnd.Stalled to true), service.endedEarly)
  }

  @Test
  fun aBriefRebufferOfTheIncomingSongDuringTheOverlapKeepsBothGoing() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    val outgoing = service.tail!!
    service.main.positionMs = 1000
    outgoing.positionMs = 176_000
    crossfade.tick()

    // The incoming song rebuffers for 1 s; the outgoing one fades on.
    service.main.sounding = false
    outgoing.positionMs = 177_000
    crossfade.tick()
    assertEquals(outgoing, service.tail)
    assertEquals(gainAt(0.6f), outgoing.level, 0.01f)

    service.main.sounding = true
    service.main.positionMs = 1500
    outgoing.positionMs = 177_500
    crossfade.tick()
    assertEquals(outgoing, service.tail)
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(gainAt(0.3f), service.main.level, 0.01f)
    assertTrue(service.endedEarly.isEmpty())
  }

  /** Equal-power gain [fraction] of the way into a fade-in, worked out by hand: sin(fraction × 90°). */
  private fun gainAt(fraction: Float): Float =
    when (fraction) {
      0.3f -> 0.454f
      0.6f -> 0.809f
      else -> error("no worked value for $fraction")
    }
}
