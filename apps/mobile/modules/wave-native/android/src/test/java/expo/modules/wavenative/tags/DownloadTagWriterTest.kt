package expo.modules.wavenative.tags

import expo.modules.wavenative.Fixtures
import java.io.File
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
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

  /**
   * YouTube serves fragmented MP4 (#237): an empty sample table, the audio in
   * moof/mdat fragments and an index of them at the end. jaudiotagger can't
   * grow its moov ("incorrect offsets written"), which failed every YouTube
   * download at Saving to the Library.
   */
  private fun youtubeDownload(): File =
    Fixtures.libraryOf("fragmented-aac.m4a" to ".wave-237.part.m4a").resolve(".wave-237.part.m4a")

  @Test
  fun tagsTheFragmentedM4aYoutubeServesAndKeepsItsFragmentsPlayable() {
    val file = youtubeDownload()
    val audioBefore = AudioPayload.of(file)
    val fragmentsBefore = Mp4Boxes.of(file).count { it.type == "moof" }

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
    assertArrayEquals(audioBefore, AudioPayload.of(file))
    val boxes = Mp4Boxes.of(file)
    assertEquals(fragmentsBefore, boxes.count { it.type == "moof" })
    // The fragment index still points at fragments once the moov has grown.
    val moofs = boxes.filter { it.type == "moof" }.map { it.offset }.toSet()
    val indexed = Mp4Boxes.fragmentIndex(file)
    assertEquals(fragmentsBefore, indexed.size)
    assertEquals(moofs, indexed.toSet())
  }

  @Test
  fun writesTheAdvisoryAScanReadsBack() {
    val explicit = DownloadTags.fromJs(mapOf("title" to "Get Lucky", "artist" to "Daft Punk", "advisory" to 1))!!
    val clean = explicit.copy(advisory = 0)
    val mp3 = Fixtures.libraryOf("soulseek-320.mp3" to "a.mp3").resolve("a.mp3")
    val m4a = download()
    val youtube = youtubeDownload()

    DownloadTagWriter().write(mp3, explicit, null)
    DownloadTagWriter().write(m4a, clean, null)
    DownloadTagWriter().write(youtube, explicit, null)

    assertEquals("1", reader.read(mp3).advisory)
    assertEquals("0", reader.read(m4a).advisory)
    assertEquals("1", reader.read(youtube).advisory)
  }

  @Test
  fun writesNoAdvisoryWhenNoneIsGiven() {
    val file = Fixtures.libraryOf("soulseek-320.mp3" to "a.mp3").resolve("a.mp3")
    DownloadTagWriter().write(file, DownloadTags.fromJs(mapOf("title" to "Halo", "artist" to "Beyoncé"))!!, null)
    assertNull(reader.read(file).advisory)
  }

  /** A copy of [fixture] standing in for the Library file a quality replacement replaces, with tags the Library doesn't keep. */
  private fun replacedFile(fixture: String, name: String): File {
    val file = Fixtures.libraryOf(fixture to name).resolve(name)
    val audio = AudioFileIO.read(file)
    val tag = audio.tagOrCreateAndSetDefault
    tag.setField(FieldKey.COMPOSER, "Nile Rodgers")
    tag.setField(FieldKey.COMMENT, "Owner's note")
    tag.setField(FieldKey.BPM, "116")
    tag.setField(FieldKey.GENRE, "Disco")
    tag.addField(FieldKey.GENRE, "Funk")
    AudioFileIO.write(audio)
    return file
  }

  private fun assertKeepsTheReplacedFilesOtherTags(replaced: File, file: File) {
    val audioBefore = AudioPayload.of(file)
    val fields = DownloadTags.fromJs(mapOf(
      "title" to "Get Lucky", "artist" to "Daft Punk", "genre" to "Disco", "keepTagsOf" to replaced.path,
    ))!!

    DownloadTagWriter().write(file, fields, null)

    val tag = AudioFileIO.read(file).tag
    assertEquals("${file.name} composer", "Nile Rodgers", tag.getFirst(FieldKey.COMPOSER))
    assertEquals("${file.name} comment", "Owner's note", tag.getFirst(FieldKey.COMMENT))
    assertEquals("${file.name} BPM", "116", tag.getFirst(FieldKey.BPM))
    val read = reader.read(file)
    assertEquals("${file.name} title", "Get Lucky", read.title)
    assertEquals("${file.name} genres", listOf("Disco", "Funk"), read.genres)
    assertArrayEquals("${file.name} audio", audioBefore, AudioPayload.of(file))
  }

  @Test
  fun anUpgradesMp3KeepsTheReplacedM4asOtherTags() = assertKeepsTheReplacedFilesOtherTags(
    replacedFile("tagged-aac.m4a", "Get Lucky.m4a"),
    Fixtures.libraryOf("soulseek-320.mp3" to ".upgrade.part.mp3").resolve(".upgrade.part.mp3"),
  )

  @Test
  fun aDowngradesFragmentedM4aKeepsTheReplacedMp3sOtherTags() = assertKeepsTheReplacedFilesOtherTags(
    replacedFile("tagged.mp3", "Get Lucky.mp3"),
    youtubeDownload(),
  )

  @Test
  fun aReplacedFileGoneMeanwhileLeavesJustTheGivenTags() {
    val file = youtubeDownload()
    val fields = DownloadTags.fromJs(
      mapOf("title" to "Get Lucky", "artist" to "Daft Punk", "keepTagsOf" to "/nowhere/gone.mp3"),
    )!!
    DownloadTagWriter().write(file, fields, null)
    assertEquals("Get Lucky", reader.read(file).title)
  }

  @Test
  fun retagsAFragmentedM4aItAlreadyTagged() {
    val file = youtubeDownload()
    val audioBefore = AudioPayload.of(file)
    DownloadTagWriter().write(file, tags, Fixtures.cover())

    DownloadTagWriter().write(file, tags.copy(title = "Get Lucky", lyrics = null), artwork = null)

    val read = reader.read(file)
    assertEquals("Get Lucky", read.title)
    assertEquals("Random Access Memories", read.album)
    assertNull(read.lyrics)
    assertNull(read.artwork)
    assertArrayEquals(audioBefore, AudioPayload.of(file))
    assertEquals(Mp4Boxes.of(file).filter { it.type == "moof" }.map { it.offset }.toSet(), Mp4Boxes.fragmentIndex(file).toSet())
  }
}

/** Top-level MP4 boxes and the `mfra` fragment index, parsed independently of the writer. */
private object Mp4Boxes {
  data class Box(val type: String, val offset: Long, val size: Long)

  fun of(file: File): List<Box> {
    val bytes = file.readBytes()
    val boxes = mutableListOf<Box>()
    var position = 0
    while (position + 8 <= bytes.size) {
      val size = java.nio.ByteBuffer.wrap(bytes, position, 4).int.toLong() and 0xffffffffL
      val type = String(bytes, position + 4, 4, Charsets.ISO_8859_1)
      boxes += Box(type, position.toLong(), size)
      check(size >= 8) { "Box $type at $position has size $size" }
      position += size.toInt()
    }
    check(position == bytes.size) { "Boxes end at $position, the file at ${bytes.size}" }
    return boxes
  }

  /** The moof offsets every `tfra` in the file's `mfra` lists. */
  fun fragmentIndex(file: File): List<Long> {
    val bytes = file.readBytes()
    val mfra = of(file).single { it.type == "mfra" }
    val buffer = java.nio.ByteBuffer.wrap(bytes)
    val offsets = mutableListOf<Long>()
    var position = mfra.offset.toInt() + 8
    while (position < mfra.offset + mfra.size) {
      val size = buffer.getInt(position)
      val type = String(bytes, position + 4, 4, Charsets.ISO_8859_1)
      if (type == "tfra") {
        buffer.position(position + 8)
        val version = buffer.get().toInt()
        buffer.position(buffer.position() + 3 + 4)
        val lengths = buffer.int
        val entries = buffer.int
        repeat(entries) {
          val wide = version == 1
          if (wide) buffer.long else buffer.int
          offsets += if (wide) buffer.long else buffer.int.toLong() and 0xffffffffL
          buffer.position(buffer.position() + ((lengths shr 4) and 3) + 1 + ((lengths shr 2) and 3) + 1 + (lengths and 3) + 1)
        }
      }
      position += size
    }
    return offsets
  }
}
