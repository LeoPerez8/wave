package expo.modules.wavenative.recognize

/** A tile or shortcut request, kept in memory until the foreground UI takes it. */
object RecognizeInbox {
  const val ACTION = "dev.leoperez.wave.action.RECOGNIZE"
  const val MATCH_ACTION = "dev.leoperez.wave.action.RECOGNIZE_MATCH"
  const val MATCH_EXTRA = "recognizeMatch"
  private var match: String? = null
  @Volatile var onMatchReceived: (() -> Unit)? = null
  private var pending = false
  @Volatile var onReceived: (() -> Unit)? = null

  fun receive(action: String?, fromHistory: Boolean = false, match: String? = null) {
    if (fromHistory) return
    if (action == MATCH_ACTION && match != null) {
      synchronized(this) { this.match = match }
      onMatchReceived?.invoke()
      return
    }
    if (action != ACTION) return
    synchronized(this) { pending = true }
    onReceived?.invoke()
  }

  fun takeMatch(): String? = synchronized(this) { match.also { match = null } }

  fun take(): Boolean = synchronized(this) { pending.also { pending = false } }
}
