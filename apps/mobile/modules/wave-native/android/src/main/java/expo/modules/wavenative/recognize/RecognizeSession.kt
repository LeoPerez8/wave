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
 * into a [RecognizeWindow], reports how much it has heard every [HEARD_STEP_MS], and
 * on [ask] sends the signature of the latest audio through [recognize]. When to ask,
 * how much audio to cover and what an answer means for the session are Core's
 * (`stepRecognize`). The window goes with the session.
 */
class RecognizeSession(
  private val audio: RecognizeAudio,
  private val recognize: (ShazamSignature) -> RecognizeOutcome,
  private val onHeard: (heardMs: Int, audible: Boolean) -> Unit,
  private val onCaptureFailed: () -> Unit,
) {
  private val window = RecognizeWindow(HELD_MS * SAMPLES_PER_MS)
  @Volatile private var stopped = false

  /** Starts capturing. */
  fun start() {
    Thread(::capture, "wave-recognize").apply { isDaemon = true }.start()
  }

  /**
   * Sends the signature of the latest [windowMs] of audio, or of everything heard if
   * that's less, and answers what came back. A new generator signs it, so the bytes
   * are those of that audio alone, and the capture goes on meanwhile.
   * [last]: no more audio is needed, so the capture stops before the request goes.
   * Blocking: call it off the main thread.
   */
  fun ask(last: Boolean, windowMs: Int): RecognizeOutcome {
    val samples = synchronized(window) { window.latest(windowMs * SAMPLES_PER_MS) }
    if (last) stop()
    return recognize(SignatureGenerator().apply { append(samples) }.signature())
  }

  /** Stops capturing; an ask already out still answers. */
  fun stop() {
    stopped = true
    audio.stop()
  }

  private fun capture() {
    val buffer = ShortArray(BUFFER)
    var samples = 0L
    var reported = 0L
    var audible = false
    try {
      while (!stopped) {
        val count = audio.read(buffer)
        if (count < 0) break
        if (!audible) audible = (0 until count).any { buffer[it] != 0.toShort() }
        synchronized(window) { window.append(buffer, count) }
        samples += count
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
    /** The most audio an ask can cover: ShazamIO warns Shazam returns no matches at 15 seconds. */
    private const val HELD_MS = 14_000
    private const val SAMPLE_RATE = 16_000
    private const val SAMPLES_PER_MS = SAMPLE_RATE / 1000
    private const val SAMPLES_PER_STEP = SAMPLE_RATE * HEARD_STEP_MS / 1000L
    /** 100 ms of audio per read. */
    private const val BUFFER = SAMPLE_RATE / 10
  }
}
