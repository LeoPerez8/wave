package expo.modules.wavenative.log

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * An app log entry as native code writes it: Core's `formatLogEntry` and
 * `redactSecrets` (packages/core/src/appLog.ts) in Kotlin, since native writers
 * append to the file directly and JS never sees their lines. Keep the two in step.
 */
object AppLogEntry {
  enum class Level(val letter: Char) { INFO('I'), WARN('W'), ERROR('E'), FATAL('F') }

  private val TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

  /** What starts each of an entry's lines after the first, so only its first line starts with a time. */
  private const val CONTINUATION = "  "

  /**
   * `<ISO time, UTC, with ms> <I|W|E|F> <tag>: <message>`, ending in a newline,
   * with secrets redacted. A message of several lines (a stack) goes on the
   * lines after, each indented by two spaces.
   */
  fun format(at: Long, level: Level, tag: String, message: String): String {
    val lines = redactSecrets(message).trimEnd().split(Regex("\r?\n"))
    return "${time(at)} ${level.letter} $tag: ${lines.joinToString("\n$CONTINUATION")}\n"
  }

  /** [at] (ms since the epoch) as the log writes times: ISO 8601, UTC, with ms. */
  fun time(at: Long): String = TIME.format(Instant.ofEpochMilli(at))

  /** [message], then [error]'s stack (with its causes) on the lines after. */
  fun withStack(message: String, error: Throwable?): String =
    if (error == null) message else "$message\n${error.stackTraceToString()}"

  private const val REDACTED = "[redacted]"

  /** A key whose value is a secret: passwords, tokens, cookies, session ids, credentials. */
  private val SECRET_KEY = Regex(
    "password|passwd|^pass$|^pwd$|secret|token|cookie|^auth$|authori[sz]ation|apisid|psid|^[a-z]?sid$|" +
      "api[-_]?key|credential|session[-_]?(?:id|key)$",
    RegexOption.IGNORE_CASE,
  )

  private fun isSecret(key: String) = SECRET_KEY.containsMatchIn(key)

  private val JSON_PAIR = Regex("""(["'])([\w.-]+)\1(\s*:\s*)(["'])(?:\\.|(?!\4)[^\\])*\4""")
  private val QUOTED_PAIR = Regex("""\b([\w-]+)(\s*[:=]\s*)(["'])(?:\\.|(?!\3)[^\\])*\3""")
  private val HEADER = Regex("""\b((?:proxy-)?authorization|set-cookie|cookie)(\s*:\s*)[^\r\n"']+""", RegexOption.IGNORE_CASE)
  private val BEARER = Regex("""\b(bearer\s+)[\w.~+/=-]{8,}""", RegexOption.IGNORE_CASE)
  private val PAIR = Regex("""\b([\w-]+)(\s*[:=]\s*)(?!//)[^\s&;,'"{}\[\]()]+""")
  private val JWT = Regex("""\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?""")
  private val GOOGLE_ACCESS_TOKEN = Regex("""\bya29\.[\w.-]+""")
  private val GOOGLE_REFRESH_TOKEN = Regex("""\b1//[\w-]{16,}""")
  private val URL_PASSWORD = Regex("""(\b[a-z][\w+.-]*://[^/\s:@]+:)[^/\s@]+@""", RegexOption.IGNORE_CASE)

  /**
   * [text] with every secret Wave handles replaced by `[redacted]`, as Core's
   * `redactSecrets` does: passwords, tokens, cookies and credentials as
   * `key=value`, `key: value` or JSON pairs, Authorization and Cookie headers,
   * bearer tokens, JWTs, Google tokens and a URL's password. Song titles,
   * artists and paths stay.
   */
  fun redactSecrets(text: String): String {
    var out = JSON_PAIR.replace(text) { m ->
      val (q, key, sep, vq) = m.destructured
      if (isSecret(key)) "$q$key$q$sep$vq$REDACTED$vq" else m.value
    }
    out = QUOTED_PAIR.replace(out) { m ->
      val (key, sep, q) = m.destructured
      if (isSecret(key)) "$key$sep$q$REDACTED$q" else m.value
    }
    out = HEADER.replace(out) { m -> "${m.groupValues[1]}${m.groupValues[2]}$REDACTED" }
    out = BEARER.replace(out) { m -> "${m.groupValues[1]}$REDACTED" }
    out = PAIR.replace(out) { m ->
      val (key, sep) = m.destructured
      if (isSecret(key)) "$key$sep$REDACTED" else m.value
    }
    out = JWT.replace(out) { REDACTED }
    out = GOOGLE_ACCESS_TOKEN.replace(out) { REDACTED }
    out = GOOGLE_REFRESH_TOKEN.replace(out) { REDACTED }
    return URL_PASSWORD.replace(out) { m -> "${m.groupValues[1]}$REDACTED@" }
  }
}
