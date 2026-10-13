package expo.modules.wavenative.tags

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Writes found lyrics and genre into copies of the fixtures and checks that
 * they read back, and that the audio and every other tag are unchanged.
 */
class SongTagWriterTest {
  private val writer = SongTagWriter()
  private val reader = AudioTagReader(primary = JAudioTaggerReader())

  private fun copyOf(fixture: String, name: String = fixture): File =
    Fixtures.libraryOf(fixture to name).resolve(name)

  /** Writes into a copy of [fixture] and checks what changed, and what didn't. */
  private fun assertWritesTags(fixture: String, tagged: Boolean = true) {
    val file = copyOf(fixture)
    val tagsBefore = reader.read(file)
    val audioBefore = AudioPayload.of(file)
    val fieldsBefore = OtherTagFields.of(file)
    if (tagged) assertTrue("$fixture has other tag fields to compare", fieldsBefore.size >= 4)
    assertTrue("$fixture has audio to compare (${audioBefore.size} bytes)", audioBefore.size > 100)

    val report = writer.write(file, lyrics = NEW_LYRICS, genre = "Post-Rock")

    assertEquals("$fixture report", TagWriteReport(LyricsDestination.TAGS, GenreDestination.TAGS), report)
    val tagsAfter = reader.read(file)
    assertEquals("$fixture lyrics", NEW_LYRICS, tagsAfter.lyrics)
    assertEquals("$fixture genre", "Post-Rock", tagsAfter.genre)
    assertEquals(
      "$fixture other tags",
      tagsBefore.copy(genre = null, lyrics = null, artwork = null),
      tagsAfter.copy(genre = null, lyrics = null, artwork = null),
    )
    assertArrayEquals("$fixture artwork", tagsBefore.artwork, tagsAfter.artwork)
    assertEquals("$fixture every other tag field", fieldsBefore, OtherTagFields.of(file))
    assertArrayEquals("$fixture audio", audioBefore, AudioPayload.of(file))
    assertFalse("$fixture sidecar", File(file.parentFile, "${file.nameWithoutExtension}.lrc").exists())
  }

  @Test fun mp3() = assertWritesTags("tagged.mp3")

  @Test fun flac() = assertWritesTags("tagged.flac")

  @Test fun m4aAac() = assertWritesTags("tagged-aac.m4a")

  @Test fun m4aAlac() = assertWritesTags("tagged-alac.m4a")

  @Test fun oggVorbis() = assertWritesTags("tagged.ogg")

  @Test fun wav() = assertWritesTags("tagged.wav")

  @Test fun mp3WithoutAnyTags() = assertWritesTags("untagged.mp3", tagged = false)

  private fun assertReplacesLyrics(fixture: String) {
    val file = copyOf(fixture)
    val audioBefore = AudioPayload.of(file)
    writer.write(file, lyrics = NEW_LYRICS, genre = null)
    assertEquals("$fixture lyrics", NEW_LYRICS, reader.read(file).lyrics)
    assertArrayEquals("$fixture audio", audioBefore, AudioPayload.of(file))
  }

  @Test fun replacesAnId3UsltFrame() = assertReplacesLyrics("lyrics.mp3")

  @Test fun replacesLyricsFfmpegWroteToAnMp3() = assertReplacesLyrics("lyrics-ffmpeg.mp3")

  @Test fun replacesFlacLyrics() = assertReplacesLyrics("lyrics.flac")

  @Test fun replacesM4aLyrics() = assertReplacesLyrics("lyrics.m4a")

  @Test fun replacesOggUnsyncedLyrics() = assertReplacesLyrics("lyrics.ogg")

  @Test
  fun writesOnlyWhatWasFound() {
    val file = copyOf("lyrics.flac")
    val report = writer.write(file, lyrics = null, genre = "Jazz")
    assertEquals(TagWriteReport(LyricsDestination.NONE, GenreDestination.TAGS), report)
    val tags = reader.read(file)
    assertEquals("Jazz", tags.genre)
    assertEquals(FIXTURE_LYRICS, tags.lyrics)
  }

  @Test
  fun leavesTheFileAloneWhenNothingWasFound() {
    val file = copyOf("tagged.mp3")
    val before = file.readBytes()
    val modifiedAt = file.lastModified()
    val report = writer.write(file, lyrics = null, genre = null)
    assertEquals(TagWriteReport(LyricsDestination.NONE, GenreDestination.NONE), report)
    assertArrayEquals(before, file.readBytes())
    assertEquals(modifiedAt, file.lastModified())
  }

  @Test
  fun opusGetsASidecarAndItsGenreIsNotWritten() {
    val file = copyOf("tagged.opus")
    val before = file.readBytes()
    val report = writer.write(file, lyrics = NEW_LYRICS, genre = "Post-Rock")
    assertEquals(TagWriteReport(LyricsDestination.SIDECAR, GenreDestination.NOT_WRITTEN), report)
    assertArrayEquals("audio file untouched", before, file.readBytes())
    assertEquals(NEW_LYRICS, File(file.parentFile, "tagged.lrc").readText())
    assertEquals("Ambient", reader.read(file).genre)
  }

  @Test
  fun aSidecarThatIsAlreadyThereIsReplaced() {
    val folder = Fixtures.libraryOf("tagged.opus" to "Song.opus", "tagged.mp3" to "Other.mp3")
    val opusSidecar = File(folder, "Song.opus.lrc").apply { writeText("[00:01.00]Old") }
    writer.write(File(folder, "Song.opus"), lyrics = NEW_LYRICS, genre = null)
    assertEquals(NEW_LYRICS, opusSidecar.readText())
    assertFalse(File(folder, "Song.lrc").exists())

    // Beside a file that takes tags it would win over them in the Lyrics view, so it follows them.
    val mp3Sidecar = File(folder, "Other.lrc").apply { writeText("[00:01.00]Old") }
    val report = writer.write(File(folder, "Other.mp3"), lyrics = NEW_LYRICS, genre = null)
    assertEquals(LyricsDestination.TAGS, report.lyrics)
    assertEquals(NEW_LYRICS, mp3Sidecar.readText())
  }

  @Test
  fun aSidecarIsNotCreatedForAFileThatTakesTags() {
    val file = copyOf("tagged.flac")
    writer.write(file, lyrics = NEW_LYRICS, genre = null)
    assertNull(File(file.parentFile, "tagged.lrc").takeIf { it.exists() })
  }

  /** A file it can't write throws (Find Lyrics and Genre counts it as failed) and is left as it was. */
  @Test
  fun aFileThatCantBeWrittenThrowsAndIsLeftAsItWas() {
    val file = copyOf("tagged.mp3")
    val before = file.readBytes()
    assertTrue(file.setReadOnly())
    try {
      assertThrows(Exception::class.java) { writer.write(file, lyrics = NEW_LYRICS, genre = "Post-Rock") }
      assertArrayEquals(before, file.readBytes())
      assertFalse(File(file.parentFile, "tagged.lrc").exists())
    } finally {
      file.setWritable(true)
    }
  }

  private companion object {
    const val NEW_LYRICS = "[00:00.40]Nova letra\n[00:01.10]Second new line"
    const val FIXTURE_LYRICS = "[00:00.50]Olá, onda\n[00:01.00]Second line"
  }
}
