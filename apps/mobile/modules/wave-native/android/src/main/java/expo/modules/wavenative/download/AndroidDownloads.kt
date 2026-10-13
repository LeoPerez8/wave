package expo.modules.wavenative.download

import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.os.Handler
import android.os.Looper
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
import expo.modules.wavenative.yt.YtDownloadService
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
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
  val transport = object : DurableTransfer {
    override fun cancel(id: String) = soulseek.client.cancel(id)
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = try {
      soulseek.download(id, SoulseekCandidate.fromJs(candidate), source, durationMs,
        onProgress = { received, total -> progress(received, total, null); changed() },
        onQueued = { place -> progress(0, 0, place); changed() },
        isCancelled = { Thread.currentThread().isInterrupted },
      )
    } catch (error: SoulseekException) {
      val reason = when (error.failure) {
        SoulseekFailure.AUTH, SoulseekFailure.SIGNED_OUT -> "account"
        SoulseekFailure.OFFLINE -> "offline"
        SoulseekFailure.STORAGE -> "storage"
        else -> "unavailable"
      }
      throw DurableFailure(reason, error)
    } catch (error: java.io.IOException) { throw DurableFailure("storage", error) }
  }
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
  fun changed() { for (listener in listeners) runCatching(listener) }

  /** Called from the user's tap or the resumed Activity. Failure never starts unprotected work. */
  fun requestService() {
    if (!jobs.hasWork()) return
    try { context.startForegroundService(Intent(context, YtDownloadService::class.java)) }
    catch (error: Exception) { jobs.stopWork(transport); jobs.expire(transport, stopAll = true); changed() }
  }

  @Synchronized fun start(onIdle: () -> Unit, refresh: () -> Unit) {
    if (worker != null) return
    jobs.startWork()
    main.post { JsRuntime.ensureStarted(context, OWNER) }
    deadlines = Executors.newSingleThreadScheduledExecutor().also { executor ->
      executor.scheduleWithFixedDelay({ runCatching { jobs.expire(transport); changed() } }, 1, 1, TimeUnit.SECONDS)
    }
    worker = Executors.newSingleThreadScheduledExecutor().also { executor ->
      executor.scheduleWithFixedDelay({
        runCatching { jobs.advance(transport, publication) }.onFailure { jobs.stopWork(transport); runCatching { jobs.expire(transport, true) } }
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
    @Volatile private var instance: AndroidDownloads? = null
    fun get(context: Context): AndroidDownloads = instance ?: synchronized(this) { instance ?: AndroidDownloads(context.applicationContext).also { instance = it } }
  }
}
