package expo.modules.wavenative.artwork

import expo.modules.wavenative.Fixtures
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ArtworkStoreTest {
  private val palette = ArtworkPalette(dominant = 0xFF14B8A6.toInt(), darkMuted = 0xFF0D6B62.toInt())

  /** Writes a fake thumbnail and returns a fixed palette, counting calls. */
  private class FakeProcessor(private val palette: ArtworkPalette?) : ArtworkProcessor {
    val calls = AtomicInteger()

    override fun process(image: ByteArray, thumbFile: File): ArtworkPalette? {
      calls.incrementAndGet()
      if (palette != null) thumbFile.writeBytes(byteArrayOf(1, 2, 3))
      return palette
    }
  }

  @Test
  fun storesTheImageThumbnailAndPaletteOnce() {
    val dir = Fixtures.tempDir()
    val processor = FakeProcessor(palette)
    val store = ArtworkStore(dir, processor)
    val cover = Fixtures.cover()

    val first = store.store(cover)
    val second = store.store(cover.copyOf())
    assertNotNull(first)
    assertEquals(first, second)
    assertEquals(1, processor.calls.get())
    assertEquals(ArtworkStore.hash(cover), first!!.hash)
    assertTrue(first.path.endsWith("${first.hash}.png"))
    assertArrayEquals(cover, File(first.path).readBytes())
    assertTrue(File(first.thumbPath).isFile)
    assertEquals(palette, first.palette)
  }

  @Test
  fun reusesArtworkAlreadyOnDiskFromAnEarlierScan() {
    val dir = Fixtures.tempDir()
    val cover = Fixtures.cover()
    ArtworkStore(dir, FakeProcessor(palette)).store(cover)

    val laterProcessor = FakeProcessor(palette)
    val again = ArtworkStore(dir, laterProcessor).store(cover)
    assertEquals(0, laterProcessor.calls.get())
    assertEquals(palette, again!!.palette)
  }

  @Test
  fun differentImagesGetDifferentEntries() {
    val store = ArtworkStore(Fixtures.tempDir(), FakeProcessor(palette))
    val a = store.store(Fixtures.cover())!!
    val b = store.store(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 1, 2, 3))!!
    assertTrue(a.hash != b.hash)
    assertTrue(b.path.endsWith(".jpg"))
  }

  @Test
  fun undecodableImagesAreNotStored() {
    val dir = Fixtures.tempDir()
    assertNull(ArtworkStore(dir, FakeProcessor(null)).store(byteArrayOf(1, 2, 3)))
    assertEquals(0, dir.listFiles()!!.count { it.name.endsWith(".img") })
    assertNull(ArtworkStore(dir, FakeProcessor(palette)).store(ByteArray(0)))
  }

  @Test
  fun paletteSurvivesSerialization() {
    val full = ArtworkPalette(
      dominant = 0xFF000000.toInt(),
      vibrant = 0xFFFFFFFF.toInt(),
      darkVibrant = 0x80123456.toInt(),
      lightVibrant = 1,
      muted = null,
      darkMuted = 0,
      lightMuted = -2,
    )
    assertEquals(full, ArtworkPalette.parse(full.serialize()))
    assertEquals(ArtworkPalette(), ArtworkPalette.parse(""))
  }
}
