package dev.leoperez.wave.stdio

import com.metrolist.innertubex.extraction.PoTokenResult
import com.metrolist.innertubex.extraction.TokenProvider
import com.metrolist.innertubex.extraction.TokenProviderCapabilities
import com.metrolist.innertubex.extraction.strategy.PoTokenProviderKind
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.net.NetworkMeters
import expo.modules.wavenative.yt.YtLookupAttempts
import expo.modules.wavenative.yt.YtPlatform
import expo.modules.wavenative.yt.YtSessionJson
import expo.modules.wavenative.yt.YtSessionState
import expo.modules.wavenative.yt.YtSessionStore
import expo.modules.wavenative.yt.YtVisitorStore
import expo.modules.wavenative.yt.ytHttpClient
import io.ktor.client.HttpClient
import java.io.File
import java.net.InetAddress
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull

/** How [YtPlatform.http] makes the HTTP client: [ytHttpClient], or a test's. */
typealias YtHttp = (YtLookupAttempts, NetworkMeters) -> HttpClient

/**
 * What the shared YouTube Music client takes from the desktop: the visitor data in Wave's data
 * folder ([dataDir]), the session and tokens from the host ([HostSessionStore], [HostTokens]).
 * The device counts as online when YouTube's name resolves.
 */
class DesktopYtPlatform(
  private val dataDir: File,
  private val host: JsonLines,
  private val makeHttp: YtHttp = ::ytHttpClient,
  private val isOnline: () -> Boolean = ::reachesYouTube,
) : YtPlatform {
  override fun http(lookups: YtLookupAttempts, meters: NetworkMeters): HttpClient = makeHttp(lookups, meters)

  @Volatile override var enabled: Boolean = true

  // A desktop has no cheap check, so every request is tried and [online] tells offline from failed.
  override fun hasNetwork(): Boolean = true

  override fun online(): Boolean = isOnline()

  override val sessionStore = HostSessionStore(host)

  override val visitorData: YtVisitorStore = FileVisitorStore(File(dataDir, "yt-visitor-data"))

  override fun tokens(): TokenProvider = HostTokens(host)
}

/**
 * The YouTube session as the host keeps it: the cookie is a credential, and only the host can
 * seal it with the system's keyring, so this process writes it nowhere. `ytSession.load` answers
 * `{"session": {...} | null}` ([YtSessionJson]) once per run, before the first request
 * ([restore]); `ytSession.save` `{"session"}` hands each change back.
 */
class HostSessionStore(private val host: JsonLines) : YtSessionStore {
  @Volatile private var held: YtSessionState? = null
  private val restoring = Mutex()

  /** Takes the session the host kept, once; without an answer this run starts signed out. */
  suspend fun restore() {
    if (held != null) return
    restoring.withLock {
      if (held != null) return
      held = try {
        val answer = host.ask("ytSession.load", JsonObject(emptyMap())) as? JsonObject
        YtSessionJson.decode(answer?.get("session") as? JsonObject)
      } catch (e: HostError) {
        WaveLog.w(SESSION_TAG, "The host handed over no YouTube session (${e.code}); starting signed out")
        YtSessionState.SignedOut
      }
    }
  }

  override fun load(): YtSessionState = held ?: YtSessionState.SignedOut

  /** A change the host doesn't take lasts until this process ends. */
  override fun save(state: YtSessionState) {
    held = state
    try {
      runBlocking {
        host.ask("ytSession.save", buildJsonObject { put("session", YtSessionJson.encode(state) ?: JsonNull) })
      }
    } catch (e: HostError) {
      WaveLog.w(SESSION_TAG, "The host didn't keep the YouTube session (${e.code})")
    }
  }

  private companion object {
    const val SESSION_TAG = "WaveYtSession"
  }
}

/** The visitor data in a file of its own. */
private class FileVisitorStore(private val file: File) : YtVisitorStore {
  override fun load(): String? =
    runCatching { file.readText().trim() }.getOrNull()?.takeIf { it.isNotEmpty() }

  override fun save(value: String?) {
    if (value == null) {
      file.delete()
    } else {
      file.parentFile?.mkdirs()
      file.writeText(value)
    }
  }
}

/** Whether YouTube Music's name resolves, so a failed request means YouTube failed, not the network. */
fun reachesYouTube(): Boolean = runCatching { InetAddress.getByName("music.youtube.com") }.isSuccess

/**
 * The desktop twin of the phone's YtPoTokens: innertubex asks for a video's proof-of-origin
 * tokens and the host mints them with BotGuard in a hidden browser window, as the phone's web
 * view does. `{"method":"poToken","params":{"identifiers":[visitorData, videoId]}}` gets
 * `{"tokens":[visitor-bound, video-bound]}`. Without tokens in time innertubex goes on with the
 * clients that need none, as on the phone.
 */
class HostTokens(private val host: JsonLines) : TokenProvider {
  override val capabilities =
    TokenProviderCapabilities(providers = setOf(PoTokenProviderKind.WEB_BOTGUARD), usesWebView = true)

  override suspend fun getPoToken(videoId: String, visitorData: String, cookie: String?): PoTokenResult? =
    try {
      val params = buildJsonObject {
        put(
          "identifiers",
          buildJsonArray {
            add(JsonPrimitive(visitorData))
            add(JsonPrimitive(videoId))
          },
        )
      }
      val answer = host.ask("poToken", params, TOKEN_TIMEOUT_MS) as? JsonObject
      val tokens = (answer?.get("tokens") as? JsonArray)?.map { (it as? JsonPrimitive)?.contentOrNull }
      val visitorToken = tokens?.getOrNull(0)
      val videoToken = tokens?.getOrNull(1)
      if (tokens?.size == 2 && visitorToken != null && videoToken != null) {
        PoTokenResult(playerRequestToken = visitorToken, streamingDataToken = videoToken, visitorData = visitorData)
      } else {
        WaveLog.w(TAG, "The host's proof-of-origin answer held no tokens; going on without")
        null
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: HostError) {
      WaveLog.w(TAG, "No proof-of-origin token from the host (${e.code}); going on without")
      null
    }

  private companion object {
    const val TAG = "WavePoToken"

    /** As long as the phone's web view gets. */
    const val TOKEN_TIMEOUT_MS = 8_000L
  }
}
