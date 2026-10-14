package expo.modules.wavenative.secrets

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Protects a secret kept in noBackupFilesDir: authenticated, so a changed file can't decrypt. */
interface SecretCipher {
  fun encrypt(value: ByteArray): ByteArray
  fun decrypt(value: ByteArray): ByteArray
}

/** AES-GCM with a non-exportable Android Keystore key named [alias], made on first use. */
class KeystoreCipher(private val alias: String) : SecretCipher {
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
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
    check(value.size > 29 && value[0] == 1.toByte()) { "Invalid encrypted secret" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, value.copyOfRange(1, 13)))
    return cipher.doFinal(value.copyOfRange(13, value.size))
  }
}
