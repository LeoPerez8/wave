package expo.modules.wavenative.yt

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/** Whether Wave holds a YouTube session (Core's `YtSession`, with the credentials). */
sealed interface YtSessionState {
  /** Core's `YtSession` for JS: who is signed in, never the credentials. */
  fun toMap(): Map<String, Any?>

  data object SignedOut : YtSessionState {
    override fun toMap(): Map<String, Any?> = mapOf("status" to "signedOut")
  }

  data class SignedIn(val credentials: YtCredentials, val account: YtAccountInfo) : YtSessionState {
    override fun toMap(): Map<String, Any?> = mapOf("status" to "signedIn", "account" to account.toMap())
  }

  /** YouTube stopped accepting the session; its credentials are gone, requests go out signed out. */
  data class Expired(val account: YtAccountInfo?) : YtSessionState {
    override fun toMap(): Map<String, Any?> = mapOf("status" to "expired", "account" to account?.toMap())
  }
}

/** Where the YouTube session is kept between runs: the phone's private file, the desktop's host. */
interface YtSessionStore {
  /** The saved session; signed out when there's none or it can't be read. */
  fun load(): YtSessionState

  /** Saves [state] in place of the last one, all at once. */
  fun save(state: YtSessionState)
}

/**
 * The session as it's kept: `{cookie, dataSyncId, authUser, account}` signed in, `{expired, account}`
 * once YouTube stopped accepting it, nothing signed out. The cookie is a credential, so whoever
 * keeps this keeps it private.
 */
object YtSessionJson {
  /** [state] to keep; null for signed out. */
  fun encode(state: YtSessionState): JsonObject? = when (state) {
    YtSessionState.SignedOut -> null
    is YtSessionState.SignedIn -> buildJsonObject {
      put("cookie", state.credentials.cookie)
      put("dataSyncId", state.credentials.dataSyncId)
      put("authUser", state.credentials.authUser)
      put("account", accountJson(state.account))
    }
    is YtSessionState.Expired -> buildJsonObject {
      put(EXPIRED, true)
      put("account", state.account?.let(::accountJson) ?: JsonNull)
    }
  }

  /** The session [root] keeps; signed out for none or one that can't be read. */
  fun decode(root: JsonObject?): YtSessionState {
    if (root == null) return YtSessionState.SignedOut
    val account = (root["account"] as? JsonObject)?.let(::account)
    if (root[EXPIRED] == JsonPrimitive(true)) return YtSessionState.Expired(account)
    val credentials = YtCredentials(
      cookie = root.text("cookie") ?: return YtSessionState.SignedOut,
      dataSyncId = root.text("dataSyncId"),
      authUser = root.text("authUser") ?: "0",
    )
    return YtSessionState.SignedIn(credentials, account ?: return YtSessionState.SignedOut)
  }

  private fun account(json: JsonObject): YtAccountInfo? =
    YtAccountInfo(json.text("name") ?: return null, json.text("email"), json.text("photoUrl"))

  private fun accountJson(account: YtAccountInfo): JsonElement = buildJsonObject {
    put("name", account.name)
    put("email", account.email)
    put("photoUrl", account.photoUrl)
  }

  private fun JsonObject.text(key: String): String? =
    (get(key) as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull

  private const val EXPIRED = "expired"
}

/**
 * Keeps the YouTube session in one private file. The caller puts it in the
 * app's no-backup storage, so the cookie never leaves the phone in a backup.
 */
class YtSessionFile(private val file: File) : YtSessionStore {
  private val json = Json { ignoreUnknownKeys = true }

  override fun load(): YtSessionState =
    YtSessionJson.decode(runCatching { json.parseToJsonElement(file.readText()) as JsonObject }.getOrNull())

  /** Signed out deletes the file. */
  override fun save(state: YtSessionState) {
    val root = YtSessionJson.encode(state)
    if (root == null) {
      file.delete()
      return
    }
    file.parentFile?.mkdirs()
    val partial = File(file.parentFile, "${file.name}.part")
    partial.writeText(root.toString())
    if (!partial.renameTo(file)) {
      file.delete()
      check(partial.renameTo(file)) { "couldn't save the YouTube session" }
    }
  }
}
