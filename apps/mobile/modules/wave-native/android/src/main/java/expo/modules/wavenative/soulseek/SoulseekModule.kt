package expo.modules.wavenative.soulseek

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.download.DownloadFiles
import expo.modules.wavenative.yt.YtDownloadNotice
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext

/** Acquisition only. Existing WaveYtDownloads still owns metadata pages, tagging and scanner import. */
class SoulseekModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val owner: AndroidSoulseek get() = AndroidSoulseek.get(context)
  private val running = ConcurrentHashMap<String, Job>()

  override fun definition() = ModuleDefinition {
    Name("WaveSoulseek")
    Events("onDownloadProgress", "onSessionChanged")

    AsyncFunction("session") Coroutine { -> coded { withContext(Dispatchers.IO) { owner.client.session() } } }
    AsyncFunction("connect") Coroutine { username: String, password: String ->
      val session = coded { withContext(Dispatchers.IO) { owner.client.connect(username, password) } }
      sendEvent("onSessionChanged", session)
      session
    }
    AsyncFunction("disconnect") Coroutine { ->
      val session = coded { withContext(Dispatchers.IO) { owner.client.disconnect() } }
      sendEvent("onSessionChanged", session)
      session
    }
    AsyncFunction("search") Coroutine { query: String ->
      coded { withContext(Dispatchers.IO) { owner.client.search(query).map { it.toMap() } } }
    }
    AsyncFunction("downloadAudio") Coroutine {
        videoId: String, candidate: Map<String, Any?>, targetPath: String, title: String, expectedDurationMs: Double ->
      val target = File(targetPath)
      if (!target.extension.equals("mp3", true)) throw CodedException(SoulseekFailure.INVALID_AUDIO.code, "MP3 target required", null)
      val part = DownloadFiles.partFileFor(target)
      val job = Job()
      running.put(videoId, job)?.let { it.cancel(); owner.client.cancel(videoId) }
      YtDownloadNotice.start(context, videoId, title)
      var downloaded = false
      try {
        val result = coded {
          withContext(job + Dispatchers.IO) {
            var lastSentAt = 0L
            owner.download(
              videoId, SoulseekCandidate.fromJs(candidate), part, expectedDurationMs.toLong(),
              onProgress = { received, total ->
                YtDownloadNotice.progress(videoId, received, total)
                val now = System.currentTimeMillis()
                if (now - lastSentAt >= 250 || received == total) {
                  lastSentAt = now
                  sendEvent("onDownloadProgress", mapOf("videoId" to videoId, "phase" to "transferring", "received" to received.toDouble(), "total" to total.toDouble()))
                }
              },
              onQueued = { place ->
                sendEvent("onDownloadProgress", mapOf("videoId" to videoId, "phase" to "queued", "queuePosition" to place.toDouble(), "received" to 0.0, "total" to 0.0))
              },
              isCancelled = { !job.isActive },
            )
          }
        }
        downloaded = true
        result
      } finally {
        running.remove(videoId, job)
        job.complete()
        if (!downloaded) { part.delete(); YtDownloadNotice.finish(videoId) }
      }
    }

    Function("cancelDownload") { videoId: String -> running[videoId]?.cancel(); owner.client.cancel(videoId) }
    // The process-owned client and durable downloads can outlive an Expo module.
  }

  private suspend fun <T> coded(block: suspend () -> T): T = try { block() }
  catch (e: SoulseekException) { throw CodedException(e.failure.code, e.failure.notice, e) }
  catch (e: CancellationException) { throw CodedException(SoulseekFailure.CANCELLED.code, SoulseekFailure.CANCELLED.notice, e) }
}
