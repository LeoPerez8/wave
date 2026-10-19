package expo.modules.wavenative.spotify

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
 * Spotify's sign-in page in a web view, as YT Music's sign-in works
 * ([expo.modules.wavenative.yt.YtSignInActivity]). Once the page reaches the
 * web player signed in, it hands the `sp_dc` cookie to whoever called
 * [signIn] and closes. The web view starts and ends empty: cookies and site
 * storage are cleared both ways, so the session's only copy is
 * [SpotifyClient]'s, in no-backup storage.
 */
class SpotifySignInActivity : Activity() {
  private lateinit var webView: WebView
  private val main = Handler(Looper.getMainLooper())
  private var delivered = false
  private var tries = 0

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestWindowFeature(Window.FEATURE_NO_TITLE)
    @Suppress("DEPRECATION")
    window.setDecorFitsSystemWindows(false)
    webView = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      webViewClient = Client()
    }
    val root = FrameLayout(this).apply {
      addView(webView)
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

  /** On the web player, waits for the session cookie, checking twice a second for ten. */
  private fun readSession() {
    tries = 0
    main.removeCallbacksAndMessages(null)
    main.post(object : Runnable {
      override fun run() {
        if (delivered || isFinishing) return
        val credentials = SpotifySignInPage.credentials(CookieManager.getInstance().getCookie(WEB_URL))
        if (credentials != null) {
          deliver(credentials)
          finish()
        } else if (++tries < MAX_TRIES) {
          main.postDelayed(this, RETRY_MS)
        }
      }
    })
  }

  private fun deliver(credentials: SpotifyCredentials?) {
    delivered = true
    synchronized(Companion) {
      pending?.complete(credentials)
      pending = null
    }
  }

  private inner class Client : WebViewClient() {
    /** Web pages only: the web player would otherwise hand over to the Spotify app. */
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      val scheme = request.url.scheme
      return scheme != "http" && scheme != "https"
    }

    override fun onPageFinished(view: WebView, url: String?) {
      val page = url?.let(Uri::parse) ?: return
      if (page.scheme == "https" && page.host == WEB_HOST) readSession()
    }
  }

  companion object {
    private const val WEB_HOST = "open.spotify.com"
    private const val WEB_URL = "https://$WEB_HOST"
    private const val SIGN_IN_URL = "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F"
    private const val MAX_TRIES = 20
    private const val RETRY_MS = 500L

    private var pending: CompletableDeferred<SpotifyCredentials?>? = null

    /**
     * Opens Spotify's sign-in page over [activity] and waits for it to close:
     * the session it signed in with, or null when the owner backed out.
     */
    suspend fun signIn(activity: Activity): SpotifyCredentials? {
      val result = CompletableDeferred<SpotifyCredentials?>()
      synchronized(this) {
        pending?.complete(null)
        pending = result
      }
      activity.startActivity(Intent(activity, SpotifySignInActivity::class.java))
      return result.await()
    }

    /**
     * Forgets everything the web view keeps: cookies and site storage. The web
     * view is shared app-wide, so this clears YT Music's sign-in page too, which
     * keeps nothing between sign-ins either. Main thread; [then] when done.
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
