package expo.modules.wavenative.soulseek

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.account.WaveAccountException
import expo.modules.wavenative.download.AndroidDownloads
import expo.modules.wavenative.download.DurableDownloads
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

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

    // [source] is Core's `downloadSource`: "soulseek", "youtube", or null when there's none.
    // [origin] is Core's `DownloadOrigin` (the playlist, album or mix that asked), null for a song on its own.
    AsyncFunction("enqueueJob") Coroutine { song: Map<String, Any?>, recording: Map<String, Any?>, equivalentId: String?, source: String?, origin: Map<String, Any?>? ->
      withContext(Dispatchers.IO) {
        val id = downloads.jobs.enqueue(song, equivalentId, recording, source, origin)
        downloads.changed(); downloads.requestService(); id
      }
    }
    // Many songs at once (an album, a playlist, a replacement run), in one journal write: each
    // request is `enqueueJob`'s arguments as an object. JSON, as a song's nulls sit a level deeper.
    AsyncFunction("enqueueJobs") Coroutine { requests: String ->
      withContext(Dispatchers.IO) {
        @Suppress("UNCHECKED_CAST")
        val asked = (fromJson(JSONTokener(requests).nextValue()) as? List<Map<String, Any?>> ?: emptyList()).map { request ->
          DurableDownloads.Request(
            song = request["song"] as Map<String, Any?>,
            equivalentId = request["equivalentId"] as String?,
            recording = request["recording"] as? Map<String, Any?> ?: emptyMap(),
            source = request["source"] as String?,
            origin = request["origin"] as Map<String, Any?>?,
          )
        }
        val ids = downloads.jobs.enqueueAll(asked)
        if (ids.isNotEmpty()) { downloads.changed(); downloads.requestService() }
        ids
      }
    }
    AsyncFunction("jobsSnapshot") Coroutine { -> withContext(Dispatchers.IO) { downloads.jobs.snapshot() } }
    // What changed since the revision JS last saw: the rows follow a big queue without copying it whole.
    AsyncFunction("jobsChangedSince") Coroutine { revision: Double ->
      withContext(Dispatchers.IO) { downloads.jobs.changesSince(revision.toLong()).toMap() }
    }
    AsyncFunction("forgetCompletedJob") Coroutine { id: String, generation: Double ->
      withContext(Dispatchers.IO) {
        downloads.jobs.forgetCompleted(id, generation.toLong()).also { if (it) downloads.changed() }
      }
    }
    AsyncFunction("resumeJobs") Coroutine { -> withContext(Dispatchers.IO) { downloads.requestService() } }
    AsyncFunction("claimDecision") Coroutine { id: String -> withContext(Dispatchers.IO) { downloads.jobs.claim(id) } }
    AsyncFunction("renewDecision") Coroutine { id: String, generation: Double, token: String ->
      withContext(Dispatchers.IO) { downloads.jobs.renew(id, generation.toLong(), token) }
    }
    // The payload comes as JSON: Expo can't convert a null inside a nested object (a tag or a
    // candidate's duration), and the answer would never reach the journal.
    AsyncFunction("submitDecision") Coroutine { id: String, generation: Double, token: String, decision: String, payload: String ->
      withContext(Dispatchers.IO) {
        @Suppress("UNCHECKED_CAST")
        val answer = fromJson(JSONTokener(payload).nextValue()) as? Map<String, Any?> ?: return@withContext false
        downloads.jobs.submit(id, generation.toLong(), token, decision, answer).also { downloads.changed() }
      }
    }
    AsyncFunction("refreshDownloadPolicy") Coroutine { roots: List<String>, excluded: List<String> ->
      withContext(Dispatchers.IO) { downloads.jobs.refreshPolicy(roots, excluded) }
    }
    // While YouTube limits downloads (Core's `ytThrottle`): YouTube's jobs wait until [until] (epoch ms).
    AsyncFunction("pauseYoutube") Coroutine { until: Double, level: Double ->
      withContext(Dispatchers.IO) { downloads.pauseYoutube(until.toLong(), level.toLong()) }
    }
    // The pause kept across restarts, or null: what JS's throttle starts from.
    AsyncFunction("youtubePause") Coroutine { ->
      withContext(Dispatchers.IO) { downloads.jobs.youtubePause()?.let { mapOf("until" to it.until.toDouble(), "level" to it.level.toDouble()) } }
    }
    AsyncFunction("cancelJob") Coroutine { id: String -> withContext(Dispatchers.IO) { downloads.jobs.cancel(id, downloads.transport); downloads.changed() } }
    // Settings › Downloads' drag: the waiting jobs [ids] start in this order (Core's `moveQueuedJobs`).
    AsyncFunction("moveQueuedJobs") Coroutine { ids: List<String> -> withContext(Dispatchers.IO) { downloads.jobs.moveQueued(ids); downloads.changed() } }

    AsyncFunction("session") Coroutine { -> coded { withContext(Dispatchers.IO) { owner.client.session() } } }
    // Download in best quality. The account it makes or reuses never leaves native code.
    AsyncFunction("turnOn") Coroutine { ->
      val session = coded { withContext(Dispatchers.IO) { owner.client.turnOn() } }
      sendEvent("onSessionChanged", session)
      session
    }
    AsyncFunction("turnOff") Coroutine { ->
      val session = coded { withContext(Dispatchers.IO) { owner.client.turnOff() } }
      sendEvent("onSessionChanged", session)
      session
    }
    // At sign-in and each pull while signed in: the phone follows the Wave account's Soulseek
    // account, or sends its own up. JS gets the session's status and username, never a password.
    AsyncFunction("followWaveAccount") Coroutine { ->
      val session = coded { withContext(Dispatchers.IO) { owner.client.followWaveAccount() } }
      sendEvent("onSessionChanged", session)
      session
    }
    AsyncFunction("search") Coroutine { query: String ->
      coded { withContext(Dispatchers.IO) { owner.client.search(query).map { it.toMap() } } }
    }
    // The process-owned client and durable downloads can outlive an Expo module.
  }

  /** JSON as Expo hands JS values over: maps, lists, strings, booleans, numbers as Double and nulls. */
  private fun fromJson(value: Any?): Any? = when (value) {
    is JSONObject -> LinkedHashMap<String, Any?>().apply { for (key in value.keys()) put(key, fromJson(value.get(key))) }
    is JSONArray -> List(value.length()) { fromJson(value.get(it)) }
    is Number -> value.toDouble()
    JSONObject.NULL -> null
    else -> value
  }

  private suspend fun <T> coded(block: suspend () -> T): T = try { block() }
  catch (e: SoulseekException) { throw CodedException(e.failure.code, e.failure.notice, e) }
  catch (e: WaveAccountException) { throw CodedException(e.failure.code, e.failure.notice, null) }
  catch (e: CancellationException) { throw CodedException(SoulseekFailure.CANCELLED.code, SoulseekFailure.CANCELLED.notice, e) }
}
