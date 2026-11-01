package expo.modules.wavenative.recognize

import expo.modules.wavenative.Fixtures
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Random
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A session over audio served from a fixture, as a capture would deliver it. */
class RecognizeSessionTest {
  @Test
  fun `sound in an earlier read still counts when the first window ends in silence`() {
    val samples = ShortArray(64_000).also { it[200] = Short.MIN_VALUE }
    val audio = FakeAudio(samples)
    val levels = CopyOnWriteArrayList<Boolean>()
    val session = RecognizeSession(audio, { RecognizeOutcome.NoMatch },
      onHeard = { ms, audible -> levels += audible; heard += ms },
      onCaptureFailed = { captureFailed.countDown() })
    session.start()
    waitForHeard(4_000)
    session.stop()
    assertTrue(levels.all { it })
  }

  @Test
  fun `a capture read that throws still reports its failure and releases the audio`() {
    val released = CountDownLatch(1)
    val audio = object : RecognizeAudio {
      override fun read(buffer: ShortArray): Int = throw IllegalStateException("Projection stopped")
      override fun stop() = Unit
      override fun release() = released.countDown()
    }
    session(audio).start()
    assertTrue(captureFailed.await(1, TimeUnit.SECONDS))
    assertTrue(released.await(1, TimeUnit.SECONDS))
  }
  @Test
  fun `reports silent PCM at the first window`() {
    val audio = FakeAudio(ShortArray(64_000))
    val levels = CopyOnWriteArrayList<Boolean>()
    val session = RecognizeSession(audio, { RecognizeOutcome.NoMatch },
      onHeard = { ms, audible -> levels += audible; heard += ms },
      onCaptureFailed = { captureFailed.countDown() })
    session.start()
    waitForHeard(4_000)
    session.stop()
    assertEquals(16, levels.size)
    assertTrue(levels.none { it })
  }
  private val chordSong: ShortArray = run {
    val bytes = Fixtures.file("shazam/chord-song.pcm").readBytes()
    ShortArray(bytes.size / 2).also { ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(it) }
  }

  /**
   * Serves [samples] in 100 ms pieces, then waits for [stop] (or, with [failsAtEnd],
   * stops on its own as a microphone taken away would).
   */
  private class FakeAudio(private val samples: ShortArray, private val failsAtEnd: Boolean = false) : RecognizeAudio {
    private var position = 0
    private val stopped = CountDownLatch(1)
    val released = CountDownLatch(1)
    val isStopped: Boolean get() = stopped.count == 0L

    override fun read(buffer: ShortArray): Int {
      if (isStopped) return -1
      if (position < samples.size) {
        val count = minOf(PIECE, buffer.size, samples.size - position)
        samples.copyInto(buffer, 0, position, position + count)
        position += count
        return count
      }
      if (failsAtEnd) return -1
      stopped.await()
      return -1
    }

    override fun stop() = stopped.countDown()

    override fun release() = released.countDown()

    companion object {
      const val PIECE = 1_600
    }
  }

  /** [seconds] of 16 kHz audio that never repeats, so each stretch has peaks of its own. */
  private fun changingNoise(seconds: Int): ShortArray {
    val random = Random(905)
    return ShortArray(seconds * 16_000) { (random.nextGaussian() * 6_000).toInt().toShort() }
  }

  private val heard = CopyOnWriteArrayList<Int>()
  private val captureFailed = CountDownLatch(1)

  private fun session(audio: RecognizeAudio, recognize: (ShazamSignature) -> RecognizeOutcome = { RecognizeOutcome.NoMatch }) =
    RecognizeSession(audio, recognize, onHeard = { ms, _ -> heard += ms }, onCaptureFailed = { captureFailed.countDown() })

  private fun waitForHeard(ms: Int) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    while ((heard.lastOrNull() ?: 0) < ms) {
      check(System.nanoTime() < deadline) { "Never heard $ms ms; heard $heard" }
      Thread.sleep(5)
    }
  }

  @Test
  fun `reports how much it has heard every quarter second`() {
    val audio = FakeAudio(chordSong)
    session(audio).start()
    waitForHeard(4_000)

    assertEquals((1..16).map { it * 250 }, heard.toList())
    audio.stop()
  }

  @Test
  fun `asks with the signature of everything heard so far`() {
    val audio = FakeAudio(chordSong)
    val asked = CopyOnWriteArrayList<ShazamSignature>()
    val session = session(audio) { asked += it; RecognizeOutcome.NoMatch }
    session.start()
    waitForHeard(4_000)

    assertEquals(RecognizeOutcome.NoMatch, session.ask(last = false, windowMs = WINDOW_MS))
    assertEquals(Fixtures.file("shazam/chord-song.uri").readText().trim(), asked.single().uri)
    assertEquals(4_000, asked.single().sampleMs)
    assertFalse("the capture goes on after an ask that isn't the last", audio.isStopped)
    session.stop()
  }

  @Test
  fun `past the window, asks with what a new generator gives for only the latest 12 seconds`() {
    val samples = changingNoise(20)
    val audio = FakeAudio(samples)
    val asked = CopyOnWriteArrayList<ShazamSignature>()
    val session = session(audio) { asked += it; RecognizeOutcome.NoMatch }
    session.start()
    waitForHeard(20_000)

    session.ask(last = false, windowMs = WINDOW_MS)

    val alone = SignatureGenerator().apply { append(samples.copyOfRange(8 * 16_000, 20 * 16_000)) }.signature()
    assertEquals(alone, asked.single())
    assertEquals(12_000, asked.single().sampleMs)
    assertTrue("the window has peaks to compare", alone.uri.length > 1_000)
    session.stop()
  }

  @Test
  fun `a second ask covers the latest window, not the one before`() {
    val samples = changingNoise(16)
    val audio = FakeAudio(samples)
    val asked = CopyOnWriteArrayList<ShazamSignature>()
    val session = session(audio) { asked += it; RecognizeOutcome.NoMatch }
    session.start()
    waitForHeard(16_000)

    session.ask(last = false, windowMs = WINDOW_MS)
    session.ask(last = true, windowMs = WINDOW_MS)

    assertEquals("nothing new was heard between them", asked[0], asked[1])
  }

  @Test
  fun `a retry of the last ask signs the same audio after the capture has stopped`() {
    val audio = FakeAudio(changingNoise(16))
    val asked = CopyOnWriteArrayList<ShazamSignature>()
    val session = session(audio) { asked += it; RecognizeOutcome.NoMatch }
    session.start()
    waitForHeard(16_000)

    session.ask(last = true, windowMs = WINDOW_MS)
    assertTrue(audio.released.await(5, TimeUnit.SECONDS))
    session.ask(last = true, windowMs = WINDOW_MS)

    assertEquals(asked[0], asked[1])
    assertEquals(12_000, asked[1].sampleMs)
  }

  @Test
  fun `no window reaches the 15 seconds at which Shazam stops matching`() {
    val audio = FakeAudio(changingNoise(20))
    val asked = CopyOnWriteArrayList<ShazamSignature>()
    val session = session(audio) { asked += it; RecognizeOutcome.NoMatch }
    session.start()
    waitForHeard(20_000)

    session.ask(last = false, windowMs = 60_000)

    assertTrue("${asked.single().sampleMs} ms", asked.single().sampleMs < 15_000)
    session.stop()
  }

  @Test
  fun `a capture that goes on past the window still reports everything it has heard`() {
    val audio = FakeAudio(ShortArray(20 * 16_000))
    session(audio).start()
    waitForHeard(20_000)

    assertEquals((1..80).map { it * 250 }, heard.toList())
    audio.stop()
  }

  @Test
  fun `answers what the request answered`() {
    val audio = FakeAudio(chordSong)
    val refused = RecognizeOutcome.Failed(RecognizeFailure.REFUSED, 429)
    val session = session(audio) { refused }
    session.start()
    waitForHeard(4_000)

    assertEquals(refused, session.ask(last = false, windowMs = WINDOW_MS))
    session.stop()
  }

  @Test
  fun `the last ask stops the capture first`() {
    val audio = FakeAudio(chordSong)
    var stoppedWhenAsked = false
    val session = session(audio) { stoppedWhenAsked = audio.isStopped; RecognizeOutcome.NoMatch }
    session.start()
    waitForHeard(4_000)
    session.ask(last = true, windowMs = WINDOW_MS)

    assertTrue(stoppedWhenAsked)
    assertTrue("the capture thread lets the audio go", audio.released.await(5, TimeUnit.SECONDS))
    assertFalse("stopping isn't a failure", captureFailed.await(100, TimeUnit.MILLISECONDS))
  }

  @Test
  fun `stop ends the capture without calling it a failure`() {
    val audio = FakeAudio(chordSong)
    val session = session(audio)
    session.start()
    waitForHeard(1_000)
    session.stop()

    assertTrue(audio.released.await(5, TimeUnit.SECONDS))
    assertFalse(captureFailed.await(100, TimeUnit.MILLISECONDS))
  }

  @Test
  fun `audio that stops on its own is reported`() {
    val audio = FakeAudio(chordSong.copyOf(16_000), failsAtEnd = true)
    session(audio).start()

    assertTrue(captureFailed.await(5, TimeUnit.SECONDS))
    assertTrue(audio.released.await(5, TimeUnit.SECONDS))
    assertEquals(1_000, heard.last())
  }

  private companion object {
    const val WINDOW_MS = 12_000
  }
}
