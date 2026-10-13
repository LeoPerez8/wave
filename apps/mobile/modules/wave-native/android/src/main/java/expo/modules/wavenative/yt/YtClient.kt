package expo.modules.wavenative.yt

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.metrolist.innertubex.InnerTube
import com.metrolist.innertubex.models.YouTubeClient
import com.metrolist.innertubex.models.YouTubeLocale
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.statement.bodyAsText
import io.ktor.serialization.kotlinx.json.json
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
class YtClient private constructor(context: Context) {
  private val appContext = context
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val connectivity = context.getSystemService(ConnectivityManager::class.java)

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

  /** The session every request goes out with: signed out until sign-in (#108) replaces it. */
  val innerTube: InnerTube by lazy {
    InnerTube(http).apply {
      // Wave is in English; the country sets what YouTube Music offers.
      locale = YouTubeLocale(gl = Locale.getDefault().country.ifEmpty { "US" }, hl = "en")
    }
  }

  /**
   * Stream addresses for playing and downloading YT Music songs, through this
   * client's session ([YtStreamResolver]).
   */
  val streams: YtStreamResolver by lazy { YtStreamResolver(appContext) }

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

  /**
   * Runs one YT Music request off the main thread: refused while off, not
   * tried without a network, and any failure reported as a [YtException].
   */
  suspend fun <T> request(block: suspend () -> T): T {
    if (!enabled) throw YtException(YtFailure.DISABLED)
    if (!hasNetwork()) throw YtException(YtFailure.OFFLINE)
    return try {
      withContext(Dispatchers.IO) { block() }
    } catch (e: CancellationException) {
      throw e
    } catch (e: YtException) {
      throw e
    } catch (e: Throwable) {
      throw YtException(YtFailure.of(e, hasNetwork()), e)
    }
  }

  internal fun hasNetwork(): Boolean {
    val network = connectivity?.activeNetwork ?: return false
    return connectivity.getNetworkCapabilities(network)
      ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
  }

  companion object {
    private const val PREFS = "wave_yt_music"
    private const val KEY_ENABLED = "enabled"

    /** YouTube Music's "Songs" search filter (as Metrolist's `SearchFilter.FILTER_SONG`). */
    const val FILTER_SONGS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"

    @Volatile private var instance: YtClient? = null

    fun get(context: Context): YtClient =
      instance ?: synchronized(this) {
        instance ?: YtClient(context.applicationContext).also { instance = it }
      }
  }
}
