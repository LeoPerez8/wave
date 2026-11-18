package expo.modules.wavenative.secrets

/**
 * Protects a secret kept in private storage that is never backed up: authenticated, so a changed
 * file can't decrypt. The phone's is `KeystoreCipher`.
 */
interface SecretCipher {
  fun encrypt(value: ByteArray): ByteArray
  fun decrypt(value: ByteArray): ByteArray
}
