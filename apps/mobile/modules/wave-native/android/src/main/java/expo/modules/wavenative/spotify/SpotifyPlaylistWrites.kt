package expo.modules.wavenative.spotify

import java.net.URLEncoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * The web-player operations sharing a playlist sends (docs/spotify-account.md,
 * 2026-10-18 hashes). Reading the playlist and the library back is
 * [SpotifyLibraryQueries]'s, as From Spotify reads them.
 */
object SpotifyShareOperations {
  val SEARCH_TRACKS = SpotifyOperation("searchTracks", "b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751")

  /** The playlist mutations share one hash. */
  private const val MUTATIONS = "b907ad6b088d5bf7680fa81198996d58398c2d55dfcdf59fcc959e0be98a418a"
  val ADD = SpotifyOperation("addToPlaylist", MUTATIONS)
  val REMOVE = SpotifyOperation("removeFromPlaylist", MUTATIONS)
  val MOVE = SpotifyOperation("moveItemsInPlaylist", MUTATIONS)
}

/**
 * Sharing a playlist on Spotify (docs/spec.md, "Sharing playlists"), as the
 * account [client] is signed in to: searching songs (answering the GraphQL
 * `data` as JSON for Core to read), and making and changing the playlist. Which songs go
 * where is Core's (`playlistShare.ts`, `spotifyShare.ts`).
 */
class SpotifyPlaylistWrites(private val client: SpotifyClient) {
  private val json = Json { ignoreUnknownKeys = true }

  /** A `searchTracks` for [term]: its data. */
  suspend fun search(term: String): String =
    client.query(
      SpotifyShareOperations.SEARCH_TRACKS,
      buildJsonObject {
        put("searchTerm", term)
        put("offset", 0)
        put("limit", 10)
        put("numberOfTopResults", 20)
        put("includeAudiobooks", false)
        put("includePreReleases", false)
        put("includeAuthors", false)
      },
    ).toString()

  /**
   * Makes an empty playlist [name], puts it in the account's library and
   * lets anyone with its link open it ([makePublic]): its URI.
   */
  suspend fun create(name: String): String {
    val created = client.spclient(
      "POST",
      "/playlist/v2/playlist",
      buildJsonObject {
        putJsonArray("ops") { add(renameOp(name)) }
        put("info", SOURCE)
      },
    )
    val uri = (json.parseToJsonElement(created) as? JsonObject)?.text("uri")
      ?.takeIf { it.startsWith("spotify:playlist:") }
      ?: throw SpotifyException(SpotifyFailure.FAILED)
    rootlist(
      buildJsonObject {
        put("kind", "ADD")
        putJsonObject("add") {
          put("addFirst", true)
          putJsonArray("items") {
            add(
              buildJsonObject {
                put("uri", uri)
                putJsonObject("attributes") {
                  put("timestamp", System.currentTimeMillis().toString())
                  putJsonArray("formatAttributes") {}
                  putJsonArray("availableSignals") {}
                }
              },
            )
          }
        }
      },
    )
    makePublic(uri)
    return uri
  }

  /**
   * Shows the playlist [uri] on the account's profile (`public`) and lets
   * anyone with its link open it (base permission `VIEWER`): Spotify's
   * private playlists don't open for anyone else.
   */
  suspend fun makePublic(uri: String) {
    rootlist(
      buildJsonObject {
        put("kind", "UPDATE_ITEM_ATTRIBUTES")
        putJsonObject("updateItemAttributes") {
          putJsonObject("item") { put("uri", uri) }
          putJsonObject("newAttributes") {
            putJsonObject("values") {
              put("public", true)
              putJsonArray("formatAttributes") {}
              putJsonArray("availableSignals") {}
            }
            putJsonArray("noValue") {}
          }
        }
      },
    )
    val path = "/playlist-permission/v1/playlist/${id(uri)}/permission/base"
    val current = runCatching { json.parseToJsonElement(client.spclient("GET", path)) as JsonObject }.getOrNull()
    client.spclient("POST", path, JsonObject((current ?: JsonObject(emptyMap())) + ("permissionLevel" to JsonPrimitive("VIEWER"))))
  }

  /** Renames the playlist [uri] to [name]. */
  suspend fun rename(uri: String, name: String) {
    client.spclient("POST", "/playlist/v2/playlist/${id(uri)}/changes", deltas(renameOp(name)))
  }

  /** Adds the tracks [trackUris] at the end of the playlist [uri], in order. */
  suspend fun add(uri: String, trackUris: List<String>) {
    client.query(
      SpotifyShareOperations.ADD,
      buildJsonObject {
        put("playlistUri", uri)
        put("playlistItemUris", strings(trackUris))
        put("newPosition", position(null))
        put("interactionId", JsonNull)
      },
    )
  }

  /** Takes the entries [uids] out of the playlist [uri]. */
  suspend fun remove(uri: String, uids: List<String>) {
    client.query(
      SpotifyShareOperations.REMOVE,
      buildJsonObject {
        put("playlistUri", uri)
        put("uids", strings(uids))
      },
    )
  }

  /** Moves the entry [uid] right before the entry [before], or to the end for null. */
  suspend fun move(uri: String, uid: String, before: String?) {
    client.query(
      SpotifyShareOperations.MOVE,
      buildJsonObject {
        put("playlistUri", uri)
        put("uids", strings(listOf(uid)))
        put("newPosition", position(before))
      },
    )
  }

  /** Applies [op] to the signed-in account's library (its rootlist). */
  private suspend fun rootlist(op: JsonObject) {
    val username = (client.session.state as? SpotifySessionState.SignedIn)?.account?.username
      ?: throw SpotifyException(SpotifyFailure.SIGNED_OUT)
    val user = URLEncoder.encode(username, "UTF-8").replace("+", "%20")
    client.spclient("POST", "/playlist/v2/user/$user/rootlist/changes", deltas(op))
  }

  private companion object {
    val SOURCE = buildJsonObject { putJsonObject("source") { put("client", "WEBPLAYER") } }

    fun id(uri: String): String = uri.substringAfterLast(':')

    fun strings(values: List<String>): JsonArray = buildJsonArray { values.forEach { add(JsonPrimitive(it)) } }

    fun position(before: String?): JsonElement = buildJsonObject {
      put("moveType", if (before == null) "BOTTOM_OF_PLAYLIST" else "BEFORE_UID")
      put("fromUid", before?.let(::JsonPrimitive) ?: JsonNull)
    }

    fun renameOp(name: String): JsonObject = buildJsonObject {
      put("kind", "UPDATE_LIST_ATTRIBUTES")
      putJsonObject("updateListAttributes") {
        putJsonObject("newAttributes") {
          putJsonObject("values") {
            put("name", name)
            putJsonArray("formatAttributes") {}
            putJsonArray("pictureSize") {}
          }
          putJsonArray("noValue") {}
        }
      }
    }

    fun deltas(op: JsonObject): JsonObject = buildJsonObject {
      putJsonArray("deltas") {
        add(
          buildJsonObject {
            putJsonArray("ops") { add(op) }
            put("info", SOURCE)
          },
        )
      }
      put("wantResultingRevisions", false)
      put("wantSyncResult", false)
      putJsonArray("nonces") {}
    }
  }
}
