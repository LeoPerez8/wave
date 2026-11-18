package expo.modules.wavenative.tags

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
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
    assertEquals("$name genres", listOf("Ambient"), tags.genres)
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
  fun originalReleaseDatesKeepPrecisionWithoutChangingYear() {
    for (name in listOf("tagged.mp3", "tagged.flac", "tagged-aac.m4a", "tagged-alac.m4a", "tagged.ogg", "tagged.wav")) {
      val file = Fixtures.tempDir().resolve(name)
      Fixtures.file(name).copyTo(file)
      val audio = AudioFileIO.read(file)
      val container = audio.tagOrCreateAndSetDefault
      val tag = if (container is org.jaudiotagger.tag.wav.WavTag) {
        container.setID3Tag(org.jaudiotagger.tag.id3.ID3v24Tag())
        container.iD3Tag
      } else container
      tag.setField(FieldKey.ORIGINALRELEASEDATE, "1985-06-21")
      AudioFileIO.write(audio)
      val tags = reader.read(file)
      assertEquals("$name original date", "1985-06-21", tags.releaseDate)
      assertEquals("$name album Year", "2024", tags.year)
    }
  }

  @Test
  fun aacFallbackRetainsALeadingId3OriginalDate() {
    val tag = org.jaudiotagger.tag.id3.ID3v24Tag().apply {
      setField(FieldKey.ORIGINALRELEASEDATE, "1985-06-21")
    }
    val file = Fixtures.tempDir().resolve("tagged.aac")
    file.outputStream().use { tag.write(it, 0) }
    file.appendBytes(byteArrayOf(0xff.toByte(), 0xf1.toByte(), 0, 0))
    val fallback = AudioTagReader(primary = JAudioTaggerReader(), fallback = { RawTags(year = "2005") })
    val tags = fallback.read(file)
    assertEquals("1985-06-21", tags.releaseDate)
    assertEquals("2005", tags.year)
  }

  /** A copy of the fixture [name] with a second genre added to its tag. */
  private fun withSecondGenre(name: String): java.io.File {
    val file = Fixtures.tempDir().resolve(name)
    Fixtures.file(name).copyTo(file)
    val audio = AudioFileIO.read(file)
    audio.tag.addField(FieldKey.GENRE, "Electronic")
    AudioFileIO.write(audio)
    return file
  }

  @Test
  fun everyValueOfAMultiValueGenreTagIsKept() {
    for (name in listOf("tagged.flac", "tagged.ogg")) {
      val tags = reader.read(withSecondGenre(name))
      assertEquals("$name genre", "Ambient", tags.genre)
      assertEquals("$name genres", listOf("Ambient", "Electronic"), tags.genres)
    }
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

  /** A copy of the fixture [name] with ReplayGain tags, written as taggers do for its format. */
  private fun withReplayGain(name: String, key: (String) -> String = { it }): java.io.File {
    val file = Fixtures.tempDir().resolve(name)
    Fixtures.file(name).copyTo(file)
    val audio = AudioFileIO.read(file)
    val tag = audio.tagOrCreateAndSetDefault
    val values = mapOf(
      "REPLAYGAIN_TRACK_GAIN" to "-6.54 dB",
      "REPLAYGAIN_TRACK_PEAK" to "0.988553",
      "REPLAYGAIN_ALBUM_GAIN" to "-7.10 dB",
      "REPLAYGAIN_ALBUM_PEAK" to "1.023000",
    )
    for ((name, value) in values) {
      when (tag) {
        is org.jaudiotagger.tag.mp4.Mp4Tag ->
          tag.addField(org.jaudiotagger.tag.mp4.field.Mp4TagReverseDnsField("----", "com.apple.iTunes", key(name), value))
        is org.jaudiotagger.tag.id3.AbstractID3v2Tag -> {
          val frame = tag.createFrame("TXXX")
          frame.body = org.jaudiotagger.tag.id3.framebody.FrameBodyTXXX(
            org.jaudiotagger.tag.id3.valuepair.TextEncoding.ISO_8859_1,
            key(name),
            value,
          )
          tag.addField(frame)
        }
        // FLAC and Ogg Vorbis: a Vorbis comment.
        else -> tag.addField(org.jaudiotagger.tag.vorbiscomment.VorbisCommentTagField(key(name), value))
      }
    }
    AudioFileIO.write(audio)
    return file
  }

  @Test
  fun replayGainTagsInEveryFormat() {
    for (name in listOf("tagged.mp3", "tagged.flac", "tagged.ogg", "tagged-aac.m4a")) {
      val tags = reader.read(withReplayGain(name)).loudness
      assertEquals("$name track gain", "-6.54 dB", tags.replayGainTrackGain)
      assertEquals("$name track peak", "0.988553", tags.replayGainTrackPeak)
      assertEquals("$name album gain", "-7.10 dB", tags.replayGainAlbumGain)
      assertEquals("$name album peak", "1.023000", tags.replayGainAlbumPeak)
    }
  }

  @Test
  fun replayGainTagNamesInLowerCase() {
    // foobar2000 and iTunes-style taggers write the names in lower case.
    for (name in listOf("tagged.mp3", "tagged.flac", "tagged-aac.m4a")) {
      val tags = reader.read(withReplayGain(name) { it.lowercase() }).loudness
      assertEquals("$name track gain", "-6.54 dB", tags.replayGainTrackGain)
      assertEquals("$name album peak", "1.023000", tags.replayGainAlbumPeak)
    }
  }

  @Test
  fun noLoudnessTagsWhenNoneAreTagged() {
    for (name in listOf("tagged.mp3", "tagged.flac", "tagged.ogg", "tagged-aac.m4a", "tagged.opus", "untagged.mp3")) {
      assertEquals(name, LoudnessTags(), reader.read(Fixtures.file(name)).loudness)
    }
  }

  private companion object {
    /** What every `lyrics.*` fixture carries (see `generate.sh`). */
    const val FIXTURE_LYRICS = "[00:00.50]Olá, onda\n[00:01.00]Second line"
  }
}
