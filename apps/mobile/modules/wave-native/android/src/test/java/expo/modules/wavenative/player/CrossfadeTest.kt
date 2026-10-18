package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossfadeTest {
  private class Deck : CrossfadeDeck {
    override var positionMs = 0L
    override var ended = false
    override var ready = true

    // Plain fields under other names: a `var volume` would clash with setVolume on the JVM.
    var sounding = true
    var level = 1f
    var wanted = true

    override val isPlaying get() = sounding && wanted

    override fun setVolume(volume: Float) {
      level = volume
    }

    override fun setPlaying(playing: Boolean) {
      wanted = playing
    }
  }

  /** The playback service: a 3-minute song playing, with another one after it. */
  private class Service : CrossfadeHost {
    /** The session's player; [promote] makes the second player it. */
    override var main = Deck().apply { positionMs = 100_000 }
    override var mainDurationMs: Long? = 180_000
    override var mainWantsToPlay = true
    override var movesOnNaturally = true
    override var currentKey: String? = "a"
    override var nextKey: String? = "b"

    /** Whether a second player opened on the next song is ready to sound at once. */
    var nextReady = true

    /** The clock (elapsed real time); it stands still unless a test moves it. */
    override var nowMs = 0L

    /** The second player: the next song's before the handoff, the outgoing song's after it. */
    var second: Deck? = null
    val opened = mutableListOf<String?>()
    var promoted = 0
    var fadesEnded = 0
    var prefetches = 0

    override fun openNext(): CrossfadeDeck {
      opened += nextKey
      return Deck().apply {
        ready = nextReady
        wanted = false
      }.also { second = it }
    }

    /** Whether a handoff can be made; not while the service stops. */
    var promotable = true

    override fun promote(): CrossfadeDeck? {
      if (!promotable) return null
      promoted++
      val outgoing = main
      main = second!!
      second = outgoing
      currentKey = nextKey
      nextKey = "c"
      return outgoing
    }

    override fun closeSecond() {
      second = null
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

  /** Plays up to [mainMs] of the song on the session's player, and ticks. */
  private fun Crossfade.playTo(service: Service, mainMs: Long) {
    service.main.positionMs = mainMs
    tick()
  }

  @Test
  fun atTheHandoffTheNextSongPlaysOnThePlayerThatStartedItWhichBecomesTheSessionsPlayer() {
    // The next song opens on the second player well ahead, silent and paused at its start.
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    val outgoing = service.main
    crossfade.playTo(service, 137_000)
    val incoming = service.second!!
    assertEquals(listOf<String?>("b"), service.opened)
    assertFalse(incoming.wanted)
    assertEquals(0f, incoming.level)

    // At the handoff it starts playing from where it is, and the session moves to it: no seek.
    crossfade.playTo(service, 170_000)
    assertEquals(1, service.promoted)
    assertSame(incoming, service.main)
    assertSame(outgoing, service.second)
    assertTrue(incoming.wanted)
    assertEquals(0L, incoming.positionMs)
    assertEquals(1f, outgoing.level)
    assertEquals(0f, incoming.level)

    incoming.positionMs = 5000
    outgoing.positionMs = 175_000
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, incoming.level, 0.01f)

    incoming.positionMs = 10_000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertNull(service.second)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, incoming.level)
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Done(overlapMs = 10_000, lateMs = 0)), service.outcomes)
  }

  /** Plays the outgoing song to its handoff at 2:55 (a 5 s overlap), the next song opened at 2:22. */
  private fun Crossfade.handOff(service: Service): Deck {
    playTo(service, 142_000)
    playTo(service, 175_000)
    return service.second!!
  }

  @Test
  fun atZeroPlaybackStaysGapless() {
    val service = Service().apply { main.positionMs = 177_000 }
    val crossfade = crossfade(service, overlapMs = 0)
    assertNull(crossfade.tick())
    assertTrue(service.opened.isEmpty())
    assertEquals(0, service.promoted)
  }

  @Test
  fun atFifteenSecondsTheOverlapRunsItsWholeLength() {
    // #407's longest setting, on a 3-minute song: the next song asked for and opened at 2:12
    // (30 s before the pre-roll, Core's crossfadePrefetchAt), the handoff at 2:45.
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 15_000)
    crossfade.playTo(service, 131_900)
    assertEquals(0, service.prefetches)
    assertNull(service.second)
    crossfade.playTo(service, 132_000)
    assertEquals(1, service.prefetches)
    val incoming = service.second!!
    crossfade.playTo(service, 164_900)
    assertEquals(0, service.promoted)

    val outgoing = service.main
    crossfade.playTo(service, 165_000)
    assertSame(incoming, service.main)
    incoming.positionMs = 7500
    outgoing.positionMs = 172_500
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, incoming.level, 0.01f)
    incoming.positionMs = 15_000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertNull(service.second)
    assertEquals(1f, incoming.level)
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Done(overlapMs = 15_000, lateMs = 0)), service.outcomes)
  }

  @Test
  fun aHandoffTheServiceCantMakeLeavesTheSongGapless() {
    val service = Service().apply { promotable = false }
    val crossfade = crossfade(service)
    crossfade.moved("a")
    val outgoing = service.main
    crossfade.playTo(service, 142_000)
    crossfade.playTo(service, 175_000)
    assertNull(service.second)
    assertSame(outgoing, service.main)
    assertEquals(1f, outgoing.level)
    crossfade.moved("b")
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Skipped(CrossfadeEnd.Stopped)), service.outcomes)
  }

  @Test
  fun aSongThatDoesNotMoveOnNaturallyDoesNotFade() {
    // Repeat one, the last song, or an end-of-song sleep timer.
    val service = Service().apply { movesOnNaturally = false }
    val crossfade = crossfade(service)
    crossfade.playTo(service, 142_000)
    crossfade.playTo(service, 175_000)
    assertTrue(service.opened.isEmpty())
    assertEquals(0, service.promoted)
  }

  @Test
  fun anEndOfSongSleepTimerSetWhileTheNextSongWaitsCancelsTheOverlap() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 142_000)
    service.movesOnNaturally = false
    crossfade.playTo(service, 175_000)
    assertNull(service.second)
    assertEquals(0, service.promoted)
  }

  @Test
  fun aManualChangeDuringTheFadeSwitchesAtOnce() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.handOff(service)
    crossfade.interrupt(CrossfadeEnd.Moved)
    assertNull(service.second)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
  }

  @Test
  fun anOutgoingSongThatStallsOrFailsIsDroppedSoonAfterTheOverlap() {
    val service = Service()
    val crossfade = crossfade(service)
    val outgoing = crossfade.handOff(service)
    // It stops moving 1 s into the fade (an error, or a stream that stalls), never ending.
    outgoing.positionMs = 176_000
    outgoing.sounding = false

    service.main.positionMs = 5000
    crossfade.tick()
    assertEquals(0, service.fadesEnded)

    service.main.positionMs = 7000
    crossfade.tick()
    assertNull(service.second)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Cut(CrossfadeEnd.Stalled, elapsedMs = 0, overlapMs = 5000)), service.outcomes)

    // The next song ending on its own fades as usual.
    crossfade.handOff(service)
    assertEquals(2, service.promoted)
  }

  @Test
  fun aManualChangeBeforeTheOverlapClosesTheWaitingNextSong() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.interrupt(CrossfadeEnd.Moved)
    assertNull(service.second)
    assertEquals(0, service.fadesEnded)
    assertEquals(0, service.promoted)
  }

  @Test
  fun pausingDuringTheFadePausesBothSongs() {
    val service = Service()
    val crossfade = crossfade(service)
    val outgoing = crossfade.handOff(service)

    service.mainWantsToPlay = false
    crossfade.onPlayingChanged()
    assertFalse(outgoing.wanted)
    assertNull(crossfade.tick())

    service.mainWantsToPlay = true
    crossfade.onPlayingChanged()
    assertTrue(outgoing.wanted)
  }

  @Test
  fun aPauseBeforeTheHandoffKeepsTheNextSongWaiting() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    val incoming = service.second!!

    service.mainWantsToPlay = false
    crossfade.onPlayingChanged()
    crossfade.playTo(service, 175_000)
    assertNull(crossfade.tick())
    assertSame(incoming, service.second)
    assertFalse(incoming.wanted)
    assertEquals(0, service.promoted)

    service.mainWantsToPlay = true
    crossfade.onPlayingChanged()
    crossfade.tick()
    assertSame(incoming, service.main)
    assertTrue(service.outcomes.isEmpty())
  }

  @Test
  fun aShortSongFadesOverHalfItsLength() {
    val service = Service().apply { mainDurationMs = 6000 }
    val crossfade = crossfade(service, overlapMs = 10_000)
    crossfade.playTo(service, 1000)
    crossfade.playTo(service, 3000)
    assertEquals(1, service.promoted)
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
    assertTrue(service.opened.isEmpty())
    crossfade.playTo(service, 137_000)
    assertEquals(1, service.prefetches)
    assertEquals(listOf<String?>("b"), service.opened)
    crossfade.playTo(service, 150_000)
    assertEquals(1, service.prefetches)
    assertEquals(listOf<String?>("b"), service.opened)
  }

  @Test
  fun aQueueSyncReportingTheSameSongAgainDoesntAskForTheNextOneAgain() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    assertTrue(crossfade.moved("a"))
    crossfade.playTo(service, 137_000)
    assertEquals(1, service.prefetches)
    val incoming = service.second
    // JS syncs the queue: the player reports the song it's on again.
    assertFalse(crossfade.moved("a"))
    crossfade.playTo(service, 140_000)
    assertEquals(1, service.prefetches)
    assertSame(incoming, service.second)
    // Another song: its next one is asked for in its turn.
    assertTrue(crossfade.moved("c"))
    crossfade.playTo(service, 137_000)
    assertEquals(2, service.prefetches)
  }

  @Test
  fun onlyAMoveToAnotherSongCountsAsTheSongChanging() {
    // The service turns the next song's preload off again only when the song changes.
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.moved("a")
    crossfade.playTo(service, 172_000)
    assertFalse(crossfade.moved("a"))
    crossfade.playTo(service, 175_000)
    assertEquals(1, service.promoted)
    // A queue sync on the new session's player reports the song faded into.
    assertFalse(crossfade.moved("b"))
    assertTrue(service.outcomes.isEmpty())
  }

  @Test
  fun aLateNextSongKeepsTheOutgoingOneAtFullVolumeThenOverlapsForWhatIsLeft() {
    val service = Service().apply { nextReady = false }
    val crossfade = crossfade(service, overlapMs = 10_000)
    val outgoing = service.main
    crossfade.playTo(service, 167_000)
    val incoming = service.second!!

    // The overlap should begin at 2:50, but the next song isn't buffered.
    crossfade.playTo(service, 170_000)
    crossfade.playTo(service, 172_000)
    assertEquals(0, service.promoted)
    assertEquals(1f, outgoing.level)
    assertEquals(0, service.fadesEnded)

    // Buffered 4 s late: the two overlap for the 6 s left.
    incoming.ready = true
    crossfade.playTo(service, 174_000)
    assertSame(incoming, service.main)
    assertEquals(1f, outgoing.level)

    incoming.positionMs = 3000
    outgoing.positionMs = 177_000
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, incoming.level, 0.01f)
    assertTrue(service.outcomes.isEmpty())
    incoming.positionMs = 6000
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
    assertNull(service.second)
    assertEquals(0, service.promoted)
    assertEquals(1f, service.main.level)
    crossfade.moved("b")
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Skipped(CrossfadeSkip.NotReady, lateMs = 9100)), service.outcomes)
  }

  @Test
  fun aNextSongThatStallsRightAfterTheHandoffWaitsWithTheOutgoingOneAtFullVolume() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    val outgoing = service.main
    crossfade.playTo(service, 167_000)
    crossfade.playTo(service, 170_000)
    val incoming = service.main

    // The incoming song, ready a moment ago, doesn't sound yet.
    incoming.sounding = false
    outgoing.positionMs = 172_000
    crossfade.tick()
    assertEquals(1f, outgoing.level)
    assertEquals(0f, incoming.level)

    // It sounds 4 s late: the overlap is the 6 s left, both fading together.
    incoming.sounding = true
    outgoing.positionMs = 174_000
    crossfade.tick()
    assertEquals(1f, outgoing.level, 0.01f)
    incoming.positionMs = 3000
    outgoing.positionMs = 177_000
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, incoming.level, 0.01f)
    assertTrue(service.outcomes.isEmpty())
    incoming.positionMs = 6000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Done(overlapMs = 6000, lateMs = 4000)), service.outcomes)
  }

  @Test
  fun aNextSongThatSoundsOnlyAfterTheOutgoingOneEndedStartsAtFullVolume() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 10_000)
    val outgoing = service.main
    crossfade.playTo(service, 167_000)
    crossfade.playTo(service, 170_000)
    val incoming = service.main
    incoming.sounding = false
    outgoing.positionMs = 179_000
    crossfade.tick()
    assertEquals(1f, outgoing.level)

    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertNull(service.second)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, incoming.level)
    assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Skipped(CrossfadeSkip.NotReady, lateMs = 10_000)), service.outcomes)
  }

  @Test
  fun theQueueSyncAfterTheHandoffKeepsTheOverlapGoing() {
    val service = Service()
    val crossfade = crossfade(service)
    val outgoing = crossfade.handOff(service)

    // The session's player reports the song being faded into, again and again.
    crossfade.moved("b")
    crossfade.moved("b")
    service.main.positionMs = 2500
    outgoing.positionMs = 177_500
    crossfade.tick()
    assertSame(outgoing, service.second)
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0, service.fadesEnded)
    assertTrue(service.outcomes.isEmpty())
  }

  @Test
  fun aMoveToAnotherSongDuringTheOverlapEndsItAndSaysWhy() {
    // A skip, picking a song, or the song being faded into replaced.
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.handOff(service)
    crossfade.moved("c")
    assertNull(service.second)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
    assertEquals(
      listOf(
        CrossfadeOutcome.Cut(CrossfadeEnd.Moved, elapsedMs = 0, overlapMs = null),
        CrossfadeOutcome.Skipped(CrossfadeSkip.Early),
      ),
      service.outcomes,
    )
  }

  @Test
  fun theNextSongReplacedWhileItWaitsOpensTheNewOneAndFadesIntoIt() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.moved("a")
    crossfade.playTo(service, 172_000)

    // A queue sync mid-way: the next song gone for a moment, then another in its place.
    service.movesOnNaturally = false
    crossfade.playTo(service, 172_500)
    assertNull(service.second)
    service.movesOnNaturally = true
    service.nextKey = "d"
    crossfade.moved("a")
    crossfade.playTo(service, 173_000)
    assertEquals(listOf<String?>("b", "d"), service.opened)
    val incoming = service.second!!

    // Replaced again, without a gap.
    service.nextKey = "e"
    crossfade.playTo(service, 173_500)
    assertEquals(listOf<String?>("b", "d", "e"), service.opened)
    assertTrue(incoming !== service.second)

    crossfade.playTo(service, 175_000)
    assertEquals(1, service.promoted)
    assertFalse(crossfade.moved("e"))
    assertEquals(1, service.promoted)
    assertTrue(service.outcomes.isEmpty())
  }

  @Test
  fun aRebufferOfTheSessionsPlayerAtTheHandoffWaitsForIt() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    val incoming = service.second!!

    service.main.sounding = false
    crossfade.playTo(service, 175_000)
    assertSame(incoming, service.second)
    assertEquals(0, service.promoted)

    service.main.sounding = true
    crossfade.playTo(service, 175_000)
    assertSame(incoming, service.main)
    assertTrue(service.outcomes.isEmpty())
  }

  @Test
  fun aNextSongStillBeingSearchedOpensNothingUntilTheSearchEnds() {
    val service = Service().apply { nextSearching = true }
    val crossfade = crossfade(service)
    crossfade.playTo(service, 142_000)
    assertTrue(service.opened.isEmpty())
    // Found: the player's next song is the one searched for.
    service.nextSearching = false
    service.nextKey = "found"
    crossfade.playTo(service, 143_000)
    assertEquals(listOf<String?>("found"), service.opened)

    // A search starting again while it waits closes it.
    service.nextSearching = true
    crossfade.playTo(service, 144_000)
    assertNull(service.second)
  }

  @Test
  fun aStallOfTheMainThreadDuringTheOverlapLandsTheFadesWhereTheyShouldBe() {
    val service = Service()
    val crossfade = crossfade(service)
    val outgoing = crossfade.handOff(service)
    service.main.positionMs = 500
    outgoing.positionMs = 175_500
    crossfade.tick()

    // No tick for 2 s; both players kept going.
    service.main.positionMs = 2500
    outgoing.positionMs = 177_500
    crossfade.tick()
    assertSame(outgoing, service.second)
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, service.main.level, 0.01f)
    assertTrue(service.outcomes.isEmpty())
  }

  @Test
  fun aStallOfTheMainThreadAcrossTheHandoffStillOverlapsForWhatIsLeft() {
    val service = Service()
    val crossfade = crossfade(service, overlapMs = 4000)
    val outgoing = service.main
    crossfade.playTo(service, 173_000)
    // The next tick comes 3 s late, 2.1 s past the handoff.
    crossfade.playTo(service, 178_100)
    assertEquals(1, service.promoted)
    service.main.positionMs = 950
    outgoing.positionMs = 179_050
    crossfade.tick()
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(0.707f, service.main.level, 0.01f)
  }

  @Test
  fun aSeekOrAPlayerErrorDuringTheOverlapEndsItAndSaysWhy() {
    for (why in listOf(CrossfadeEnd.Seek, CrossfadeEnd.Error)) {
      val service = Service()
      val crossfade = crossfade(service)
      crossfade.handOff(service)
      crossfade.interrupt(why)
      assertNull(service.second)
      assertEquals(1f, service.main.level)
      assertEquals(listOf<CrossfadeOutcome>(CrossfadeOutcome.Cut(why, elapsedMs = 0, overlapMs = null)), service.outcomes)
    }
  }

  @Test
  fun aBriefRebufferOfTheIncomingSongDuringTheOverlapKeepsBothGoing() {
    val service = Service()
    val crossfade = crossfade(service)
    val outgoing = crossfade.handOff(service)
    service.main.positionMs = 1000
    outgoing.positionMs = 176_000
    crossfade.tick()

    // The incoming song rebuffers for 1 s; the outgoing one fades on.
    service.main.sounding = false
    outgoing.positionMs = 177_000
    crossfade.tick()
    assertSame(outgoing, service.second)
    assertEquals(gainAt(0.6f), outgoing.level, 0.01f)

    service.main.sounding = true
    service.main.positionMs = 1500
    outgoing.positionMs = 177_500
    crossfade.tick()
    assertSame(outgoing, service.second)
    assertEquals(0.707f, outgoing.level, 0.01f)
    assertEquals(gainAt(0.3f), service.main.level, 0.01f)
    assertTrue(service.outcomes.isEmpty())
  }

  @Test
  fun anOverlapEndsByTheClockEvenIfTheMainPlayersPositionStopsAdvancing() {
    val service = Service()
    val crossfade = crossfade(service)
    val outgoing = crossfade.handOff(service)
    service.main.positionMs = 1000
    outgoing.positionMs = 176_000
    service.nowMs = 1000
    crossfade.tick()

    // Neither position moves again, though both report playing.
    service.nowMs = 6900
    crossfade.tick()
    assertSame(outgoing, service.second)
    service.nowMs = 7000
    crossfade.tick()
    assertNull(service.second)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.level)
  }

  @Test
  fun aPauseDuringTheOverlapDoesntCountAgainstItsClock() {
    val service = Service()
    val crossfade = crossfade(service)
    val outgoing = crossfade.handOff(service)
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
    assertSame(outgoing, service.second)
    service.nowMs = 65_000
    crossfade.tick()
    assertNull(service.second)
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
      // Picked up 1 s before the end: too late to wait for the next song.
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
      service.nextSearching = true
      crossfade(service).songChange(service, 170_000, 179_500, stepMs = 500)
      assertEquals(skipped(CrossfadeSkip.Searching), service.outcomes)
    }
    Service().let { service ->
      // A skip while the next song waits.
      crossfade(service).songChange(service, 172_000, 173_000, to = "c")
      assertEquals(skipped(CrossfadeEnd.Moved), service.outcomes)
    }
  }

  @Test
  fun anOverlapCutShortLogsHowLongItRanThenTheSkipLogsItsOwnChange() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.moved("a")
    crossfade.handOff(service)
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
