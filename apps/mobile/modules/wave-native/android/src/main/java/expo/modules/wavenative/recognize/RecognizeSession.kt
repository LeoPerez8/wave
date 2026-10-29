package expo.modules.wavenative.recognize

/**
 * What a session listens to: 16 kHz mono 16-bit PCM. The microphone is one
 * ([MicrophoneAudio]); the phone's own audio (#771) is another.
 */
interface RecognizeAudio {
  /**
   * Fills [buffer] with the next samples, blocking until some come: how many, or a
   * negative number once the audio has stopped (after [stop], or on its own).
   */
  fun read(buffer: ShortArray): Int

  /** Makes [read] return; safe from any thread. */
  fun stop()

  /** Lets the audio go. The capture thread calls it once, after its last [read]. */
  fun release()
}

/**
 * One Recognize session's native half: it captures [audio] on a thread of its own
 * into a [SignatureGenerator], reports how much it has heard every [HEARD_STEP_MS],
 * and on [ask] sends the signature of everything heard so far through [recognize].
 * When to ask, and what an answer means for the session, is Core's (`stepRecognize`).
 */
class RecognizeSession(
  private val audio: RecognizeAudio,
  private val recognize: (ShazamSignature) -> RecognizeOutcome,
  private val onHeard: (heardMs: Int, audible: Boolean) -> Unit,
  private val onCaptureFailed: () -> Unit,
) {
  private val generator = SignatureGenerator()
  @Volatile private var stopped = false

  /** Starts capturing. */
  fun start() {
    Thread(::capture, "wave-recognize").apply { isDaemon = true }.start()
  }

  /**
   * Sends the signature of everything heard so far and answers what came back.
   * [last]: no more audio is needed, so the capture stops before the request goes.
   * Blocking: call it off the main thread.
   */
  fun ask(last: Boolean): RecognizeOutcome {
    val signature = synchronized(generator) { generator.signature() }
    if (last) stop()
    return recognize(signature)
  }

  /** Stops capturing; an ask already out still answers. */
  fun stop() {
    stopped = true
    audio.stop()
  }

  private fun capture() {
    val buffer = ShortArray(BUFFER)
    var reported = 0L
    var audible = false
    try {
      while (!stopped) {
        val count = audio.read(buffer)
        if (count < 0) break
        if (!audible) audible = (0 until count).any { buffer[it] != 0.toShort() }
        val samples = synchronized(generator) {
          generator.append(buffer, 0, count)
          generator.sampleCount
        }
        val steps = samples / SAMPLES_PER_STEP
        while (reported < steps) {
          reported++
          onHeard((reported * HEARD_STEP_MS).toInt(), audible)
        }
      }
    } catch (_: Exception) {
      // Projection revocation or a device disconnect may make AudioRecord.read throw.
      // The controller still needs the capture-failed event to finish its session.
    } finally {
      audio.release()
    }
    if (!stopped) onCaptureFailed()
  }

  companion object {
    /** How often the session says how much it has heard: the schedule's resolution. */
    const val HEARD_STEP_MS = 250
    private const val SAMPLE_RATE = 16_000
    private const val SAMPLES_PER_STEP = SAMPLE_RATE * HEARD_STEP_MS / 1000L
    /** 100 ms of audio per read. */
    private const val BUFFER = SAMPLE_RATE / 10
  }
}
