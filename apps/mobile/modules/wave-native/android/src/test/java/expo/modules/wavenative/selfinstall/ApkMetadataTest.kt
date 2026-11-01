package expo.modules.wavenative.selfinstall

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayInputStream
import java.util.Date

/** The signature was made by `openssl dgst -sha256 -sign`, the scheme CI's Node signs with. */
class ApkMetadataTest {
  private val metadata = """{"version":"1.3.0-ti","sha256":"é"}"""
  private val signature = "WrYeBHh+HqjHetXLuoQCYtEK7MhlVxJCVBYPyPbqswkzJ8STC8miAcHRJTTjmIHPET9SKYyv7jW/luFWIEKuv/xstYOKIObtFP27ZC5w+sva1mXB+Uo6ehv3JdnkiDpaGCglc/GXM2qhYvcQlm51mdMDncYq1VxBdSdqqjIA+upy++B0AhBaZimRzrs1zc4RD5tI/UoSlGl/vo0kGVIKpERLIoQ6IWcklJkO/aSszmAMdABrKR8iwYkUPiwexJOvl9pqpKRncLJdM2ZE9frU/SYkwhendyqx0Y2bx7JfLd/HJX0rn0TnPigLWbzpA8gL2qv4619oo5dsZ+8bjrsxtQ=="
  private val certificate = """-----BEGIN CERTIFICATE-----
MIIDKTCCAhGgAwIBAgIUbINp3KjKYa2UTkDD39CZ6wwo8t8wDQYJKoZIhvcNAQEL
BQAwDzENMAsGA1UEAwwEVGVzdDAgFw0yNjExMDEwMjU2MjRaGA8yMTI2MTAwODAy
NTYyNFowDzENMAsGA1UEAwwEVGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC
AQoCggEBAMpLX7Dyt4U0iJ69IaEl1FPpMboTdUPZGRAAT+ldXhrcgps/+vk13Thz
XdPbf5Uge3BD79RYNLP94fajC7eMDY5pqlJ1GHpBz5sfRs3QtvCGRdmAowTKOD7a
Rqe2DjAx4rnnbCYKuuhJgFO7v7CiX3o1Fg/t5Hgb5FvOjPU6pj7R+BUx+FbhLjQS
6/PzUetXpj8ewys2ifObA1HaDSkzTifkUetTAc07UjvdTm4n/Ku8kqScTNTJ83rW
vfbbmNWcz8K+Rcr5GqYHCocR39jCA7e1o0DVA6iBNhgC/gOM5oMKrFaonjky563o
7YfQ54JhlTBCnS3z7DbSD4Z46Yqwof0CAwEAAaN7MHkwHQYDVR0OBBYEFJWGSuNU
iaNUsqJrymyAjnFUFuGeMB8GA1UdIwQYMBaAFJWGSuNUiaNUsqJrymyAjnFUFuGe
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgeAMBYGA1UdJQEB/wQMMAoG
CCsGAQUFBwMDMA0GCSqGSIb3DQEBCwUAA4IBAQCIPTYDVs1pomRBHR3diA3x9I86
DpaMbZIuQeu2UogAlSJduS1Cse4sJ0G0Jm7VjpOaW5IbM+o0LkKSZ5Ihot4EXzTD
D5wTd/hifRbY/xljRlCpU8JYd/sQO5R8NgIDFfzc8/6cwV/iM5yJmXQrMvurAkdz
4e3dBbzZ4GfW8Efep0i9zmAdbVQPCV5ys6wE2n4tyqBCu2T6rOwb7YTr3XDa0/Qh
nDOU1v0hDerLJBYWqprglXJt0KTlx2Lds2AkhuQimqBv1NESiINYfqXhW8WLjoa2
/xIhkJ7rQZjFYbZhU8+6T5S+GnlISIK9jTV2TbEQPnRuRY2hBUmpwWlV//bk
-----END CERTIFICATE-----
"""
  private val otherCertificate = """-----BEGIN CERTIFICATE-----
MIIDAzCCAeugAwIBAgIUMk7HSeAh9JdZF0nYrywhkFjRlYEwDQYJKoZIhvcNAQEL
BQAwEDEOMAwGA1UEAwwFT3RoZXIwIBcNMjYxMTAxMDI1NjI0WhgPMjEyNjEwMDgw
MjU2MjRaMBAxDjAMBgNVBAMMBU90aGVyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEAm/GJwJv0fjd4YzCKJ/iUTIC2KuaJomr297Jj2AIarlmOvwT3/vBc
+OGy29ELWMZ0TIOehE9+cddlDCQQay0YJEBbRUoyqEjt9RwyW1JZBElYRAj9TlIt
oTRa3ti9fTMmhe222ZR6fZsrnuGujE/ba5Dy2vyU4OpAJWMACfvmQCzqS6VerDpZ
LimbxN9wER18JyFj1nWb5xE5QlLQ8OhWFY4uU/KSF/sDUPUTOmEqqRdTS8ZdV36f
25yIcyYdcqs4IDeZXVs7nFl8lnPK+zIHOEMR6aNS7kzMskLTvzRp7gbzvn/0jFDw
4Pjbw5kSXyPjjIJ7fIh6I/1l3xH5PF/zvwIDAQABo1MwUTAdBgNVHQ4EFgQUx+Jd
1bB5m2Wqn+032lmP+6Ghp7MwHwYDVR0jBBgwFoAUx+Jd1bB5m2Wqn+032lmP+6Gh
p7MwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAQnEq32Db6MiO
95aFzrs/n3HnORC198zugsvnL3AKOWPp65PnAqeAY2mlcm7B+WmqzxQ9OSTeXadV
o+iMHPuqV/y5FVZt4uKRG7RmF+2y8yH/MYTkZSmgsturh3IC1isZkxTiTGuObtVG
ILpCJgCZpbcBs7jxa+u7Cx3e0HY5vBarhzXofIuyybG2BPZ2nf7qmPsfalR9njRL
+fp3cjaWUEbY6eDPT1VOr2WGozE0haA2kfIeNQtpuZgxn4Cjb5yedjEsYEPBdPjl
ePPilFqiwYG+pVE9+bb1pnvoDDAyceRvIQLt91E2bdi3TmqWMv7M1wefWoZzTTJ8
kCSR/6jZPw==
-----END CERTIFICATE-----
"""
  // Inside the certificate's validity, whatever day the tests run.
  private val during = Date(1_900_000_000_000L)

  private fun check(
    text: String = metadata,
    sig: String = signature,
    pem: String? = certificate,
    at: Date = during,
  ) = checkApkMetadata(text, sig, pem, at)

  @Test
  fun acceptsMetadataTheCertificatesKeySigned() {
    assertEquals(ApkMetadataCheck.VALID, check())
  }

  @Test
  fun refusesChangedMetadata() {
    assertEquals(ApkMetadataCheck.BAD_SIGNATURE, check(text = metadata.replace("1.3.0", "9.9.9")))
  }

  @Test
  fun refusesAnotherKeysSignature() {
    assertEquals(ApkMetadataCheck.BAD_SIGNATURE, check(pem = otherCertificate))
  }

  @Test
  fun refusesAMalformedOrEmptySignature() {
    assertEquals(ApkMetadataCheck.BAD_SIGNATURE, check(sig = "not base64!"))
    assertEquals(ApkMetadataCheck.BAD_SIGNATURE, check(sig = ""))
    assertEquals(ApkMetadataCheck.BAD_SIGNATURE, check(sig = "c2ln"))
  }

  @Test
  fun anApkWithNoUsableCertificateAcceptsNothing() {
    assertEquals(ApkMetadataCheck.NO_CERTIFICATE, check(pem = null))
    assertEquals(ApkMetadataCheck.NO_CERTIFICATE, check(pem = ""))
    assertEquals(ApkMetadataCheck.NO_CERTIFICATE, check(pem = "not a certificate"))
  }

  @Test
  fun aCertificatePastItsValidityAcceptsNothing() {
    assertEquals(ApkMetadataCheck.NO_CERTIFICATE, check(at = Date(7_000_000_000_000L)))
  }

  @Test
  fun hashesAFileAsHex() {
    assertEquals(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sha256Hex(ByteArrayInputStream("abc".toByteArray())),
    )
  }
}
