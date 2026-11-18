package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * A signed-in YouTube session: what innertubex needs to send requests as the
 * account. The cookie is a credential: it's kept in the app's no-backup
 * storage, never handed to JS and never logged ([toString] leaves it out).
 */
data class YtCredentials(
  /** The `Cookie` header for music.youtube.com. */
  val cookie: String,
  /** Which of the Google account's channels (brand accounts) the session is for. */
  val dataSyncId: String?,
  /** Which signed-in Google account (`X-Goog-AuthUser`), "0" for the first. */
  val authUser: String,
) {
  override fun toString(): String = "YtCredentials(authUser=$authUser)"
}

/**
 * Reads the sign-in web view once it reaches YouTube Music: the session's
 * cookie, and which account and channel the page is signed in as (from the
 * page's `ytcfg`, as Metrolist's `LoginScreen` does, GPL-3.0).
 */
object YtSignInPage {
  private val json = Json { ignoreUnknownKeys = true }

  /** Evaluated on the YouTube Music page; answers a JSON object as a string. */
  const val CONFIG_SCRIPT =
    "(function(){var c=(window.yt&&window.yt.config_)||{};" +
      "return JSON.stringify({dataSyncId:c.DATASYNC_ID||null,sessionIndex:String(c.SESSION_INDEX||0)});})()"

  /**
   * The session, given the web view's [cookie] for music.youtube.com and what
   * [CONFIG_SCRIPT] evaluated to.
   */
  fun credentials(cookie: String?, evaluatedConfig: String?): YtCredentials? {
    if (cookie == null || !isSignedIn(cookie)) return null
    val config = runCatching {
      (json.parseToJsonElement(evaluatedConfig!!) as JsonPrimitive).contentOrNull
        ?.let { json.parseToJsonElement(it) as JsonObject }
    }.getOrNull()
    return credentials(cookie, config.text("dataSyncId"), config.text("sessionIndex"))
  }

  /**
   * The session, given the [cookie] for music.youtube.com and the page config's `DATASYNC_ID` and
   * `SESSION_INDEX` as read ([CONFIG_SCRIPT]'s fields); null when the cookie isn't a signed-in one.
   */
  fun credentials(cookie: String?, dataSyncId: String?, sessionIndex: String?): YtCredentials? {
    if (cookie == null || !isSignedIn(cookie)) return null
    return YtCredentials(
      cookie = cookie,
      dataSyncId = dataSyncId?.substringBefore("||")?.ifBlank { null },
      authUser = sessionIndex?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) } ?: "0",
    )
  }

  /** Whether [cookie] carries a signed-in Google session: one of the cookies innertubex signs requests with. */
  private fun isSignedIn(cookie: String): Boolean {
    val names = cookie.split(';').map { it.substringBefore('=').trim() }.toSet()
    return SESSION_COOKIES.any { it in names }
  }

  private val SESSION_COOKIES = listOf("SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID")

  private fun JsonObject?.text(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull
}
