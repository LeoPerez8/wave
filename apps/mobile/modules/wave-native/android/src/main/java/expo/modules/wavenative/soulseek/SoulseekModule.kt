package expo.modules.wavenative.soulseek

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.download.AndroidDownloads
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The Soulseek session and search, and the bridge to the native download journal (`AndroidDownloads`). */
class SoulseekModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val owner: AndroidSoulseek get() = AndroidSoulseek.get(context)
  private val downloads: AndroidDownloads get() = AndroidDownloads.get(context)
  private var detachDownloads: (() -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("WaveSoulseek")
    Events("onSessionChanged", "onJobsChanged")
    OnCreate { detachDownloads = downloads.subscribe { sendEvent("onJobsChanged", emptyMap<String, Any>()) } }
    OnDestroy { detachDownloads?.invoke(); detachDownloads = null }

    AsyncFunction("enqueueJob") Coroutine { song: Map<String, Any?>, recording: Map<String, Any?>, equivalentId: String? ->
      withContext(Dispatchers.IO) {
        val id = downloads.jobs.enqueue(song, equivalentId, recording)
        downloads.changed(); downloads.requestService(); id
      }
    }
    AsyncFunction("jobsSnapshot") Coroutine { -> withContext(Dispatchers.IO) { downloads.jobs.snapshot() } }
    AsyncFunction("resumeJobs") Coroutine { -> withContext(Dispatchers.IO) { downloads.requestService() } }
    AsyncFunction("claimDecision") Coroutine { id: String -> withContext(Dispatchers.IO) { downloads.jobs.claim(id) } }
    AsyncFunction("submitDecision") Coroutine { id: String, generation: Double, token: String, decision: String, payload: Map<String, Any?> ->
      withContext(Dispatchers.IO) { downloads.jobs.submit(id, generation.toLong(), token, decision, payload).also { downloads.changed() } }
    }
    AsyncFunction("refreshDownloadPolicy") Coroutine { roots: List<String>, excluded: List<String> ->
      withContext(Dispatchers.IO) { downloads.jobs.refreshPolicy(roots, excluded) }
    }
    AsyncFunction("cancelJob") Coroutine { id: String -> withContext(Dispatchers.IO) { downloads.jobs.cancel(id, downloads.transport); downloads.changed() } }

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
    // The process-owned client and durable downloads can outlive an Expo module.
  }

  private suspend fun <T> coded(block: suspend () -> T): T = try { block() }
  catch (e: SoulseekException) { throw CodedException(e.failure.code, e.failure.notice, e) }
  catch (e: CancellationException) { throw CodedException(SoulseekFailure.CANCELLED.code, SoulseekFailure.CANCELLED.notice, e) }
}
