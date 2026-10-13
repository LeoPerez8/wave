package expo.modules.wavenative.tags

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Tags a downloaded M4A (a copy of the AAC fixture, standing in for what
 * YouTube serves) with everything a YT Music download gets, and reads it back
 * the way a scan does.
 */
class DownloadTagWriterTest {
  private val reader = AudioTagReader(primary = JAudioTaggerReader())

  private fun download(): File = Fixtures.libraryOf("tagged-aac.m4a" to ".08 Get Lucky.part.m4a")
    .resolve(".08 Get Lucky.part.m4a")

  private val tags = DownloadTags(
    title = "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
    artist = "Daft Punk, Pharrell Williams & Nile Rodgers",
    album = "Random Access Memories",
    albumArtist = "Daft Punk",
    year = 2013,
    trackNumber = 8,
    genre = "Dance",
    lyrics = "[00:01.00]Like the legend of the phoenix",
  )

  @Test
  fun writesMp3DiscTagsAndArtworkWithoutChangingMpegFrames() {
    val file = Fixtures.libraryOf("soulseek-320.mp3" to ".download.part.mp3").resolve(".download.part.mp3")
    val audioBefore = AudioPayload.of(file)
    val fields = DownloadTags.fromJs(mapOf(
      "title" to "Get Lucky", "artist" to "Daft Punk", "album" to "Random Access Memories",
      "albumArtist" to "Daft Punk", "year" to 2013, "trackNumber" to 8, "discNumber" to 2,
      "genre" to "Dance", "lyrics" to "[00:01.00]Like the legend",
    ))!!
    DownloadTagWriter().write(file, fields, Fixtures.cover())
    val read = reader.read(file)
    assertEquals("Get Lucky", read.title)
    assertEquals("Daft Punk", read.artist)
    assertEquals("Random Access Memories", read.album)
    assertEquals("Daft Punk", read.albumArtist)
    assertEquals("2013", read.year)
    assertEquals("8", read.trackNumber)
    assertEquals("2", read.discNumber)
    assertEquals("Dance", read.genre)
    assertEquals("[00:01.00]Like the legend", read.lyrics)
    assertArrayEquals(Fixtures.cover(), read.artwork)
    assertArrayEquals(audioBefore, AudioPayload.of(file))
  }

  @Test
  fun writesEveryFieldAndTheCoverAndKeepsTheAudio() {
    val file = download()
    val audioBefore = AudioPayload.of(file)

    DownloadTagWriter().write(file, tags, Fixtures.cover())

    val read = reader.read(file)
    assertEquals(tags.title, read.title)
    assertEquals(tags.artist, read.artist)
    assertEquals("Random Access Memories", read.album)
    assertEquals("Daft Punk", read.albumArtist)
    assertEquals("2013", read.year)
    assertEquals("8", read.trackNumber)
    assertEquals("Dance", read.genre)
    assertEquals(tags.lyrics, read.lyrics)
    assertArrayEquals(Fixtures.cover(), read.artwork)
    assertArrayEquals(AudioPayload.of(file), audioBefore)
  }

  @Test
  fun replacesWhatTheFileHadAndLeavesOutWhatIsUnknown() {
    val file = download()
    val before = reader.read(file)
    check(before.discNumber != null && before.artwork != null) { "the fixture has a disc number and a cover" }

    DownloadTagWriter().write(
      file,
      tags.copy(album = null, year = null, trackNumber = null, genre = null, lyrics = null),
      artwork = null,
    )

    val read = reader.read(file)
    assertEquals(tags.title, read.title)
    assertNull(read.album)
    assertNull(read.year)
    assertNull(read.trackNumber)
    assertNull(read.discNumber)
    assertNull(read.genre)
    assertNull(read.lyrics)
    assertNull(read.artwork)
  }
}
