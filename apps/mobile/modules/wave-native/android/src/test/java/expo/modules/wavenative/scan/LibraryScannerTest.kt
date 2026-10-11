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
import org.junit.Assume.assumeTrue
import org.junit.Test

class LibraryScannerTest {
  private val fakeProcessor = ArtworkProcessor { _, thumb ->
    thumb.writeBytes(byteArrayOf(0))
    ArtworkPalette(dominant = 0xFF14B8A6.toInt())
  }

  private class Recorder : ScanListener {
    val progress = mutableListOf<ScanProgress>()
    val batches = mutableListOf<Pair<List<ScannedTrack>, List<ArtworkInfo>>>()
    val events = mutableListOf<String>()

    override fun onProgress(progress: ScanProgress) {
      this.progress.add(progress)
    }

    override fun onBatch(tracks: List<ScannedTrack>, artwork: List<ArtworkInfo>) {
      batches.add(tracks to artwork)
      events.add("batch")
    }

    override fun onMissing(paths: List<String>) {
      missing.addAll(paths)
      events.add("missing")
    }

    val missing = mutableListOf<String>()
    val read: List<ScannedTrack> get() = batches.flatMap { it.first }
  }

  /** What the index holds after a scan, as an incremental scan receives it. */
  private fun indexOf(tracks: List<ScannedTrack>): Map<String, KnownFile> =
    tracks.associate { it.path to KnownFile(sizeBytes = it.sizeBytes, modifiedAt = it.modifiedAt) }

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

  @Test
  fun rescanningAnUnchangedLibraryReadsNoFile() {
    val first = Recorder().also { scanner(batchSize = 10).scan(listOf(library), emptyList(), it) }
    val recorder = Recorder()
    val summary = scanner(batchSize = 10)
      .scan(listOf(library), emptyList(), recorder, known = indexOf(first.read))

    assertEquals(6, summary.filesFound)
    assertEquals(6, summary.filesUnchanged)
    assertEquals(0, summary.filesRead)
    assertTrue(recorder.batches.isEmpty())
    assertTrue(recorder.missing.isEmpty())
  }

  private fun firstScan(): Map<String, KnownFile> =
    indexOf(Recorder().also { scanner(batchSize = 10).scan(listOf(library), emptyList(), it) }.read)

  private fun path(relative: String): String = File(library, relative).canonicalPath

  @Test
  fun readsOnlyNewAndChangedFiles() {
    val known = firstScan()
    File(library, "Lossless/a.flac").appendBytes(ByteArray(16))
    File(library, "Opus/a.opus").setLastModified(946_684_800_000)
    Fixtures.file("tagged.mp3").copyTo(File(library, "New/b.mp3"))

    val recorder = Recorder()
    val summary = scanner(batchSize = 10).scan(listOf(library), emptyList(), recorder, known = known)

    assertEquals(
      setOf(path("Lossless/a.flac"), path("Opus/a.opus"), path("New/b.mp3")),
      recorder.read.map { it.path }.toSet(),
    )
    assertEquals(7, summary.filesFound)
    assertEquals(4, summary.filesUnchanged)
    assertEquals(3, summary.filesRead)
    val last = recorder.progress.last()
    assertEquals(ScanProgress(ScanPhase.READING, filesFound = 7, filesRead = 3, filesUnchanged = 4), last)
  }

  @Test
  fun reportsDeletedFilesAsMissingBeforeTheFirstBatch() {
    val known = firstScan()
    File(library, "Loose/untagged.mp3").delete()
    File(library, "Compilation/a.mp3").renameTo(File(library, "Compilation/renamed.mp3"))

    val recorder = Recorder()
    scanner(batchSize = 10).scan(listOf(library), emptyList(), recorder, known = known)

    assertEquals(listOf(path("Compilation/a.mp3"), path("Loose/untagged.mp3")), recorder.missing)
    assertEquals(listOf(path("Compilation/renamed.mp3")), recorder.read.map { it.path })
    assertEquals(listOf("missing", "batch"), recorder.events)
  }

  @Test
  fun reportsTheFilesOfAnExcludedFolderAsMissing() {
    val known = firstScan()
    val recorder = Recorder()
    scanner(batchSize = 10)
      .scan(listOf(library), listOf(File(library, "Fixture Album")), recorder, known = known)

    assertEquals(listOf(path("Fixture Album/01.mp3"), path("Fixture Album/02.mp3")), recorder.missing)
    assertTrue(recorder.batches.isEmpty())
  }

  @Test
  fun leavesKnownFilesOutsideTheRootsOrUnderAnAbsentRootAlone() {
    val sdCard = File(Fixtures.tempDir(), "unmounted")
    val known = firstScan() +
      mapOf(
        "${sdCard.path}/Music/a.mp3" to KnownFile(sizeBytes = 1, modifiedAt = 1),
        "/elsewhere/b.mp3" to KnownFile(sizeBytes = 1, modifiedAt = 1),
      )

    val recorder = Recorder()
    val summary = scanner(batchSize = 10)
      .scan(listOf(library, File(sdCard, "Music")), emptyList(), recorder, known = known)

    assertTrue(recorder.missing.isEmpty())
    assertEquals(6, summary.filesUnchanged)
  }

  @Test
  fun leavesKnownFilesUnderAnUnreadableRootAlone() {
    val known = firstScan()
    assertTrue(library.setReadable(false))
    try {
      // Running as root reads it anyway; there's nothing to test then.
      assumeTrue(library.listFiles() == null)
      val recorder = Recorder()
      scanner(batchSize = 10).scan(listOf(library), emptyList(), recorder, known = known)
      assertTrue(recorder.missing.isEmpty())
    } finally {
      library.setReadable(true)
    }
  }
}
