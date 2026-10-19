package expo.modules.wavenative.spotify

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * The queries From Spotify reads the account's library with
 * (docs/spotify-account.md, "Reading the library"): its playlists, Liked
 * Songs and a playlist's songs, a page from an offset each. Core asks for the
 * pages and reads their `data` (`readSpotifyLibrary`, `readSpotifyAccountPlaylist`).
 */
object SpotifyLibraryQueries {
  val LIBRARY = SpotifyOperation("libraryV3", "390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455")
  val LIKED_SONGS = SpotifyOperation("fetchLibraryTracks", "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240")
  val PLAYLIST = SpotifyOperation("fetchPlaylist", "21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf")

  /** As the web player asks: 50 library entries, 50 liked songs, 500 playlist songs a page. */
  private const val LIBRARY_PAGE = 50
  private const val LIKED_PAGE = 50
  private const val PLAYLIST_PAGE = 500

  private val PLAYLIST_URI = Regex("""spotify:playlist:[A-Za-z0-9]+""")

  /** The account's playlists, created and followed, folders flattened, with Liked Songs. */
  fun library(offset: Int): Pair<SpotifyOperation, JsonObject> =
    LIBRARY to buildJsonObject {
      putJsonArray("filters") { add("Playlists") }
      put("order", JsonNull)
      put("textFilter", JsonNull)
      putJsonArray("features") { add("LIKED_SONGS") }
      put("limit", LIBRARY_PAGE)
      put("offset", offset)
      put("flatten", true)
      putJsonArray("expandedFolders") {}
      put("folderUri", JsonNull)
      put("includeFoldersWhenFlattening", true)
    }

  /** A page of Liked Songs. */
  fun likedSongs(offset: Int): Pair<SpotifyOperation, JsonObject> =
    LIKED_SONGS to buildJsonObject {
      put("offset", offset)
      put("limit", LIKED_PAGE)
    }

  /** A page of the playlist [uri]; null for anything but a `spotify:playlist:<id>` URI. */
  fun playlist(uri: String, offset: Int): Pair<SpotifyOperation, JsonObject>? {
    if (!PLAYLIST_URI.matches(uri)) return null
    return PLAYLIST to buildJsonObject {
      put("uri", uri)
      put("offset", offset)
      put("limit", PLAYLIST_PAGE)
      put("enableWatchFeedEntrypoint", false)
    }
  }
}
