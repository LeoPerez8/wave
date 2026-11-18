package expo.modules.wavenative.soulseek

import java.security.SecureRandom

/**
 * Random Soulseek credentials for a phone that has no account: logging in with an unused name is
 * how Soulseek makes one. The username reads like any other user's (syllables, then a number) and
 * never names Wave: Wave shares no files, and a pattern every Wave user had would let peers block
 * them all.
 */
internal object SoulseekAccounts {
  private const val CONSONANTS = "bcdfghjklmnprstvz"
  private const val VOWELS = "aeiou"
  private const val PASSWORD = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  private val random = SecureRandom()

  fun draw(): SoulseekCredentials {
    val username = buildString {
      repeat(3 + random.nextInt(2)) {
        append(CONSONANTS[random.nextInt(CONSONANTS.length)])
        append(VOWELS[random.nextInt(VOWELS.length)])
      }
      repeat(2 + random.nextInt(3)) { append(random.nextInt(10)) }
    }
    val password = String(CharArray(24) { PASSWORD[random.nextInt(PASSWORD.length)] })
    return SoulseekCredentials(username, password)
  }
}
