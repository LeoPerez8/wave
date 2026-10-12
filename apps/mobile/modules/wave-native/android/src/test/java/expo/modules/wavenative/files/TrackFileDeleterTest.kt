package expo.modules.wavenative.files

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Deleting a song's audio file from the phone, with its sidecar `.lrc`. */
class TrackFileDeleterTest {
  private val deleter = TrackFileDeleter()

  @Test
  fun deletesTheAudioFileAndItsSidecar() {
    val folder = Fixtures.libraryOf("tagged.mp3" to "Album/01 Song.mp3", "tagged.mp3" to "Album/02 Other.mp3")
    File(folder, "Album/01 Song.lrc").writeText("[00:01.00]Lyrics")
    File(folder, "Album/02 Other.lrc").writeText("[00:01.00]Other lyrics")

    assertEquals(DeleteOutcome.DELETED, deleter.delete(File(folder, "Album/01 Song.mp3")))

    assertFalse(File(folder, "Album/01 Song.mp3").exists())
    assertFalse(File(folder, "Album/01 Song.lrc").exists())
    // The other song in the folder keeps its file and its lyrics.
    assertTrue(File(folder, "Album/02 Other.mp3").exists())
    assertTrue(File(folder, "Album/02 Other.lrc").exists())
  }

  @Test
  fun aSidecarNamedAfterTheWholeFileNameInAnyCaseGoesToo() {
    val folder = Fixtures.libraryOf("tagged.mp3" to "Song.mp3")
    File(folder, "SONG.MP3.LRC").writeText("Lyrics")

    assertEquals(DeleteOutcome.DELETED, deleter.delete(File(folder, "Song.mp3")))

    assertFalse(File(folder, "SONG.MP3.LRC").exists())
  }

  @Test
  fun aFileThatIsAlreadyGoneIsReportedMissing() {
    val folder = Fixtures.tempDir()

    assertEquals(DeleteOutcome.MISSING, deleter.delete(File(folder, "Gone.mp3")))
  }

  @Test
  fun aFileOnReadOnlyStorageStays() {
    val folder = Fixtures.libraryOf("tagged.mp3" to "Song.mp3")
    File(folder, "Song.lrc").writeText("Lyrics")

    val outcome = TrackFileDeleter(isReadOnly = { true }).delete(File(folder, "Song.mp3"))

    assertEquals(DeleteOutcome.READ_ONLY, outcome)
    assertTrue(File(folder, "Song.mp3").exists())
    assertTrue(File(folder, "Song.lrc").exists())
  }

  @Test
  fun aFileInAFolderWaveMayNotWriteStaysAndItsSidecarToo() {
    val folder = Fixtures.libraryOf("tagged.mp3" to "Locked/Song.mp3")
    val locked = File(folder, "Locked")
    File(locked, "Song.lrc").writeText("Lyrics")
    locked.setWritable(false)
    try {
      assertEquals(DeleteOutcome.DENIED, deleter.delete(File(locked, "Song.mp3")))
      assertTrue(File(locked, "Song.mp3").exists())
      assertTrue(File(locked, "Song.lrc").exists())
    } finally {
      locked.setWritable(true)
    }
  }
}
