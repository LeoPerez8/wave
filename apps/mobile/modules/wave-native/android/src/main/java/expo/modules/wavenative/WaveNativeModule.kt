package expo.modules.wavenative

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
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
import expo.modules.wavenative.artwork.ArtworkInfo
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.folders.TreeUris
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
 * Wave's native side: all-files access, the folder picker and the library scanner. Scans run one at
 * a time on a background thread and stream results to JS as events:
 * `onScanProgress`, `onScanBatch`, `onScanComplete` and `onScanError`, each
 * carrying the `scanId` returned by `startScan`.
 */
class WaveNativeModule : Module() {
  private val scanExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "wave-scanner").apply { priority = Thread.NORM_PRIORITY - 1 }
  }
  private val nextScanId = AtomicInteger(1)
  @Volatile private var currentScan: Pair<Int, AtomicBoolean>? = null
  /** Only touched on the main thread, where the picker starts and its result arrives. */
  private var pendingFolderPick: Promise? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WaveNative")

    Events("onScanProgress", "onScanBatch", "onScanComplete", "onScanError")

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

    /** Starts a full scan of [roots] minus [excluded], cancelling any scan in progress. */
    Function("startScan") { roots: List<String>, excluded: List<String> ->
      val id = nextScanId.getAndIncrement()
      val cancelled = AtomicBoolean(false)
      currentScan?.second?.set(true)
      currentScan = id to cancelled
      val artworkDir = File(context.filesDir, "artwork")
      scanExecutor.execute { runScan(id, cancelled, roots.map(::File), excluded.map(::File), artworkDir) }
      id
    }

    Function("cancelScan") { scanId: Int ->
      currentScan?.takeIf { it.first == scanId }?.second?.set(true)
    }

    OnDestroy {
      currentScan?.second?.set(true)
      scanExecutor.shutdownNow()
    }
  }

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
              ),
            )
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
      )
      sendEvent(
        "onScanComplete",
        mapOf(
          "scanId" to id,
          "filesFound" to summary.filesFound,
          "filesRead" to summary.filesRead,
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
