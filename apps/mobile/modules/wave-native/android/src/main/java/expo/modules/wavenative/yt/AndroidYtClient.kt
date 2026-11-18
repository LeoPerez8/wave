package expo.modules.wavenative.yt

import android.content.Context
import com.metrolist.innertubex.extraction.TokenProvider
import expo.modules.wavenative.net.Connectivity
import expo.modules.wavenative.net.NetworkMeters
import expo.modules.wavenative.yt.potoken.YtPoTokens
import io.ktor.client.HttpClient
import java.io.File

/** The phone's one [YtClient] for the whole process, on [AndroidYtPlatform]. */
object AndroidYtClient {
  @Volatile private var instance: YtClient? = null

  fun get(context: Context): YtClient =
    instance ?: synchronized(this) {
      instance ?: YtClient(AndroidYtPlatform(context.applicationContext)).also { instance = it }
    }
}

/**
 * What [YtClient] takes from the phone: the switch in shared preferences, Android's view of the
 * network, the session in no-backup storage, and tokens minted in a hidden web view.
 */
private class AndroidYtPlatform(private val context: Context) : YtPlatform {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val connectivity = Connectivity(context)

  override fun http(lookups: YtLookupAttempts, meters: NetworkMeters): HttpClient = ytHttpClient(lookups, meters)

  override var enabled: Boolean
    get() = prefs.getBoolean(KEY_ENABLED, true)
    set(on) {
      prefs.edit().putBoolean(KEY_ENABLED, on).apply()
    }

  override fun hasNetwork(): Boolean = connectivity.hasNetwork()

  override fun online(): Boolean = connectivity.online()

  /** In `noBackupFilesDir`: Android never backs it up. */
  override val sessionStore: YtSessionStore get() = YtSessionFile(File(context.noBackupFilesDir, SESSION_FILE))

  override val visitorData: YtVisitorStore = object : YtVisitorStore {
    private val visitorPrefs = context.getSharedPreferences(VISITOR_PREFS, Context.MODE_PRIVATE)

    override fun load(): String? = visitorPrefs.getString(VISITOR_KEY, null)

    override fun save(value: String?) {
      if (value == null) visitorPrefs.edit().remove(VISITOR_KEY).apply()
      else visitorPrefs.edit().putString(VISITOR_KEY, value).apply()
    }
  }

  override fun tokens(): TokenProvider = YtPoTokens(context)

  private companion object {
    const val PREFS = "wave_yt_music"
    const val KEY_ENABLED = "enabled"
    const val SESSION_FILE = "yt-session.json"
    const val VISITOR_PREFS = "wave_yt_visitor"
    const val VISITOR_KEY = "visitor_data"
  }
}
