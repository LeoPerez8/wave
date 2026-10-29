package expo.modules.wavenative.recognize

/** A tile or shortcut request, kept in memory until the foreground UI takes it. */
object RecognizeInbox {
  const val ACTION = "dev.leoperez.wave.action.RECOGNIZE"
  private var pending = false
  @Volatile var onReceived: (() -> Unit)? = null

  fun receive(action: String?, fromHistory: Boolean = false) {
    if (action != ACTION || fromHistory) return
    synchronized(this) { pending = true }
    onReceived?.invoke()
  }

  fun take(): Boolean = synchronized(this) { pending.also { pending = false } }
}
