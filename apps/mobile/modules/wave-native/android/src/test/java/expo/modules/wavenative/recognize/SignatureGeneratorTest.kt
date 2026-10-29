package expo.modules.wavenative.recognize

import expo.modules.wavenative.Fixtures
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The fixtures are 16 kHz PCM and the signature shazamio-core 2.0.0 gives for it
 * (`src/test/fixtures-src/shazam/make_fixtures.py`).
 */
class SignatureGeneratorTest {
  private fun pcm(name: String): ShortArray {
    val bytes = Fixtures.file("shazam/$name.pcm").readBytes()
    val samples = ShortArray(bytes.size / 2)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
    return samples
  }

  private fun uri(name: String) = Fixtures.file("shazam/$name.uri").readText().trim()

  @Test
  fun `a fixture gives the signature shazamio-core gives for it`() {
    for (name in listOf("chord-song", "pause")) {
      val generator = SignatureGenerator()
      generator.append(pcm(name))

      assertEquals(name, uri(name), generator.signature().uri)
    }
  }

  @Test
  fun `audio appended as it is captured, with signatures sent on the way, gives the same signature`() {
    val samples = pcm("chord-song")
    val generator = SignatureGenerator()
    var offset = 0
    var piece = 1
    while (offset < samples.size) {
      val length = minOf(piece, samples.size - offset)
      generator.append(samples, offset, length)
      generator.signature()
      offset += length
      piece = piece * 3 + 7
    }

    assertEquals(uri("chord-song"), generator.signature().uri)
  }

  @Test
  fun `the signature says how long the audio was`() {
    val generator = SignatureGenerator()
    generator.append(pcm("pause"))
    assertEquals(4000, generator.signature().sampleMs)

    // shazamio-core counts a last part shorter than one 128-sample step in the length.
    generator.append(ShortArray(100))
    assertEquals(4006, generator.signature().sampleMs)
  }
}
