package expo.modules.wavenative.scan

import expo.modules.wavenative.artwork.ArtworkInfo
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.lyrics.Sidecars
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
  /**
   * Tags without the artwork bytes (referenced by [artworkHash]) or the lyrics,
   * which `LyricsReader` reads when they are shown.
   */
  val tags: RawTags,
  val artworkHash: String?,
  /** Lyrics in the tags or a sidecar `.lrc`: the whole-Library lyrics and genre run skips songs with them and a genre. */
  val hasLyrics: Boolean = false,
)

enum class ScanPhase(val id: String) {
  /** Walking folders to find audio files. */
  DISCOVERING("discovering"),
  /** Reading tags and artwork from the files found. */
  READING("reading"),
}

/** What the index holds for a file, for incremental scans. */
data class KnownFile(val sizeBytes: Long, val modifiedAt: Long)

/**
 * [filesRead] counts the files whose tags were read; [filesUnchanged] the found
 * files an incremental scan skipped because the index already has them as they are.
 */
data class ScanProgress(
  val phase: ScanPhase,
  val filesFound: Int,
  val filesRead: Int,
  val filesUnchanged: Int = 0,
)

data class ScanSummary(
  val filesFound: Int,
  val filesRead: Int,
  val cancelled: Boolean,
  val durationMs: Long,
  val filesUnchanged: Int = 0,
)

interface ScanListener {
  fun onProgress(progress: ScanProgress)

  /**
   * A batch of indexed tracks, plus the artwork first referenced by this batch in
   * the current scan (each unique image is reported once per scan).
   */
  fun onBatch(tracks: List<ScannedTrack>, artwork: List<ArtworkInfo>)

  /**
   * Known files the scan didn't find, reported once after discovery and before
   * the first batch, so moved files can be matched as their batches arrive.
   */
  fun onMissing(paths: List<String>) {}
}

/**
 * Library scan: walks the roots, then reads tags on a small thread pool and
 * reports results in batches of [batchSize], so JS can store and show tracks
 * while the scan is still running.
 *
 * Incremental mode: given the [KnownFile]s the index holds, files found with the
 * same size and modification time are not read again, and known files under the
 * roots that weren't found are reported missing. Known files outside the roots,
 * or under a root that isn't there (an unmounted SD card) or can't be listed,
 * are left alone.
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
    known: Map<String, KnownFile> = emptyMap(),
  ): ScanSummary {
    val startedAt = clock()
    var lastProgressAt = Long.MIN_VALUE
    var found = 0
    var unchanged = 0
    fun progress(phase: ScanPhase, read: Int, force: Boolean = false) {
      val now = clock()
      if (force || lastProgressAt == Long.MIN_VALUE || now - lastProgressAt >= progressIntervalMs) {
        lastProgressAt = now
        listener.onProgress(ScanProgress(phase, found, read, unchanged))
      }
    }
    fun summary(read: Int, cancelled: Boolean) =
      ScanSummary(found, read, cancelled, clock() - startedAt, unchanged)

    val files = ArrayList<File>()
    val seen = HashSet<String>()
    AudioFileWalker(roots, excluded).walk(isCancelled) { file ->
      found += 1
      seen.add(file.path)
      if (isUnchanged(file, known[file.path])) unchanged += 1 else files.add(file)
      progress(ScanPhase.DISCOVERING, 0)
    }
    if (isCancelled()) return summary(0, true)
    val missing = missingFiles(known, seen, roots)
    if (missing.isNotEmpty()) listener.onMissing(missing)
    progress(ScanPhase.READING, 0, force = true)

    val reportedArtwork = ConcurrentHashMap.newKeySet<String>()
    // Each folder's `.lrc` names, listed once per scan rather than once per song.
    val sidecarNames = ConcurrentHashMap<String, Set<String>>()
    val pool = Executors.newFixedThreadPool(threads.coerceAtLeast(1))
    var read = 0
    try {
      for (chunk in files.chunked(batchSize.coerceAtLeast(1))) {
        if (isCancelled()) return summary(read, true)
        val results = pool.invokeAll(
          chunk.map { file ->
            Callable { index(file, sidecarNames.computeIfAbsent(file.parent ?: "") { Sidecars.namesIn(file.parentFile) }) }
          },
        ).map { it.get() }
        val newArtwork = results.mapNotNull { it.second }.filter { reportedArtwork.add(it.hash) }
        read += results.size
        listener.onBatch(results.map { it.first }, newArtwork)
        progress(ScanPhase.READING, read, force = true)
      }
    } finally {
      pool.shutdownNow()
    }
    return summary(read, false)
  }

  private fun isUnchanged(file: File, indexed: KnownFile?): Boolean =
    indexed != null && indexed.sizeBytes == file.length() && indexed.modifiedAt == file.lastModified()

  /**
   * Known files under the available [roots] that the walk didn't find. A root
   * that is gone or can't be listed tells nothing about its files.
   */
  private fun missingFiles(known: Map<String, KnownFile>, seen: Set<String>, roots: List<File>): List<String> {
    if (known.isEmpty()) return emptyList()
    val available = roots.filter { it.listFiles() != null }.map { it.canonicalFile.path }
    return known.keys
      .filter { path -> path !in seen && available.any { root -> path == root || path.startsWith("$root/") } }
      .sorted()
  }

  /**
   * Reads one file as a scan would: its track and its artwork (stored, if new).
   * Also used after Wave writes a file's tags or sidecar, to update its index
   * entry. [sidecars] are the `.lrc` names in its folder (`Sidecars.namesIn`).
   */
  fun index(file: File, sidecars: Set<String> = Sidecars.namesIn(file.parentFile)): Pair<ScannedTrack, ArtworkInfo?> {
    val tags = tagReader.read(file)
    val artwork = tags.artwork?.let(artworkStore::store)
    val track = ScannedTrack(
      path = file.path,
      sizeBytes = file.length(),
      modifiedAt = file.lastModified(),
      tags = tags.copy(artwork = null, lyrics = null),
      artworkHash = artwork?.hash,
      hasLyrics = !tags.lyrics.isNullOrBlank() || Sidecars.hasOne(file, sidecars),
    )
    return track to artwork
  }
}
