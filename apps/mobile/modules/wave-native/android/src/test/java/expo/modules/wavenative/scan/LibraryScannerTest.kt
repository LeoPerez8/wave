package expo.modules.wavenative.scan

import expo.modules.wavenative.Fixtures
import expo.modules.wavenative.artwork.ArtworkInfo
import expo.modules.wavenative.artwork.ArtworkPalette
import expo.modules.wavenative.artwork.ArtworkProcessor
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.JAudioTaggerReader
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryScannerTest {
  private val fakeProcessor = ArtworkProcessor { _, thumb ->
    thumb.writeBytes(byteArrayOf(0))
    ArtworkPalette(dominant = 0xFF14B8A6.toInt())
  }

  private class Recorder : ScanListener {
    val progress = mutableListOf<ScanProgress>()
    val batches = mutableListOf<Pair<List<ScannedTrack>, List<ArtworkInfo>>>()

    override fun onProgress(progress: ScanProgress) {
      this.progress.add(progress)
    }

    override fun onBatch(tracks: List<ScannedTrack>, artwork: List<ArtworkInfo>) {
      batches.add(tracks to artwork)
    }
  }

  private fun scanner(batchSize: Int) = LibraryScanner(
    tagReader = AudioTagReader(primary = JAudioTaggerReader()),
    artworkStore = ArtworkStore(Fixtures.tempDir(), fakeProcessor),
    batchSize = batchSize,
    threads = 2,
  )

  private val library = Fixtures.libraryOf(
    "tagged.mp3" to "Fixture Album/01.mp3",
    "same-cover.mp3" to "Fixture Album/02.mp3",
    "tagged.flac" to "Lossless/a.flac",
    "tagged.opus" to "Opus/a.opus",
    "compilation.mp3" to "Compilation/a.mp3",
    "untagged.mp3" to "Loose/untagged.mp3",
  )

  @Test
  fun indexesEveryFileInBatchesAndReportsEachArtworkOnce() {
    val recorder = Recorder()
    val summary = scanner(batchSize = 4).scan(listOf(library), emptyList(), recorder)

    assertEquals(6, summary.filesFound)
    assertEquals(6, summary.filesRead)
    assertFalse(summary.cancelled)
    assertEquals(listOf(4, 2), recorder.batches.map { it.first.size })

    val tracks = recorder.batches.flatMap { it.first }
    assertEquals(6, tracks.map { it.path }.toSet().size)
    // Five files carry a cover but only two distinct images exist.
    val artwork = recorder.batches.flatMap { it.second }
    assertEquals(2, artwork.size)
    assertEquals(2, artwork.map { it.hash }.toSet().size)
    assertEquals(5, tracks.count { it.artworkHash != null })
    assertEquals(artwork.map { it.hash }.toSet(), tracks.mapNotNull { it.artworkHash }.toSet())

    val untagged = tracks.single { it.path.endsWith("untagged.mp3") }
    assertNull(untagged.tags.title)
    assertNull(untagged.artworkHash)
    assertTrue(untagged.sizeBytes > 0)
    assertTrue(untagged.modifiedAt > 0)
    // Artwork bytes are not carried in the batch.
    assertTrue(tracks.all { it.tags.artwork == null })
  }

  @Test
  fun reportsDiscoveryThenReadingProgress() {
    val recorder = Recorder()
    scanner(batchSize = 2).scan(listOf(library), emptyList(), recorder)
    val reading = recorder.progress.filter { it.phase == ScanPhase.READING }
    assertEquals(ScanPhase.DISCOVERING, recorder.progress.first().phase)
    assertEquals(listOf(0, 2, 4, 6), reading.map { it.filesRead })
    assertTrue(reading.all { it.filesFound == 6 })
  }

  @Test
  fun honoursExclusions() {
    val recorder = Recorder()
    val summary = scanner(batchSize = 10)
      .scan(listOf(library), listOf(File(library, "Fixture Album")), recorder)
    assertEquals(4, summary.filesRead)
  }

  @Test
  fun stopsBetweenBatchesWhenCancelled() {
    val recorder = Recorder()
    val summary = scanner(batchSize = 2)
      .scan(listOf(library), emptyList(), recorder, isCancelled = { recorder.batches.isNotEmpty() })
    assertTrue(summary.cancelled)
    assertEquals(1, recorder.batches.size)
    assertEquals(2, summary.filesRead)
  }
}
