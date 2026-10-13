package expo.modules.wavenative

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.artwork.AndroidArtworkProcessor
import expo.modules.wavenative.artwork.ArtistPhotoStore
import expo.modules.wavenative.artwork.ArtworkInfo
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.files.DeleteOutcome
import expo.modules.wavenative.files.TrackFileDeleter
import expo.modules.wavenative.folders.TreeUris
import expo.modules.wavenative.launch.LaunchTheme
import expo.modules.wavenative.launch.LaunchThemeStore
import expo.modules.wavenative.lyrics.LyricsReader
import expo.modules.wavenative.scan.KnownFile
import expo.modules.wavenative.scan.LibraryScanner
import expo.modules.wavenative.scan.ScanListener
import expo.modules.wavenative.scan.ScanProgress
import expo.modules.wavenative.scan.ScannedTrack
import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.tags.MediaRetrieverTagReader
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Wave's native side: all-files access, the folder picker, the library scanner,
 * lyrics, deleting songs' files, saving artist photos and the launch theme. Scans run one at
 * a time on a background thread and stream results to JS as events:
 * `onScanProgress`, `onScanMissing`, `onScanBatch`, `onScanComplete` and
 * `onScanError`, each carrying the `scanId` returned by `startScan`.
 */
class WaveNativeModule : Module() {
  private val scanExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "wave-scanner").apply { priority = Thread.NORM_PRIORITY - 1 }
  }
  private val nextScanId = AtomicInteger(1)
  @Volatile private var currentScan: Pair<Int, AtomicBoolean>? = null
  private val lyricsReader by lazy {
    LyricsReader(AudioTagReader(primary = JAudioTaggerReader(), fallback = MediaRetrieverTagReader()))
  }
  /** Only touched on the main thread, where the picker starts and its result arrives. */
  private var pendingFolderPick: Promise? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WaveNative")

    Events("onScanProgress", "onScanMissing", "onScanBatch", "onScanComplete", "onScanError")

    Function("hasAllFilesAccess") { Environment.isExternalStorageManager() }

    /** Opens the system "All files access" screen for Wave. Re-check access when the app is active again. */
    AsyncFunction("requestAllFilesAccess") {
      val packageUri = Uri.parse("package:${context.packageName}")
      val activity = appContext.currentActivity
      val launcher: Context = activity ?: context
      fun launch(intent: Intent) {
        if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        launcher.startActivity(intent)
      }
      try {
        launch(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, packageUri))
      } catch (e: ActivityNotFoundException) {
        // Some OEM builds only have the list screen.
        launch(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
      }
    }

    Function("getDefaultMusicFolder") {
      @Suppress("DEPRECATION")
      Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC).absolutePath
    }

    /**
     * Opens the system folder picker. Resolves `{ status: "picked", path }`,
     * `{ status: "cancelled" }`, or `{ status: "unsupported" }` for folders
     * without a file path (Downloads, cloud providers).
     */
    AsyncFunction("pickFolder") { promise: Promise ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      pendingFolderPick?.resolve(mapOf("status" to "cancelled"))
      pendingFolderPick = promise
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), PICK_FOLDER_REQUEST)
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != PICK_FOLDER_REQUEST) return@OnActivityResult
      val promise = pendingFolderPick ?: return@OnActivityResult
      pendingFolderPick = null
      val uri = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(mapOf("status" to "cancelled"))
        return@OnActivityResult
      }
      val documentId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull()
      val path = TreeUris.toPath(uri.authority, documentId, ::volumeDirectory)
      promise.resolve(
        if (path == null) mapOf("status" to "unsupported") else mapOf("status" to "picked", "path" to path),
      )
    }

    /**
     * Scans [roots] minus [excluded], cancelling any scan in progress. The known
     * files (parallel lists of path, size and modification time) make it
     * incremental: unchanged files aren't read again and missing ones are reported.
     */
    Function("startScan") {
        roots: List<String>,
        excluded: List<String>,
        knownPaths: List<String>,
        knownSizes: List<Double>,
        knownModifiedAt: List<Double>,
      ->
      require(knownPaths.size == knownSizes.size && knownPaths.size == knownModifiedAt.size) {
        "Known file lists differ in length"
      }
      val known = HashMap<String, KnownFile>(knownPaths.size * 2)
      for (i in knownPaths.indices) {
        known[knownPaths[i]] = KnownFile(knownSizes[i].toLong(), knownModifiedAt[i].toLong())
      }
      val id = nextScanId.getAndIncrement()
      val cancelled = AtomicBoolean(false)
      currentScan?.second?.set(true)
      currentScan = id to cancelled
      val artworkDir = File(context.filesDir, "artwork")
      scanExecutor.execute {
        runScan(id, cancelled, roots.map(::File), excluded.map(::File), known, artworkDir)
      }
      id
    }

    Function("cancelScan") { scanId: Int ->
      currentScan?.takeIf { it.first == scanId }?.second?.set(true)
    }

    /**
     * A track's lyrics, unparsed: `{ embedded, sidecar }`, each the text or
     * null. Read on a background thread when the Lyrics view asks for them.
     */
    AsyncFunction("readLyrics") { path: String ->
      val sources = lyricsReader.read(File(path))
      mapOf("embedded" to sources.embedded, "sidecar" to sources.sidecar)
    }

    /**
     * Deletes songs' audio files (and their sidecar `.lrc`), one outcome per
     * path, in order: `deleted`, `missing`, `denied`, `readOnly` or `failed`.
     * Other apps' view of the media (MediaStore) is told about the deleted ones.
     */
    AsyncFunction("deleteFiles") { paths: List<String> ->
      val deleter = TrackFileDeleter(isReadOnly = { file ->
        Environment.getExternalStorageState(file) == Environment.MEDIA_MOUNTED_READ_ONLY
      })
      val outcomes = paths.map { deleter.delete(File(it)) }
      val deleted = paths.filterIndexed { i, _ -> outcomes[i] == DeleteOutcome.DELETED }
      if (deleted.isNotEmpty()) {
        MediaScannerConnection.scanFile(context, deleted.toTypedArray(), null, null)
      }
      outcomes.map { it.id }
    }

    /**
     * Downloads an artist's photo in both sizes beside the album artwork and
     * resolves `{ path, thumbPath }`; rejects when either download fails or
     * isn't an image (nothing is kept then). Runs off the main thread.
     */
    AsyncFunction("saveArtistPhoto") { artistKey: String, thumbUrl: String, largeUrl: String ->
      artistPhotos().save(artistKey, thumbUrl, largeUrl).toMap()
    }

    /** Deletes every downloaded artist photo. */
    AsyncFunction("clearArtistPhotos") { artistPhotos().clear() }

    /** Saves Core's `launchTheme` for the next cold start and picks its splash (Android 13+). */
    AsyncFunction("setLaunchTheme") { theme: Map<String, Any?> ->
      val launch = LaunchTheme.fromJs(theme) ?: throw IllegalArgumentException("Malformed launch theme: $theme")
      LaunchThemeStore.save(context, launch)
      appContext.currentActivity?.let { LaunchThemeStore.applySplash(it, launch) }
    }

    // JS may have saved the launch theme without an activity (Android Auto starts it headless).
    OnActivityEntersForeground {
      appContext.currentActivity?.let { LaunchThemeStore.applySplash(it, LaunchThemeStore.load(context)) }
    }

    OnDestroy {
      currentScan?.second?.set(true)
      scanExecutor.shutdownNow()
    }
  }

  private fun artistPhotos() = ArtistPhotoStore(File(File(context.filesDir, "artwork"), "artists"))

  /** The root of a storage volume: `primary` or the UUID of an SD card or USB drive. */
  private fun volumeDirectory(volumeId: String): File? {
    if (volumeId == "primary") {
      @Suppress("DEPRECATION")
      return Environment.getExternalStorageDirectory()
    }
    val storage = context.getSystemService(StorageManager::class.java) ?: return null
    return storage.storageVolumes.firstOrNull { it.uuid.equals(volumeId, ignoreCase = true) }?.directory
  }

  private fun runScan(
    id: Int,
    cancelled: AtomicBoolean,
    roots: List<File>,
    excluded: List<File>,
    known: Map<String, KnownFile>,
    artworkDir: File,
  ) {
    try {
      val scanner = LibraryScanner(
        tagReader = AudioTagReader(primary = JAudioTaggerReader(), fallback = MediaRetrieverTagReader()),
        artworkStore = ArtworkStore(artworkDir, AndroidArtworkProcessor()),
        threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4),
      )
      val summary = scanner.scan(
        roots,
        excluded,
        object : ScanListener {
          override fun onProgress(progress: ScanProgress) {
            sendEvent(
              "onScanProgress",
              mapOf(
                "scanId" to id,
                "phase" to progress.phase.id,
                "filesFound" to progress.filesFound,
                "filesRead" to progress.filesRead,
                "filesUnchanged" to progress.filesUnchanged,
              ),
            )
          }

          override fun onMissing(paths: List<String>) {
            sendEvent("onScanMissing", mapOf("scanId" to id, "paths" to paths))
          }

          override fun onBatch(tracks: List<ScannedTrack>, artwork: List<ArtworkInfo>) {
            sendEvent(
              "onScanBatch",
              mapOf(
                "scanId" to id,
                "tracks" to tracks.map(::trackToMap),
                "artwork" to artwork.map(::artworkToMap),
              ),
            )
          }
        },
        isCancelled = cancelled::get,
        known = known,
      )
      sendEvent(
        "onScanComplete",
        mapOf(
          "scanId" to id,
          "filesFound" to summary.filesFound,
          "filesRead" to summary.filesRead,
          "filesUnchanged" to summary.filesUnchanged,
          "cancelled" to summary.cancelled,
          "durationMs" to summary.durationMs.toDouble(),
        ),
      )
    } catch (e: Throwable) {
      sendEvent("onScanError", mapOf("scanId" to id, "message" to (e.message ?: e.toString())))
    } finally {
      if (currentScan?.first == id) currentScan = null
    }
  }

  private fun trackToMap(track: ScannedTrack): Map<String, Any?> =
    mapOf(
      "path" to track.path,
      "sizeBytes" to track.sizeBytes.toDouble(),
      "modifiedAt" to track.modifiedAt.toDouble(),
      "title" to track.tags.title,
      "artist" to track.tags.artist,
      "album" to track.tags.album,
      "albumArtist" to track.tags.albumArtist,
      "genre" to track.tags.genre,
      "year" to track.tags.year,
      "trackNumber" to track.tags.trackNumber,
      "discNumber" to track.tags.discNumber,
      "compilation" to track.tags.compilation,
      "durationMs" to track.tags.durationMs.toDouble(),
      "sampleRate" to track.tags.sampleRate,
      "bitrateKbps" to track.tags.bitrateKbps,
      "artworkHash" to track.artworkHash,
    )

  private fun artworkToMap(artwork: ArtworkInfo): Map<String, Any?> =
    mapOf(
      "hash" to artwork.hash,
      "path" to artwork.path,
      "thumbPath" to artwork.thumbPath,
      "palette" to artwork.palette.toMap(),
    )

  private companion object {
    const val PICK_FOLDER_REQUEST = 0x5741
  }
}
