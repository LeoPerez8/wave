package expo.modules.wavenative.yt

/**
 * The decisions around a YT Music song's stream address, kept apart from
 * innertubex (whose classes need a newer JVM than the unit tests run on):
 * which audio to ask for, which to accept, how long an address lasts and
 * when a rejected one is resolved again.
 */
object YtStreams {
  /** How long an address that says nothing about its expiry is trusted. */
  const val UNKNOWN_LIFETIME_MS = 5 * 60_000L

  private val EXPIRE = Regex("[?&]expire=([0-9]+)")

  /**
   * When a stream address stops working: what the extractor says
   * ([expiresAtMs]), else the address's own `expire` (epoch seconds), else a
   * few minutes from [nowMs].
   */
  fun expiresAtMs(expiresAtMs: Long?, url: String, nowMs: Long): Long =
    expiresAtMs
      ?: EXPIRE.find(url)?.groupValues?.get(1)?.toLongOrNull()?.let { it * 1000 }
      ?: (nowMs + UNKNOWN_LIFETIME_MS)

  /**
   * innertubex's `AudioQuality` to ask for: downloads take the best AAC in M4A
   * (itag 141 with Premium, else 140), which takes every tag; playback the
   * best audio YouTube serves the account, by bitrate.
   */
  fun audioQuality(preferM4a: Boolean): String = if (preferM4a) "MP4" else "HIGH"

  /** Whether a stream of [mimeType] is what was asked for: audio, and M4A for a download. */
  fun fits(mimeType: String?, preferM4a: Boolean): Boolean {
    if (mimeType == null || !mimeType.startsWith("audio/")) return false
    return !preferM4a || mimeType.startsWith("audio/mp4")
  }

  /** The stream's MIME type with its codecs, as `audio/webm; codecs="opus"`. */
  fun mimeType(mimeType: String, codecs: String?): String =
    if (codecs.isNullOrBlank() || "codecs=" in mimeType) mimeType else "$mimeType; codecs=\"$codecs\""

  /** How many times a rejected address is resolved again before the song fails. */
  private const val RESOLVE_AGAIN_TIMES = 2

  /**
   * Whether googlevideo rejecting an address with [httpStatus] is worth a
   * fresh one: 403 and 410 say the address expired or its client was turned
   * down, which a new resolution (skipping that client) fixes. [attempt]
   * counts the fresh ones already tried for this load.
   */
  fun resolveAgain(httpStatus: Int, attempt: Int): Boolean =
    (httpStatus == 403 || httpStatus == 410) && attempt < RESOLVE_AGAIN_TIMES
}

/**
 * Why a YT Music song couldn't stream, as the player reports it to JS (Core's
 * `PlayerErrorCode`): no network, YT Music off, YouTube won't serve the song,
 * or it failed otherwise. It travels in the error's message, the one part of
 * a playback error that reaches Wave's media controller.
 */
enum class YtStreamFailure(val code: String) {
  OFFLINE("ytOffline"),
  DISABLED("ytDisabled"),
  UNAVAILABLE("ytUnavailable"),
  FAILED("ytFailed");

  /** The message of the error a failed stream raises. */
  val message: String
    get() = PREFIX + code

  companion object {
    private const val PREFIX = "wave-yt:"

    /** Reasons innertubex gives (`StreamResolveException.Reason`) for a song it won't serve at all. */
    private val UNSERVED = setOf("UNAVAILABLE", "AGE_RESTRICTED", "NO_PLAYABLE_STREAM", "EXPLICIT_UNSUPPORTED", "NO_MUSIC_VIDEO")

    /** The failure a request's [failure] and innertubex's resolve reason (if any) amount to. */
    fun of(failure: YtFailure, resolveReason: String?): YtStreamFailure =
      when (failure) {
        YtFailure.OFFLINE -> OFFLINE
        YtFailure.DISABLED -> DISABLED
        YtFailure.FAILED -> if (resolveReason in UNSERVED) UNAVAILABLE else FAILED
      }

    /** The code carried by an error [message], or null when it isn't a stream failure. */
    fun codeOf(message: String?): String? {
      if (message == null || !message.startsWith(PREFIX)) return null
      val code = message.substring(PREFIX.length)
      return entries.firstOrNull { it.code == code }?.code
    }
  }
}
