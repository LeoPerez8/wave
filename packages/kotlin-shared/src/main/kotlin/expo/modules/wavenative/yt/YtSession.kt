package expo.modules.wavenative.yt

/**
 * The YouTube account every YT Music request goes out with, or none. It
 * restores the saved session when the process starts, so Wave stays signed
 * in across restarts, and hands the credentials to innertubex through
 * [useCredentials] (null: requests go out signed out).
 *
 * [rejects] says whether a failure (or one of its causes) is YouTube refusing
 * the credentials; it's innertubex's to tell, so [YtClient] passes it in.
 */
class YtSession(
  private val store: YtSessionStore,
  private val rejects: (Throwable) -> Boolean,
  private val useCredentials: (YtCredentials?) -> Unit,
) {
  @Volatile
  var state: YtSessionState = store.load()
    private set

  init {
    useCredentials((state as? YtSessionState.SignedIn)?.credentials)
  }

  /** Called with the new state whenever it changes (the `WaveYtMusic` module tells JS). */
  @Volatile
  var onChange: ((YtSessionState) -> Unit)? = null

  /** Signed in as [account] with [credentials], which YouTube accepted. */
  @Synchronized
  fun signedIn(credentials: YtCredentials, account: YtAccountInfo) {
    update(YtSessionState.SignedIn(credentials, account))
  }

  /**
   * Expires the session when [error] is YouTube rejecting its credentials,
   * and says whether it did, so the caller can ask again signed
   * out. Signed out, nothing is rejected twice: no error loop.
   */
  @Synchronized
  fun expireIfRejected(error: Throwable): Boolean {
    val current = state as? YtSessionState.SignedIn ?: return false
    if (!isRejected(error)) return false
    update(YtSessionState.Expired(current.account))
    return true
  }

  /**
   * What YouTube's account menu said when asked with [credentials]: the
   * account (its name or picture may have changed), or that the session is
   * over. An answer about a session Wave no longer holds changes nothing.
   */
  @Synchronized
  fun checked(credentials: YtCredentials, menu: YtAccountMenu) {
    val current = state as? YtSessionState.SignedIn ?: return
    if (current.credentials != credentials) return
    val next = when (menu) {
      is YtAccountMenu.SignedIn -> current.copy(account = menu.account)
      YtAccountMenu.SignedOut -> YtSessionState.Expired(current.account)
    }
    if (next != current) update(next)
  }

  /** Forgets the session; requests go out signed out. */
  @Synchronized
  fun signOut() {
    update(YtSessionState.SignedOut)
  }

  private fun update(next: YtSessionState) {
    store.save(next)
    state = next
    useCredentials((next as? YtSessionState.SignedIn)?.credentials)
    onChange?.invoke(next)
  }

  private fun isRejected(error: Throwable): Boolean = generateSequence(error) { it.cause }.any(rejects)
}
