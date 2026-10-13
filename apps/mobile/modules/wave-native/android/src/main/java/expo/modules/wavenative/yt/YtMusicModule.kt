package expo.modules.wavenative.yt

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/**
 * YT Music for JS (`WaveYtMusic`): the switch in Settings, song search and
 * the account. Requests go through the process-wide [YtClient]; failures
 * reject with the codes of [YtFailure]. Nothing returned carries cookies or
 * stream addresses: the account is `{ status, account: { name, email, photoUrl } }`.
 */
class YtMusicModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: YtClient
    get() = YtClient.get(context)

  override fun definition() = ModuleDefinition {
    Name("WaveYtMusic")

    /** The session changed natively: YouTube ended it during a request, say. */
    Events("onSessionChanged")

    // Only while JS listens (Settings is open), so starting Wave doesn't load the session.
    OnStartObserving("onSessionChanged") {
      client.session.onChange = { sendEvent("onSessionChanged", it.toMap()) }
    }

    OnStopObserving("onSessionChanged") {
      client.session.onChange = null
    }

    /** Turns YT Music on or off; off, every request is refused before reaching the network. */
    Function("setEnabled") { on: Boolean -> client.enabled = on }

    Function("isEnabled") { client.enabled }

    /** `{ songs, continuation }` for [query], or a rejection with an `ERR_YT_*` code. */
    AsyncFunction("searchSongs") Coroutine { query: String ->
      coded { client.searchSongs(query).toMap() }
    }

    /** The saved session, without asking YouTube. */
    AsyncFunction("session") Coroutine { ->
      withContext(Dispatchers.IO) { client.session.state.toMap() }
    }

    /** The session after asking YouTube whose it is: refreshed, expired, or as it was without an answer. */
    AsyncFunction("checkSession") Coroutine { ->
      client.checkSession().toMap()
    }

    /**
     * Opens Google's sign-in page; resolves the session once it's signed in,
     * or null when the owner backs out. A session YouTube doesn't confirm
     * rejects with an `ERR_YT_*` code.
     */
    AsyncFunction("signIn") Coroutine { ->
      if (!client.enabled) throw CodedException(YtFailure.DISABLED.code, "YT Music is off", null)
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val credentials = YtSignInActivity.signIn(activity) ?: return@Coroutine null
      coded { client.signIn(credentials).toMap() }
    }

    /** Forgets the session and everything the sign-in web view kept. */
    AsyncFunction("signOut") Coroutine { ->
      withContext(Dispatchers.IO) { client.session.signOut() }
      withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { done -> YtSignInActivity.clearWebData { done.resume(Unit) } }
      }
      client.session.state.toMap()
    }
  }

  private suspend fun <T> coded(block: suspend () -> T): T =
    try {
      block()
    } catch (e: YtException) {
      throw CodedException(e.failure.code, e.message, e.cause)
    }
}
