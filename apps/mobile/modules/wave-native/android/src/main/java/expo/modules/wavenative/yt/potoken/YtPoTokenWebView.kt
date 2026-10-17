package expo.modules.wavenative.yt.potoken

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import expo.modules.wavenative.log.WaveLog
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/** A proof-of-origin token couldn't be minted (this time). */
class PoTokenException(message: String) : Exception(message)

/** The phone's WebView can't run BotGuard at all; Wave stops trying for the session. */
class BadWebViewException(message: String) : Exception(message)

/**
 * A hidden web view running YouTube's BotGuard to mint proof-of-origin
 * tokens, the attestation YouTube's web client sends to be served audio. The
 * page (`wave_po_token.html`) loads nothing from the network itself: Wave
 * fetches BotGuard's challenge and integrity token (`api/jnn/v1/Create`,
 * `GenerateIT` on www.youtube.com) and hands them in. Once set up, it mints a
 * token per identifier (the visitor data, a video id) until the integrity
 * token runs out.
 *
 * Ported from Metrolist's `utils/potoken/PoTokenWebView.kt` (GPL-3.0), itself
 * from NewPipe. Tokens are never logged. WebView calls run on the main thread.
 */
class YtPoTokenWebView private constructor(
  context: Context,
  /** Resumed once, when set-up ends. */
  private val continuation: Continuation<YtPoTokenWebView>,
) {
  private val webView = WebView(context)
  private val scope = MainScope()
  private val initResumed = AtomicBoolean(false)
  private val pending = ConcurrentHashMap<String, Continuation<String>>()
  private val requests = AtomicLong()
  private val exceptionHandler = CoroutineExceptionHandler { _, error -> failSetUp(error) }

  @Volatile private var closed = false

  @Volatile private var expiresAtMs = 0L

  /** The renderer died or stopped answering; a new web view is needed. */
  @Volatile var isDead = false
    private set

  val isExpired: Boolean
    get() = System.currentTimeMillis() >= expiresAtMs

  init {
    webView.settings.apply {
      @Suppress("SetJavaScriptEnabled")
      javaScriptEnabled = true
      userAgentString = USER_AGENT
      // The page needs no network: Wave makes BotGuard's requests.
      blockNetworkLoads = true
    }
    webView.addJavascriptInterface(this, JS_INTERFACE)
    webView.webChromeClient = object : WebChromeClient() {
      override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        val text = message.message()
        if ("Uncaught" in text) {
          val description = "\"$text\", line ${message.lineNumber()}"
          if (initResumed.get()) {
            // After set-up, errors come from BotGuard's own (remote) code: start over next time.
            isDead = true
            close()
            failPending(PoTokenException(description))
          } else {
            val error = BadWebViewException(description)
            failSetUp(error)
            failPending(error)
          }
        }
        return super.onConsoleMessage(message)
      }
    }
    webView.webViewClient = object : WebViewClient() {
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        WaveLog.w(TAG, "Token web view renderer gone (crashed: ${detail.didCrash()})")
        isDead = true
        val error = PoTokenException("Renderer gone")
        failSetUp(error)
        failPending(error)
        // Handled: the app's process lives on.
        return true
      }
    }
  }

  private fun loadPage() {
    scope.launch(exceptionHandler) {
      val html = withContext(Dispatchers.IO) {
        webView.context.assets.open(PAGE).bufferedReader().use { it.readText() }
      }
      // Starts BotGuard once the page's script has run.
      val page = html.replaceFirst("</script>", "\n$JS_INTERFACE.downloadAndRunBotguard()</script>")
      webView.loadDataWithBaseURL("https://www.youtube.com", page, "text/html", "utf-8", null)
    }
  }

  @JavascriptInterface
  fun downloadAndRunBotguard() {
    botGuardRequest(CREATE_URL, "[ \"$REQUEST_KEY\" ]") { body ->
      val challenge = YtBotGuard.challengeJson(body)
      webView.evaluateJavascript(
        """try {
          data = $challenge
          runBotGuard(data).then(function (result) {
            this.webPoSignalOutput = result.webPoSignalOutput
            $JS_INTERFACE.onRunBotguardResult(result.botguardResponse)
          }, function (error) {
            $JS_INTERFACE.onJsInitializationError(error + "\n" + error.stack)
          })
        } catch (error) {
          $JS_INTERFACE.onJsInitializationError(error + "\n" + error.stack)
        }""",
        null,
      )
    }
  }

  @JavascriptInterface
  fun onJsInitializationError(error: String) {
    failSetUp(if ("SyntaxError" in error) BadWebViewException(error) else PoTokenException(error))
  }

  @JavascriptInterface
  fun onRunBotguardResult(botguardResponse: String) {
    botGuardRequest(GENERATE_IT_URL, "[ \"$REQUEST_KEY\", \"$botguardResponse\" ]") { body ->
      val (integrityToken, lifetimeSeconds) = YtBotGuard.integrityToken(body)
      // Ten minutes early, to be safe.
      expiresAtMs = System.currentTimeMillis() + (lifetimeSeconds - 600).coerceAtLeast(0) * 1000
      webView.evaluateJavascript(
        """try {
          this.integrityToken = $integrityToken
          createPoTokenMinter(webPoSignalOutput, integrityToken).then(function () {
            $JS_INTERFACE.onMinterCreated()
          }).catch(function (error) {
            $JS_INTERFACE.onJsInitializationError(error + "\n" + (error.stack || ''))
          })
        } catch (error) {
          $JS_INTERFACE.onJsInitializationError(error + "\n" + error.stack)
        }""",
        null,
      )
    }
  }

  @JavascriptInterface
  fun onMinterCreated() {
    if (initResumed.compareAndSet(false, true)) continuation.resume(this)
  }

  /** A token bound to [identifier] (the visitor data, or a video id). */
  suspend fun mint(identifier: String): String {
    if (isDead || closed) throw PoTokenException("Token web view is gone")
    // Each call gets its own key, so two for the same video don't take each other's token.
    val key = "$identifier#${requests.incrementAndGet()}"
    return try {
      withTimeout(MINT_TIMEOUT_MS) {
        withContext(Dispatchers.Main) {
          suspendCancellableCoroutine { cont ->
            pending[key] = cont
            webView.evaluateJavascript(
              """(function () {
                var requestKey = "$key"
                try {
                  obtainPoToken(${YtBotGuard.bytesOf(identifier)}).then(function (token) {
                    $JS_INTERFACE.onObtainPoTokenResult(requestKey, token.join(","))
                  }).catch(function (error) {
                    $JS_INTERFACE.onObtainPoTokenError(requestKey, error + "\n" + (error.stack || ''))
                  })
                } catch (error) {
                  $JS_INTERFACE.onObtainPoTokenError(requestKey, error + "\n" + error.stack)
                }
              })()""",
              null,
            )
          }
        }
      }
    } catch (e: TimeoutCancellationException) {
      // A renderer that doesn't answer is wedged: the next call starts a new web view.
      isDead = true
      pending.remove(key)
      throw PoTokenException("Minting timed out")
    }
  }

  @JavascriptInterface
  fun onObtainPoTokenError(requestKey: String, error: String) {
    pending.remove(requestKey)?.resumeWithException(PoTokenException(error))
  }

  @JavascriptInterface
  fun onObtainPoTokenResult(requestKey: String, bytes: String) {
    val cont = pending.remove(requestKey) ?: return
    runCatching { YtBotGuard.tokenFromBytes(bytes) }
      .onSuccess(cont::resume)
      .onFailure(cont::resumeWithException)
  }

  /** POSTs [body] to BotGuard's [url] and hands the answer to [handle] on the main thread. */
  private fun botGuardRequest(url: String, body: String, handle: (String) -> Unit) {
    scope.launch(exceptionHandler) {
      val answer = withContext(Dispatchers.IO) { post(url, body) }
      handle(answer)
    }
  }

  private fun post(url: String, body: String): String {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = HTTP_TIMEOUT_MS
      connection.readTimeout = HTTP_TIMEOUT_MS
      connection.doOutput = true
      connection.setRequestProperty("User-Agent", USER_AGENT)
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Content-Type", "application/json+protobuf")
      connection.setRequestProperty("x-goog-api-key", GOOGLE_API_KEY)
      connection.setRequestProperty("x-user-agent", "grpc-web-javascript/0.1")
      connection.outputStream.use { it.write(body.toByteArray()) }
      val code = connection.responseCode
      val answer = if (code == HttpURLConnection.HTTP_OK) connection.inputStream.use { it.readBytes().decodeToString() } else null
      if (answer.isNullOrEmpty()) throw IOException("BotGuard answered $code")
      return answer
    } finally {
      connection.disconnect()
    }
  }

  private fun failSetUp(error: Throwable) {
    close()
    if (initResumed.compareAndSet(false, true)) runCatching { continuation.resumeWithException(error) }
  }

  private fun failPending(error: Throwable) {
    val all = pending.keys.toList().mapNotNull { pending.remove(it) }
    all.forEach { runCatching { it.resumeWithException(error) } }
  }

  fun close() {
    if (closed) return
    closed = true
    scope.cancel()
    if (Looper.myLooper() == Looper.getMainLooper()) destroy() else Handler(Looper.getMainLooper()).post(::destroy)
  }

  private fun destroy() {
    runCatching {
      webView.clearHistory()
      webView.clearCache(true)
      webView.loadUrl("about:blank")
      webView.onPause()
      webView.removeAllViews()
      webView.destroy()
    }
  }

  companion object {
    private const val TAG = "WaveYtPoToken"
    private const val PAGE = "wave_po_token.html"
    private const val JS_INTERFACE = "PoTokenWebView"
    private const val CREATE_URL = "https://www.youtube.com/api/jnn/v1/Create"
    private const val GENERATE_IT_URL = "https://www.youtube.com/api/jnn/v1/GenerateIT"

    // BotGuard's public web key and request key, as YouTube's web player sends them.
    private const val GOOGLE_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw"
    private const val REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"
    private const val USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.3"

    private const val HTTP_TIMEOUT_MS = 15_000

    /** Set-up makes two round trips to BotGuard and runs its program. */
    private const val SET_UP_TIMEOUT_MS = 45_000L

    /** A live renderer mints a token in well under a second. */
    private const val MINT_TIMEOUT_MS = 15_000L

    /** A web view with BotGuard set up and ready to mint. */
    suspend fun create(context: Context): YtPoTokenWebView {
      var created: YtPoTokenWebView? = null
      try {
        return withTimeout(SET_UP_TIMEOUT_MS) {
          withContext(Dispatchers.Main) {
            suspendCancellableCoroutine { cont ->
              val view = YtPoTokenWebView(context, cont)
              created = view
              view.loadPage()
            }
          }
        }
      } catch (e: TimeoutCancellationException) {
        closeQuietly(created)
        throw PoTokenException("Set-up timed out")
      } catch (e: CancellationException) {
        closeQuietly(created)
        throw e
      }
    }

    private suspend fun closeQuietly(view: YtPoTokenWebView?) {
      if (view == null) return
      withContext(NonCancellable + Dispatchers.Main) {
        // A late callback mustn't resume the cancelled set-up.
        view.initResumed.set(true)
        view.close()
      }
    }
  }
}
