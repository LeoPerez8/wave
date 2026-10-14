package expo.modules.wavenative.account

import expo.modules.wavenative.secrets.SecretCipher
import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** The Google account a Wave session is for, as Settings shows it. */
data class WaveAccountInfo(val email: String, val name: String?, val photoUrl: String?) {
  fun toMap(): Map<String, Any?> = mapOf("email" to email, "name" to name, "photoUrl" to photoUrl)
}

/** Whether the phone holds a session with the sync service (Core's `WaveSession`). */
sealed class WaveSessionState {
  data object SignedOut : WaveSessionState()

  /** [token] is the service's session token: it never leaves the native module. */
  data class SignedIn(val serviceUrl: String, val token: String, val account: WaveAccountInfo) : WaveSessionState() {
    override fun toString() = "SignedIn(serviceUrl=$serviceUrl, account=$account)"
  }

  /** The service stopped accepting the session; nothing is sent until a new sign-in. */
  data class Ended(val account: WaveAccountInfo?) : WaveSessionState()

  /** What JS sees: the session without its token or service. */
  fun toMap(): Map<String, Any?> = when (this) {
    SignedOut -> mapOf("status" to "signedOut")
    is SignedIn -> mapOf("status" to "signedIn", "account" to account.toMap())
    is Ended -> mapOf("status" to "ended", "account" to account?.toMap())
  }
}

/**
 * The Wave session, encrypted with [cipher] in [file] (in noBackupFilesDir, so Android's backup
 * never has it). Signed out, there's no file.
 */
class WaveAccountStore(private val file: File, private val cipher: SecretCipher) {
  @Synchronized fun load(): WaveSessionState {
    if (!file.exists()) return WaveSessionState.SignedOut
    var plaintext: ByteArray? = null
    return try {
      if (file.length() !in 1..65536) throw IllegalStateException("Unexpected session file size")
      plaintext = cipher.decrypt(file.readBytes())
      decode(Json.parseToJsonElement(plaintext.decodeToString()) as JsonObject)
    } catch (_: Exception) {
      // Corrupt ciphertext, a revoked key or a file from elsewhere can't become a session.
      file.delete()
      WaveSessionState.SignedOut
    } finally { plaintext?.fill(0) }
  }

  @Synchronized fun save(state: WaveSessionState) {
    val partial = File(file.parentFile, "${file.name}.part")
    val root = when (state) {
      WaveSessionState.SignedOut -> {
        partial.delete()
        check(!file.exists() || file.delete()) { "Couldn't forget the Wave session" }
        return
      }
      is WaveSessionState.SignedIn -> buildJsonObject {
        put("status", "signedIn")
        put("serviceUrl", state.serviceUrl)
        put("token", state.token)
        put("account", accountJson(state.account))
      }
      is WaveSessionState.Ended -> buildJsonObject {
        put("status", "ended")
        state.account?.let { put("account", accountJson(it)) }
      }
    }
    val bytes = root.toString().encodeToByteArray()
    try {
      file.parentFile?.mkdirs()
      partial.writeBytes(cipher.encrypt(bytes))
      try {
        Files.move(partial.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
      } catch (_: AtomicMoveNotSupportedException) {
        Files.move(partial.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
      }
    } finally { bytes.fill(0); partial.delete() }
  }

  private fun accountJson(account: WaveAccountInfo) = buildJsonObject {
    put("email", account.email)
    put("name", account.name)
    put("photoUrl", account.photoUrl)
  }

  private fun decode(root: JsonObject): WaveSessionState {
    val account = (root["account"] as? JsonObject)?.let { json ->
      WaveAccountInfo(json.text("email") ?: return@let null, json.text("name"), json.text("photoUrl"))
    }
    return when (root.text("status")) {
      "signedIn" -> WaveSessionState.SignedIn(
        serviceUrl = root.text("serviceUrl") ?: return WaveSessionState.SignedOut,
        token = root.text("token") ?: return WaveSessionState.SignedOut,
        account = account ?: return WaveSessionState.SignedOut,
      )
      "ended" -> WaveSessionState.Ended(account)
      else -> WaveSessionState.SignedOut
    }
  }

  private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.jsonPrimitive?.contentOrNull
}
