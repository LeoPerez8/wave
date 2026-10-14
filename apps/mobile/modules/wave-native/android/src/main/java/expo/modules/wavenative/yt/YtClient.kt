package expo.modules.wavenative.yt

import android.content.Context
import com.metrolist.innertubex.InnerTube
import expo.modules.wavenative.net.Connectivity
import com.metrolist.innertubex.InnerTubeHttpException
import com.metrolist.innertubex.models.YouTubeClient
import com.metrolist.innertubex.models.YouTubeLocale
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.statement.bodyAsText
import io.ktor.serialization.kotlinx.json.json
import java.io.File
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

/**
 * Wave's one connection to YouTube Music, shared by everything native in the
 * process (the `WaveYtMusic` module now; the playback service and downloads
 * next). It owns the HTTP client and innertubex's session, refuses every
 * request while YT Music is off, and turns failures into a [YtFailure].
 *
 * innertubex only sends requests; [YtSearchParser] reads the answers. Wave
 * never calls innertubex's playback-reporting endpoints, and only ever plays
 * the audio stream itself, so no ad is requested or shown.
 */
class YtClient private constructor(private val context: Context) {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val connectivity = Connectivity(context)

  /** innertubex brings no HTTP engine and sends `@Serializable` bodies, hence content negotiation. */
  internal val http: HttpClient by lazy {
    HttpClient(OkHttp) {
      // innertubex checks statuses and retries transient failures itself.
      expectSuccess = false
      install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true })
      }
      install(HttpTimeout) {
        requestTimeoutMillis = 20_000
        connectTimeoutMillis = 10_000
        socketTimeoutMillis = 20_000
      }
    }
  }

  private val tube: InnerTube by lazy {
    InnerTube(http).apply {
      // Wave is in English; the country sets what YouTube Music offers.
      locale = YouTubeLocale(gl = Locale.getDefault().country.ifEmpty { "US" }, hl = "en")
    }
  }

  /**
   * Stream addresses for playing and downloading YT Music songs, through this
   * client's session ([YtStreamResolver]).
   */
  val streams: YtStreamResolver by lazy { YtStreamResolver(context) }

  /**
   * innertubex, with the session every request goes out with: the signed-in
   * account's ([session]), restored before the first request, or none.
   */
  val innerTube: InnerTube
    get() = tube.also { session }

  /**
   * The YouTube account requests go out as, kept in the app's no-backup
   * storage (never in a backup, never shown to JS or logged).
   */
  val session: YtSession by lazy {
    YtSession(
      YtSessionStore(File(context.noBackupFilesDir, SESSION_FILE)),
      rejects = { it is InnerTubeHttpException && it.status.value == 401 },
    ) { tube.use(it) }
  }

  /** Whether YT Music is on (Settings); kept here so native callers see it without JS. */
  var enabled: Boolean
    get() = prefs.getBoolean(KEY_ENABLED, true)
    set(on) {
      prefs.edit().putBoolean(KEY_ENABLED, on).apply()
    }

  /** Songs on YT Music for [query]: YouTube Music's "Songs" search, the first page. */
  suspend fun searchSongs(query: String): YtSearchPage = request {
    val response = innerTube.search(YouTubeClient.WEB_REMIX, query, params = FILTER_SONGS)
    YtSearchParser.songs(response.bodyAsText())
  }

  /** Artists on YT Music named like [query]: YouTube Music's "Artists" search, the first page. */
  suspend fun searchArtists(query: String): List<YtArtistCandidate> = request {
    val response = innerTube.search(YouTubeClient.WEB_REMIX, query, params = FILTER_ARTISTS)
    YtArtistParser.artists(response.bodyAsText())
  }

  /** Albums, singles and EPs on YT Music for [query]: YouTube Music's "Albums" search, the first page. */
  suspend fun searchAlbums(query: String): List<YtShelfItem.Album> = request {
    val response = innerTube.search(YouTubeClient.WEB_REMIX, query, params = FILTER_ALBUMS)
    YtSearchParser.albums(response.bodyAsText())
  }

  /**
   * Signs in with [credentials] from the sign-in page, once YouTube Music
   * says whose account they are. A session it doesn't accept fails.
   */
  suspend fun signIn(credentials: YtCredentials): YtSessionState = request {
    when (val menu = accountMenu(credentials)) {
      is YtAccountMenu.SignedIn -> session.signedIn(credentials, menu.account)
      YtAccountMenu.SignedOut -> throw YtException(YtFailure.FAILED)
    }
    session.state
  }

  /**
   * Asks YouTube Music whose account the session is, picking up a new name
   * or picture, or finding that it expired. Without an answer (offline, off,
   * YouTube failing) the session stays as it was.
   */
  suspend fun checkSession(): YtSessionState {
    val current = session.state as? YtSessionState.SignedIn ?: return session.state
    try {
      request { session.checked(current.credentials, accountMenu(current.credentials)) }
    } catch (_: YtException) {
      // No answer says nothing about the session.
    }
    return session.state
  }

  /** The account menu as [credentials] see it, asked on a session of its own. */
  private suspend fun accountMenu(credentials: YtCredentials): YtAccountMenu {
    val asked = tube.createIsolatedSession(includeAccount = false).apply { use(credentials) }
    try {
      val response = asked.accountMenu(YouTubeClient.WEB_REMIX)
      return YtAccountMenu.read(response.status.value, response.bodyAsText())
    } finally {
      asked.close()
    }
  }

  /**
   * Sends requests as the account of [credentials], or signed out for null.
   * The visitor data isn't the account's, so it stays as it is.
   */
  private fun InnerTube.use(credentials: YtCredentials?) {
    replaceSession(
      cookie = credentials?.cookie,
      visitorData = visitorData,
      dataSyncId = credentials?.dataSyncId,
      authUser = credentials?.authUser ?: "0",
      useLoginForBrowse = credentials != null,
    )
  }

  /**
   * Runs one YT Music request off the main thread: refused while off, not
   * tried without a network, and any failure reported as a [YtException].
   * A request YouTube refuses because the session expired is asked again
   * signed out, once (see [YtSession.expireIfRejected]).
   */
  suspend fun <T> request(block: suspend () -> T): T {
    if (!enabled) throw YtException(YtFailure.DISABLED)
    if (!connectivity.hasNetwork()) throw YtException(YtFailure.OFFLINE)
    return try {
      withContext(Dispatchers.IO) { block() }
    } catch (e: CancellationException) {
      throw e
    } catch (e: YtException) {
      throw e
    } catch (e: Throwable) {
      if (session.expireIfRejected(e)) return request(block)
      throw YtException(YtFailure.of(e, online()), e)
    }
  }

  /** Whether a failure happened online: else it's the phone being offline (see [Connectivity.online]). */
  internal fun online(): Boolean = connectivity.online()

  companion object {
    private const val PREFS = "wave_yt_music"
    private const val KEY_ENABLED = "enabled"

    /** In `noBackupFilesDir`: Android never backs it up. */
    private const val SESSION_FILE = "yt-session.json"

    /** YouTube Music's "Songs" search filter (as Metrolist's `SearchFilter.FILTER_SONG`). */
    const val FILTER_SONGS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"

    /** YouTube Music's "Artists" search filter (as Metrolist's `SearchFilter.FILTER_ARTIST`). */
    const val FILTER_ARTISTS = "EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D"

    /** YouTube Music's "Albums" search filter (as Metrolist's `SearchFilter.FILTER_ALBUM`). */
    const val FILTER_ALBUMS = "EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D"

    @Volatile private var instance: YtClient? = null

    fun get(context: Context): YtClient =
      instance ?: synchronized(this) {
        instance ?: YtClient(context.applicationContext).also { instance = it }
      }
  }
}
