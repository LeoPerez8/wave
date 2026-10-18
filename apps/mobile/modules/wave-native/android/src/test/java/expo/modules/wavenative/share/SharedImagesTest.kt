package expo.modules.wavenative.share

import java.io.File
import java.nio.file.Files
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** The images Wave hands to the gallery and to other apps: written from JS's base64 PNG. */
class SharedImagesTest {
  private val folder: File = Files.createTempDirectory("wave-share").toFile()
  private val now = 1_800_000_000_000L
  private val images = SharedImages(File(folder, "shared-images")) { now }
  private val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 1, 2, 3)
  private val base64 = Base64.getEncoder().encodeToString(png)

  @Test
  fun writesTheDecodedImageUnderItsName() {
    val image = images.write(base64, "Wave - Song - 20261018-140509.png")

    assertEquals("Wave - Song - 20261018-140509.png", image.name)
    assertEquals(File(folder, "shared-images"), image.parentFile)
    assertArrayEquals(png, image.readBytes())
  }

  @Test
  fun aNameCantLeaveTheFolder() {
    val image = images.write(base64, "../../elsewhere/card.png")

    assertEquals(File(folder, "shared-images/card.png"), image)
  }

  @Test
  fun anImageFromOverTenMinutesAgoIsDeletedWhenTheNextIsWritten() {
    val old = images.write(base64, "old.png")
    old.setLastModified(now - 11 * 60_000)
    val recent = images.write(base64, "recent.png")
    recent.setLastModified(now - 9 * 60_000)

    images.write(base64, "new.png")

    // The recent one may still be on its way to the app it was shared with.
    assertEquals(setOf("recent.png", "new.png"), File(folder, "shared-images").list()!!.toSet())
  }

  @Test
  fun writingTheSameNameAgainReplacesTheImage() {
    images.write(Base64.getEncoder().encodeToString(byteArrayOf(9, 9)), "card.png")
    val image = images.write(base64, "card.png")

    assertArrayEquals(png, image.readBytes())
  }
}
