package expo.modules.wavenative.yt

import java.io.IOException
import okhttp3.Interceptor
import okhttp3.Response
import okio.Buffer

/**
 * Notes each YouTube player request (`youtubei/v1/player`) innertubex sends, with YouTube's
 * answer, into [attempts], so a stream lookup that fails can say what each client was told
 * ([YtLookupLog]). It only reads: the request goes out and the answer comes back unchanged
 * (the answer is peeked, not consumed), and only songs being looked up are kept.
 */
class YtPlayerRecorder(private val attempts: YtLookupAttempts) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val body = request.body
    // A streamed (one-shot) body can't be read twice: such a request goes out unnoted.
    if (!request.url.encodedPath.endsWith(PLAYER_PATH) || body == null || body.isOneShot() || body.contentLength() !in 0..MAX_REQUEST_BYTES) {
      return chain.proceed(request)
    }
    val sent = runCatching { Buffer().also(body::writeTo).readUtf8() }.getOrNull() ?: return chain.proceed(request)
    val videoId = YtPlayerAttempt.videoIdOf(sent) ?: return chain.proceed(request)
    val startedAt = System.nanoTime()
    val response = try {
      chain.proceed(request)
    } catch (e: IOException) {
      attempts.record(videoId, YtPlayerAttempt.unanswered(sent, e, elapsedMs(startedAt)))
      throw e
    }
    val elapsed = elapsedMs(startedAt)
    val answer = runCatching { response.peekBody(MAX_RESPONSE_BYTES).string() }.getOrNull()
    attempts.record(videoId, YtPlayerAttempt.answered(sent, response.code, answer, elapsed))
    return response
  }

  private fun elapsedMs(startedAt: Long) = (System.nanoTime() - startedAt) / 1_000_000

  private companion object {
    const val PLAYER_PATH = "/youtubei/v1/player"
    const val MAX_REQUEST_BYTES = 256 * 1024L
    /** Enough for a player answer; its playability status comes first. */
    const val MAX_RESPONSE_BYTES = 4L * 1024 * 1024
  }
}
