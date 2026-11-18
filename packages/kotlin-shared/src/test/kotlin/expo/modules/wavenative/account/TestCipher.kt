package expo.modules.wavenative.account

import expo.modules.wavenative.secrets.SecretCipher
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** AES-GCM with a key made for the test run, standing in for the Android Keystore's. */
class TestCipher(private val key: SecretKey = KEY) : SecretCipher {
  override fun encrypt(value: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    return cipher.iv + cipher.doFinal(value)
  }

  override fun decrypt(value: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, value.copyOfRange(0, 12)))
    return cipher.doFinal(value.copyOfRange(12, value.size))
  }

  companion object {
    private val KEY: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    /** Another instance over the same key, as after a restart. */
    val sameKey: TestCipher get() = TestCipher(KEY)
  }
}
