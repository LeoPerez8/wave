package expo.modules.wavenative.soulseek

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import expo.modules.wavenative.tags.JAudioTaggerReader
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey

/** Owns the session for the whole app process; Expo screen/module destruction doesn't disconnect it. */
class AndroidSoulseek private constructor(context: Context) {
  val client = SoulseekClient(SoulseekSessionStore(File(context.noBackupFilesDir, "soulseek-session"), KeystoreCipher()))

  fun download(
    id: String,
    candidate: SoulseekCandidate,
    part: File,
    expectedDurationMs: Long,
    onProgress: (Long, Long) -> Unit = { _, _ -> },
    onQueued: (Long) -> Unit = {},
    isCancelled: () -> Boolean = { false },
  ): Map<String, Any?> {
    try {
      val verified = client.download(id, candidate, part, expectedDurationMs, onProgress, onQueued)
      AndroidMp3Decode.validate(part, verified, isCancelled)
      JAudioTaggerReader.configure()
      val tag = AudioFileIO.read(part).tag
      fun text(key: FieldKey): String? = tag?.getFirst(key)?.takeIf { it.isNotBlank() }
      return verified.toMap() + mapOf(
        "partPath" to part.path,
        "receivedTags" to mapOf("title" to text(FieldKey.TITLE), "artist" to text(FieldKey.ARTIST), "album" to text(FieldKey.ALBUM)),
      )
    } catch (e: Exception) { part.delete(); throw e }
  }

  companion object {
    @Volatile private var instance: AndroidSoulseek? = null
    fun get(context: Context): AndroidSoulseek = instance ?: synchronized(this) {
      instance ?: AndroidSoulseek(context.applicationContext).also { instance = it }
    }
  }
}

private class KeystoreCipher : SoulseekCredentialCipher {
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true).build())
    }.generateKey()
  }

  override fun encrypt(value: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    return byteArrayOf(1) + cipher.iv + cipher.doFinal(value)
  }

  override fun decrypt(value: ByteArray): ByteArray {
    check(value.size > 29 && value[0] == 1.toByte()) { "Invalid encrypted session" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, value.copyOfRange(1, 13)))
    return cipher.doFinal(value.copyOfRange(13, value.size))
  }

  private companion object { const val ALIAS = "wave-soulseek-session-v1" }
}
