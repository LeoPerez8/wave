package expo.modules.wavenative.spotify

import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URLEncoder
import java.net.UnknownHostException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * Why a Spotify request didn't work, as JS sees it (a rejection code): no
 * network, Spotify failed or answered something unreadable, there's no
 * session Spotify accepts, or Spotify changed its web player so Wave needs
 * an update (the session is kept for then).
 */
enum class SpotifyFailure(val code: String) {
  OFFLINE("ERR_SPOTIFY_OFFLINE"),
  FAILED("ERR_SPOTIFY_FAILED"),
  SIGNED_OUT("ERR_SPOTIFY_SIGNED_OUT"),
  CHANGED("ERR_SPOTIFY_CHANGED"),
}

class SpotifyException(val failure: SpotifyFailure, cause: Throwable? = null) :
  Exception("Spotify request failed: ${failure.name.lowercase()}", cause)

/** One HTTP request to Spotify. [toString] leaves the headers (the cookie, the token) out. */
data class SpotifyRequest(val method: String, val url: String, val headers: Map<String, String>, val body: String? = null) {
  override fun toString(): String = "SpotifyRequest($method ${url.substringBefore('?')})"
}

data class SpotifyResponse(val status: Int, val body: String)

/** Sends a request and answers its status and body (blocking: [SpotifyClient] calls it off the main thread). */
fun interface SpotifyHttp {
  fun send(request: SpotifyRequest): SpotifyResponse
}

/** A web-player GraphQL operation and its persisted-query hash. */
data class SpotifyOperation(val name: String, val hash: String) {
  companion object {
    /** The signed-in account's name, photo and username. */
    val PROFILE = SpotifyOperation("profileAttributes", "08ffb4730af3746e04a8301396f20875dbbce10c75243803091a9274eacc8ac0")
  }
}

/**
 * Wave's connection to Spotify's web-player endpoints (docs/spotify-account.md),
 * as the signed-in account in [session]. It turns the `sp_dc` cookie into
 * access tokens (with the web player's TOTP), keeps the current one in memory
 * only, and sends GraphQL queries with it. Nothing it hands out carries the
 * cookie or a token.
 *
 * - A 401 from `/api/token` means Spotify no longer accepts the cookie: the
 *   session expires, once, and later requests are refused without sending.
 * - A refused TOTP (400), a stale TOTP version or an unknown query hash (412)
 *   means Spotify changed its web player: the secret and hashes are read again
 *   from the live bundle, once per run, before failing with
 *   [SpotifyFailure.CHANGED]. The session stays.
 * - A 401 to a token gets one new token.
 */
class SpotifyClient(
  val session: SpotifySession,
  private val http: SpotifyHttp,
  private val clock: () -> Long = System::currentTimeMillis,
  private val hasNetwork: () -> Boolean = { true },
  private val online: () -> Boolean = { true },
) {
  private class Cached(val credentials: SpotifyCredentials, val token: SpotifyToken)

  @Volatile private var cached: Cached? = null
  @Volatile private var secret = SpotifySecret.SHIPPED
  private val hashes = mutableMapOf<String, String>()
  @Volatile private var bundle: String? = null
  @Volatile private var bundleRead = false

  /**
   * Signs in with [credentials] from the sign-in page, once Spotify hands out
   * a signed-in token for them and names the account. A cookie it doesn't
   * accept fails ([SpotifyFailure.FAILED]).
   */
  suspend fun signIn(credentials: SpotifyCredentials): SpotifySessionState = request {
    val token = try {
      token(credentials)
    } catch (_: Rejected) {
      throw SpotifyException(SpotifyFailure.FAILED)
    }
    val account = SpotifyAccountInfo.fromProfile(send(token, SpotifyOperation.PROFILE, EMPTY))
      ?: throw SpotifyException(SpotifyFailure.FAILED)
    session.signedIn(credentials, account)
    session.state
  }

  /**
   * Asks Spotify whose account the session is: picks up a new name or photo,
   * or finds it expired. Without an answer the session stays as it was.
   */
  suspend fun checkSession(): SpotifySessionState {
    val current = session.state as? SpotifySessionState.SignedIn ?: return session.state
    try {
      val account = SpotifyAccountInfo.fromProfile(query(SpotifyOperation.PROFILE, EMPTY))
      if (account != null) session.checked(current.credentials, account)
    } catch (_: SpotifyException) {
      // No answer says nothing more about the session.
    }
    return session.state
  }

  /**
   * Sends the GraphQL [operation] with [variables] as the signed-in account and
   * answers its `data`. Rejects with [SpotifyFailure.SIGNED_OUT] without a
   * session Spotify accepts (#486 and #487 read and write through this).
   */
  suspend fun query(operation: SpotifyOperation, variables: JsonObject): JsonObject = request {
    val current = session.state as? SpotifySessionState.SignedIn ?: throw SpotifyException(SpotifyFailure.SIGNED_OUT)
    val token = try {
      token(current.credentials)
    } catch (_: Rejected) {
      session.expire(current.credentials)
      throw SpotifyException(SpotifyFailure.SIGNED_OUT)
    }
    send(token, operation, variables, retryToken = { token(current.credentials, fresh = true) })
  }

  /** The cookie no longer buys a signed-in token. */
  private class Rejected : Exception()

  /** A signed-in token for [credentials]: the cached one while usable, else a new one. */
  private fun token(credentials: SpotifyCredentials, fresh: Boolean = false): SpotifyToken {
    if (!fresh) cached?.takeIf { it.credentials == credentials && it.token.usableAt(clock()) }?.let { return it.token }
    var answer = requestToken(credentials)
    if (answer == SpotifyTokenAnswer.Changed && rereadWebPlayer(newSecret())) answer = requestToken(credentials)
    return when (answer) {
      is SpotifyTokenAnswer.Token -> {
        if (answer.token.anonymous) throw Rejected()
        if (answer.secretStale) rereadWebPlayer(newSecret())
        cached = Cached(credentials, answer.token)
        answer.token
      }
      SpotifyTokenAnswer.Rejected -> throw Rejected()
      SpotifyTokenAnswer.Changed -> throw SpotifyException(SpotifyFailure.CHANGED)
    }
  }

  private fun requestToken(credentials: SpotifyCredentials): SpotifyTokenAnswer {
    val secret = this.secret
    val key = secret.key()
    val serverTime = runCatching {
      val response = http.send(SpotifyRequest("GET", "$WEB/api/server-time", mapOf("User-Agent" to USER_AGENT)))
      Regex(""""serverTime":(\d+)""").find(response.body)!!.groupValues[1].toLong() * 1000
    }.getOrNull()
    val params = listOf(
      "reason" to "init",
      "productType" to "web-player",
      "totp" to SpotifyTotp.code(key, clock()),
      "totpServer" to (serverTime?.let { SpotifyTotp.code(key, it) } ?: "unavailable"),
      "totpVer" to secret.version.toString(),
    ).joinToString("&") { (name, value) -> "$name=${URLEncoder.encode(value, "UTF-8")}" }
    val response = http.send(
      SpotifyRequest("GET", "$WEB/api/token?$params", mapOf("User-Agent" to USER_AGENT, "Cookie" to "sp_dc=${credentials.spDc}")),
    )
    return SpotifyTokenAnswer.read(response.status, response.body)
  }

  private fun send(
    token: SpotifyToken,
    operation: SpotifyOperation,
    variables: JsonObject,
    retryToken: (() -> SpotifyToken)? = null,
  ): JsonObject {
    var current = token
    var tokenRetried = retryToken == null
    var hashRetried = false
    while (true) {
      val hash = synchronized(hashes) { hashes[operation.name] } ?: operation.hash
      when (val answer = post(current, operation.name, hash, variables)) {
        is SpotifyQueryAnswer.Data -> return answer.data
        SpotifyQueryAnswer.TokenExpired -> {
          if (tokenRetried) throw SpotifyException(SpotifyFailure.FAILED)
          tokenRetried = true
          current = retryToken!!()
        }
        SpotifyQueryAnswer.Changed -> {
          if (hashRetried || !rereadWebPlayer(newHash(operation.name, hash))) throw SpotifyException(SpotifyFailure.CHANGED)
          hashRetried = true
        }
        SpotifyQueryAnswer.NotSignedIn -> throw SpotifyException(SpotifyFailure.FAILED)
      }
    }
  }

  private fun post(token: SpotifyToken, name: String, hash: String, variables: JsonObject): SpotifyQueryAnswer {
    val body = buildJsonObject {
      put("variables", variables)
      put("operationName", name)
      putJsonObject("extensions") {
        putJsonObject("persistedQuery") {
          put("version", 1)
          put("sha256Hash", hash)
        }
      }
    }
    val response = http.send(
      SpotifyRequest(
        "POST",
        PATHFINDER,
        mapOf(
          "Authorization" to "Bearer ${token.accessToken}",
          "Content-Type" to "application/json",
          "User-Agent" to USER_AGENT,
        ),
        body.toString(),
      ),
    )
    return SpotifyQueryAnswer.read(response.status, response.body)
  }

  /**
   * Reads the live web-player bundle (once per run; later calls reuse it) and
   * answers whether [take] found something new in it.
   */
  @Synchronized
  private fun rereadWebPlayer(take: (String) -> Boolean): Boolean {
    if (!bundleRead) {
      bundleRead = true
      bundle = runCatching {
        val page = http.send(SpotifyRequest("GET", "$WEB/", mapOf("User-Agent" to USER_AGENT))).body
        val url = BUNDLE_URL.find(page)!!.value
        http.send(SpotifyRequest("GET", url, mapOf("User-Agent" to USER_AGENT))).body
      }.getOrNull()
    }
    return bundle?.let(take) ?: false
  }

  private fun newSecret(): (String) -> Boolean = { js ->
    val found = SpotifySecret.fromBundle(js)
    (found != null && found != secret).also { if (it) secret = found!! }
  }

  private fun newHash(name: String, sent: String): (String) -> Boolean = { js ->
    val found = Regex(""""${Regex.escape(name)}","(?:query|mutation)","([0-9a-f]{64})"""").find(js)?.groupValues?.get(1)
    (found != null && found != sent).also { if (it) synchronized(hashes) { hashes[name] = found!! } }
  }

  /**
   * Runs one Spotify request off the main thread: not tried without a
   * network, and any failure reported as a [SpotifyException].
   */
  private suspend fun <T> request(block: () -> T): T {
    if (!hasNetwork()) throw SpotifyException(SpotifyFailure.OFFLINE)
    return try {
      withContext(Dispatchers.IO) { block() }
    } catch (e: CancellationException) {
      throw e
    } catch (e: SpotifyException) {
      throw e
    } catch (e: Throwable) {
      val unreachable = generateSequence(e) { it.cause }.any {
        it is UnknownHostException || it is ConnectException || it is NoRouteToHostException || it is SocketTimeoutException
      }
      throw SpotifyException(if (!online() || unreachable) SpotifyFailure.OFFLINE else SpotifyFailure.FAILED, e)
    }
  }

  /** Forgets the token in memory (Sign Out). */
  fun forgetToken() {
    cached = null
  }

  companion object {
    private const val WEB = "https://open.spotify.com"
    private const val PATHFINDER = "https://api-partner.spotify.com/pathfinder/v2/query"
    private val BUNDLE_URL = Regex("""https://open\.spotifycdn\.com/cdn/build/web-player/web-player\.[0-9a-f]+\.js""")
    private val EMPTY = JsonObject(emptyMap())

    /** A desktop browser's: the web player's endpoints answer it as they answer the web player. */
    const val USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
  }
}

/** [SpotifyHttp] over `HttpURLConnection`. */
object UrlConnectionSpotifyHttp : SpotifyHttp {
  private const val TIMEOUT_MS = 20_000

  override fun send(request: SpotifyRequest): SpotifyResponse {
    val connection = java.net.URL(request.url).openConnection() as java.net.HttpURLConnection
    try {
      connection.requestMethod = request.method
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      for ((name, value) in request.headers) connection.setRequestProperty(name, value)
      if (request.body != null) {
        connection.doOutput = true
        connection.outputStream.use { it.write(request.body.toByteArray(Charsets.UTF_8)) }
      }
      val status = connection.responseCode
      val stream = if (status >= 400) connection.errorStream else connection.inputStream
      val body = stream?.use { String(it.readBytes(), Charsets.UTF_8) } ?: ""
      return SpotifyResponse(status, body)
    } finally {
      connection.disconnect()
    }
  }
}
