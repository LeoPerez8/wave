package expo.modules.wavenative.tags

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reads every fixture format through the same entry point the scanner uses and
 * checks the tags, duration and embedded artwork.
 */
class TagReadingTest {
  private val reader = AudioTagReader(primary = JAudioTaggerReader())

  private fun assertFullyTagged(name: String, expectArtwork: Boolean = true) {
    val tags = reader.read(Fixtures.file(name))
    assertEquals("$name title", "Wave Fixture", tags.title)
    assertEquals("$name artist", "Fixture Artist", tags.artist)
    assertEquals("$name album", "Fixture Album", tags.album)
    assertEquals("$name album artist", "Fixture Album Artist", tags.albumArtist)
    assertEquals("$name genre", "Ambient", tags.genre)
    assertEquals("$name year", "2024", tags.year)
    assertEquals("$name track", "3/12", tags.trackNumber)
    assertEquals("$name disc", "1/2", tags.discNumber)
    assertFalse("$name compilation", tags.compilation)
    assertDuration(name, tags)
    if (expectArtwork) assertArrayEquals("$name artwork", Fixtures.cover(), tags.artwork)
  }

  private fun assertDuration(name: String, tags: RawTags) {
    // Fixtures are 1.5 s of audio; encoders add a little padding.
    assertTrue("$name duration ${tags.durationMs}", tags.durationMs in 1_400..1_700)
  }

  @Test fun mp3() = assertFullyTagged("tagged.mp3")

  @Test fun flac() = assertFullyTagged("tagged.flac")

  @Test fun m4aAac() = assertFullyTagged("tagged-aac.m4a")

  @Test fun m4aAlac() = assertFullyTagged("tagged-alac.m4a")

  @Test fun oggVorbis() = assertFullyTagged("tagged.ogg")

  @Test fun opus() = assertFullyTagged("tagged.opus")

  @Test fun opusInsideAnOggFile() = assertFullyTagged("opus-in-ogg.ogg")

  @Test
  fun wav() {
    val tags = reader.read(Fixtures.file("tagged.wav"))
    assertEquals("Wave Fixture", tags.title)
    assertEquals("Fixture Artist", tags.artist)
    assertEquals("Fixture Album", tags.album)
    assertEquals("Ambient", tags.genre)
    assertEquals("2024", tags.year)
    assertDuration("tagged.wav", tags)
  }

  @Test
  fun compilationFlag() {
    val tags = reader.read(Fixtures.file("compilation.mp3"))
    assertTrue(tags.compilation)
    assertNull(tags.albumArtist)
    assertNotNull(tags.artwork)
  }

  @Test
  fun untaggedFileReadsWithoutTags() {
    val tags = reader.read(Fixtures.file("untagged.mp3"))
    assertNull(tags.title)
    assertNull(tags.artist)
    assertNull(tags.album)
    assertNull(tags.artwork)
    assertDuration("untagged.mp3", tags)
  }

  @Test
  fun unreadableFileFallsBackToEmptyTags() {
    val garbage = Fixtures.tempDir().resolve("broken.mp3").apply { writeText("not audio") }
    val tags = reader.read(garbage)
    assertNull(tags.title)
    assertEquals(0L, tags.durationMs)
  }

  @Test
  fun unreadableFileUsesTheFallbackReader() {
    val garbage = Fixtures.tempDir().resolve("broken.flac").apply { writeText("not audio") }
    val withFallback = AudioTagReader(
      primary = JAudioTaggerReader(),
      fallback = { RawTags(title = "From fallback") },
    )
    assertEquals("From fallback", withFallback.read(garbage).title)
  }

  private fun assertLyrics(name: String) =
    assertEquals("$name lyrics", FIXTURE_LYRICS, reader.read(Fixtures.file(name)).lyrics)

  @Test fun lyricsFromAnId3UsltFrame() = assertLyrics("lyrics.mp3")

  @Test fun lyricsFromAnMp3ConvertedByFfmpeg() = assertLyrics("lyrics-ffmpeg.mp3")

  @Test fun lyricsFromFlac() = assertLyrics("lyrics.flac")

  @Test fun lyricsFromM4a() = assertLyrics("lyrics.m4a")

  @Test fun lyricsFromOggVorbisUnsyncedLyricsField() = assertLyrics("lyrics.ogg")

  @Test fun lyricsFromOpus() = assertLyrics("lyrics.opus")

  @Test
  fun noLyricsWhenNoneAreTagged() {
    assertNull(reader.read(Fixtures.file("tagged.mp3")).lyrics)
    assertNull(reader.read(Fixtures.file("tagged.flac")).lyrics)
    assertNull(reader.read(Fixtures.file("untagged.mp3")).lyrics)
  }

  private fun advisoryOf(name: String): String? = reader.read(Fixtures.file(name)).advisory

  @Test fun advisoryFromAnId3UserTextFrame() = assertEquals("1", advisoryOf("explicit.mp3"))

  @Test fun advisoryFromFlac() = assertEquals("1", advisoryOf("explicit.flac"))

  @Test fun advisoryFromOggVorbis() = assertEquals("0", advisoryOf("clean.ogg"))

  @Test fun advisoryFromAnMp4RtngAtom() = assertEquals("1", advisoryOf("explicit.m4a"))

  @Test
  fun noAdvisoryWhenNoneIsTagged() {
    for (name in listOf("tagged.mp3", "tagged.flac", "tagged.ogg", "tagged-aac.m4a", "tagged.opus", "untagged.mp3")) {
      assertNull(name, advisoryOf(name))
    }
  }

  private companion object {
    /** What every `lyrics.*` fixture carries (see `generate.sh`). */
    const val FIXTURE_LYRICS = "[00:00.50]Olá, onda\n[00:01.00]Second line"
  }
}
