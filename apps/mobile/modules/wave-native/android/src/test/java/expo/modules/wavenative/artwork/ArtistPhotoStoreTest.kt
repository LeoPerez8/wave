package expo.modules.wavenative.artwork

import expo.modules.wavenative.Fixtures
import java.io.File
import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ArtistPhotoStoreTest {
  private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 1, 2, 3)

  /** Answers each URL with its bytes; unknown URLs fail like a dropped connection. */
  private fun web(vararg pages: Pair<String, ByteArray>): (String) -> ByteArray {
    val map = pages.toMap()
    return { url -> map[url] ?: throw IOException("no route to $url") }
  }

  @Test
  fun savesBothSizesUnderTheArtworkDirectory() {
    val dir = Fixtures.tempDir()
    val cover = Fixtures.cover()
    val store = ArtistPhotoStore(dir, web("thumb" to jpeg, "large" to cover))

    val photo = store.save("radiohead", thumbUrl = "thumb", largeUrl = "large")

    assertEquals(dir.path, File(photo.thumbPath).parentFile!!.path)
    assertArrayEquals(jpeg, File(photo.thumbPath).readBytes())
    assertArrayEquals(cover, File(photo.path).readBytes())
    assertTrue(photo.thumbPath.endsWith("_thumb.jpg"))
    assertTrue(photo.path.endsWith(".png"))
  }

  @Test
  fun eachArtistGetsItsOwnFilesWhateverTheirName() {
    val store = ArtistPhotoStore(Fixtures.tempDir(), web("t" to jpeg, "l" to jpeg))
    val acdc = store.save("ac/dc", "t", "l")
    val other = store.save("ac dc", "t", "l")
    assertNotEquals(acdc.path, other.path)
    assertFalse(File(acdc.path).name.contains("/"))
  }

  @Test
  fun aFailedDownloadOrSomethingThatIsNotAnImageSavesNothing() {
    val dir = Fixtures.tempDir()
    val store = ArtistPhotoStore(dir, web("thumb" to jpeg, "html" to "<html>".toByteArray()))
    for (large in listOf("missing", "html")) {
      try {
        store.save("radiohead", "thumb", large)
        fail("expected $large to fail")
      } catch (expected: IOException) {
        // The lookup is recorded as failed and retried later.
      }
    }
    assertEquals(0, dir.listFiles().orEmpty().count { !it.name.startsWith(".") })
  }

  @Test
  fun clearDeletesEveryPhoto() {
    val dir = File(Fixtures.tempDir(), "artists")
    val store = ArtistPhotoStore(dir, web("t" to jpeg, "l" to jpeg))
    val photo = store.save("radiohead", "t", "l")
    store.clear()
    assertFalse(File(photo.path).exists())
    assertFalse(File(photo.thumbPath).exists())
    assertFalse(dir.exists())
  }
}
