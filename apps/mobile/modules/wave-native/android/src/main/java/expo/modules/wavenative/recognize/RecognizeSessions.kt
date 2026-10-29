package expo.modules.wavenative.recognize

/** An ask for a session that Wave has stopped or replaced. */
class RecognizeSessionEnded : IllegalStateException("The session has ended")

/**
 * The module's one live [RecognizeSession], by the id JS gave its start (its request
 * number), so JS knows the id before any event can name it. Only audio that stops on
 * its own is a capture failure: a session Wave stops or replaces, including when Wave
 * goes to the background, reports nothing.
 */
class RecognizeSessions(
  private val recognize: (ShazamSignature) -> RecognizeOutcome,
  private val onHeard: (session: Int, heardMs: Int, audible: Boolean) -> Unit,
  private val onCaptureFailed: (session: Int) -> Unit,
) {
  private var current: Pair<Int, RecognizeSession>? = null

  /** Replaces any live session with one capturing [audio]; [started] gets its id before the capture starts. */
  @Synchronized
  fun start(id: Int, audio: RecognizeAudio, started: (Int) -> Unit) {
    stopAll()
    lateinit var session: RecognizeSession
    session = RecognizeSession(audio, recognize,
      onHeard = { ms, audible -> onHeard(id, ms, audible) },
      onCaptureFailed = { if (get(id) === session) onCaptureFailed(id) })
    current = id to session
    started(id)
    session.start()
  }

  @Synchronized
  fun get(id: Int): RecognizeSession? = current?.takeIf { it.first == id }?.second

  /** Blocking: call it off the main thread. Throws [RecognizeSessionEnded] once [id] isn't live. */
  fun ask(id: Int, last: Boolean): RecognizeOutcome = (get(id) ?: throw RecognizeSessionEnded()).ask(last)

  @Synchronized
  fun stop(id: Int) {
    if (current?.first == id) stopAll()
  }

  @Synchronized
  fun stopAll() {
    current?.second?.stop()
    current = null
  }
}
