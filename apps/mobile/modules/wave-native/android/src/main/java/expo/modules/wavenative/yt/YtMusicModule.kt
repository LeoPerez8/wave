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
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/**
 * YT Music for JS (`WaveYtMusic`): the switch in Settings, song search, the
 * home's recommendations and playlists (Discover), the account and caching a
 * played song's cover. (Album pages are `WaveYtDownloads.album`.) (Playing is the playback
 * service's: it streams `yt:` queue items, see [YtDataSource].) Requests go
 * through the process-wide [YtClient]; failures reject with the codes of
 * [YtFailure]. Nothing returned carries cookies or stream addresses: the
 * account is `{ status, account: { name, email, photoUrl } }`.
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

    /** `{ songs, continuation }` for [query], or a rejection with an `ERR_YT_*` code. */
    AsyncFunction("searchSongs") Coroutine { query: String ->
      coded { client.searchSongs(query).toMap() }
    }

    /**
     * The account's recommendations, YouTube Music's home: `[{ title, items }]`,
     * each item `{ kind: "song" | "album" | "playlist", … }`. Rejects with an
     * `ERR_YT_*` code.
     */
    AsyncFunction("home") Coroutine { ->
      coded { YtPages(client).home().map(YtShelf::toMap) }
    }

    /** The playlist [playlistId]: `{ title, author, artworkUrl, songs }`, or an `ERR_YT_*` rejection. */
    AsyncFunction("playlist") Coroutine { playlistId: String ->
      coded { YtPages(client).playlist(playlistId).toMap() }
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

  private suspend fun <T> coded(block: suspend () -> T): T =
    try {
      block()
    } catch (e: YtException) {
      throw CodedException(e.failure.code, e.message, e.cause)
    }
}
