package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** The YouTube account Wave is signed in to, as Settings shows it. */
data class YtAccountInfo(
  val name: String,
  val email: String?,
  /** The account's largest picture on YouTube's image server. */
  val photoUrl: String?,
) {
  fun toMap(): Map<String, Any?> = mapOf("name" to name, "email" to email, "photoUrl" to photoUrl)
}

/**
 * What YouTube Music's account menu (`account/account_menu`) says about the
 * session it was asked with: whose account it is, or that it's signed out.
 * The walk follows innertubex's `AccountMenuResponse` (GPL-3.0).
 */
sealed interface YtAccountMenu {
  data class SignedIn(val account: YtAccountInfo) : YtAccountMenu

  /** No account: the menu offers to sign in, or YouTube rejected the session's credentials. */
  data object SignedOut : YtAccountMenu

  companion object {
    private val json = Json { ignoreUnknownKeys = true }
    private val REJECTED = setOf(401, 403)

    /**
     * Reads the answer to an account-menu request: its HTTP [status] and
     * [body]. Throws for an answer that says neither (a server error, or
     * something that isn't the menu), which says nothing about the session.
     */
    fun read(status: Int, body: String): YtAccountMenu {
      if (status in REJECTED) return SignedOut
      check(status in 200..299) { "account menu failed with HTTP $status" }
      val menu = json.parseToJsonElement(body).path("actions").arr?.firstOrNull()
        ?.path("openPopupAction", "popup", "multiPageMenuRenderer")
        ?: error("not an account menu")
      val header = menu.path("header", "activeAccountHeaderRenderer") ?: return SignedOut
      return SignedIn(
        YtAccountInfo(
          name = header.path("accountName", "runs").arr?.firstOrNull()?.path("text").string ?: "",
          email = header.path("email", "runs").arr?.firstOrNull()?.path("text").string,
          photoUrl = header.path("accountPhoto", "thumbnails").arr?.lastOrNull()?.path("url").string,
        ),
      )
    }

    private fun JsonElement?.path(vararg keys: String): JsonElement? =
      keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

    private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
    private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
  }
}
