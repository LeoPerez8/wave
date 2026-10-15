package expo.modules.wavenative.account

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Settings › Wave Account and the sync service, for JS. The session token stays here: JS gets
 * the session's account and the service's answers, never the token. Failures reject with an
 * `ERR_WAVE_*` code.
 */
class WaveAccountModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val owner: AndroidWaveAccount get() = AndroidWaveAccount.get(context)
  private var unsubscribe: (() -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("WaveAccount")
    Events("onSessionChanged")
    OnCreate { unsubscribe = owner.client.subscribe { sendEvent("onSessionChanged", it.toMap()) } }
    OnDestroy { unsubscribe?.invoke(); unsubscribe = null }

    AsyncFunction("session") Coroutine { -> withContext(Dispatchers.IO) { owner.client.session().toMap() } }

    /**
     * Opens Google's account picker for an ID token for [webClientId] and trades it for a session
     * with the service at [serviceUrl]. Null when the owner backs out: nothing was sent.
     * Offline, it says so before the picker opens.
     */
    AsyncFunction("signIn") Coroutine { serviceUrl: String, webClientId: String ->
      coded {
        if (!owner.connectivity.online()) throw WaveAccountException(WaveAccountFailure.OFFLINE)
        val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
        val identity = GoogleSignIn.pick(activity, webClientId) ?: return@coded null
        withContext(Dispatchers.IO) { owner.client.signIn(serviceUrl, identity).toMap() }
      }
    }

    AsyncFunction("signOut") Coroutine { -> coded { withContext(Dispatchers.IO) { owner.client.signOut().toMap() } } }

    AsyncFunction("deleteAccount") Coroutine { -> coded { withContext(Dispatchers.IO) { owner.client.deleteAccount().toMap() } } }

    /** `POST /v1/push` or `GET /v1/pull?since=…` with the session; `{ status, body }`. */
    AsyncFunction("request") Coroutine { method: String, path: String, body: String? ->
      coded { withContext(Dispatchers.IO) { owner.client.request(method, path, body).toMap() } }
    }
  }

  private suspend fun <T> coded(block: suspend () -> T): T = try { block() }
  catch (e: WaveAccountException) { throw CodedException(e.failure.code, e.failure.notice, null) }
}
