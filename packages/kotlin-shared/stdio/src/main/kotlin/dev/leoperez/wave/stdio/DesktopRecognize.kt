package dev.leoperez.wave.stdio

import expo.modules.wavenative.recognize.RecognizeAudio
import expo.modules.wavenative.recognize.RecognizeOutcome
import expo.modules.wavenative.recognize.RecognizeSessionEnded
import expo.modules.wavenative.recognize.RecognizeSessions
import expo.modules.wavenative.recognize.ShazamClient
import expo.modules.wavenative.recognize.ShazamHttp
import expo.modules.wavenative.recognize.ShazamInstallId
import expo.modules.wavenative.recognize.ShazamSignature
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.LinkedBlockingQueue
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * Audio the host sends as it captures it: 16 kHz mono 16-bit PCM, in the order it was heard.
 * [end] is the capture stopping on its own (a device taken away), which the session reports as
 * a capture failure; [stop] is Wave ending it.
 */
class SentAudio : RecognizeAudio {
  private val pieces = LinkedBlockingQueue<ShortArray>()
  private var rest: ShortArray = NOTHING
  private var position = 0

  /** The next samples the host heard. */
  fun write(samples: ShortArray) {
    if (samples.isNotEmpty()) pieces.put(samples)
  }

  /** The host's capture is over: [read] answers what is left, then that the audio stopped. */
  fun end() = pieces.put(NOTHING)

  override fun read(buffer: ShortArray): Int {
    if (position == rest.size) {
      rest = pieces.take()
      position = 0
      if (rest.isEmpty()) {
        // Stays ended for any later read.
        pieces.put(NOTHING)
        return -1
      }
    }
    val count = minOf(buffer.size, rest.size - position)
    rest.copyInto(buffer, 0, position, position + count)
    position += count
    return count
  }

  override fun stop() = end()

  override fun release() = Unit

  private companion object {
    val NOTHING = ShortArray(0)
  }
}

/** Shazam's address, which [shazamAt] replaces. */
const val SHAZAM_ORIGIN = "https://amp.shazam.com"

/**
 * [http] with Shazam's requests sent to [origin] instead: a development build's fake Shazam
 * (`--shazam-url`, which main passes only when Wave isn't packaged).
 */
fun shazamAt(origin: String, http: ShazamHttp): ShazamHttp = ShazamHttp { request ->
  http.post(
    if (request.url.startsWith(SHAZAM_ORIGIN)) request.copy(url = origin.trimEnd('/') + request.url.removePrefix(SHAZAM_ORIGIN))
    else request,
  )
}

/**
 * Recognize on the desktop: the phone's session, signature and Shazam client
 * (`expo.modules.wavenative.recognize`) over audio the host captures and sends.
 *
 * - `recognize.start` `{session, locale?}`: a session under the host's id, replacing any other;
 *   `locale` is the app's language as a tag, else the system's.
 * - `recognize.audio` `{session, pcm}`: its next samples, 16-bit little-endian in base64.
 * - `recognize.end` `{session}`: the host's capture stopped on its own.
 * - `recognize.ask` `{session, last, windowMs}`: asks Shazam about the latest audio
 *   (`RecognizeOutcome.toMap`). Fails with `ERR_RECOGNIZE_ENDED` once the session is gone, and
 *   `ERR_RECOGNIZE_ASK` when the request couldn't be made.
 * - `recognize.stop` `{session}`.
 *
 * The host hears `recognizeHeard` `{session, heardMs, audible}` every quarter second of audio and
 * `recognizeCaptureFailed` `{session}`, the phone module's two events.
 */
class DesktopRecognize(
  private val host: JsonLines,
  dataDir: File,
  private val http: ShazamHttp,
) {
  private val installId = ShazamInstallId(File(dataDir, "recognize/shazam-install-id"))
  @Volatile private var locale: Locale = Locale.getDefault()
  private var audio: Pair<Int, SentAudio>? = null
  private val sessions = RecognizeSessions(
    ::recognize,
    onHeard = { id, ms, audible ->
      host.event("recognizeHeard", buildJsonObject { put("session", id); put("heardMs", ms); put("audible", audible) })
    },
    onCaptureFailed = { id -> host.event("recognizeCaptureFailed", buildJsonObject { put("session", id) }) },
  )

  /** Blocking (an ask waits for Shazam): call it off the request threads. */
  fun call(method: String, params: JsonObject): JsonElement {
    val id = (params["session"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
      ?: throw CodedError("ERR_BAD_PARAMS", "session must be a number")
    return when (method) {
      "recognize.start" -> {
        val sent = SentAudio()
        synchronized(this) {
          locale = (params["locale"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            ?.let(Locale::forLanguageTag)?.takeIf { it.language.isNotEmpty() } ?: Locale.getDefault()
          audio = id to sent
        }
        sessions.start(id, sent) {}
        JsonPrimitive(id)
      }
      "recognize.audio" -> {
        val pcm = (params["pcm"] as? JsonPrimitive)?.takeIf { it.isString }?.content
          ?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }
          ?: throw CodedError("ERR_BAD_PARAMS", "pcm must be base64")
        val samples = ShortArray(pcm.size / 2)
        ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
        // Audio for a session already stopped is dropped: the host's capture ends a moment later.
        sent(id)?.write(samples)
        JsonNull
      }
      "recognize.end" -> {
        sent(id)?.end()
        JsonNull
      }
      "recognize.ask" -> {
        val last = (params["last"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
          ?: throw CodedError("ERR_BAD_PARAMS", "last must be a boolean")
        val windowMs = (params["windowMs"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull?.takeIf { it > 0 }
          ?: throw CodedError("ERR_BAD_PARAMS", "windowMs must be a positive number")
        try {
          jsonOf(sessions.ask(id, last, windowMs).toMap())
        } catch (_: RecognizeSessionEnded) {
          throw CodedError("ERR_RECOGNIZE_ENDED", "The session has ended")
        } catch (e: Exception) {
          throw CodedError("ERR_RECOGNIZE_ASK", e.message ?: e.javaClass.simpleName)
        }
      }
      "recognize.stop" -> {
        sessions.stop(id)
        JsonNull
      }
      else -> throw CodedError("ERR_UNKNOWN_METHOD", "No method $method")
    }
  }

  fun close() = sessions.stopAll()

  @Synchronized
  private fun sent(id: Int): SentAudio? = audio?.takeIf { it.first == id }?.second

  private fun recognize(signature: ShazamSignature): RecognizeOutcome =
    ShazamClient(http, installId.get(), locale, TimeZone.getDefault().id).recognize(signature)
}
