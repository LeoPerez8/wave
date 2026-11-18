package dev.leoperez.wave.stdio

import expo.modules.wavenative.download.BackgroundThreads
import expo.modules.wavenative.download.DownloadFiles
import expo.modules.wavenative.download.DurableDownloads
import expo.modules.wavenative.download.DurableFailure
import expo.modules.wavenative.download.DurablePublication
import expo.modules.wavenative.download.DurableTransfer
import expo.modules.wavenative.download.JournalNotices
import expo.modules.wavenative.download.TransferThreads
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.secrets.SecretCipher
import expo.modules.wavenative.soulseek.SoulseekCandidate
import expo.modules.wavenative.soulseek.SoulseekClient
import expo.modules.wavenative.soulseek.SoulseekException
import expo.modules.wavenative.soulseek.SoulseekFailure
import expo.modules.wavenative.soulseek.SoulseekSessionStore
import expo.modules.wavenative.soulseek.SoulseekSwitchFile
import expo.modules.wavenative.tags.DownloadTagWriter
import expo.modules.wavenative.tags.DownloadTags
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.yt.YtAudioDownload
import expo.modules.wavenative.yt.YtAudioStreams
import expo.modules.wavenative.yt.YtClient
import expo.modules.wavenative.yt.YtException
import expo.modules.wavenative.yt.YtStreamFailure
import expo.modules.wavenative.yt.YtStreamResolver
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey

/**
 * The desktop twin of the phone's `AndroidDownloads` and `AndroidSoulseek`: the shared download
 * journal ([jobs]) in Wave's data folder, worked by threads of its own while the host keeps it
 * started ([start], [stop]: the host stops it offline), and the Soulseek client. JS makes the
 * journal's decisions, as on the phone; the host hears `downloadsChanged` (with the revision) at
 * most every [NOTIFY_MS] when the journal changed, and asks what changed since.
 *
 * The Soulseek account is sealed by the host (Electron's `safeStorage`), as the phone's Keystore
 * does: `seal`/`unseal` `{data}` (base64). It never leaves the JVM unsealed.
 */
class DesktopDownloads(
  private val host: JsonLines,
  dataDir: File,
  private val yt: YtClient,
  private val online: () -> Boolean,
  audioStreams: YtAudioStreams,
) : Closeable {
  private val journalWriter = Executors.newSingleThreadScheduledExecutor(BackgroundThreads("Wave download journal", daemon = true, lower = {}))
  private val noticeTimer = Executors.newSingleThreadScheduledExecutor(BackgroundThreads("Wave download notices", daemon = true, lower = {}))
  val jobs = DurableDownloads(
    File(dataDir, "download-jobs-v1"),
    log = { WaveLog.w(TAG, it) },
    note = { WaveLog.i(TAG, it) },
    budgetRunning = false,
    later = { delay, run -> journalWriter.schedule(run, delay, TimeUnit.MILLISECONDS) },
  )
  private val soulseekLazy = lazy {
    SoulseekClient(
      credentialsStore = SoulseekSessionStore(File(dataDir, "soulseek-session"), HostCipher(host)),
      online = online,
      switch = SoulseekSwitchFile(File(dataDir, "soulseek-best-quality")),
    )
  }
  val soulseek: SoulseekClient by soulseekLazy
  private val ytAudio = YtAudioDownload(audioStreams)
  private val ytAttempts = TransferThreads()
  private var worker: ScheduledExecutorService? = null
  private var steps: ExecutorService? = null
  private var deadlines: ScheduledExecutorService? = null

  private val notices = JournalNotices(
    revision = { jobs.revision }, clock = System::currentTimeMillis, intervalMs = NOTIFY_MS,
    later = { delay, run -> runCatching { noticeTimer.schedule(run, delay, TimeUnit.MILLISECONDS) } },
    notify = { runCatching { host.event("downloadsChanged", buildJsonObject { put("revision", jobs.revision) }) } },
  )

  /** The journal may have changed: the host hears of it when it did. */
  fun changed() = notices.changed()

  /** Each transfer goes to the source of the job's current candidate: a Soulseek peer or YouTube. */
  val transport = object : DurableTransfer {
    override fun cancel(id: String) {
      if (soulseekLazy.isInitialized()) soulseek.cancel(id)
      ytAttempts.cancel(id)
    }
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> =
      if (candidate["source"] == DurableDownloads.YOUTUBE) fromYoutube(id, candidate, source, progress)
      else fromSoulseek(id, candidate, source, durationMs, progress)
  }

  /** The phone's `AndroidDownloads.fromYoutube`: the M4A as served, measured to its last sample. */
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
      val durationMs = Mp4Length.of(source, cancelled)
      mapOf(
        "partPath" to source.path, "bytes" to file.bytes, "mimeType" to file.mimeType, "itag" to file.itag.toLong(),
        "bitrate" to file.bitrate.toLong(), "durationMs" to durationMs, "requested" to videoId,
        "resolved" to file.source.videoId, "client" to file.source.client, "videoType" to file.source.videoType,
        "announcedMs" to file.source.lengthMs,
      )
    } catch (error: InterruptedException) {
      throw DurableFailure("cancelled", error)
    } catch (error: YtException) {
      if (cancelled()) throw DurableFailure("cancelled", error)
      val failure = YtStreamResolver.failureOf(error)
      val reason = when {
        failure == YtStreamFailure.OFFLINE || !online() -> "offline"
        failure == YtStreamFailure.DISABLED -> "noSource"
        failure == YtStreamFailure.UNAVAILABLE && YtStreamResolver.refused(error) -> "ytRefused"
        failure == YtStreamFailure.UNAVAILABLE -> "ytUnavailable"
        else -> "failed"
      }
      throw DurableFailure(reason, error)
    } catch (error: CancellationException) {
      throw DurableFailure("cancelled", error)
    } catch (error: IOException) {
      if (cancelled()) throw DurableFailure("cancelled", error)
      val folder = source.parentFile
      val reason = when {
        error is FileNotFoundException || folder == null || !folder.isDirectory || folder.usableSpace < MIN_FREE_BYTES -> "storage"
        !online() -> "offline"
        else -> "failed"
      }
      WaveLog.w(TAG, "A YouTube transfer failed ($reason): ${error.message}")
      throw DurableFailure(reason, error)
    }
  }

  /** The phone's `AndroidDownloads.fromSoulseek` with `AndroidSoulseek.download`'s received tags. */
  private fun fromSoulseek(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = try {
    try {
      val verified = soulseek.download(id, SoulseekCandidate.fromJs(candidate), source, durationMs,
        onProgress = { received, total -> progress(received, total, null); changed() },
        onQueued = { place -> progress(0, 0, place); changed() },
        isCancelled = { Thread.currentThread().isInterrupted || !jobs.transferWanted(id) },
      )
      JAudioTaggerReader.configure()
      val tag = AudioFileIO.read(source).tag
      fun text(key: FieldKey): String? = tag?.getFirst(key)?.takeIf { it.isNotBlank() }
      verified.toMap() + mapOf(
        "partPath" to source.path,
        "receivedTags" to mapOf("title" to text(FieldKey.TITLE), "artist" to text(FieldKey.ARTIST), "album" to text(FieldKey.ALBUM)),
      )
    } catch (error: Exception) { source.delete(); throw error }
  } catch (error: SoulseekException) {
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
  } catch (error: IOException) {
    throw DurableFailure(if (DownloadFiles.storageProblem(error, source.parentFile)) "storage" else "unavailable", error)
  } catch (error: org.jaudiotagger.audio.exceptions.CannotReadException) {
    throw DurableFailure("unavailable", error)
  }

  /** Tags the file with the cover; JS imports it into the Library itself (`saved.path`). */
  private val publication = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>): String? {
      val fields = DownloadTags.fromJs(tags) ?: throw IOException("Invalid download tags")
      val cover = (tags["artworkUrl"] as? String)?.let { runCatching { cover(it) }.getOrNull() }
      return DownloadTagWriter().write(source, fields, cover)
    }
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path)
  }

  /** YouTube's jobs wait until [until] (epoch ms), as JS decided (Core's `ytThrottle`). */
  suspend fun pauseYoutube(until: Long, level: Long) {
    val now = System.currentTimeMillis()
    if (until > now && jobs.youtubePause()?.until != until) {
      runCatching { yt.streams.renewSession() }
      WaveLog.w(TAG, "YouTube downloads paused for ${(until - now) / 1000} s: YouTube is limiting them (burst $level)")
    }
    jobs.pauseYoutube(until, level)
    changed()
  }

  /** Starts the work, unless it runs already. */
  @Synchronized fun start() {
    if (worker != null) return
    jobs.startWork()
    deadlines = Executors.newSingleThreadScheduledExecutor(BackgroundThreads("Wave download deadlines", daemon = true, lower = {})).also { executor ->
      executor.scheduleWithFixedDelay({ runCatching { jobs.expire(transport); changed() } }, 1, 1, TimeUnit.SECONDS)
    }
    val pool = Executors.newCachedThreadPool(BackgroundThreads("Wave download step", daemon = true, lower = {})).also { steps = it }
    worker = Executors.newSingleThreadScheduledExecutor(BackgroundThreads("Wave download worker", daemon = true, lower = {})).also { executor ->
      executor.scheduleWithFixedDelay({
        runCatching {
          jobs.expire(transport)
          while (true) {
            val step = jobs.nextStep(transport, publication) ?: break
            try { pool.execute { runCatching(step).onFailure(::workerFailed); changed() } }
            catch (_: RejectedExecutionException) { step() }
          }
        }.onFailure(::workerFailed)
        changed()
      }, 0, 500, TimeUnit.MILLISECONDS)
    }
  }

  private fun workerFailed(error: Throwable) {
    WaveLog.w(TAG, "The download worker failed", error)
    runCatching { jobs.expire(transport, true, stopCause = error.javaClass.simpleName) }
  }

  /** Stops the work (offline, or quitting): started songs go back in line for the next [start]. */
  @Synchronized fun stop() {
    jobs.stopWork(transport)
    journalWriter.execute { runCatching { jobs.flush() } }
    worker?.shutdownNow(); worker = null
    steps?.shutdownNow(); steps = null
    deadlines?.shutdownNow(); deadlines = null
    changed()
  }

  val running: Boolean @Synchronized get() = worker != null

  override fun close() {
    stop()
    runCatching { jobs.flush() }
    if (soulseekLazy.isInitialized()) runCatching { soulseek.close() }
    journalWriter.shutdown()
    noticeTimer.shutdownNow()
  }

  /** The cover's image: from the network, or a local file (a replacement's own cover). */
  private fun cover(url: String): ByteArray {
    val local = File(url)
    if (local.isAbsolute) {
      check(local.isFile && local.length() in 1..MAX_IMAGE_BYTES)
      return local.readBytes()
    }
    val connection = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 2_000; readTimeout = 2_000 }
    try {
      check(connection.responseCode == 200)
      return connection.inputStream.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (output.size() <= MAX_IMAGE_BYTES) { val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count) }
        output.toByteArray().also { check(it.isNotEmpty() && it.size <= MAX_IMAGE_BYTES) }
      }
    } finally { connection.disconnect() }
  }

  /** Seals the Soulseek account with the host's keyring (Electron's `safeStorage`). */
  private class HostCipher(private val host: JsonLines) : SecretCipher {
    override fun encrypt(value: ByteArray) = ask("seal", value)
    override fun decrypt(value: ByteArray) = ask("unseal", value)
    private fun ask(method: String, value: ByteArray): ByteArray = runBlocking {
      val answer = host.ask(method, buildJsonObject { put("data", Base64.getEncoder().encodeToString(value)) })
      Base64.getDecoder().decode(answer.jsonObject["data"]!!.jsonPrimitive.content)
    }
  }

  companion object {
    private const val TAG = "WaveDownloads"
    const val NOTIFY_MS = 500L
    private const val MIN_FREE_BYTES = 8L shl 20
    private const val MAX_IMAGE_BYTES = 8L shl 20
  }
}

/** A JSON value as the phone's module hands Kotlin JS's values: maps, lists, strings, booleans, numbers as Double, nulls. */
fun plainOf(value: kotlinx.serialization.json.JsonElement): Any? = when (value) {
  is kotlinx.serialization.json.JsonNull -> null
  is JsonObject -> LinkedHashMap<String, Any?>().apply { for ((key, item) in value) put(key, plainOf(item)) }
  is kotlinx.serialization.json.JsonArray -> value.map(::plainOf)
  is JsonPrimitive -> when {
    value.isString -> value.content
    value.content == "true" -> true
    value.content == "false" -> false
    else -> value.content.toDouble()
  }
}
