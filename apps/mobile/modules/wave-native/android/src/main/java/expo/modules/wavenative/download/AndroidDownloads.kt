package expo.modules.wavenative.download

import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.wavenative.artwork.AndroidArtworkProcessor
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.log.AndroidMemory
import expo.modules.wavenative.log.JsHeap
import expo.modules.wavenative.log.WaveLog
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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** Application-context owner, independent of Expo module and Activity lifetimes. */
class AndroidDownloads private constructor(private val context: Context) {
  /** Writes the journal's changes that wait for their second (#452), off the main thread and whether or not the service runs. */
  private val journalWriter = Executors.newSingleThreadScheduledExecutor { run -> Thread(run, "Wave download journal").apply { isDaemon = true } }
  // Each failure's cause also goes to the app log, so a device run shows why a download stopped;
  // and each transfer's speed, so it shows where a download's time went. Its budgets wait for the
  // download service (startWork): Wave opening before the service starts isn't charged.
  val jobs = DurableDownloads(
    File(context.noBackupFilesDir, "soulseek-download-jobs-v1"),
    log = { WaveLog.w(TAG, it) },
    note = { WaveLog.i(TAG, it) },
    budgetRunning = false,
    later = { delay, run -> journalWriter.schedule(run, delay, TimeUnit.MILLISECONDS) },
  )
  private val soulseek = AndroidSoulseek.get(context)
  private val main = Handler(Looper.getMainLooper())
  private var worker: ScheduledExecutorService? = null
  private var steps: ExecutorService? = null
  private var deadlines: ScheduledExecutorService? = null
  /** When the work last started ([SystemClock.elapsedRealtime]), for the stop line. */
  private var startedAt = 0L
  private val listeners = CopyOnWriteArrayList<() -> Unit>()
  private val ytStreams by lazy { AndroidYtAudioStreams(context) }
  private val ytAudio by lazy { YtAudioDownload(ytStreams) }
  /** Where cancelling a job reaches its YouTube attempt: resolving, pausing or reading. */
  private val ytAttempts = TransferThreads()
  /** Each transfer goes to the source of the job's current candidate: a Soulseek peer or YouTube. */
  val transport = object : DurableTransfer {
    // A YouTube transfer also stops as soon as the journal no longer wants it (`transferWanted`).
    override fun cancel(id: String) { soulseek.client.cancel(id); ytAttempts.cancel(id) }
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> =
      if (candidate["source"] == DurableDownloads.YOUTUBE) fromYoutube(id, candidate, source, progress)
      else fromSoulseek(id, candidate, source, durationMs, progress)
  }

  /**
   * The M4A YouTube serves, saved as it is, then read through to its last sample for its length,
   * which the journal's confirm decision checks against the song's (Core's `ytAudioMatches`) and
   * logs with the video YouTube answered for (Core's `ytDownloadReport`).
   *
   * The attempt goes on from the bytes [source] already holds (an earlier attempt's that broke off
   * or stalled), and leaves what arrived there when it fails or is cancelled: the journal deletes
   * the part file once nothing will go on from it. Cancelling the job ([transport]'s cancel)
   * interrupts the attempt wherever it waits, so the job's next attempt isn't held up behind it.
   * The attempt ends at the `return` (the audio) or one of the `throw`s (what ended it).
   */
  private fun fromYoutube(id: String, candidate: Map<String, Any?>, source: File, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = ytAttempts.run(id) {
    val videoId = candidate["videoId"] as? String ?: throw DurableFailure("failed")
    val cancelled = { Thread.currentThread().isInterrupted || !jobs.transferWanted(id) }
    try {
      source.parentFile?.mkdirs()
      val file = ytAudio.download(videoId, source,
        onProgress = { received, total -> progress(received, total, null); changed() },
        isCancelled = cancelled,
        onResume = { from, total ->
          WaveLog.i(TAG, if (from > 0) "A YouTube transfer goes on from byte $from of $total" else "A YouTube transfer starts over: its part file held another stream")
        },
      )
      val durationMs = AndroidM4aDuration.of(source, cancelled)
      // What YouTube answered with goes along, so the confirm decision logs it beside the lengths.
      mapOf(
        "partPath" to source.path, "bytes" to file.bytes, "mimeType" to file.mimeType, "itag" to file.itag.toLong(),
        "bitrate" to file.bitrate.toLong(), "durationMs" to durationMs, "requested" to videoId,
        "resolved" to file.source.videoId, "client" to file.source.client, "videoType" to file.source.videoType,
        "announcedMs" to file.source.lengthMs,
      )
    } catch (error: InterruptedException) {
      // Cancelled while resolving or pausing.
      throw DurableFailure("cancelled", error)
    } catch (error: YtException) {
      if (cancelled()) throw DurableFailure("cancelled", error)
      val reason = when (YtStreamResolver.failureOf(error)) {
        YtStreamFailure.OFFLINE -> "offline"
        // YT Music was turned off: with Download in best quality off too, there's no source left.
        YtStreamFailure.DISABLED -> "noSource"
        YtStreamFailure.UNAVAILABLE -> "ytUnavailable"
        YtStreamFailure.FAILED -> "failed"
      }
      WaveLog.w(TAG, "A YouTube transfer failed ($reason)")
      throw DurableFailure(reason, error)
    } catch (error: CancellationException) {
      throw DurableFailure("cancelled", error)
    } catch (error: java.io.IOException) {
      if (cancelled()) throw DurableFailure("cancelled", error)
      // The part file couldn't be written, the network went, or YouTube broke off: the journal tries again.
      val folder = source.parentFile
      val reason = when {
        error is java.io.FileNotFoundException || folder == null || !folder.isDirectory || folder.usableSpace < MIN_FREE_BYTES -> "storage"
        !ytStreams.online() -> "offline"
        else -> "failed"
      }
      WaveLog.w(TAG, "A YouTube transfer failed ($reason): ${error.message}")
      throw DurableFailure(reason, error)
    }
  }

  private fun fromSoulseek(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = try {
      soulseek.download(id, SoulseekCandidate.fromJs(candidate), source, durationMs,
        onProgress = { received, total -> progress(received, total, null); changed() },
        onQueued = { place -> progress(0, 0, place); changed() },
        // The journal's start, queue and stall rules bound the wait, even if a cancel goes missing.
        isCancelled = { Thread.currentThread().isInterrupted || !jobs.transferWanted(id) },
      )
    } catch (error: SoulseekException) {
      // Which check a peer's file failed is what tells a strict check from a bad file.
      if (error.failure != SoulseekFailure.CANCELLED) {
        WaveLog.w(TAG, "A Soulseek transfer failed (${error.failure}): ${error.message}; ${error.cause?.message ?: ""}")
      }
      val reason = when (error.failure) {
        SoulseekFailure.SIGNED_OUT -> "account"
        SoulseekFailure.AUTH -> "accountRejected"
        SoulseekFailure.OFFLINE -> "offline"
        SoulseekFailure.UNREACHABLE -> "unreachable"
        SoulseekFailure.STORAGE -> "storage"
        SoulseekFailure.CANCELLED -> "cancelled"
        else -> "unavailable"
      }
      throw DurableFailure(reason, error)
    } catch (error: java.io.IOException) {
      // Only a full or unwritable folder is a storage problem; a broken connection is a source that went away.
      throw DurableFailure(if (DownloadFiles.storageProblem(error, source.parentFile)) "storage" else "unavailable", error)
    }
    catch (error: Exception) { WaveLog.w(TAG, "A Soulseek transfer failed", error); throw error }
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

  /**
   * The lines written about once a minute while the service runs, on a thread of their own (the
   * memory line waits up to half a second for JS's heap). Another line takes the same beat with
   * `minutes.add { WaveLog.i(TAG, …) }` here.
   */
  private val minutes = MinuteLines(SystemClock::elapsedRealtime, every = { period, tick ->
    val ticking = minuteTicker.scheduleWithFixedDelay({ tick() }, period, period, TimeUnit.MILLISECONDS)
    ({ ticking.cancel(false) })
  }).also { minutes ->
    minutes.add { WaveLog.i(TAG, DownloadServiceLines.memory(jobs.counts(), AndroidMemory.read(), JsHeap.app.read())) }
    // What the journal's writes cost since the last line (#452).
    minutes.add { WaveLog.i(TAG, jobs.takeWriteStats().line()) }
  }
  private val minuteTicker by lazy {
    Executors.newSingleThreadScheduledExecutor { tick -> Thread(tick, "WaveDownloadMinutes").apply { isDaemon = true } }
  }

  fun subscribe(listener: () -> Unit): () -> Unit { listeners.add(listener); return { listeners.remove(listener) } }
  /**
   * The journal may have changed. Listeners (JS, which then asks for what changed since its
   * revision) only hear of it when it did, at most every [NOTIFY_MS]: transfer progress arrives
   * per chunk, and the deadline thread and the worker call this twice a second.
   */
  fun changed() = notices.changed()
  private val notices = JournalNotices(
    revision = { jobs.revision }, clock = SystemClock::elapsedRealtime, intervalMs = NOTIFY_MS,
    later = { delay, run -> main.postDelayed(run, delay) },
    notify = { for (listener in listeners) runCatching(listener) },
  )

  /** Called from the user's tap or the resumed Activity. Failure never starts unprotected work. */
  fun requestService() {
    if (!jobs.hasWork()) return
    try { context.startForegroundService(Intent(context, YtDownloadService::class.java)) }
    catch (error: Exception) {
      // Never unprotected work: started jobs fail with Retry; queued ones wait for the next launch.
      if (synchronized(this) { worker == null }) {
        WaveLog.w(TAG, DownloadServiceLines.refused(restart = false, describe(error)))
        jobs.expire(transport, stopAll = true); changed()
      } else WaveLog.w(TAG, "Android refused to start the download service again; it goes on", error)
    }
  }

  /** Starts the work, unless it runs already; [restarted] when Android restarted the service after Wave was closed. */
  @Synchronized fun start(onIdle: () -> Unit, refresh: () -> Unit, restarted: Boolean = false) {
    if (worker != null) return
    WaveLog.i(TAG, DownloadServiceLines.started(restarted, jobs.counts(), AndroidMemory.read()))
    startedAt = SystemClock.elapsedRealtime()
    jobs.startWork()
    minutes.start()
    // The journal's line counts its writes from the service's start.
    jobs.takeWriteStats()
    main.post { JsRuntime.ensureStarted(context, OWNER) }
    deadlines = Executors.newSingleThreadScheduledExecutor().also { executor ->
      // Also refreshes the notification and the rows while transfers go on.
      executor.scheduleWithFixedDelay({ runCatching { jobs.expire(transport); changed(); main.post(refresh) } }, 1, 1, TimeUnit.SECONDS)
    }
    // Each song's transfer, tagging or publication runs on a thread of its own, several songs at once.
    val pool = Executors.newCachedThreadPool().also { steps = it }
    worker = Executors.newSingleThreadScheduledExecutor().also { executor ->
      executor.scheduleWithFixedDelay({
        runCatching {
          jobs.expire(transport)
          while (true) {
            val step = jobs.nextStep(transport, publication) ?: break
            // Stopped meanwhile: the step only lets go of its job.
            try { pool.execute { runCatching(step).onFailure(::workerFailed); changed() } }
            catch (_: RejectedExecutionException) { step() }
          }
        }.onFailure(::workerFailed)
        changed()
        main.post { refresh(); if (!jobs.hasWork()) onIdle() }
      }, 0, 500, TimeUnit.MILLISECONDS)
    }
  }

  /** An unexpected failure (a full disk can't even write the journal) ends the started jobs, never the queue. */
  private fun workerFailed(error: Throwable) {
    WaveLog.w(TAG, "The download worker failed", error)
    runCatching { jobs.expire(transport, true, stopCause = describe(error)) }
  }

  /** Android's time limit stops actual socket work before removing foreground protection. */
  @Synchronized fun stop(why: DownloadServiceStop, timedOut: Boolean = false) {
    if (worker != null) WaveLog.i(TAG, DownloadServiceLines.stopped(why, SystemClock.elapsedRealtime() - startedAt, jobs.counts(), AndroidMemory.read()))
    jobs.stopWork(transport)
    minutes.stop()
    // What waits for its second is written now, off the main thread (a full disk keeps it for the next write).
    journalWriter.execute { runCatching { jobs.flush() } }
    worker?.shutdownNow(); worker = null
    steps?.shutdownNow(); steps = null
    deadlines?.shutdownNow(); deadlines = null
    if (timedOut) Executors.newSingleThreadExecutor().also { executor ->
      executor.execute { try { jobs.expire(transport, true); changed() } finally { executor.shutdown() } }
    }
    main.post { JsRuntime.release(OWNER) }
  }

  /**
   * The cover's image: from the network, or a quality replacement's own cover, the Library's copy
   * of it on the phone (an absolute path).
   */
  private fun cover(url: String): ByteArray {
    if (url.startsWith("/")) {
      val file = File(url)
      check(file.isFile && file.length() in 1..ArtworkStore.MAX_IMAGE_BYTES.toLong())
      return file.readBytes()
    }
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
    /** How often, at most, JS hears that the journal changed. */
    private const val NOTIFY_MS = 500L
    /** Less free space than this beside the part file means the write failed for want of room. */
    private const val MIN_FREE_BYTES = 8L shl 20
    @Volatile private var instance: AndroidDownloads? = null
    fun get(context: Context): AndroidDownloads = instance ?: synchronized(this) { instance ?: AndroidDownloads(context.applicationContext).also { instance = it } }
  }
}
