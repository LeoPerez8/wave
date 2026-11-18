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

/**
 * Keeps the YouTube session in one private file. The caller puts it in the
 * app's no-backup storage, so the cookie never leaves the phone in a backup.
 */
class YtSessionStore(private val file: File) {
  private val json = Json { ignoreUnknownKeys = true }

  /** The saved session; signed out when there's none or it can't be read. */
  fun load(): YtSessionState {
    val root = runCatching { json.parseToJsonElement(file.readText()) as JsonObject }.getOrNull()
      ?: return YtSessionState.SignedOut
    val account = (root["account"] as? JsonObject)?.let(::account)
    if (root[EXPIRED] == JsonPrimitive(true)) return YtSessionState.Expired(account)
    val credentials = YtCredentials(
      cookie = root.text("cookie") ?: return YtSessionState.SignedOut,
      dataSyncId = root.text("dataSyncId"),
      authUser = root.text("authUser") ?: "0",
    )
    return YtSessionState.SignedIn(credentials, account ?: return YtSessionState.SignedOut)
  }

  /** Saves [state] in place of the last one, all at once; signed out deletes the file. */
  fun save(state: YtSessionState) {
    val root = when (state) {
      YtSessionState.SignedOut -> {
        file.delete()
        return
      }
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
    file.parentFile?.mkdirs()
    val partial = File(file.parentFile, "${file.name}.part")
    partial.writeText(root.toString())
    if (!partial.renameTo(file)) {
      file.delete()
      check(partial.renameTo(file)) { "couldn't save the YouTube session" }
    }
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

  private companion object {
    const val EXPIRED = "expired"
  }
}
