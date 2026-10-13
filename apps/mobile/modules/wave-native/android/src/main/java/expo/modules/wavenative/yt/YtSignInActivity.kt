package expo.modules.wavenative.yt

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Window
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher
import android.widget.FrameLayout
import kotlinx.coroutines.CompletableDeferred

/**
 * Google's sign-in page in a web view, the way Metrolist signs in
 * (`LoginScreen`, GPL-3.0). Once the page reaches YouTube Music signed in, it
 * hands the session to whoever called [signIn] and closes. The web view
 * starts and ends empty: its cookies and storage are cleared both ways, so
 * the session's only copy is [YtClient]'s, in no-backup storage.
 */
class YtSignInActivity : Activity() {
  private lateinit var webView: WebView
  private val main = Handler(Looper.getMainLooper())
  private var delivered = false
  private var tries = 0

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestWindowFeature(Window.FEATURE_NO_TITLE)
    // Edge to edge, as Android 15 and later draw it anyway; the insets below keep the page clear.
    @Suppress("DEPRECATION")
    window.setDecorFitsSystemWindows(false)
    webView = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      webViewClient = Client()
    }
    val root = FrameLayout(this).apply {
      addView(webView)
      // Clear of the status bar, the navigation bar and the keyboard.
      setOnApplyWindowInsetsListener { view, insets ->
        val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        WindowInsets.CONSUMED
      }
    }
    setContentView(root)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
    }
    // A fresh page, so an earlier (expired) session doesn't sign straight back in.
    clearWebData { webView.loadUrl(SIGN_IN_URL) }
  }

  @Deprecated("Android 12: Back before OnBackInvokedDispatcher")
  override fun onBackPressed() {
    back()
  }

  /** Back goes back through Google's pages, then out of the sign-in. */
  private fun back() {
    if (webView.canGoBack()) webView.goBack() else finish()
  }

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    if (isFinishing) {
      if (!delivered) deliver(null)
      webView.stopLoading()
      webView.clearHistory()
      webView.clearCache(true)
      webView.destroy()
      clearWebData {}
    }
    super.onDestroy()
  }

  /**
   * On YouTube Music, waits for Google's session cookie and the page's
   * account (the page sets them as it loads), checking twice a second for ten.
   */
  private fun readSession() {
    tries = 0
    main.removeCallbacksAndMessages(null)
    main.post(object : Runnable {
      override fun run() {
        if (delivered || isFinishing) return
        val cookie = CookieManager.getInstance().getCookie(MUSIC_URL)
        webView.evaluateJavascript(YtSignInPage.CONFIG_SCRIPT) { config ->
          if (delivered || isFinishing) return@evaluateJavascript
          val credentials = YtSignInPage.credentials(cookie, config)
          if (credentials != null) {
            deliver(credentials)
            finish()
          } else if (++tries < MAX_TRIES) {
            main.postDelayed(this, RETRY_MS)
          }
        }
      }
    })
  }

  private fun deliver(credentials: YtCredentials?) {
    delivered = true
    synchronized(Companion) {
      pending?.complete(credentials)
      pending = null
    }
  }

  private inner class Client : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      val scheme = request.url.scheme
      if (scheme == "http" || scheme == "https") return false
      // Google hands some steps (a passkey, another app) to the system.
      runCatching {
        startActivity(
          Intent.parseUri(request.url.toString(), Intent.URI_INTENT_SCHEME).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
            component = null
            selector = null
          },
        )
      }
      return true
    }

    override fun onPageFinished(view: WebView, url: String?) {
      val page = url?.let(Uri::parse) ?: return
      if (page.scheme == "https" && page.host == MUSIC_HOST) readSession()
    }
  }

  companion object {
    private const val MUSIC_HOST = "music.youtube.com"
    private const val MUSIC_URL = "https://$MUSIC_HOST"
    private const val SIGN_IN_URL =
      "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com"
    private const val MAX_TRIES = 20
    private const val RETRY_MS = 500L

    private var pending: CompletableDeferred<YtCredentials?>? = null

    /**
     * Opens the sign-in page over [activity] and waits for it to close: the
     * session it signed in with, or null when the owner backed out.
     */
    suspend fun signIn(activity: Activity): YtCredentials? {
      val result = CompletableDeferred<YtCredentials?>()
      synchronized(this) {
        pending?.complete(null)
        pending = result
      }
      activity.startActivity(Intent(activity, YtSignInActivity::class.java))
      return result.await()
    }

    /**
     * Forgets everything the web view keeps: cookies (Google's session among
     * them) and site storage. Runs on the main thread; [then] when done.
     */
    fun clearWebData(then: () -> Unit) {
      WebStorage.getInstance().deleteAllData()
      CookieManager.getInstance().removeAllCookies {
        CookieManager.getInstance().flush()
        then()
      }
    }
  }
}
