package expo.modules.wavenative.lyrics

import expo.modules.wavenative.Fixtures
import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.JAudioTaggerReader
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/** A track's lyrics as the Lyrics view asks for them: from its tags and from a sidecar `.lrc`. */
class LyricsReaderTest {
  private val reader = LyricsReader(AudioTagReader(primary = JAudioTaggerReader()))

  @Test
  fun findsTheLrcFileBesideTheTrack() {
    val folder = Fixtures.libraryOf("tagged.mp3" to "Album/01 Song.mp3")
    File(folder, "Album/01 Song.lrc").writeText("[00:01.00]From the sidecar")

    assertEquals(
      LyricsSources(embedded = null, sidecar = "[00:01.00]From the sidecar"),
      reader.read(File(folder, "Album/01 Song.mp3")),
    )
  }

  @Test
  fun readsTheEmbeddedLyricsAndTheSidecarTogether() {
    val folder = Fixtures.libraryOf("lyrics.flac" to "Song.flac")
    File(folder, "Song.lrc").writeText("[00:02.00]Sidecar")

    assertEquals(
      LyricsSources(embedded = "[00:00.50]Olá, onda\n[00:01.00]Second line", sidecar = "[00:02.00]Sidecar"),
      reader.read(File(folder, "Song.flac")),
    )
  }

  @Test
  fun theSidecarsNameMayDifferInCaseOrKeepTheAudioExtension() {
    val folder = Fixtures.libraryOf("tagged.mp3" to "Upper.mp3", "tagged.mp3" to "Doubled.mp3")
    File(folder, "upper.LRC").writeText("Upper")
    File(folder, "Doubled.mp3.lrc").writeText("Doubled")

    assertEquals("Upper", reader.read(File(folder, "Upper.mp3")).sidecar)
    assertEquals("Doubled", reader.read(File(folder, "Doubled.mp3")).sidecar)
  }

  private fun sidecarFromBytes(bytes: ByteArray): String? {
    val folder = Fixtures.libraryOf("tagged.mp3" to "Song.mp3")
    File(folder, "Song.lrc").writeBytes(bytes)
    return reader.read(File(folder, "Song.mp3")).sidecar
  }

  @Test
  fun sidecarsInUtf8WithOrWithoutAByteOrderMark() {
    val text = "[00:01.00]Olá, onda"
    assertEquals(text, sidecarFromBytes(text.toByteArray(Charsets.UTF_8)))
    assertEquals(text, sidecarFromBytes(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + text.toByteArray()))
  }

  @Test
  fun sidecarsInUtf16() {
    val text = "[00:01.00]Olá, onda"
    // Java's UTF-16 encoder writes a big-endian byte order mark.
    assertEquals(text, sidecarFromBytes(text.toByteArray(Charsets.UTF_16)))
    val littleEndian = byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + text.toByteArray(Charsets.UTF_16LE)
    assertEquals(text, sidecarFromBytes(littleEndian))
  }

  @Test
  fun olderSidecarsInWindowsLatin1() {
    val text = "[00:01.00]Olá, café"
    assertEquals(text, sidecarFromBytes(text.toByteArray(charset("windows-1252"))))
  }

  @Test
  fun aHugeFileNamedLikeASidecarIsNotRead() {
    assertEquals(null, sidecarFromBytes(ByteArray(2 * 1024 * 1024) { 'a'.code.toByte() }))
  }

  @Test
  fun noSidecarWhenOnlyOtherTracksHaveOne() {
    val folder = Fixtures.libraryOf("tagged.mp3" to "Song.mp3")
    File(folder, "Song 2.lrc").writeText("Another song")
    File(folder, "Song.txt").writeText("Not lyrics")

    assertEquals(LyricsSources(embedded = null, sidecar = null), reader.read(File(folder, "Song.mp3")))
  }
}
