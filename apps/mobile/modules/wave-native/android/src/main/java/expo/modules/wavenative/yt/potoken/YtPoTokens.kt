package expo.modules.wavenative.yt.potoken

import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import com.metrolist.innertubex.extraction.PoTokenResult
import com.metrolist.innertubex.extraction.TokenProvider
import com.metrolist.innertubex.extraction.TokenProviderCapabilities
import com.metrolist.innertubex.extraction.strategy.PoTokenProviderKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * The proof-of-origin tokens innertubex asks for to stream through YouTube
 * Music's web client: one bound to the visitor data (minted once per web
 * view) and one bound to each video. Minted by BotGuard in a hidden web view
 * ([YtPoTokenWebView]), recreated when its integrity token expires, its
 * renderer dies or the visitor data changes. When no token comes in time,
 * innertubex goes on with clients that don't need one.
 *
 * Ported from Metrolist's `utils/potoken/PoTokenGenerator.kt` (GPL-3.0).
 */
class YtPoTokens(context: Context) : TokenProvider {
  private val appContext = context.applicationContext
  private val lock = Mutex()
  private var webView: YtPoTokenWebView? = null
  private var webViewVisitorData: String? = null
  private var visitorToken: String? = null

  /** Whether the phone has a usable WebView; false for good after one can't run BotGuard. */
  @Volatile private var webViewUsable: Boolean? = null

  override val capabilities =
    TokenProviderCapabilities(providers = setOf(PoTokenProviderKind.WEB_BOTGUARD), usesWebView = true)

  override suspend fun getPoToken(videoId: String, visitorData: String, cookie: String?): PoTokenResult? {
    if (!hasWebView()) return null
    return try {
      withTimeout(TOKEN_TIMEOUT_MS) {
        val (playerToken, streamingToken) = tokens(videoId, visitorData, recreate = false)
        PoTokenResult(playerRequestToken = playerToken, streamingDataToken = streamingToken, visitorData = visitorData)
      }
    } catch (e: TimeoutCancellationException) {
      Log.w(TAG, "No proof-of-origin token in time; going on without")
      reset()
      null
    } catch (e: CancellationException) {
      throw e
    } catch (e: BadWebViewException) {
      Log.w(TAG, "The WebView can't mint proof-of-origin tokens")
      webViewUsable = false
      null
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't mint a proof-of-origin token (${e::class.simpleName})")
      null
    }
  }

  override suspend fun close() = reset()

  /** The visitor-bound token and [videoId]'s, recreating the web view when it can't mint. */
  private suspend fun tokens(videoId: String, visitorData: String, recreate: Boolean): Pair<String, String> {
    val (view, visitor, fresh) = lock.withLock {
      val current = webView
      val renew = recreate || current == null || current.isExpired || current.isDead ||
        webViewVisitorData != visitorData
      if (renew) {
        withContext(Dispatchers.Main) { current?.close() }
        webView = null
        visitorToken = null
        webViewVisitorData = null
        val created = YtPoTokenWebView.create(appContext)
        // The visitor-bound token comes first, before any other is minted.
        val token = try {
          created.mint(visitorData)
        } catch (e: Throwable) {
          created.close()
          throw e
        }
        webView = created
        visitorToken = token
        webViewVisitorData = visitorData
      }
      Triple(webView!!, visitorToken!!, renew)
    }
    val videoToken = try {
      view.mint(videoId)
    } catch (e: PoTokenException) {
      // A web view that lost its page (Wave was in the background) is recreated once.
      if (fresh) throw e
      return tokens(videoId, visitorData, recreate = true)
    }
    return visitor to videoToken
  }

  private suspend fun reset() {
    lock.withLock {
      withContext(Dispatchers.Main) { webView?.close() }
      webView = null
      visitorToken = null
      webViewVisitorData = null
    }
  }

  private fun hasWebView(): Boolean =
    webViewUsable ?: runCatching { CookieManager.getInstance() }.isSuccess.also { webViewUsable = it }

  private companion object {
    const val TAG = "WaveYtPoToken"

    /**
     * A healthy cold start (web view, BotGuard, two tokens) takes a few
     * seconds; past this, playback goes on without a token rather than wait.
     */
    const val TOKEN_TIMEOUT_MS = 8_000L
  }
}
