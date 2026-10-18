package expo.modules.wavenative.spotify

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.net.Connectivity
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlin.coroutines.resume

/**
 * The Spotify account for JS (`WaveSpotify`): sign in through Spotify's page,
 * the session, and sign out. Nothing returned carries the cookie or a token:
 * the session is `{ status, account: { name, photoUrl } }`. Failures reject
 * with the codes of [SpotifyFailure].
 */
class SpotifyModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: SpotifyClient
    get() = clientFor(context)

  override fun definition() = ModuleDefinition {
    Name("WaveSpotify")

    /** The session changed natively: Spotify ended it during a request, say. */
    Events("onSessionChanged")

    OnStartObserving("onSessionChanged") {
      client.session.onChange = { sendEvent("onSessionChanged", it.toMap()) }
    }

    OnStopObserving("onSessionChanged") {
      client.session.onChange = null
    }

    /** The saved session, without asking Spotify. */
    AsyncFunction("session") Coroutine { ->
      withContext(Dispatchers.IO) { client.session.state.toMap() }
    }

    /** The session after asking Spotify whose it is: refreshed, expired, or as it was without an answer. */
    AsyncFunction("checkSession") Coroutine { ->
      client.checkSession().toMap()
    }

    /**
     * Opens Spotify's sign-in page; resolves the session once signed in, or
     * null when the owner backs out. A session Spotify doesn't confirm rejects
     * with an `ERR_SPOTIFY_*` code.
     */
    AsyncFunction("signIn") Coroutine { ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val credentials = SpotifySignInActivity.signIn(activity) ?: return@Coroutine null
      coded { client.signIn(credentials).toMap() }
    }

    /**
     * From Spotify (#486): a page of the account's library, of Liked Songs
     * or of a playlist, as the query's `data` in JSON for Core to read.
     * Rejects with an `ERR_SPOTIFY_*` code; a playlist that isn't a
     * `spotify:playlist:<id>` URI is never asked for.
     */
    AsyncFunction("library") Coroutine { offset: Int ->
      read(SpotifyLibraryQueries.library(offset))
    }

    AsyncFunction("likedSongs") Coroutine { offset: Int ->
      read(SpotifyLibraryQueries.likedSongs(offset))
    }

    AsyncFunction("playlist") Coroutine { uri: String, offset: Int ->
      read(SpotifyLibraryQueries.playlist(uri, offset) ?: throw CodedException(SpotifyFailure.FAILED.code, "Not a playlist", null))
    }

    /** Forgets the session, its token and everything the sign-in web view kept. */
    AsyncFunction("signOut") Coroutine { ->
      withContext(Dispatchers.IO) { client.session.signOut() }
      client.forgetToken()
      withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { done -> SpotifySignInActivity.clearWebData { done.resume(Unit) } }
      }
      client.session.state.toMap()
    }
  }

  private suspend fun read(query: Pair<SpotifyOperation, JsonObject>): String =
    coded { client.query(query.first, query.second).toString() }

  private suspend fun <T> coded(block: suspend () -> T): T =
    try {
      block()
    } catch (e: SpotifyException) {
      throw CodedException(e.failure.code, e.message, e.cause)
    }

  companion object {
    /** In `noBackupFilesDir`: Android never backs it up. */
    private const val SESSION_FILE = "spotify-session.json"

    @Volatile private var instance: SpotifyClient? = null

    /** The process-wide client, so #486's import and #487's share use the same session and token. */
    fun clientFor(context: Context): SpotifyClient =
      instance ?: synchronized(this) {
        instance ?: run {
          val app = context.applicationContext
          val connectivity = Connectivity(app)
          SpotifyClient(
            SpotifySession(SpotifySessionStore(File(app.noBackupFilesDir, SESSION_FILE))),
            UrlConnectionSpotifyHttp,
            hasNetwork = connectivity::hasNetwork,
            online = connectivity::online,
          ).also { instance = it }
        }
      }
  }
}
