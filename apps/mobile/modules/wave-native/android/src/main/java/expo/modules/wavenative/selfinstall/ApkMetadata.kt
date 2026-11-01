package expo.modules.wavenative.selfinstall

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.Date

/** What the signature on the channel's APK metadata comes to. The names are what JS reads. */
enum class ApkMetadataCheck(val jsName: String) {
  VALID("valid"),
  NO_CERTIFICATE("noCertificate"),
  BAD_SIGNATURE("badSignature"),
}

/**
 * Whether the key behind [certificatePem], the one the APK ships to check updates with, signed
 * [metadata]: base64 of RSA-SHA256 over its UTF-8 bytes. As with updates, a certificate past its
 * validity accepts nothing.
 */
fun checkApkMetadata(
  metadata: String,
  signature: String,
  certificatePem: String?,
  now: Date = Date(),
): ApkMetadataCheck {
  val certificate = readCertificate(certificatePem, now) ?: return ApkMetadataCheck.NO_CERTIFICATE
  val valid = try {
    Signature.getInstance("SHA256withRSA").run {
      initVerify(certificate)
      update(metadata.toByteArray(Charsets.UTF_8))
      verify(Base64.getDecoder().decode(signature))
    }
  } catch (_: GeneralSecurityException) {
    false
  } catch (_: IllegalArgumentException) {
    false
  }
  return if (valid) ApkMetadataCheck.VALID else ApkMetadataCheck.BAD_SIGNATURE
}

private fun readCertificate(pem: String?, now: Date): X509Certificate? {
  if (pem.isNullOrEmpty()) return null
  return try {
    val input = ByteArrayInputStream(pem.toByteArray(Charsets.UTF_8))
    (CertificateFactory.getInstance("X.509").generateCertificate(input) as X509Certificate)
      .apply { checkValidity(now) }
  } catch (_: GeneralSecurityException) {
    null
  }
}

/** Hex of the SHA-256 of what [input] holds. Doesn't close it. */
fun sha256Hex(input: InputStream): String {
  val digest = MessageDigest.getInstance("SHA-256")
  val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
  while (true) {
    val read = input.read(buffer)
    if (read < 0) break
    digest.update(buffer, 0, read)
  }
  return digest.digest().joinToString("") { "%02x".format(it) }
}
