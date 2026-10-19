package expo.modules.wavenative.spotify

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

private val json = Json { ignoreUnknownKeys = true }

/**
 * A web-player access token for Spotify's APIs. A credential: it lives in
 * memory only, never reaches JS, and [toString] leaves it out.
 */
data class SpotifyToken(val accessToken: String, val expiresAtMs: Long, val anonymous: Boolean) {
  /** Whether to send it at [nowMs]: until a minute before it expires. */
  fun usableAt(nowMs: Long): Boolean = nowMs < expiresAtMs - 60_000

  override fun toString(): String = "SpotifyToken(expiresAtMs=$expiresAtMs, anonymous=$anonymous)"
}

/** What `open.spotify.com/api/token` answered. */
sealed interface SpotifyTokenAnswer {
  /** A token; [secretStale] when Spotify flagged the TOTP version (`totpVerExpired`) as on its way out. */
  data class Token(val token: SpotifyToken, val secretStale: Boolean) : SpotifyTokenAnswer

  /** 401: Spotify no longer accepts the cookie. The session is over. */
  data object Rejected : SpotifyTokenAnswer

  /** 400: the TOTP was refused, so the secret rotated. Wave changed nothing about the session. */
  data object Changed : SpotifyTokenAnswer

  companion object {
    /** Reads an answer; throws for one that says nothing about the session (a server error, not JSON). */
    fun read(status: Int, body: String): SpotifyTokenAnswer {
      if (status == 401) return Rejected
      if (status == 400) return Changed
      check(status in 200..299) { "token request failed with HTTP $status" }
      val root = json.parseToJsonElement(body) as JsonObject
      val token = SpotifyToken(
        accessToken = root.text("accessToken") ?: error("no access token"),
        expiresAtMs = (root["accessTokenExpirationTimestampMs"] as? JsonPrimitive)?.longOrNull ?: error("no expiry"),
        anonymous = root.text("isAnonymous") != "false",
      )
      return Token(token, secretStale = root.containsKey("totpVerExpired"))
    }
  }
}

/** What a GraphQL query to `api-partner.spotify.com/pathfinder` answered. */
sealed interface SpotifyQueryAnswer {
  /** The answer's `data`, with no errors. */
  data class Data(val data: JsonObject) : SpotifyQueryAnswer

  /** "User is not authorized": the token isn't a signed-in account's. */
  data object NotSignedIn : SpotifyQueryAnswer

  /** 401: the token expired; fetch a new one. */
  data object TokenExpired : SpotifyQueryAnswer

  /** 412 (an unknown query hash) or any other GraphQL error: Spotify changed the query, not the library. */
  data object Changed : SpotifyQueryAnswer

  companion object {
    fun read(status: Int, body: String): SpotifyQueryAnswer {
      if (status == 401) return TokenExpired
      if (status == 412) return Changed
      check(status in 200..299) { "query failed with HTTP $status" }
      val root = json.parseToJsonElement(body) as JsonObject
      val errors = (root["errors"] as? JsonArray).orEmpty()
      if (errors.isNotEmpty()) {
        val messages = errors.map { (it as? JsonObject)?.text("message").orEmpty() }
        return if (messages.all { "User is not authorized" in it }) NotSignedIn else Changed
      }
      return Data(root["data"] as? JsonObject ?: return Changed)
    }
  }
}

/** The Spotify account Wave is signed in to, as Settings shows it; [username] addresses its library. */
data class SpotifyAccountInfo(val name: String, val photoUrl: String?, val username: String) {
  /** Core's `SpotifyAccount`: JS doesn't need the username. */
  fun toMap(): Map<String, Any?> = mapOf("name" to name, "photoUrl" to photoUrl)

  companion object {
    /** The account in a `profileAttributes` answer's data, or null when it has none. */
    fun fromProfile(data: JsonObject): SpotifyAccountInfo? {
      val profile = ((data["me"] as? JsonObject)?.get("profile") as? JsonObject) ?: return null
      val username = profile.text("username")?.ifBlank { null } ?: return null
      val sources = ((profile["avatar"] as? JsonObject)?.get("sources") as? JsonArray).orEmpty()
        .mapNotNull { it as? JsonObject }
      val photo = sources.maxByOrNull { (it["width"] as? JsonPrimitive)?.intOrNull ?: 0 }?.text("url")
      return SpotifyAccountInfo(profile.text("name")?.ifBlank { null } ?: username, photo, username)
    }
  }
}

internal fun JsonObject.text(key: String): String? =
  (get(key) as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull

internal fun JsonElement?.obj(): JsonObject? = this as? JsonObject
