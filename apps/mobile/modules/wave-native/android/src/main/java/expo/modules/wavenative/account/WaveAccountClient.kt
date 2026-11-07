package expo.modules.wavenative.account

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

enum class WaveAccountFailure(val code: String, val notice: String) {
  /** The phone is offline: nothing changed. */
  OFFLINE("ERR_WAVE_OFFLINE", "Couldn't reach Wave's server without a connection"),
  /** The phone is online but the service didn't answer, or answered with a server error. */
  UNREACHABLE("ERR_WAVE_UNREACHABLE", "Wave's server didn't answer. Try again later"),
  /** The service didn't accept Google's ID token. */
  REJECTED("ERR_WAVE_REJECTED", "Wave's server didn't accept the Google sign-in"),
  /** The service's allowlist leaves this Google account out. */
  NOT_ALLOWED("ERR_WAVE_NOT_ALLOWED", "This Google account can't use Wave's server"),
  /** There's no session to send the request with; nothing was sent. */
  SIGNED_OUT("ERR_WAVE_SIGNED_OUT", "Not signed in to a Wave account"),
  /** The service stopped accepting the session (a 401): the app is signed out. */
  SESSION_ENDED("ERR_WAVE_SESSION_ENDED", "Your Wave session ended. Sign in again"),
  /** JS asked for a route it may not send to (the Soulseek account, sessions, the account). */
  FORBIDDEN_REQUEST("ERR_WAVE_FORBIDDEN_REQUEST", "That request isn't allowed"),
  /** The phone has no Google account to sign in with. */
  NO_GOOGLE_ACCOUNT("ERR_WAVE_NO_GOOGLE_ACCOUNT", "Add a Google account to this phone to sign in"),
  /** Google's sign-in failed. */
  GOOGLE("ERR_WAVE_GOOGLE", "Google's sign-in didn't work. Try again"),
  /** The service didn't take Google's fresh sign-in as this account's (another Google account): nothing was deleted. */
  GOOGLE_NOT_CONFIRMED("ERR_WAVE_GOOGLE_NOT_CONFIRMED", "Google didn't confirm this Wave account"),
}

class WaveAccountException(val failure: WaveAccountFailure, cause: Throwable? = null) : IOException(failure.notice, cause)

/** What Google's account picker answered: the ID token for Wave's web client and who it's for. */
data class GoogleIdentity(val idToken: String, val email: String?, val name: String?, val photoUrl: String?) {
  override fun toString() = "GoogleIdentity(email=$email, name=$name)"
}

/** The service's answer to an authenticated request. */
data class WaveResponse(val status: Int, val body: String) {
  fun toMap(): Map<String, Any?> = mapOf("status" to status, "body" to body)
}

/**
 * Wave's side of the sync service: signs in with a Google ID token, holds the session token it
 * answers (in [store], never handed to JS) and sends requests with it. Signed out, it sends
 * nothing. A 401 to the session ends it: the app is signed out and [subscribe]rs hear so.
 */
class WaveAccountClient(
  private val store: WaveAccountStore,
  private val online: () -> Boolean,
  private val timeoutMs: Int = 20_000,
) {
  private val listeners = CopyOnWriteArrayList<(WaveSessionState) -> Unit>()

  fun session(): WaveSessionState = store.load()

  /** Hears every change of session: sign-in, sign-out, deletion and the service ending it. */
  fun subscribe(listener: (WaveSessionState) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  /** Trades Google's ID token for a session with the service at [serviceUrl], and keeps it. */
  fun signIn(serviceUrl: String, identity: GoogleIdentity): WaveSessionState {
    val body = buildJsonObject { put("idToken", identity.idToken) }.toString()
    val response = exchange("POST", serviceUrl.trimEnd('/') + "/v1/session", null, body)
    when {
      response.status == 403 -> throw WaveAccountException(WaveAccountFailure.NOT_ALLOWED)
      response.status in 400..499 -> throw WaveAccountException(WaveAccountFailure.REJECTED)
      response.status !in 200..299 -> throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    }
    val answer = runCatching { Json.parseToJsonElement(response.body) as JsonObject }.getOrNull()
    val token = answer?.text("sessionToken")?.takeIf(String::isNotBlank)
      ?: throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    val email = answer.text("email") ?: identity.email ?: throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    val session = WaveSessionState.SignedIn(serviceUrl.trimEnd('/'), token, WaveAccountInfo(email, identity.name, identity.photoUrl))
    change(session)
    return session
  }

  /** Ends the session on the service when it can, and forgets it on the phone either way. */
  fun signOut(): WaveSessionState {
    val session = store.load()
    if (session is WaveSessionState.SignedIn)
      runCatching { exchange("DELETE", session.serviceUrl + "/v1/session", session.token, null) }
    change(WaveSessionState.SignedOut)
    return WaveSessionState.SignedOut
  }

  /**
   * Deletes the account and everything the service has of it, then signs out; the phone keeps its
   * own. The service needs [identity], a fresh Google sign-in to the account's own Google account,
   * besides the session; one it doesn't take keeps the account and the session.
   */
  fun deleteAccount(identity: GoogleIdentity): WaveSessionState {
    val body = buildJsonObject { put("idToken", identity.idToken) }.toString()
    val response = sendEndingOnly("DELETE", "/v1/account", body) ?: return store.load()
    if (response.status == 401) throw WaveAccountException(WaveAccountFailure.GOOGLE_NOT_CONFIRMED)
    if (response.status !in 200..299) throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    change(WaveSessionState.SignedOut)
    return WaveSessionState.SignedOut
  }

  /** Ends every session of the account on the service, this phone's too, then signs out. */
  fun signOutEverywhere(): WaveSessionState {
    val response = sendEndingOnly("DELETE", "/v1/sessions", null) ?: return store.load()
    if (response.status !in 200..299) throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    change(WaveSessionState.SignedOut)
    return WaveSessionState.SignedOut
  }

  /** [send], but null when the service had already ended the session (the app now shows it ended). */
  private fun sendEndingOnly(method: String, path: String, body: String?): WaveResponse? =
    try { send(method, path, body) }
    catch (e: WaveAccountException) {
      if (e.failure == WaveAccountFailure.SESSION_ENDED) null else throw e
    }

  /**
   * A request JS sends with the session it can't see: only a push (`POST /v1/push`) or a pull
   * (`GET /v1/pull`). The Soulseek account and sessions go between native code and the service.
   */
  fun request(method: String, path: String, body: String?): WaveResponse {
    val allowed = (method == "POST" && path == "/v1/push") || (method == "GET" && PULL.matches(path))
    if (!allowed) throw WaveAccountException(WaveAccountFailure.FORBIDDEN_REQUEST)
    return send(method, path, body)
  }

  /**
   * Sends [body] (JSON) to [path] on the service with the session. Answers whatever the service
   * did, but a 401 for the session, which ends it. A 401 for an ID token (Delete Account's fresh
   * Google sign-in) is the token's refusal and comes back like any other answer.
   */
  fun send(method: String, path: String, body: String?): WaveResponse {
    if (!path.startsWith("/v1/") || ".." in path || "//" in path) throw WaveAccountException(WaveAccountFailure.FORBIDDEN_REQUEST)
    val session = store.load() as? WaveSessionState.SignedIn ?: throw WaveAccountException(WaveAccountFailure.SIGNED_OUT)
    val response = exchange(method, session.serviceUrl + path, session.token, body)
    if (response.status == 401 && !refusesIdToken(response)) {
      end(session)
      throw WaveAccountException(WaveAccountFailure.SESSION_ENDED)
    }
    return response
  }

  /** Ends [session] if it's still the phone's: a sign-out and sign-in meanwhile keeps the new one. */
  private fun end(session: WaveSessionState.SignedIn) {
    val ended = synchronized(this) {
      val current = store.load()
      if (current !is WaveSessionState.SignedIn || current.token != session.token) return
      WaveSessionState.Ended(current.account).also(store::save)
    }
    listeners.forEach { it(ended) }
  }

  private fun change(session: WaveSessionState) {
    synchronized(this) { store.save(session) }
    listeners.forEach { it(session) }
  }

  private fun exchange(method: String, url: String, token: String?, body: String?): WaveResponse {
    val connection = try { URL(url).openConnection() as HttpURLConnection }
    catch (e: Exception) { throw WaveAccountException(WaveAccountFailure.UNREACHABLE, e) }
    try {
      connection.requestMethod = method
      connection.connectTimeout = timeoutMs
      connection.readTimeout = timeoutMs
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.setRequestProperty("Accept", "application/json")
      if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
      if (body != null) {
        val bytes = body.encodeToByteArray()
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setFixedLengthStreamingMode(bytes.size)
        connection.outputStream.use { it.write(bytes) }
      }
      val status = connection.responseCode
      val stream = if (status >= 400) connection.errorStream else connection.inputStream
      return WaveResponse(status, stream?.use { it.readBytes().decodeToString() } ?: "")
    } catch (e: IOException) {
      throw WaveAccountException(if (online()) WaveAccountFailure.UNREACHABLE else WaveAccountFailure.OFFLINE, e)
    } finally { connection.disconnect() }
  }

  private fun refusesIdToken(response: WaveResponse): Boolean {
    val answer = runCatching { Json.parseToJsonElement(response.body) as JsonObject }.getOrNull()
    return answer?.text("error") in ID_TOKEN_REFUSALS
  }

  private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

  private companion object {
    val ID_TOKEN_REFUSALS = setOf("invalid_id_token", "id_token_required")
    val PULL = Regex("""^/v1/pull(\?since=[0-9A-Za-z_-]*)?$""")
  }
}
