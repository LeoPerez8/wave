package expo.modules.wavenative.player

/** Main-thread bridge: the service owns the wait, JS only observes it or sends owner commands. */
object StreamReconnectLink {
  var waitingForConnection = false
    private set

  /**
   * The last wait ran out on its own (its deadline, the output going away, other audio), not
   * ended by the owner or by playing: Core's networkSignal shows Back only then.
   */
  var waitRanOut = false
    private set

  /** A transport command cancels the wait even when pause is already the player's state. */
  var onOwnerCommand: ((moving: Boolean) -> Unit)? = null
  /** Rechecks elapsed time when the phone wakes; Handler delays do not include deep sleep. */
  var onCheck: (() -> Unit)? = null
  private val listeners = mutableListOf<(resuming: Boolean) -> Unit>()

  /**
   * [resuming]: the wait ended because the service is preparing the song again. The session's
   * controllers still show the failed player then, until its next state reaches them.
   */
  fun setWaiting(waiting: Boolean, resuming: Boolean = false, ranOut: Boolean = false) {
    val ranOutNow = ranOut && !waiting
    if (waitingForConnection == waiting && waitRanOut == ranOutNow) return
    waitingForConnection = waiting
    waitRanOut = ranOutNow
    listeners.toList().forEach { it(!waiting && resuming) }
  }

  fun listen(listener: (resuming: Boolean) -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }
}
