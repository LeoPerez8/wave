package expo.modules.wavenative.soulseek

import expo.modules.wavenative.secrets.SecretCipher
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.AtomicMoveNotSupportedException

/** The platform protects bytes with an authenticated, non-exportable Android Keystore key. */
typealias SoulseekCredentialCipher = SecretCipher

/** Download in best quality, kept as "on" or "off" in [file]; no file on a phone from before the switch. */
class SoulseekSwitchFile(private val file: File) : SoulseekSwitchStore {
  @Synchronized override fun load(): Boolean? = when (runCatching { file.readText() }.getOrNull()) {
    "on" -> true
    "off" -> false
    else -> null
  }

  @Synchronized override fun save(on: Boolean) {
    file.parentFile?.mkdirs()
    file.writeText(if (on) "on" else "off")
  }
}

/** Put [file] in Android's noBackupFilesDir. It never contains a plaintext username/password. */
class SoulseekSessionStore(private val file: File, private val cipher: SoulseekCredentialCipher) : SoulseekCredentialsStore {
  @Synchronized override fun load(): SoulseekCredentials? {
    if (!file.exists()) return null
    var plaintext: ByteArray? = null
    return try {
      if (file.length() !in 1..8192) return null
      val decoded = cipher.decrypt(file.readBytes())
      plaintext = decoded
      val fields = SoulseekWire.reader(decoded)
      val username = fields.string()
      val password = fields.string()
      if (username.isBlank() || username.length > 30 || password.isEmpty() || password.length > 1024) null
      else SoulseekCredentials(username, password)
    } catch (_: Exception) {
      // Corrupt ciphertext, a revoked key or authentication failure cannot become a session.
      file.delete()
      null
    } finally { plaintext?.fill(0) }
  }

  @Synchronized override fun save(value: SoulseekCredentials?) {
    val partial = File(file.parentFile, "${file.name}.part")
    if (value == null) {
      partial.delete()
      check(!file.exists() || file.delete()) { "Couldn't remove the Soulseek account" }
      return
    }
    val bytes = SoulseekWire.Writer().apply { string(value.username); string(value.password) }.result()
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
}
