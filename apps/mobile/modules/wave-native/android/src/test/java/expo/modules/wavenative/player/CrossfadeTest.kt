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

    /** The clock (elapsed real time); it stands still unless a test moves it. */
    override var nowMs = 0L
    var tail: Deck? = null
    val opened = mutableListOf<Long>()
    var advanced = 0
    var fadesEnded = 0
    var prefetches = 0

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

    override var nextSearching = false

    /** What the app log heard of each song change. */
    val outcomes = mutableListOf<CrossfadeOutcome>()

    override fun outcome(outcome: CrossfadeOutcome) {
      outcomes += outcome
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
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Done(overlapMs = 15_000, lateMs = 0)), service.outcomes)
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
    assertTrue(service.outcomes.isEmpty())
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
    assertTrue(service.outcomes.isEmpty())
    service.main.positionMs = 6000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Done(overlapMs = 6000, lateMs = 4000)), service.outcomes)
  }

  @Test
  fun aNextSongNeverReadyBeforeTheEndPlaysGaplessWithNoFadeOut() {
    val service = Service().apply { nextReady = false }
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.moved("a")
    crossfade.playTo(service, 167_000)
    crossfade.playTo(service, 175_000)
    crossfade.playTo(service, 179_100)
    assertNull(service.tail)
    assertEquals(0, service.advanced)
    assertEquals(1f, service.main.level)
    crossfade.moved("b")
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Skipped(CrossfadeSkip.NotReady, lateMs = 9100)), service.outcomes)
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
    assertTrue(service.outcomes.isEmpty())
    service.main.positionMs = 6000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Done(overlapMs = 6000, lateMs = 4000)), service.outcomes)
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
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Skipped(CrossfadeSkip.NotReady, lateMs = 10_000)), service.outcomes)
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
    assertTrue(service.outcomes.isEmpty())
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
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Cut(CrossfadeEnd.Moved, elapsedMs = 0, overlapMs = null)), service.outcomes)
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
    assertTrue(service.outcomes.isEmpty())
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
    assertTrue(service.outcomes.isEmpty())
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
    crossfade.moved("a")
    crossfade.playTo(service, 172_000)
    service.tail!!.sounding = false
    service.main.positionMs = 179_100
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(0, service.advanced)
    assertEquals(1f, service.main.level)
    crossfade.moved("b")
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Skipped(CrossfadeEnd.NotInStep)), service.outcomes)
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
    assertTrue(service.outcomes.isEmpty())
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
    assertTrue(service.outcomes.isEmpty())
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
      assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Cut(why, elapsedMs = 0, overlapMs = null)), service.outcomes)
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
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Cut(CrossfadeEnd.Stalled, elapsedMs = 0, overlapMs = 5000)), service.outcomes)
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
    assertTrue(service.outcomes.isEmpty())
  }

  @Test
  fun anOverlapEndsByTheClockEvenIfTheMainPlayersPositionStopsAdvancing() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    val outgoing = service.tail!!
    service.main.positionMs = 1000
    outgoing.positionMs = 176_000
    service.nowMs = 1000
    crossfade.tick()

    // Neither position moves again, though both report playing.
    service.nowMs = 6900
    crossfade.tick()
    assertEquals(outgoing, service.tail)
    service.nowMs = 7000
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
  }

  @Test
  fun aPauseDuringTheOverlapDoesntCountAgainstItsClock() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    val outgoing = service.tail!!
    service.main.positionMs = 1000
    outgoing.positionMs = 176_000
    crossfade.tick()

    service.nowMs = 1000
    service.mainWantsToPlay = false
    crossfade.onPlayingChanged()
    crossfade.tick()
    service.nowMs = 60_000
    service.mainWantsToPlay = true
    crossfade.onPlayingChanged()
    crossfade.tick()
    assertEquals(outgoing, service.tail)
    service.nowMs = 65_000
    crossfade.tick()
    assertNull(service.tail)
  }

  /** Plays song "a" from [fromMs] to [toMs] in [stepMs] steps with ticks, then the player moves to [to]. */
  private fun Crossfade.songChange(service: Service, fromMs: Long, toMs: Long, to: String = "b", stepMs: Long = 1000) {
    moved("a")
    var at = fromMs
    while (at <= toMs) {
      playTo(service, at)
      at += stepMs
    }
    // Back to "a": repeat one starting it again.
    moved(to, restarted = to == "a")
  }

  @Test
  fun anOverlapThatRunsItsLengthLogsDoneWithItsOverlap() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.moved("a")
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    crossfade.moved("b")
    val outgoing = service.tail!!
    crossfade.tick()
    assertTrue(service.outcomes.isEmpty())
    service.main.positionMs = 5000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Done(overlapMs = 5000, lateMs = 0)), service.outcomes)
  }

  @Test
  fun everySongChangeWithoutAnOverlapLogsTheRuleThatSkippedIt() {
    fun skipped(why: CrossfadeReason, lateMs: Long = 0) = listOf<CrossfadeOutcome>(CrossfadeOutcome.Skipped(why, lateMs))

    Service().let { service ->
      crossfade(service, overlapMs = 0).songChange(service, 170_000, 179_000)
      assertEquals(skipped(CrossfadeSkip.Off), service.outcomes)
    }
    Service().let { service ->
      service.main.sounding = false
      crossfade(service).songChange(service, 170_000, 179_000)
      assertEquals(skipped(CrossfadeSkip.NotPlaying), service.outcomes)
    }
    Service().let { service ->
      service.mainDurationMs = null
      crossfade(service).songChange(service, 170_000, 179_000)
      assertEquals(skipped(CrossfadeSkip.UnknownLength), service.outcomes)
    }
    Service().let { service ->
      // Picked up 1 s before the end: too late to get in step.
      crossfade(service).songChange(service, 179_000, 179_000)
      assertEquals(skipped(CrossfadeSkip.PastHandoff), service.outcomes)
    }
    Service().let { service ->
      service.movesOnNaturally = false
      crossfade(service).songChange(service, 170_000, 179_000, to = "a")
      assertEquals(skipped(CrossfadeSkip.NoNext), service.outcomes)
    }
    Service().let { service ->
      // A skip mid-song.
      crossfade(service).songChange(service, 100_000, 100_000, to = "c")
      assertEquals(skipped(CrossfadeSkip.Early), service.outcomes)
    }
    Service().let { service ->
      service.nextReady = false
      crossfade(service).songChange(service, 170_000, 179_500, stepMs = 500)
      assertEquals(skipped(CrossfadeSkip.NotReady, lateMs = 4500), service.outcomes)
    }
    Service().let { service ->
      service.nextReady = false
      service.nextSearching = true
      crossfade(service).songChange(service, 170_000, 179_500, stepMs = 500)
      assertEquals(skipped(CrossfadeSkip.Searching, lateMs = 4500), service.outcomes)
    }
    Service().let { service ->
      // A skip during the pre-roll.
      crossfade(service).songChange(service, 172_000, 173_000, to = "c")
      assertEquals(skipped(CrossfadeEnd.Moved), service.outcomes)
    }
  }

  @Test
  fun anOverlapCutShortLogsHowLongItRanThenTheSkipLogsItsOwnChange() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.moved("a")
    crossfade.playTo(service, 172_000)
    crossfade.playTo(service, 175_000)
    crossfade.moved("b")
    crossfade.tick()
    service.nowMs = 2000
    crossfade.moved("c")
    assertEquals(
      listOf(
        CrossfadeOutcome.Cut(CrossfadeEnd.Moved, elapsedMs = 2000, overlapMs = 5000),
        CrossfadeOutcome.Skipped(CrossfadeSkip.Early),
      ),
      service.outcomes,
    )
  }

  @Test
  fun aSyncReportingTheSameSongAgainLogsNoChange() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.moved("a")
    crossfade.moved("a")
    crossfade.moved("a")
    assertTrue(service.outcomes.isEmpty())
  }

  /** Equal-power gain [fraction] of the way into a fade-in, worked out by hand: sin(fraction × 90°). */
  private fun gainAt(fraction: Float): Float =
    when (fraction) {
      0.3f -> 0.454f
      0.6f -> 0.809f
      else -> error("no worked value for $fraction")
    }
}
