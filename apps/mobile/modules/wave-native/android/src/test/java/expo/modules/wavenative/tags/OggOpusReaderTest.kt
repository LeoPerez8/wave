package expo.modules.wavenative.tags

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OggOpusReaderTest {
  private val reader = OggOpusReader()

  @Test
  fun readsVorbisCommentsCoverAndDuration() {
    val tags = reader.read(Fixtures.file("tagged.opus"))
    assertEquals("Wave Fixture", tags.title)
    assertEquals("Fixture Album Artist", tags.albumArtist)
    assertEquals("3/12", tags.trackNumber)
    assertEquals(48_000, tags.sampleRate)
    // 1.5 s, minus pre-skip; Opus frames round the end up to 20 ms.
    assertTrue("duration ${tags.durationMs}", tags.durationMs in 1_490..1_530)
    assertArrayEquals(Fixtures.cover(), tags.artwork)
  }

  @Test
  fun detectsOpusByContentNotExtension() {
    assertTrue(OggOpusReader.isOpus(Fixtures.file("opus-in-ogg.ogg")))
    assertFalse(OggOpusReader.isOpus(Fixtures.file("tagged.ogg")))
    assertFalse(OggOpusReader.isOpus(Fixtures.file("tagged.mp3")))
  }

  @Test
  fun commentKeysAreCaseInsensitiveAndTotalsAreCombined() {
    val block = vorbisComments(
      "title=Lower Case",
      "TRACKNUMBER=4",
      "TRACKTOTAL=9",
      "DISCNUMBER=2",
      "TOTALDISCS=3",
      "Album Artist=Spaced",
      "COMPILATION=1",
      "YEAR=1999",
    )
    val tags = with(OggOpusReader) { parseComments(block, 0).toRawTags(durationMs = 0, sampleRate = null) }
    assertEquals("Lower Case", tags.title)
    assertEquals("4/9", tags.trackNumber)
    assertEquals("2/3", tags.discNumber)
    assertEquals("Spaced", tags.albumArtist)
    assertEquals("1999", tags.year)
    assertTrue(tags.compilation)
  }

  private fun vorbisComments(vararg entries: String): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    fun writeInt(value: Int) {
      out.write(value and 0xff)
      out.write((value shr 8) and 0xff)
      out.write((value shr 16) and 0xff)
      out.write((value shr 24) and 0xff)
    }
    val vendor = "test".toByteArray()
    writeInt(vendor.size)
    out.write(vendor)
    writeInt(entries.size)
    for (entry in entries) {
      val bytes = entry.toByteArray()
      writeInt(bytes.size)
      out.write(bytes)
    }
    return out.toByteArray()
  }
}
