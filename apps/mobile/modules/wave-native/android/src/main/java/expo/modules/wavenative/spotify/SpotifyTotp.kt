package expo.modules.wavenative.spotify

import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The TOTP secret the web player signs `open.spotify.com/api/token` requests
 * with, as its bundle carries it: [raw] is obfuscated, [version] goes along as
 * `totpVer`. Not a credential: every visitor's browser downloads it.
 */
data class SpotifySecret(val raw: String, val version: Int) {
  /** The HMAC key: each char code XOR (index % 33 + 9), the numbers joined as decimal, as UTF-8. */
  fun key(): ByteArray =
    raw.mapIndexed { i, c -> (c.code xor (i % 33 + 9)).toString() }.joinToString("").toByteArray(Charsets.UTF_8)

  companion object {
    /** The secret in use on 2026-10-18 (docs/spotify-account.md). */
    val SHIPPED = SpotifySecret(",7/*F(\"rLJ2oxaKL^f+E1xvP@N", 61)

    private val ENTRY = Regex("""\[\{secret:(['"])((?:\\.|(?!\1).)*)\1,version:(\d+)\}""")

    /** The secret in use (the list's first entry) in the web player's main bundle, or null. */
    fun fromBundle(js: String): SpotifySecret? {
      val match = ENTRY.find(js) ?: return null
      val raw = match.groupValues[2].replace(Regex("""\\(.)""")) { it.groupValues[1] }
      return SpotifySecret(raw, match.groupValues[3].toInt())
    }
  }
}

/** RFC 6238 codes: HMAC-SHA1, 30-second steps, 6 digits. */
object SpotifyTotp {
  fun code(key: ByteArray, timeMs: Long): String {
    val mac = Mac.getInstance("HmacSHA1").apply { init(SecretKeySpec(key, "HmacSHA1")) }
    val hash = mac.doFinal(ByteBuffer.allocate(8).putLong(timeMs / 30_000).array())
    val offset = hash[19].toInt() and 0x0f
    val number = ByteBuffer.wrap(hash, offset, 4).int and 0x7fffffff
    return (number % 1_000_000).toString().padStart(6, '0')
  }
}
