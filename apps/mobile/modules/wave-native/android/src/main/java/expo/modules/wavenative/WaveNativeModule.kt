package expo.modules.wavenative

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.artwork.AndroidArtworkProcessor
import expo.modules.wavenative.artwork.ArtworkInfo
import expo.modules.wavenative.artwork.ArtworkStore
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
 * Wave's native side: all-files access and the library scanner. Scans run one at
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
}
