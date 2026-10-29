package expo.modules.wavenative.recognize

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShazamInstallIdTest {
  private val file = File(Fixtures.tempDir(), "recognize/shazam-install-id")

  @Test
  fun `an install keeps the id it first made`() {
    val first = ShazamInstallId(file).get()

    assertTrue(first, Regex("[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}").matches(first))
    assertEquals(first, ShazamInstallId(file).get())
  }

  @Test
  fun `another install makes its own`() {
    val other = File(Fixtures.tempDir(), "shazam-install-id")

    assertNotEquals(ShazamInstallId(file).get(), ShazamInstallId(other).get())
  }

  @Test
  fun `an id that can't be saved is still sent, the same one for the rest of the run`() {
    val blocked = File(Fixtures.tempDir(), "recognize").apply { writeText("a file where the folder goes") }
    val ids = ShazamInstallId(File(blocked, "shazam-install-id"))

    val first = ids.get()
    assertTrue(first, Regex("[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}").matches(first))
    assertEquals(first, ids.get())
  }

  @Test
  fun `an unreadable id is replaced`() {
    file.parentFile.mkdirs()
    file.writeText("not an id\n")

    val id = ShazamInstallId(file).get()
    assertNotEquals("not an id", id)
    assertEquals(id, ShazamInstallId(file).get())
  }
}
