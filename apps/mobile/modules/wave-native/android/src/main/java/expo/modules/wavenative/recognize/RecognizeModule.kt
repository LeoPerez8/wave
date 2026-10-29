package expo.modules.wavenative.recognize

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Recognize for JS (docs/spec.md, "Recognize"). JS starts a session from a source and
 * gets its id; the session says how much it has heard (`onRecognizeHeard`, every
 * quarter second of audio) and when its audio stopped on its own
 * (`onRecognizeCaptureFailed`). Core's schedule tells JS when to [ask][RecognizeSession.ask],
 * which sends the signature of everything heard so far and answers
 * [RecognizeOutcome.toMap]. One session at a time: starting one stops the last.
 * Nothing heard is kept: the audio and its signature stay in memory and go with the session.
 */
class RecognizeModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private var current: Pair<Int, RecognizeSession>? = null
  private var lastId = 0

  override fun definition() = ModuleDefinition {
    Name("WaveRecognize")
    Events(HEARD, CAPTURE_FAILED)

    /**
     * Starts capturing from [source] (`microphone`); resolves the session's id. Rejects
     * with `ERR_RECOGNIZE_PERMISSION` without RECORD_AUDIO, `ERR_RECOGNIZE_CAPTURE` when
     * the microphone can't be opened.
     */
    AsyncFunction("start") { source: String ->
      require(source == "microphone") { "Unknown source $source" }
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw CodedException("ERR_RECOGNIZE_PERMISSION", "Wave may not use the microphone", null)
      }
      synchronized(this@RecognizeModule) {
        current?.second?.stop()
        current = null
        val audio = try {
          MicrophoneAudio.open()
        } catch (e: IllegalStateException) {
          throw CodedException("ERR_RECOGNIZE_CAPTURE", e.message, e)
        }
        val id = ++lastId
        val session = RecognizeSession(
          audio,
          recognize = ::recognize,
          onHeard = { heardMs -> sendEvent(HEARD, mapOf("session" to id, "heardMs" to heardMs)) },
          onCaptureFailed = { sendEvent(CAPTURE_FAILED, mapOf("session" to id)) },
        )
        current = id to session
        session.start()
        id
      }
    }

    /**
     * Sends the signature of everything session [id] has heard; [last] stops its capture
     * first. Resolves `{kind:"match", song} | {kind:"noMatch"} | {kind:"failed", failure, status}`.
     */
    AsyncFunction("ask") Coroutine { id: Int, last: Boolean ->
      val session = session(id) ?: throw CodedException("ERR_RECOGNIZE_ENDED", "The session has ended", null)
      withContext(Dispatchers.IO) { session.ask(last).toMap() }
    }

    /** Stops session [id]'s capture. An ask already out still answers. */
    Function("stop") { id: Int ->
      synchronized(this@RecognizeModule) {
        if (current?.first == id) {
          current?.second?.stop()
          current = null
        }
      }
    }

    OnDestroy {
      synchronized(this@RecognizeModule) {
        current?.second?.stop()
        current = null
      }
    }
  }

  @Synchronized
  private fun session(id: Int): RecognizeSession? = current?.takeIf { it.first == id }?.second

  /** Blocking. The client reads the phone's language, country and time zone as each request goes. */
  private fun recognize(signature: ShazamSignature): RecognizeOutcome {
    val installId = ShazamInstallId(File(context.filesDir, "recognize/shazam-install-id")).get()
    val client = ShazamClient(UrlConnectionShazamHttp(), installId, Locale.getDefault(), TimeZone.getDefault().id)
    return client.recognize(signature)
  }

  private companion object {
    const val HEARD = "onRecognizeHeard"
    const val CAPTURE_FAILED = "onRecognizeCaptureFailed"
  }
}
