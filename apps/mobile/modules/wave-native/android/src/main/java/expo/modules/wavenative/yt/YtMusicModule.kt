package expo.modules.wavenative.yt

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.artwork.AndroidArtworkProcessor
import expo.modules.wavenative.artwork.ArtistPhotoStore
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.net.NetworkMeter
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.resume

/**
 * YT Music for JS (`WaveYtMusic`): the switch in Settings, song, artist and
 * album search (Search; the artist page's section finds artists too), the
 * artist page, playlists (and, for sharing one, making and editing the
 * account's own, [YtPlaylistWrites]), the account and caching a played song's cover.
 * (Album pages are `WaveYtDownloads.album`.) (Playing is the playback
 * service's: it streams `yt:` queue items, see [YtDataSource].) Requests go
 * through the process-wide [YtClient]; failures reject with the codes of
 * [YtFailure]. Nothing returned carries cookies or stream addresses: the
 * account is `{ status, account: { name, email, photoUrl } }`.
 *
 * The reads mixes and the Magic Queue make (artist search, artist page,
 * radios) take an optional meter (`startNetworkMeter`): their requests count
 * on it, and `takeNetworkUse` says what it counted ([expo.modules.wavenative.net.NetworkMeters]).
 */
class YtMusicModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: YtClient
    get() = YtClient.get(context)

  /** The Library's artwork store: YT Music covers are cached beside the Library's. */
  private val artworkStore by lazy { ArtworkStore(File(context.filesDir, "artwork"), AndroidArtworkProcessor()) }

  override fun definition() = ModuleDefinition {
    Name("WaveYtMusic")

    /** The session changed natively: YouTube ended it during a request, say. */
    Events("onSessionChanged")

    // Only while JS listens (Settings is open), so starting Wave doesn't load the session.
    OnStartObserving("onSessionChanged") {
      client.session.onChange = { sendEvent("onSessionChanged", it.toMap()) }
    }

    OnStopObserving("onSessionChanged") {
      client.session.onChange = null
    }

    /** Turns YT Music on or off; off, every request is refused before reaching the network. */
    Function("setEnabled") { on: Boolean -> client.enabled = on }

    Function("isEnabled") { client.enabled }

    /** A new meter's id, for the metered reads below. */
    Function("startNetworkMeter") { client.meters.start() }

    /** What meter [id] counted, `{ requests, bytes }` (bytes on the wire), ending it. */
    Function("takeNetworkUse") { id: String -> client.meters.take(id).toMap() }

    /**
     * Hands over the day's Wi-Fi pre-download list ([videoIds], in the order
     * to fetch; empty for none): the start of Home's mixes goes into the
     * audio cache on Wi-Fi with battery not low ([PreDownloads]).
     */
    AsyncFunction("schedulePreDownload") { videoIds: List<String> -> PreDownloads.schedule(context, videoIds) }

    /**
     * The video ids whose audio the audio cache holds whole: the songs that
     * play offline ([YtAudioCache.wholeVideos]; none when it can't open).
     */
    AsyncFunction("cachedVideos") Coroutine { ->
      withContext(Dispatchers.IO) { YtAudioCache.get(context)?.wholeVideos()?.toList() ?: emptyList() }
    }

    /** `{ songs, continuation }` for [query], or a rejection with an `ERR_YT_*` code. */
    AsyncFunction("searchSongs") Coroutine { query: String ->
      coded { client.searchSongs(query).toMap() }
    }

    /**
     * Artists named like [query] (YouTube Music's "Artists" filter):
     * `[{ name, browseId, audience, artworkUrl }]`, or a rejection with an `ERR_YT_*` code.
     */
    AsyncFunction("searchArtists") Coroutine { query: String, meter: String? ->
      coded(meter) { client.searchArtists(query).map(YtArtistCandidate::toMap) }
    }

    /**
     * Albums, singles and EPs named like [query] (YouTube Music's "Albums"
     * filter): `[{ kind: "album", browseId, title, artists, year, artworkUrl }]`,
     * or a rejection with an `ERR_YT_*` code.
     */
    AsyncFunction("searchAlbums") Coroutine { query: String ->
      coded { client.searchAlbums(query).map(YtShelfItem.Album::toMap) }
    }

    /**
     * The artist page [browseId] (`UC…`): `{ name, songs, albums, singles }`,
     * or an `ERR_YT_*` rejection.
     */
    AsyncFunction("artist") Coroutine { browseId: String, meter: String? ->
      coded(meter) { YtPages(client).artist(browseId).toMap() }
    }

    /**
     * The playlist [playlistId]'s first page: `{ title, author, artworkUrl,
     * songs, continuation }`, or an `ERR_YT_*` rejection.
     */
    AsyncFunction("playlist") Coroutine { playlistId: String ->
      coded { YtPages(client).playlist(playlistId).toMap() }
    }

    /**
     * The playlist page a `continuation` leads to: `{ songs, continuation }`,
     * or an `ERR_YT_*` rejection.
     */
    AsyncFunction("playlistMore") Coroutine { continuation: String ->
      coded { YtPages(client).playlistMore(continuation).toMap() }
    }

    /**
     * The playlists in the signed-in account's library: `[{ playlistId,
     * title, artworkUrl, songCount, kind }]`, every page read, or an
     * `ERR_YT_*` rejection (`ERR_YT_SIGNED_OUT` without a session YouTube accepts).
     */
    AsyncFunction("libraryPlaylists") Coroutine { ->
      coded { YtPages(client).libraryPlaylists().map(YtLibraryPlaylist::toMap) }
    }

    /**
     * The first page of a song's radio: `{ songs, continuation }`, each song
     * with `video` (a music video rather than a song), or an `ERR_YT_*`
     * rejection. Needs no sign-in.
     */
    AsyncFunction("songRadio") Coroutine { videoId: String, meter: String? ->
      coded(meter) { YtPages(client).songRadio(videoId).toMap() }
    }

    /**
     * The first page of an artist's radio, from their page (`UC…`), as
     * [songRadio], with where it started: `start: { playlistId, params }`.
     */
    AsyncFunction("artistRadio") Coroutine { browseId: String, meter: String? ->
      coded(meter) { YtPages(client).artistRadio(browseId).toMap() }
    }

    /**
     * The first page of an artist's radio from a `start` [artistRadio] gave,
     * without reading their page, as [songRadio]: `ERR_YT_FAILED` when
     * YouTube Music no longer starts a radio there.
     */
    AsyncFunction("startedRadio") Coroutine { playlistId: String, params: String?, meter: String? ->
      coded(meter) { YtPages(client).startedRadio(YtRadioStart(playlistId, params)).toMap() }
    }

    /** The radio page a `continuation` leads to, as [songRadio]. */
    AsyncFunction("radioMore") Coroutine { continuation: String, meter: String? ->
      coded(meter) { YtPages(client).radioMore(continuation).toMap() }
    }

    /**
     * The entries of the account's playlist [playlistId]: `[{ videoId,
     * setVideoId }]`, every page; null when it's gone or isn't the account's.
     * An `ERR_YT_*` rejection otherwise (`ERR_YT_SIGNED_OUT` without a session).
     */
    AsyncFunction("ownPlaylist") Coroutine { playlistId: String ->
      coded { YtPlaylistWrites(client).ownPlaylist(playlistId)?.map(YtOwnEntry::toMap) }
    }

    /** Makes an unlisted playlist on the account with [videoIds] in order; resolves its id. */
    AsyncFunction("createPlaylist") Coroutine { title: String, videoIds: List<String> ->
      coded { YtPlaylistWrites(client).create(title, videoIds) }
    }

    /**
     * Applies [edits] (`{ kind: "add" | "remove" | "move" | "rename", … }`)
     * to the account's playlist [playlistId], in order, in one request.
     */
    AsyncFunction("editPlaylist") Coroutine { playlistId: String, edits: List<Map<String, Any?>> ->
      val known = edits.map { YtPlaylistEdit.of(it) ?: throw IllegalArgumentException("Unknown playlist edit: $it") }
      coded { YtPlaylistWrites(client).edit(playlistId, known) }
    }

    /** The saved session, without asking YouTube. */
    AsyncFunction("session") Coroutine { ->
      withContext(Dispatchers.IO) { client.session.state.toMap() }
    }

    /** The session after asking YouTube whose it is: refreshed, expired, or as it was without an answer. */
    AsyncFunction("checkSession") Coroutine { ->
      client.checkSession().toMap()
    }

    /**
     * Opens Google's sign-in page; resolves the session once it's signed in,
     * or null when the owner backs out. A session YouTube doesn't confirm
     * rejects with an `ERR_YT_*` code.
     */
    AsyncFunction("signIn") Coroutine { ->
      if (!client.enabled) throw CodedException(YtFailure.DISABLED.code, "YT Music is off", null)
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val credentials = YtSignInActivity.signIn(activity) ?: return@Coroutine null
      coded { client.signIn(credentials).toMap() }
    }

    /** Forgets the session and everything the sign-in web view kept. */
    AsyncFunction("signOut") Coroutine { ->
      withContext(Dispatchers.IO) { client.session.signOut() }
      withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { done -> YtSignInActivity.clearWebData { done.resume(Unit) } }
      }
      client.session.state.toMap()
    }

    /**
     * Caches a YT Music song's cover from [url] beside the Library's artwork:
     * `{ hash, path, thumbPath, palette }` (ARGB swatches), so the player,
     * the notification and Auto show it like a Library track's and Now
     * Playing takes its tint. Rejects with an `ERR_YT_*` code.
     */
    AsyncFunction("cacheArtwork") Coroutine { url: String ->
      val artwork = coded {
        client.request {
          val bytes = ArtistPhotoStore.httpGet(url)
          if (ArtworkStore.extensionOf(bytes) == "img") throw IOException("Not an image")
          artworkStore.store(bytes) ?: throw IOException("Unreadable image")
        }
      }
      mapOf(
        "hash" to artwork.hash,
        "path" to artwork.path,
        "thumbPath" to artwork.thumbPath,
        "palette" to artwork.palette.toMap(),
      )
    }
  }

  /** [block] with its failure as an `ERR_YT_*` code; its requests count on [meter] when given. */
  private suspend fun <T> coded(meter: String? = null, block: suspend () -> T): T =
    try {
      withContext(meter?.let(::NetworkMeter) ?: EmptyCoroutineContext) { block() }
    } catch (e: YtException) {
      throw CodedException(e.failure.code, e.message, e.cause)
    }
}
