package expo.modules.wavenative.playlists

import expo.modules.wavenative.Fixtures
import expo.modules.wavenative.artwork.ArtworkUris
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaylistImageStoreTest {
  private val large = byteArrayOf(1, 2, 3)
  private val thumb = byteArrayOf(4, 5)

  @Test
  fun anImageIsSavedInBothSizesUnderNamesAndroidAutoReads() {
    val dir = File(Fixtures.tempDir(), "playlists")
    val files = PlaylistImageStore(dir).save(large, thumb)
    assertArrayEquals(large, File(files.path).readBytes())
    assertArrayEquals(thumb, File(files.thumbPath).readBytes())
    assertEquals(dir, File(files.path).parentFile)
    val hash = ArtworkUris.hashOf(files.thumbPath)
    assertEquals(hash, ArtworkUris.hashOf(files.path))
    assertEquals(File(files.path), ArtworkUris.coverFile(dir.parentFile!!, hash!!))
  }

  @Test
  fun everyPickIsSavedUnderNewNames() {
    val store = PlaylistImageStore(Fixtures.tempDir())
    val first = store.save(large, thumb)
    val second = store.save(large, thumb)
    assertNotEquals(first.path, second.path)
    assertTrue(File(first.path).isFile)
  }

  @Test
  fun deletingTakesOnlyItsOwnImages() {
    val root = Fixtures.tempDir()
    val dir = File(root, "playlists")
    val store = PlaylistImageStore(dir)
    val kept = store.save(large, thumb)
    val gone = store.save(large, thumb)
    val cover = File(root, "0123456789abcdef0123456789abcdef01234567.jpg").apply { writeBytes(large) }
    val stray = File(dir, "notes.txt").apply { writeText("x") }
    store.delete(listOf(gone.path, gone.thumbPath, cover.path, stray.path, "$dir/../${cover.name}", "/missing.jpg"))
    assertFalse(File(gone.path).exists())
    assertFalse(File(gone.thumbPath).exists())
    assertTrue(File(kept.path).isFile)
    assertTrue(cover.isFile)
    assertTrue(stray.isFile)
  }

  @Test
  fun theCropIsThePicturesCentreSquare() {
    assertEquals(Square(left = 100, top = 0, side = 600), PlaylistImageStore.centreSquare(800, 600))
    assertEquals(Square(left = 0, top = 150, side = 300), PlaylistImageStore.centreSquare(300, 601))
    assertEquals(Square(left = 0, top = 0, side = 50), PlaylistImageStore.centreSquare(50, 50))
  }

  @Test
  fun aBigPhotoIsDecodedSmallerButNeverBelowTheLargeSize() {
    assertEquals(1, PlaylistImageStore.sampleSize(1200, 1600, 1200))
    assertEquals(2, PlaylistImageStore.sampleSize(4000, 3000, 1200))
    assertEquals(4, PlaylistImageStore.sampleSize(12000, 9600, 1200))
    assertEquals(1, PlaylistImageStore.sampleSize(200, 200, 1200))
  }
}
