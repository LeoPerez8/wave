package expo.modules.wavenative.player

/** Main-thread bridge: the service owns the wait, JS only observes it or sends owner commands. */
object StreamReconnectLink {
  var waitingForConnection = false
    private set

  /** A transport command cancels the wait even when pause is already the player's state. */
  var onOwnerCommand: ((moving: Boolean) -> Unit)? = null
  /** Rechecks elapsed time when the phone wakes; Handler delays do not include deep sleep. */
  var onCheck: (() -> Unit)? = null
  private val listeners = mutableListOf<() -> Unit>()

  fun setWaiting(waiting: Boolean) {
    if (waitingForConnection == waiting) return
    waitingForConnection = waiting
    listeners.toList().forEach { it() }
  }

  fun listen(listener: () -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }
}
