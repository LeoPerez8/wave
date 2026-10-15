package expo.modules.wavenative.soulseek

import expo.modules.wavenative.account.WaveAccountClient
import expo.modules.wavenative.account.WaveAccountException
import expo.modules.wavenative.account.WaveAccountFailure
import expo.modules.wavenative.account.WaveSessionState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The sync service's `GET` and `PUT /v1/soulseek`, sent with the Wave session [account] holds. */
class SyncServiceSoulseek(private val account: WaveAccountClient) : WaveAccountSoulseek {
  override fun signedIn() = account.session() is WaveSessionState.SignedIn

  override fun read(): SoulseekCredentials? {
    val response = account.send("GET", PATH, null)
    if (response.status != 200) throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    val answer = runCatching { Json.parseToJsonElement(response.body) as JsonObject }.getOrNull()
      ?: throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    val kept = answer["account"]
    if (kept == null || kept is JsonNull) return null
    val fields = kept as? JsonObject ?: throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    val username = fields.text("username")
    val password = fields.text("password")
    if (username.isNullOrBlank() || password.isNullOrEmpty()) throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
    return SoulseekCredentials(username, password)
  }

  override fun keep(account: SoulseekCredentials) {
    val body = buildJsonObject { put("username", account.username); put("password", account.password) }.toString()
    val response = this.account.send("PUT", PATH, body)
    if (response.status !in 200..299) throw WaveAccountException(WaveAccountFailure.UNREACHABLE)
  }

  private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

  private companion object {
    const val PATH = "/v1/soulseek"
  }
}
