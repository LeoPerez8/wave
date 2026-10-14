package expo.modules.wavenative

import android.app.Activity
import android.app.Application
import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.events.OnActivityResultPayload
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
import expo.modules.wavenative.launcher.LauncherIconSwitcher
import expo.modules.wavenative.launch.LaunchTheme
import expo.modules.wavenative.launch.LaunchThemeStore
import expo.modules.wavenative.lyrics.LyricsReader
import expo.modules.wavenative.playlists.PlaylistFiles
import expo.modules.wavenative.scan.KnownFile
import expo.modules.wavenative.scan.LibraryScanner
import expo.modules.wavenative.scan.ScanListener
import expo.modules.wavenative.scan.ScanProgress
import expo.modules.wavenative.scan.ScannedTrack
import expo.modules.wavenative.scan.artworkToMap
import expo.modules.wavenative.scan.trackToMap
import expo.modules.wavenative.share.SharedTextInbox
import expo.modules.wavenative.tags.AlbumPlace
import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.tags.LyricsDestination
import expo.modules.wavenative.tags.MediaRetrieverTagReader
import expo.modules.wavenative.tags.SongTagWriter
import expo.modules.wavenative.tags.TagDestination
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Wave's native side: all-files access, the folder and playlist file pickers, the library scanner,
 * lyrics, writing found lyrics and genre into files, deleting songs' files, saving artist photos,
 * the launch theme, the launcher icon, reading the clipboard and text shared to Wave. Scans run one at a time on a background thread and
 * stream results to JS as events:
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
  /** Only touched on the main thread, where the pickers start and their results arrive. */
  private var pendingFolderPick: Promise? = null
  private var pendingPlaylistPick: Promise? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WaveNative")

    Events(
      "onScanProgress",
      "onScanMissing",
      "onScanBatch",
      "onScanComplete",
      "onScanError",
      "onShareReceived",
    )

    // A share can arrive before JS listens: it stays in the inbox until `takeSharedText`.
    OnCreate { SharedTextInbox.onReceived = { sendEvent("onShareReceived") } }

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

    /**
     * Opens the system file picker for one or more M3U playlists. Resolves one
     * `{ name, path, text }` per picked file (none when cancelled): its file
     * name, its absolute path when its provider has one, and its text, or null
     * when it couldn't be read. The files are read off the main thread.
     */
    AsyncFunction("pickPlaylistFiles") { promise: Promise ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      pendingPlaylistPick?.resolve(emptyList<Map<String, Any?>>())
      pendingPlaylistPick = promise
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        putExtra(Intent.EXTRA_MIME_TYPES, PlaylistFiles.MIME_TYPES)
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
      activity.startActivityForResult(intent, PICK_PLAYLISTS_REQUEST)
    }.runOnQueue(Queues.MAIN)

    /**
     * Opens the system file picker for one or more files of any type (BlackPlayer's
     * `.bpstat` track stats have no MIME type of their own) and resolves them as
     * `pickPlaylistFiles` does.
     */
    AsyncFunction("pickStatFiles") { promise: Promise ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      pendingPlaylistPick?.resolve(emptyList<Map<String, Any?>>())
      pendingPlaylistPick = promise
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
      activity.startActivityForResult(intent, PICK_PLAYLISTS_REQUEST)
    }.runOnQueue(Queues.MAIN)

    /**
     * The text on the clipboard, or null when it holds none (Import from a Link offers a
     * playlist link from it). Android only lets the app in front read it.
     */
    AsyncFunction("readClipboardText") {
      val clipboard = context.getSystemService(ClipboardManager::class.java)
      clipboard?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
    }.runOnQueue(Queues.MAIN)

    /** The latest text shared to Wave from another app, once; null when nothing new was shared. */
    Function("takeSharedText") { SharedTextInbox.take() }

    OnActivityResult { _, payload ->
      when (payload.requestCode) {
        PICK_FOLDER_REQUEST -> onFolderPicked(payload)
        PICK_PLAYLISTS_REQUEST -> onPlaylistsPicked(payload)
      }
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

    /**
     * Makes [alias] (one of [aliases], activity-alias names without the package)
     * Wave's launcher icon once Wave leaves the screen; see [LauncherIconSwitcher].
     */
    AsyncFunction("setLauncherIcon") { alias: String, aliases: List<String> ->
      launcherIcons().request(alias, aliases)
    }.runOnQueue(Queues.MAIN)

    /**
     * Writes found lyrics (LRC or plain text) and genre into a song's file,
     * replacing what is there, and fills in its track number (with the disc)
     * and year, keeping any the file has; null leaves that field alone (see
     * [SongTagWriter]). Resolves `{ lyrics, genre, trackNumber, year }`, where
     * each went (`tags`, `sidecar`, `notWritten` or `none`), and, when the tags
     * changed, the file read again as a scan reads it (`track`, `artwork`) so
     * the index can be updated. Rejects when the file can't be written. Off the
     * main thread.
     */
    AsyncFunction("writeLyricsAndGenre") {
        path: String,
        lyrics: String?,
        genre: String?,
        trackNumber: Int?,
        discNumber: Int?,
        year: Int?,
      ->
      val file = File(path)
      val report = SongTagWriter().write(file, lyrics, genre, AlbumPlace(trackNumber, discNumber, year))
      val tagsChanged =
        report.lyrics == LyricsDestination.TAGS ||
          listOf(report.genre, report.trackNumber, report.year).any { it == TagDestination.TAGS }
      // A sidecar alone leaves the tags as they were, but the index learns the song has lyrics.
      val reindex = tagsChanged || report.lyrics == LyricsDestination.SIDECAR
      val (track, artwork) = if (reindex) singleFileScanner().index(file) else null to null
      if (tagsChanged) MediaScannerConnection.scanFile(context, arrayOf(path), null, null)
      report.toMap() +
        mapOf("track" to track?.let(::trackToMap), "artwork" to artwork?.let(::artworkToMap))
    }

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
      SharedTextInbox.onReceived = null
      currentScan?.second?.set(true)
      scanExecutor.shutdownNow()
      launcherIconSwitcher?.let { switcher ->
        appContext.reactContext?.let { (it.applicationContext as Application).unregisterActivityLifecycleCallbacks(switcher) }
      }
      launcherIconSwitcher = null
    }
  }

  /** Created on first use (on the main thread) and told when Wave's activities stop. */
  private var launcherIconSwitcher: LauncherIconSwitcher? = null

  private fun launcherIcons(): LauncherIconSwitcher =
    launcherIconSwitcher
      ?: LauncherIconSwitcher(
        context.applicationContext,
        // A picker Wave opened is over it: switching now could close Wave's task under it.
        isBusy = { pendingFolderPick != null || pendingPlaylistPick != null },
      ).also {
        (context.applicationContext as Application).registerActivityLifecycleCallbacks(it)
        launcherIconSwitcher = it
      }

  private fun onFolderPicked(payload: OnActivityResultPayload) {
    val promise = pendingFolderPick ?: return
    pendingFolderPick = null
    val uri = payload.data?.data
    if (payload.resultCode != Activity.RESULT_OK || uri == null) {
      promise.resolve(mapOf("status" to "cancelled"))
      return
    }
    val documentId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull()
    val path = TreeUris.toPath(uri.authority, documentId, ::volumeDirectory)
    promise.resolve(
      if (path == null) mapOf("status" to "unsupported") else mapOf("status" to "picked", "path" to path),
    )
  }

  private fun onPlaylistsPicked(payload: OnActivityResultPayload) {
    val promise = pendingPlaylistPick ?: return
    pendingPlaylistPick = null
    val data = payload.data
    if (payload.resultCode != Activity.RESULT_OK || data == null) {
      promise.resolve(emptyList<Map<String, Any?>>())
      return
    }
    val clip = data.clipData
    val uris = if (clip != null) List(clip.itemCount) { clip.getItemAt(it).uri } else listOfNotNull(data.data)
    Thread({ promise.resolve(uris.map(::readPlaylistFile)) }, "wave-playlist-import").start()
  }

  /** `{ name, path, text }` of a picked playlist file; see `pickPlaylistFiles`. */
  private fun readPlaylistFile(uri: Uri): Map<String, Any?> {
    val resolver = context.contentResolver
    val name = runCatching {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    }.getOrNull() ?: uri.lastPathSegment ?: "Playlist"
    val documentId = runCatching { DocumentsContract.getDocumentId(uri) }.getOrNull()
    val path = PlaylistFiles.documentPath(uri.authority, documentId, ::volumeDirectory)
      ?: PlaylistFiles.mediaStoreId(uri.authority, documentId)?.let(::mediaStorePath)
    val text = runCatching {
      resolver.openInputStream(uri)?.use(PlaylistFiles::readText)
    }.getOrNull()
    return mapOf("name" to name, "path" to path, "text" to text)
  }

  /** A MediaStore file's absolute path (readable with all-files access), for downloads picked by id. */
  private fun mediaStorePath(id: Long): String? = runCatching {
    val uri = ContentUris.withAppendedId(MediaStore.Files.getContentUri("external"), id)
    @Suppress("DEPRECATION")
    context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else null
    }
  }.getOrNull()

  private fun artistPhotos() = ArtistPhotoStore(File(File(context.filesDir, "artwork"), "artists"))

  /** Reads single files the way a scan does (same tag reader and artwork store). */
  private fun singleFileScanner() =
    LibraryScanner(
      tagReader = AudioTagReader(primary = JAudioTaggerReader(), fallback = MediaRetrieverTagReader()),
      artworkStore = ArtworkStore(File(context.filesDir, "artwork"), AndroidArtworkProcessor()),
    )

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

  private companion object {
    const val PICK_FOLDER_REQUEST = 0x5741
    const val PICK_PLAYLISTS_REQUEST = 0x5742
  }
}
