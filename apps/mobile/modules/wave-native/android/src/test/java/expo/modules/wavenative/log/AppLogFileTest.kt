package expo.modules.wavenative.log

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Test

/** The app log's file: appends, trimming its oldest bytes, and the exported copy. */
class AppLogFileTest {
  private val folder: File = Files.createTempDirectory("wave-log").toFile()
  private val log = AppLogFile(File(File(folder, "logs"), "wave.log"))

  @Test
  fun appendsAndReportsTheSizeInBytes() {
    assertEquals("", log.read())
    log.append("2026-10-16T14:03:22.415Z W console: Beyoncé\n")
    val size = log.append("2026-10-16T14:03:23.000Z E uncaught: boom\n")

    assertEquals("2026-10-16T14:03:22.415Z W console: Beyoncé\n2026-10-16T14:03:23.000Z E uncaught: boom\n", log.read())
    assertEquals(log.read().toByteArray(Charsets.UTF_8).size.toLong(), size)
  }

  @Test
  fun droppingTheHeadKeepsWhatCameAfter() {
    val first = "2026-10-16T14:03:22.415Z W console: Beyoncé\n"
    log.append(first)
    log.append("2026-10-16T14:03:23.000Z E uncaught: boom\n")

    log.dropHead(first.toByteArray(Charsets.UTF_8).size.toLong())

    assertEquals("2026-10-16T14:03:23.000Z E uncaught: boom\n", log.read())
  }

  @Test
  fun droppingMoreThanTheLogEmptiesIt() {
    log.append("a line\n")
    log.dropHead(1_000)
    assertEquals("", log.read())
  }

  @Test
  fun theExportStartsWithTheHeader() {
    log.append("2026-10-16T14:03:22.415Z W console: hello\n")
    val export = File(folder, "export/wave-log.txt")

    log.exportTo(export, "Wave 0.5.3 (build 503)\n\n")

    assertEquals("Wave 0.5.3 (build 503)\n\n2026-10-16T14:03:22.415Z W console: hello\n", export.readText())
  }
}
