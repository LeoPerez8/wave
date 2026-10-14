package expo.modules.wavenative.download

import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import expo.modules.wavenative.artwork.AndroidArtworkProcessor
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.player.JsRuntime
import expo.modules.wavenative.scan.LibraryScanner
import expo.modules.wavenative.scan.artworkToMap
import expo.modules.wavenative.scan.trackToMap
import expo.modules.wavenative.soulseek.AndroidSoulseek
import expo.modules.wavenative.soulseek.SoulseekCandidate
import expo.modules.wavenative.soulseek.SoulseekException
import expo.modules.wavenative.soulseek.SoulseekFailure
import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.DownloadTagWriter
import expo.modules.wavenative.tags.DownloadTags
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.tags.MediaRetrieverTagReader
import expo.modules.wavenative.yt.AndroidM4aDuration
import expo.modules.wavenative.yt.AndroidYtAudioStreams
import expo.modules.wavenative.yt.YtAudioDownload
import expo.modules.wavenative.yt.YtDownloadService
import expo.modules.wavenative.yt.YtException
import expo.modules.wavenative.yt.YtStreamFailure
import expo.modules.wavenative.yt.YtStreamResolver
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CancellationException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** Application-context owner, independent of Expo module and Activity lifetimes. */
class AndroidDownloads private constructor(private val context: Context) {
  val jobs = DurableDownloads(File(context.noBackupFilesDir, "soulseek-download-jobs-v1"))
  private val soulseek = AndroidSoulseek.get(context)
  private val main = Handler(Looper.getMainLooper())
  private var worker: ScheduledExecutorService? = null
  private var deadlines: ScheduledExecutorService? = null
  private val listeners = CopyOnWriteArrayList<() -> Unit>()
  private val ytStreams by lazy { AndroidYtAudioStreams(context) }
  private val ytAudio by lazy { YtAudioDownload(ytStreams) }
  /** Each transfer goes to the source of the job's current candidate: a Soulseek peer or YouTube. */
  val transport = object : DurableTransfer {
    // A YouTube transfer stops as soon as the journal no longer wants it (`transferWanted`).
    override fun cancel(id: String) = soulseek.client.cancel(id)
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> =
      if (candidate["source"] == DurableDownloads.YOUTUBE) fromYoutube(id, candidate, source, progress)
      else fromSoulseek(id, candidate, source, durationMs, progress)
  }

  /**
   * The M4A YouTube serves, saved as it is, then read through to its last sample for its length,
   * which the journal's confirm decision checks against the song's (Core's `ytAudioMatches`).
   */
  private fun fromYoutube(id: String, candidate: Map<String, Any?>, source: File, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
    val videoId = candidate["videoId"] as? String ?: throw DurableFailure("failed")
    val cancelled = { Thread.currentThread().isInterrupted || !jobs.transferWanted(id) }
    return try {
      source.parentFile?.mkdirs()
      val file = ytAudio.download(videoId, source,
        onProgress = { received, total -> progress(received, total, null); changedSoon() },
        isCancelled = cancelled,
      )
      val durationMs = AndroidM4aDuration.of(source, cancelled)
      mapOf("partPath" to source.path, "bytes" to file.bytes, "mimeType" to file.mimeType, "itag" to file.itag.toLong(), "bitrate" to file.bitrate.toLong(), "durationMs" to durationMs)
    } catch (error: YtException) {
      source.delete()
      val reason = when (YtStreamResolver.failureOf(error)) {
        YtStreamFailure.OFFLINE -> "offline"
        // YT Music was turned off: with no Soulseek account either, there's no source left.
        YtStreamFailure.DISABLED -> "noSource"
        YtStreamFailure.UNAVAILABLE -> "ytUnavailable"
        YtStreamFailure.FAILED -> "failed"
      }
      Log.w(TAG, "A YouTube transfer failed ($reason)")
      throw DurableFailure(reason, error)
    } catch (error: CancellationException) {
      source.delete(); throw DurableFailure("cancelled", error)
    } catch (error: java.io.IOException) {
      source.delete()
      // The part file couldn't be written, the network went, or YouTube broke off: the journal starts it again.
      val folder = source.parentFile
      val reason = when {
        error is java.io.FileNotFoundException || folder == null || !folder.isDirectory || folder.usableSpace < MIN_FREE_BYTES -> "storage"
        !ytStreams.hasNetwork() -> "offline"
        else -> "failed"
      }
      Log.w(TAG, "A YouTube transfer failed ($reason): ${error.message}")
      throw DurableFailure(reason, error)
    }
  }

  private fun fromSoulseek(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = try {
      soulseek.download(id, SoulseekCandidate.fromJs(candidate), source, durationMs,
        onProgress = { received, total -> progress(received, total, null); changedSoon() },
        onQueued = { place -> progress(0, 0, place); changed() },
        // The journal's start, queue and stall rules bound the wait, even if a cancel goes missing.
        isCancelled = { Thread.currentThread().isInterrupted || !jobs.transferWanted(id) },
      )
    } catch (error: SoulseekException) {
      // Which check a peer's file failed is what tells a strict check from a bad file.
      if (error.failure != SoulseekFailure.CANCELLED) {
        Log.w(TAG, "A Soulseek transfer failed (${error.failure}): ${error.message}; ${error.cause?.message ?: ""}")
      }
      val reason = when (error.failure) {
        SoulseekFailure.AUTH, SoulseekFailure.SIGNED_OUT -> "account"
        SoulseekFailure.OFFLINE -> "offline"
        SoulseekFailure.STORAGE -> "storage"
        SoulseekFailure.CANCELLED -> "cancelled"
        else -> "unavailable"
      }
      throw DurableFailure(reason, error)
    } catch (error: java.io.IOException) { throw DurableFailure("storage", error) }
    catch (error: Exception) { Log.w(TAG, "A Soulseek transfer failed", error); throw error }
  private val publication = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) {
      val fields = DownloadTags.fromJs(tags) ?: throw java.io.IOException("Invalid download tags")
      val cover = (tags["artworkUrl"] as? String)?.let { runCatching { cover(it) }.getOrNull() }
      DownloadTagWriter().write(source, fields, cover)
    }
    override fun index(file: File): Map<String, Any?> {
      val scanner = LibraryScanner(
        tagReader = AudioTagReader(primary = JAudioTaggerReader(), fallback = MediaRetrieverTagReader()),
        artworkStore = ArtworkStore(File(context.filesDir, "artwork"), AndroidArtworkProcessor()),
      )
      val (track, artwork) = scanner.index(file)
      MediaScannerConnection.scanFile(context, arrayOf(file.path), null, null)
      return mapOf("path" to file.path, "track" to trackToMap(track), "artwork" to artwork?.let(::artworkToMap))
    }
  }

  fun subscribe(listener: () -> Unit): () -> Unit { listeners.add(listener); return { listeners.remove(listener) } }
  fun changed() { lastChangedAt = SystemClock.elapsedRealtime(); for (listener in listeners) runCatching(listener) }
  @Volatile private var lastChangedAt = 0L
  /** Transfer progress arrives per chunk; JS and the notification only need a few updates a second. */
  private fun changedSoon() { if (SystemClock.elapsedRealtime() - lastChangedAt >= 500) changed() }

  /** Called from the user's tap or the resumed Activity. Failure never starts unprotected work. */
  fun requestService() {
    if (!jobs.hasWork()) return
    try { context.startForegroundService(Intent(context, YtDownloadService::class.java)) }
    catch (error: Exception) {
      // Never unprotected work: started jobs fail with Retry; queued ones wait for the next launch.
      if (synchronized(this) { worker == null }) { jobs.expire(transport, stopAll = true); changed() }
    }
  }

  @Synchronized fun start(onIdle: () -> Unit, refresh: () -> Unit) {
    if (worker != null) return
    jobs.startWork()
    main.post { JsRuntime.ensureStarted(context, OWNER) }
    deadlines = Executors.newSingleThreadScheduledExecutor().also { executor ->
      // Also refreshes the notification while the worker is blocked in a transfer.
      executor.scheduleWithFixedDelay({ runCatching { jobs.expire(transport); changed(); main.post(refresh) } }, 1, 1, TimeUnit.SECONDS)
    }
    worker = Executors.newSingleThreadScheduledExecutor().also { executor ->
      executor.scheduleWithFixedDelay({
        // An unexpected failure (a full disk can't even write the journal) ends the started jobs, never the queue.
        runCatching { jobs.advance(transport, publication) }.onFailure { runCatching { jobs.expire(transport, true) } }
        changed()
        main.post { refresh(); if (!jobs.hasWork()) onIdle() }
      }, 0, 500, TimeUnit.MILLISECONDS)
    }
  }

  /** Android's time limit stops actual socket work before removing foreground protection. */
  @Synchronized fun stop(timedOut: Boolean = false) {
    jobs.stopWork(transport)
    worker?.shutdownNow(); worker = null
    deadlines?.shutdownNow(); deadlines = null
    if (timedOut) Executors.newSingleThreadExecutor().also { executor ->
      executor.execute { try { jobs.expire(transport, true); changed() } finally { executor.shutdown() } }
    }
    main.post { JsRuntime.release(OWNER) }
  }

  private fun cover(url: String): ByteArray {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 2_000; readTimeout = 2_000 }
    try {
      check(connection.responseCode == 200)
      return connection.inputStream.use { input ->
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (output.size() <= ArtworkStore.MAX_IMAGE_BYTES) { val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count) }
        output.toByteArray().also { check(it.isNotEmpty() && it.size <= ArtworkStore.MAX_IMAGE_BYTES) }
      }
    } finally { connection.disconnect() }
  }

  companion object {
    private const val OWNER = "downloads"
    private const val TAG = "WaveDownloads"
    /** Less free space than this beside the part file means the write failed for want of room. */
    private const val MIN_FREE_BYTES = 8L shl 20
    @Volatile private var instance: AndroidDownloads? = null
    fun get(context: Context): AndroidDownloads = instance ?: synchronized(this) { instance ?: AndroidDownloads(context.applicationContext).also { instance = it } }
  }
}
