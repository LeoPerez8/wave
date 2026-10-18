package expo.modules.wavenative.files

import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Test

/** How long files play, read from their audio to its end: what the duplicate check trusts. */
class AudioLengthsTest {
  private val folder = Files.createTempDirectory("lengths").toFile()

  private fun file(name: String) = File(folder, name).apply { writeText("audio") }

  @Test
  fun eachFileItsLengthInOrderAndNullForOneThatIsMissingOrUnreadable() {
    val whole = file("505.mp3")
    val cut = file("505.m4a")
    val lengths = AudioLengths { audio ->
      if (audio == cut) throw IOException("No audio samples") else 253_000L
    }

    assertEquals(
      listOf(253_000L, null, null),
      lengths.read(listOf(whole.path, cut.path, File(folder, "gone.mp3").path)),
    )
  }

  @Test
  fun anyFailureReadingAFileIsNoLength() {
    val lengths = AudioLengths { throw IllegalStateException("Extractor failed") }
    assertEquals(listOf<Long?>(null), lengths.read(listOf(file("a.mp3").path)))
  }
}
