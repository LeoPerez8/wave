package expo.modules.wavenative.tags

import expo.modules.wavenative.Fixtures
import java.io.File
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.wav.WavTag
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

    assertEquals("$fixture report", TagWriteReport(LyricsDestination.TAGS, TagDestination.TAGS), report)
    val tagsAfter = reader.read(file)
    assertEquals("$fixture lyrics", NEW_LYRICS, tagsAfter.lyrics)
    assertEquals("$fixture genre", "Post-Rock", tagsAfter.genre)
    assertEquals("$fixture genres", listOf("Post-Rock"), tagsAfter.genres)
    assertEquals(
      "$fixture other tags",
      tagsBefore.copy(genre = null, genres = emptyList(), lyrics = null, artwork = null),
      tagsAfter.copy(genre = null, genres = emptyList(), lyrics = null, artwork = null),
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
    assertEquals(TagWriteReport(LyricsDestination.NONE, TagDestination.TAGS), report)
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
    assertEquals(TagWriteReport(LyricsDestination.NONE, TagDestination.NONE), report)
    assertArrayEquals(before, file.readBytes())
    assertEquals(modifiedAt, file.lastModified())
  }

  @Test
  fun opusGetsASidecarAndItsGenreIsNotWritten() {
    val file = copyOf("tagged.opus")
    val before = file.readBytes()
    val report = writer.write(file, lyrics = NEW_LYRICS, genre = "Post-Rock")
    assertEquals(TagWriteReport(LyricsDestination.SIDECAR, TagDestination.NOT_WRITTEN), report)
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

  /** A file it can't write throws (Fix Song counts it as failed) and is left as it was. */
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

  /** A failure says its step (the app log's line, #448): a file it can't write fails writing. */
  @Test
  fun aFileThatCantBeWrittenFailsAtTheWriteStep() {
    val file = copyOf("tagged.mp3")
    assertTrue(file.setReadOnly())
    try {
      val failure = assertThrows(TagWriteStepException::class.java) {
        writer.write(file, lyrics = NEW_LYRICS, genre = "Post-Rock")
      }
      assertEquals(TagWriteStep.WRITE, failure.step)
    } finally {
      file.setWritable(true)
    }
  }

  @Test
  fun aFileGoneFailsAtTheReadStep() {
    val file = File(copyOf("tagged.mp3").parentFile, "gone.mp3")
    val failure = assertThrows(TagWriteStepException::class.java) {
      writer.write(file, lyrics = NEW_LYRICS, genre = null)
    }
    assertEquals(TagWriteStep.READ, failure.step)
  }

  /** What JS logs of a failure: the step, the original exception, and the file as it was then. */
  @Test
  fun aFailureTellsJsTheStepTheExceptionAndTheFile() {
    val file = copyOf("tagged.mp3")
    val failure = TagWriteStepException(TagWriteStep.WRITE, java.io.IOException("No space left on device"))
    assertEquals(
      mapOf(
        "step" to "write",
        "exception" to "java.io.IOException",
        "message" to "No space left on device",
        "fileExists" to true,
        "fileBytes" to file.length().toDouble(),
      ),
      TagWriteFailure.of(failure, file).toMap(),
    )
    val gone = TagWriteFailure.of(failure, File(file.parentFile, "gone.mp3")).toMap()
    assertEquals(false, gone["fileExists"])
    assertNull(gone["fileBytes"])
  }

  /** A copy of [fixture] without its track number, disc and year, as a file never numbered. */
  private fun unnumberedCopyOf(fixture: String): File {
    val file = copyOf(fixture)
    val audio = AudioFileIO.read(file)
    val tags = (audio.tag as? WavTag)?.let { listOfNotNull(it.iD3Tag, it.infoTag) } ?: listOfNotNull(audio.tag)
    for (tag in tags) for (key in PLACE_KEYS) runCatching { tag.deleteField(key) }
    AudioFileIO.write(audio)
    val read = reader.read(file)
    check(read.trackNumber == null && read.discNumber == null && read.year == null) { "$fixture is still numbered: $read" }
    return file
  }

  /** Fills in the track number, disc and year of an unnumbered copy of [fixture]; nothing else changes. */
  private fun assertFillsInPlace(fixture: String) {
    val file = unnumberedCopyOf(fixture)
    val tagsBefore = reader.read(file)
    val audioBefore = AudioPayload.of(file)
    val fieldsBefore = OtherTagFields.of(file, except = OtherTagFields.PLACE)
    assertTrue("$fixture has other tag fields to compare", fieldsBefore.size >= 4)

    val report = writer.write(file, lyrics = null, genre = null, place = PLACE)

    assertEquals(
      "$fixture report",
      TagWriteReport(LyricsDestination.NONE, TagDestination.NONE, trackNumber = TagDestination.TAGS, year = TagDestination.TAGS),
      report,
    )
    val tagsAfter = reader.read(file)
    assertEquals("$fixture track", "6", tagsAfter.trackNumber)
    assertEquals("$fixture disc", "2", tagsAfter.discNumber)
    assertEquals("$fixture year", "1997", tagsAfter.year)
    val unnumbered = { tags: RawTags -> tags.copy(trackNumber = null, discNumber = null, year = null, artwork = null) }
    assertEquals("$fixture other tags", unnumbered(tagsBefore), unnumbered(tagsAfter))
    assertArrayEquals("$fixture artwork", tagsBefore.artwork, tagsAfter.artwork)
    assertEquals("$fixture every other tag field", fieldsBefore, OtherTagFields.of(file, except = OtherTagFields.PLACE))
    assertArrayEquals("$fixture audio", audioBefore, AudioPayload.of(file))
  }

  @Test fun fillsInAnMp3sTrackNumberAndYear() = assertFillsInPlace("tagged.mp3")

  @Test fun fillsInAFlacsTrackNumberAndYear() = assertFillsInPlace("tagged.flac")

  @Test fun fillsInAnM4asTrackNumberAndYear() = assertFillsInPlace("tagged-aac.m4a")

  @Test fun fillsInAnOggVorbisTrackNumberAndYear() = assertFillsInPlace("tagged.ogg")

  @Test fun fillsInAWavsTrackNumberAndYear() = assertFillsInPlace("tagged.wav")

  @Test
  fun fillsInAnUntaggedMp3() {
    val file = copyOf("untagged.mp3")
    val audioBefore = AudioPayload.of(file)
    writer.write(file, lyrics = null, genre = null, place = PLACE)
    val tags = reader.read(file)
    assertEquals(listOf("6", "2", "1997"), listOf(tags.trackNumber, tags.discNumber, tags.year))
    assertArrayEquals(audioBefore, AudioPayload.of(file))
  }

  @Test
  fun writesLyricsGenreTrackNumberAndYearTogether() {
    val file = unnumberedCopyOf("tagged.flac")
    val report = writer.write(file, lyrics = NEW_LYRICS, genre = "Post-Rock", place = PLACE)
    assertEquals(TagWriteReport(LyricsDestination.TAGS, TagDestination.TAGS, TagDestination.TAGS, TagDestination.TAGS), report)
    val tags = reader.read(file)
    assertEquals(listOf(NEW_LYRICS, "Post-Rock", "6", "2", "1997"), listOf(tags.lyrics, tags.genre, tags.trackNumber, tags.discNumber, tags.year))
  }

  @Test
  fun aSingleDiscAlbumGetsNoDiscNumber() {
    val file = unnumberedCopyOf("tagged.mp3")
    writer.write(file, lyrics = null, genre = null, place = AlbumPlace(trackNumber = 6, discNumber = null, year = null))
    val tags = reader.read(file)
    assertEquals("6", tags.trackNumber)
    assertNull(tags.discNumber)
    assertNull(tags.year)
  }

  /** A file that has a track number and year keeps them; with nothing else to write it isn't touched. */
  private fun assertKeepsPlace(fixture: String, disc: String? = "1/2", numbered: (File) -> Unit = {}) {
    val file = copyOf(fixture).also(numbered)
    check(reader.read(file).trackNumber == "3/12" && reader.read(file).year == "2024") { "$fixture is numbered" }
    val before = file.readBytes()
    val report = writer.write(file, lyrics = null, genre = null, place = PLACE)
    assertEquals("$fixture report", TagWriteReport(LyricsDestination.NONE, TagDestination.NONE), report)
    assertArrayEquals("$fixture untouched", before, file.readBytes())

    writer.write(file, lyrics = NEW_LYRICS, genre = null, place = PLACE).let {
      assertEquals("$fixture track number report", TagDestination.NONE, it.trackNumber)
      assertEquals("$fixture year report", TagDestination.NONE, it.year)
    }
    val tags = reader.read(file)
    assertEquals("$fixture lyrics", NEW_LYRICS, tags.lyrics)
    assertEquals("$fixture track", "3/12", tags.trackNumber)
    assertEquals("$fixture disc", disc, tags.discNumber)
    assertEquals("$fixture year", "2024", tags.year)
  }

  @Test fun anMp3KeepsItsTrackNumberAndYear() = assertKeepsPlace("tagged.mp3")

  @Test fun aFlacKeepsItsTrackNumberAndYear() = assertKeepsPlace("tagged.flac")

  @Test fun anM4aKeepsItsTrackNumberAndYear() = assertKeepsPlace("tagged-aac.m4a")

  @Test fun anOggVorbisKeepsItsTrackNumberAndYear() = assertKeepsPlace("tagged.ogg")

  /** The WAV fixture's RIFF INFO chunk has a year but no track number: one is added to it. */
  @Test
  fun aWavKeepsItsTrackNumberAndYear() =
    assertKeepsPlace("tagged.wav", disc = null) { file ->
      val audio = AudioFileIO.read(file)
      (audio.tag as WavTag).infoTag.setField(FieldKey.TRACK, "3/12")
      AudioFileIO.write(audio)
    }

  @Test
  fun keepsTheYearWhileFillingInTheTrackNumber() {
    val file = copyOf("tagged.flac")
    val audio = AudioFileIO.read(file)
    for (key in listOf(FieldKey.TRACK_TOTAL, FieldKey.TRACK, FieldKey.DISC_TOTAL, FieldKey.DISC_NO)) audio.tag.deleteField(key)
    AudioFileIO.write(audio)
    val report = writer.write(file, lyrics = null, genre = null, place = PLACE)
    assertEquals(TagDestination.TAGS, report.trackNumber)
    assertEquals(TagDestination.NONE, report.year)
    val tags = reader.read(file)
    assertEquals(listOf("6", "2", "2024"), listOf(tags.trackNumber, tags.discNumber, tags.year))
  }

  @Test
  fun opusGetsNoTrackNumberOrYear() {
    val file = copyOf("tagged.opus")
    val before = file.readBytes()
    val placeOnly = writer.write(file, lyrics = null, genre = null, place = PLACE)
    assertEquals(
      TagWriteReport(LyricsDestination.NONE, TagDestination.NONE, TagDestination.NOT_WRITTEN, TagDestination.NOT_WRITTEN),
      placeOnly,
    )
    assertFalse("no sidecar", File(file.parentFile, "tagged.lrc").exists())
    val withLyrics = writer.write(file, lyrics = NEW_LYRICS, genre = null, place = PLACE)
    assertEquals(
      TagWriteReport(LyricsDestination.SIDECAR, TagDestination.NONE, TagDestination.NOT_WRITTEN, TagDestination.NOT_WRITTEN),
      withLyrics,
    )
    assertArrayEquals("audio file untouched", before, file.readBytes())
  }

  /** Fills in [fixture]'s advisory tag (1, then 0 in another copy) and checks nothing else changed. */
  private fun assertFillsInAdvisory(fixture: String) {
    for (advisory in listOf(1, 0)) {
      val file = copyOf(fixture)
      check(reader.read(file).advisory == null) { "$fixture has no advisory tag" }
      val tagsBefore = reader.read(file)
      val audioBefore = AudioPayload.of(file)
      val report = writer.write(file, lyrics = null, genre = null, advisory = advisory)
      assertEquals(
        "$fixture report",
        TagWriteReport(LyricsDestination.NONE, TagDestination.NONE, explicit = TagDestination.TAGS),
        report,
      )
      val tagsAfter = reader.read(file)
      assertEquals("$fixture advisory", advisory.toString(), tagsAfter.advisory)
      assertEquals(
        "$fixture other tags",
        tagsBefore.copy(artwork = null),
        tagsAfter.copy(advisory = null, artwork = null),
      )
      assertArrayEquals("$fixture audio", audioBefore, AudioPayload.of(file))
    }
  }

  @Test fun fillsInAnMp3sAdvisory() = assertFillsInAdvisory("tagged.mp3")

  @Test fun fillsInAFlacsAdvisory() = assertFillsInAdvisory("tagged.flac")

  @Test fun fillsInAnM4asAdvisory() = assertFillsInAdvisory("tagged-aac.m4a")

  @Test fun fillsInAnOggVorbisAdvisory() = assertFillsInAdvisory("tagged.ogg")

  @Test fun fillsInAWavsAdvisory() = assertFillsInAdvisory("tagged.wav")

  @Test fun fillsInAnUntaggedMp3sAdvisory() = assertFillsInAdvisory("untagged.mp3")

  /** A file with an advisory tag keeps it (a YT Music download's, another app's); alone, it isn't touched. */
  private fun assertKeepsAdvisory(fixture: String, has: String) {
    val file = copyOf(fixture)
    val before = file.readBytes()
    val other = if (has == "1") 0 else 1
    val report = writer.write(file, lyrics = null, genre = null, advisory = other)
    assertEquals("$fixture report", TagWriteReport(LyricsDestination.NONE, TagDestination.NONE), report)
    assertArrayEquals("$fixture untouched", before, file.readBytes())

    assertEquals(TagDestination.NONE, writer.write(file, lyrics = NEW_LYRICS, genre = null, advisory = other).explicit)
    assertEquals("$fixture advisory", has, reader.read(file).advisory)
    assertEquals("$fixture lyrics", NEW_LYRICS, reader.read(file).lyrics)
  }

  @Test fun anMp3KeepsItsAdvisory() = assertKeepsAdvisory("explicit.mp3", has = "1")

  @Test fun aFlacKeepsItsAdvisory() = assertKeepsAdvisory("explicit.flac", has = "1")

  @Test fun anM4aKeepsItsAdvisory() = assertKeepsAdvisory("explicit.m4a", has = "1")

  @Test fun anOggVorbisKeepsItsAdvisory() = assertKeepsAdvisory("clean.ogg", has = "0")

  @Test
  fun writesTheAdvisoryWithEverythingElse() {
    val file = copyOf("untagged.mp3")
    val report = writer.write(file, lyrics = NEW_LYRICS, genre = "Jazz", place = PLACE, advisory = 1)
    assertEquals(
      TagWriteReport(LyricsDestination.TAGS, TagDestination.TAGS, TagDestination.TAGS, TagDestination.TAGS, TagDestination.TAGS),
      report,
    )
    val tags = reader.read(file)
    assertEquals(listOf(NEW_LYRICS, "Jazz", "6", "1997", "1"), listOf(tags.lyrics, tags.genre, tags.trackNumber, tags.year, tags.advisory))
  }

  @Test
  fun opusGetsNoAdvisory() {
    val file = copyOf("tagged.opus")
    val before = file.readBytes()
    val report = writer.write(file, lyrics = null, genre = null, advisory = 1)
    assertEquals(
      TagWriteReport(LyricsDestination.NONE, TagDestination.NONE, explicit = TagDestination.NOT_WRITTEN),
      report,
    )
    assertArrayEquals("audio file untouched", before, file.readBytes())
  }

  /**
   * A quality replacement's new copy (#454): YouTube's fragmented M4A, tagged at download with
   * the replaced file's tags ([DownloadTagWriter], `keepTagsOf`), which can lack lyrics, a genre,
   * a track number or a year. The fill-in then writes those into it. jaudiotagger can't grow a
   * fragmented file's moov ("incorrect offsets written"), so this failed at the write step.
   */
  private fun replacementCopy(lyrics: String?): File {
    val file = copyOf("fragmented-aac.m4a", "Get Lucky.m4a")
    val tags = DownloadTags(
      title = "Get Lucky",
      artist = "Daft Punk, Pharrell Williams",
      album = "Random Access Memories",
      albumArtist = null,
      year = null,
      trackNumber = null,
      genre = null,
      lyrics = lyrics,
    )
    DownloadTagWriter().write(file, tags, Fixtures.cover())
    return file
  }

  /** What the fill-in must leave as it was: the replacement's tags, the audio, and every fragment the index finds. */
  private fun assertKeepsTheReplacementCopy(file: File, write: () -> Unit) {
    val before = reader.read(file)
    val audioBefore = AudioPayload.of(file)
    val fragmentsBefore = Mp4Boxes.of(file).count { it.type == "moof" }

    write()

    val after = reader.read(file)
    assertEquals(
      listOf(before.title, before.artist, before.album),
      listOf(after.title, after.artist, after.album),
    )
    assertArrayEquals("cover", Fixtures.cover(), after.artwork)
    assertArrayEquals("audio", audioBefore, AudioPayload.of(file))
    val boxes = Mp4Boxes.of(file)
    assertEquals(fragmentsBefore, boxes.count { it.type == "moof" })
    assertEquals(boxes.filter { it.type == "moof" }.map { it.offset }.toSet(), Mp4Boxes.fragmentIndex(file).toSet())
  }

  @Test
  fun fillsInTheLyricsAndGenreOfAReplacementsFragmentedM4a() {
    val file = replacementCopy(lyrics = null)
    assertKeepsTheReplacementCopy(file) {
      val report = writer.write(file, lyrics = NEW_LYRICS, genre = "Dance")
      assertEquals(TagWriteReport(LyricsDestination.TAGS, TagDestination.TAGS), report)
    }
    val tags = reader.read(file)
    assertEquals(NEW_LYRICS, tags.lyrics)
    assertEquals(listOf("Dance"), tags.genres)
    assertFalse("sidecar", File(file.parentFile, "Get Lucky.lrc").exists())
  }

  @Test
  fun aReplacementsFragmentedM4aKeepsItsLyricsWhenTheRestIsFilledIn() {
    val file = replacementCopy(lyrics = FIXTURE_LYRICS)
    assertKeepsTheReplacementCopy(file) {
      writer.write(file, lyrics = null, genre = "Dance", place = PLACE, advisory = 1)
    }
    val tags = reader.read(file)
    assertEquals(FIXTURE_LYRICS, tags.lyrics)
    assertEquals(listOf("Dance", "6", "1997", "1"), listOf(tags.genre, tags.trackNumber, tags.year, tags.advisory))
  }

  @Test
  fun reportsWhereTheAdvisoryWentToJs() {
    val report = TagWriteReport(LyricsDestination.NONE, TagDestination.NONE, explicit = TagDestination.TAGS)
    assertEquals("tags", report.toMap()["explicit"])
  }

  private companion object {
    val PLACE = AlbumPlace(trackNumber = 6, discNumber = 2, year = 1997)
    val PLACE_KEYS = listOf(FieldKey.TRACK_TOTAL, FieldKey.TRACK, FieldKey.DISC_TOTAL, FieldKey.DISC_NO, FieldKey.YEAR)
    const val NEW_LYRICS = "[00:00.40]Nova letra\n[00:01.10]Second new line"
    const val FIXTURE_LYRICS = "[00:00.50]Olá, onda\n[00:01.00]Second line"
  }
}
