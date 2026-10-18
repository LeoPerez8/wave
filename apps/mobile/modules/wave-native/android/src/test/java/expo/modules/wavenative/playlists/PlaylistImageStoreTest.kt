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
  fun anOriginalPhotoIsKeptUnderANewNameDeletingTakes() {
    val dir = File(Fixtures.tempDir(), "playlists")
    val store = PlaylistImageStore(dir)
    val image = store.save(large, thumb)
    val original = store.saveOriginal(large)
    assertArrayEquals(large, File(original).readBytes())
    assertEquals(dir, File(original).parentFile)
    assertNotEquals(image.path, original)
    assertTrue(store.owns(original))
    assertTrue(store.owns(image.thumbPath))
    store.delete(listOf(original))
    assertFalse(File(original).exists())
    assertTrue(File(image.path).isFile)
  }

  @Test
  fun onlyItsOwnImagesAreCroppedFrom() {
    val root = Fixtures.tempDir()
    val store = PlaylistImageStore(File(root, "playlists"))
    val original = store.saveOriginal(large)
    assertTrue(store.owns(original))
    assertFalse(store.owns(File(root, "0123456789abcdef0123456789abcdef01234567.jpg").path))
    assertFalse(store.owns("${File(root, "playlists")}/notes.txt"))
    assertFalse(store.owns("${File(root, "playlists")}/../${File(original).name}"))
  }

  @Test
  fun theOriginalKeepsItsShapeWithItsShortSideAtMostTheOriginalSize() {
    assertEquals(4000 to 3000, PlaylistImageStore.originalSize(4000, 3000, 3000))
    assertEquals(3200 to 2400, PlaylistImageStore.originalSize(4000, 3000, 2400))
    assertEquals(2400 to 4266, PlaylistImageStore.originalSize(3000, 5333, 2400))
    assertEquals(200 to 100, PlaylistImageStore.originalSize(200, 100, 2400))
  }

  @Test
  fun theChosenSquareIsKeptInsideThePicture() {
    assertEquals(Square(left = 100, top = 0, side = 600), PlaylistImageStore.fitSquare(800, 600, Square(100, 0, 600)))
    assertEquals(Square(left = 200, top = 0, side = 600), PlaylistImageStore.fitSquare(800, 600, Square(250, -5, 601)))
    assertEquals(Square(left = 0, top = 0, side = 1), PlaylistImageStore.fitSquare(800, 600, Square(-3, -3, 0)))
  }
}
