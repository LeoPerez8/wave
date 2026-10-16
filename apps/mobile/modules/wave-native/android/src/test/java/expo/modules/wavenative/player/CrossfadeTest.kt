package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossfadeTest {
  private class Deck : CrossfadeDeck {
    override var positionMs = 0L
    override var isPlaying = true
    override var ended = false
    var volume = 1f
    var speed = 1f
    var playing = true
    val seeks = mutableListOf<Long>()

    override fun setVolume(volume: Float) {
      this.volume = volume
    }

    override fun setSpeed(speed: Float) {
      this.speed = speed
    }

    override fun seekTo(positionMs: Long) {
      seeks += positionMs
      this.positionMs = positionMs
    }

    override fun setPlaying(playing: Boolean) {
      this.playing = playing
    }
  }

  /** The playback service: a 3-minute song playing, with another one after it. */
  private class Service : CrossfadeHost {
    override val main = Deck().apply { positionMs = 100_000 }
    override var mainDurationMs: Long? = 180_000
    override var mainWantsToPlay = true
    override var movesOnNaturally = true
    var tail: Deck? = null
    val opened = mutableListOf<Long>()
    var advanced = 0
    var fadesEnded = 0

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
    }

    override fun fadeEnded() {
      fadesEnded++
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
    assertEquals(0f, outgoing.volume)

    crossfade.playTo(service, 175_000)
    assertEquals(1, service.advanced)
    assertEquals(1f, outgoing.volume)
    assertEquals(0f, service.main.volume)

    service.main.positionMs = 2500
    outgoing.positionMs = 177_500
    crossfade.tick()
    assertEquals(0.707f, outgoing.volume, 0.01f)
    assertEquals(0.707f, service.main.volume, 0.01f)
    assertEquals(0, service.fadesEnded)

    service.main.positionMs = 5000
    outgoing.positionMs = 180_000
    outgoing.ended = true
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.volume)
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
    crossfade.interrupt()
    assertNull(service.tail)
    assertEquals(1, service.fadesEnded)
    assertEquals(1f, service.main.volume)
  }

  @Test
  fun aManualChangeBeforeTheOverlapDropsTheOutgoingCopy() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    crossfade.interrupt()
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
    assertFalse(outgoing.playing)
    assertNull(crossfade.tick())

    service.mainWantsToPlay = true
    crossfade.onPlayingChanged()
    assertTrue(outgoing.playing)
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
    assertTrue(outgoing.speed < 1f)

    outgoing.positionMs = 171_900
    crossfade.tick()
    assertTrue(outgoing.speed > 1f)

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
    assertEquals(1f, outgoing.speed)
  }

  @Test
  fun aCopyThatCannotKeepUpLeavesTheSongGapless() {
    val service = Service()
    val crossfade = crossfade(service)
    crossfade.playTo(service, 172_000)
    service.tail!!.isPlaying = false // still buffering
    service.main.positionMs = 177_500
    crossfade.tick()
    assertNull(service.tail)
    assertEquals(0, service.advanced)
    crossfade.playTo(service, 178_000)
    assertEquals(1, service.opened.size)
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
}
