package expo.modules.wavenative.spotify

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A signed-in Spotify session: the `sp_dc` cookie Spotify's sign-in leaves on
 * `.spotify.com`. A credential: kept in no-backup storage, never handed to JS
 * and never logged ([toString] leaves it out).
 */
data class SpotifyCredentials(val spDc: String) {
  override fun toString(): String = "SpotifyCredentials(…)"
}

/** Reads the sign-in web view's cookies once it reaches the web player. */
object SpotifySignInPage {
  /** The session in the web view's `Cookie` header for open.spotify.com, or null before sign-in. */
  fun credentials(cookie: String?): SpotifyCredentials? =
    cookie?.split(';')?.map { it.trim() }
      ?.firstOrNull { it.substringBefore('=') == "sp_dc" }
      ?.substringAfter('=')?.ifBlank { null }
      ?.let(::SpotifyCredentials)
}

/** Whether Wave holds a Spotify session (Core's `SpotifySession`, with the credentials). */
sealed interface SpotifySessionState {
  /** Core's `SpotifySession` for JS: who is signed in, never the credentials. */
  fun toMap(): Map<String, Any?>

  data object SignedOut : SpotifySessionState {
    override fun toMap(): Map<String, Any?> = mapOf("status" to "signedOut")
  }

  data class SignedIn(val credentials: SpotifyCredentials, val account: SpotifyAccountInfo) : SpotifySessionState {
    override fun toMap(): Map<String, Any?> = mapOf("status" to "signedIn", "account" to account.toMap())
  }

  /** Spotify stopped accepting the session; the cookie is gone. */
  data class Expired(val account: SpotifyAccountInfo?) : SpotifySessionState {
    override fun toMap(): Map<String, Any?> = mapOf("status" to "expired", "account" to account?.toMap())
  }
}

/**
 * Keeps the Spotify session in one private file. The caller puts it in the
 * app's no-backup storage, so the cookie never leaves the phone in a backup.
 */
class SpotifySessionStore(private val file: File) {
  private val json = Json { ignoreUnknownKeys = true }

  /** The saved session; signed out when there's none or it can't be read. */
  fun load(): SpotifySessionState {
    val root = runCatching { json.parseToJsonElement(file.readText()) as JsonObject }.getOrNull()
      ?: return SpotifySessionState.SignedOut
    val account = (root["account"] as? JsonObject)?.let(::account)
    if (root[EXPIRED] == JsonPrimitive(true)) return SpotifySessionState.Expired(account)
    val credentials = SpotifyCredentials(root.text("spDc") ?: return SpotifySessionState.SignedOut)
    return SpotifySessionState.SignedIn(credentials, account ?: return SpotifySessionState.SignedOut)
  }

  /** Saves [state] in place of the last one, all at once; signed out deletes the file. */
  fun save(state: SpotifySessionState) {
    val root = when (state) {
      SpotifySessionState.SignedOut -> {
        file.delete()
        return
      }
      is SpotifySessionState.SignedIn -> buildJsonObject {
        put("spDc", state.credentials.spDc)
        put("account", accountJson(state.account))
      }
      is SpotifySessionState.Expired -> buildJsonObject {
        put(EXPIRED, true)
        put("account", state.account?.let(::accountJson) ?: JsonNull)
      }
    }
    file.parentFile?.mkdirs()
    val partial = File(file.parentFile, "${file.name}.part")
    partial.writeText(root.toString())
    if (!partial.renameTo(file)) {
      file.delete()
      check(partial.renameTo(file)) { "couldn't save the Spotify session" }
    }
  }

  private fun account(json: JsonObject): SpotifyAccountInfo? =
    SpotifyAccountInfo(json.text("name") ?: return null, json.text("photoUrl"), json.text("username") ?: return null)

  private fun accountJson(account: SpotifyAccountInfo): JsonElement = buildJsonObject {
    put("name", account.name)
    put("photoUrl", account.photoUrl)
    put("username", account.username)
  }

  private companion object {
    const val EXPIRED = "expired"
  }
}

/**
 * The Spotify account Wave holds, restored from [store] when the process
 * starts. Every change is saved at once and heard by [onChange].
 */
class SpotifySession(private val store: SpotifySessionStore) {
  @Volatile
  var state: SpotifySessionState = store.load()
    private set

  /** Called with the new state whenever it changes (the `WaveSpotify` module tells JS). */
  @Volatile
  var onChange: ((SpotifySessionState) -> Unit)? = null

  @Synchronized
  fun signedIn(credentials: SpotifyCredentials, account: SpotifyAccountInfo) {
    update(SpotifySessionState.SignedIn(credentials, account))
  }

  /**
   * Spotify rejected [credentials]: the session expires, unless Wave already
   * holds another one. Expired, nothing is rejected twice: no error loop.
   */
  @Synchronized
  fun expire(credentials: SpotifyCredentials) {
    val current = state as? SpotifySessionState.SignedIn ?: return
    if (current.credentials != credentials) return
    update(SpotifySessionState.Expired(current.account))
  }

  /** Spotify named [account] when asked with [credentials] (its name or photo may have changed). */
  @Synchronized
  fun checked(credentials: SpotifyCredentials, account: SpotifyAccountInfo) {
    val current = state as? SpotifySessionState.SignedIn ?: return
    if (current.credentials != credentials || current.account == account) return
    update(current.copy(account = account))
  }

  @Synchronized
  fun signOut() {
    update(SpotifySessionState.SignedOut)
  }

  private fun update(next: SpotifySessionState) {
    store.save(next)
    state = next
    onChange?.invoke(next)
  }
}
