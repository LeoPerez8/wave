package expo.modules.wavenative.soulseek

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class Mp3ValidationTest {
  @Test fun `a mislabeled low bitrate file cannot become MP3 320`() {
    val low = File(javaClass.getResource("/fixtures/untagged.mp3")!!.toURI())
    val failure = assertThrows(SoulseekException::class.java) { Mp3Validation.validate(low, low.length(), 1500) }
    assertEquals(SoulseekFailure.INVALID_AUDIO, failure.failure)
  }

  @Test fun `a truncated last frame fails even when the peer claimed its shorter size was complete`() {
    val source = File(javaClass.getResource("/fixtures/soulseek-320.mp3")!!.toURI()).readBytes()
    val received = kotlin.io.path.createTempFile().toFile()
    try {
      received.writeBytes(source.copyOf(source.size - 10))
      val failure = assertThrows(SoulseekException::class.java) { Mp3Validation.validate(received, received.length(), 1500) }
      assertEquals(SoulseekFailure.INVALID_AUDIO, failure.failure)
    } finally { received.delete() }
  }

  @Test fun `a complete 320 file with the wrong recording duration fails`() {
    val file = File(javaClass.getResource("/fixtures/soulseek-320.mp3")!!.toURI())
    val failure = assertThrows(SoulseekException::class.java) { Mp3Validation.validate(file, file.length(), 120000) }
    assertEquals(SoulseekFailure.INVALID_AUDIO, failure.failure)
  }

  @Test fun `a received original 320 kbps MP3 keeps its audio frames and measured duration`() {
    val file = File(javaClass.getResource("/fixtures/soulseek-320.mp3")!!.toURI())
    val audio = Mp3Validation.validate(file, file.length(), 1500)
    assertEquals("audio/mpeg", audio.mimeType)
    assertEquals(320_000, audio.bitrate)
    assertEquals(1541L, audio.durationMs)
  }
}
