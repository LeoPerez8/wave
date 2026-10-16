package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Audio output is the system boundary; tests drive the same commands as the service. */
class CrossfadeTest {
  private class Deck(override val key: String) : CrossfadeDeck {
    override var durationMs = 180_000L
    override var positionMs = 0L
    override var ready = true
    override var playing = false
    override var volume = 1f
    var released = false
    override fun setPlaying(value: Boolean) { playing = value }
    override fun release() { released = true; playing = false }
  }

  private class Audio : CrossfadeHost {
    val first = Deck("local").apply { positionMs = 175_000; playing = true }
    val second = Deck("yt:stream")
    override var current: CrossfadeDeck = first
    override var nextKey: String? = second.key
    override var suppressed = false
    val events = mutableListOf<String>()
    override fun prepareNext(): CrossfadeDeck = second
    override fun promote(deck: CrossfadeDeck) { current = deck }
    override fun event(phase: String, playing: Boolean?, reason: String?) { events += "$phase:$reason" }
  }

  @Test
  fun naturalTransitionPromotesTheNextSongAtTheStartAndCompletesTheOutgoingFade() {
    val audio = Audio()
    val crossfade = Crossfade(audio)
    crossfade.durationMs = 5000
    crossfade.tick()
    assertEquals("yt:stream", audio.current.key)
    assertTrue(audio.first.playing)
    assertTrue(audio.second.playing)
    assertEquals(0f, audio.second.volume)
    audio.first.positionMs = 177_500
    audio.second.positionMs = 2500
    crossfade.tick()
    assertEquals(0.5f, audio.first.volume)
    assertEquals(0.5f, audio.second.volume)
    assertFalse(audio.first.released)
    audio.first.positionMs = 180_000
    audio.second.positionMs = 5000
    crossfade.tick()
    assertTrue(audio.first.released)
    assertEquals(1f, audio.second.volume)
    assertEquals(listOf("start:null", "end:completed"), audio.events)
  }
}
