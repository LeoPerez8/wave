package expo.modules.wavenative.scan

import expo.modules.wavenative.artwork.ArtworkInfo
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.tags.RawTags
import expo.modules.wavenative.tags.TagReader
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** One indexed audio file. */
data class ScannedTrack(
  val path: String,
  val sizeBytes: Long,
  val modifiedAt: Long,
  /** Tags without the artwork bytes; the artwork is referenced by [artworkHash]. */
  val tags: RawTags,
  val artworkHash: String?,
)

enum class ScanPhase(val id: String) {
  /** Walking folders to find audio files. */
  DISCOVERING("discovering"),
  /** Reading tags and artwork from the files found. */
  READING("reading"),
}

data class ScanProgress(val phase: ScanPhase, val filesFound: Int, val filesRead: Int)

data class ScanSummary(val filesFound: Int, val filesRead: Int, val cancelled: Boolean, val durationMs: Long)

interface ScanListener {
  fun onProgress(progress: ScanProgress)

  /**
   * A batch of indexed tracks, plus the artwork first referenced by this batch in
   * the current scan (each unique image is reported once per scan).
   */
  fun onBatch(tracks: List<ScannedTrack>, artwork: List<ArtworkInfo>)
}

/**
 * Full library scan: walks the roots, then reads tags on a small thread pool and
 * reports results in batches of [batchSize], so JS can store and show tracks
 * while the scan is still running.
 */
class LibraryScanner(
  private val tagReader: TagReader,
  private val artworkStore: ArtworkStore,
  private val batchSize: Int = 500,
  private val threads: Int = 4,
  private val progressIntervalMs: Long = 250,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  fun scan(
    roots: List<File>,
    excluded: List<File>,
    listener: ScanListener,
    isCancelled: () -> Boolean = { false },
  ): ScanSummary {
    val startedAt = clock()
    var lastProgressAt = Long.MIN_VALUE
    fun progress(phase: ScanPhase, found: Int, read: Int, force: Boolean = false) {
      val now = clock()
      if (force || lastProgressAt == Long.MIN_VALUE || now - lastProgressAt >= progressIntervalMs) {
        lastProgressAt = now
        listener.onProgress(ScanProgress(phase, found, read))
      }
    }

    val files = ArrayList<File>()
    AudioFileWalker(roots, excluded).walk(isCancelled) { file ->
      files.add(file)
      progress(ScanPhase.DISCOVERING, files.size, 0)
    }
    if (isCancelled()) return ScanSummary(files.size, 0, true, clock() - startedAt)
    progress(ScanPhase.READING, files.size, 0, force = true)

    val reportedArtwork = ConcurrentHashMap.newKeySet<String>()
    val pool = Executors.newFixedThreadPool(threads.coerceAtLeast(1))
    var read = 0
    try {
      for (chunk in files.chunked(batchSize.coerceAtLeast(1))) {
        if (isCancelled()) return ScanSummary(files.size, read, true, clock() - startedAt)
        val results = pool.invokeAll(chunk.map { file -> Callable { index(file) } }).map { it.get() }
        val newArtwork = results.mapNotNull { it.second }.filter { reportedArtwork.add(it.hash) }
        read += results.size
        listener.onBatch(results.map { it.first }, newArtwork)
        progress(ScanPhase.READING, files.size, read, force = true)
      }
    } finally {
      pool.shutdownNow()
    }
    return ScanSummary(files.size, read, false, clock() - startedAt)
  }

  private fun index(file: File): Pair<ScannedTrack, ArtworkInfo?> {
    val tags = tagReader.read(file)
    val artwork = tags.artwork?.let(artworkStore::store)
    val track = ScannedTrack(
      path = file.path,
      sizeBytes = file.length(),
      modifiedAt = file.lastModified(),
      tags = tags.copy(artwork = null),
      artworkHash = artwork?.hash,
    )
    return track to artwork
  }
}
