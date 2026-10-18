package expo.modules.wavenative.yt

/**
 * Whether a song YouTube wouldn't serve was refused or is clearly unavailable (docs/spec.md,
 * Downloads, "When YouTube limits downloads"). A refusal (an UNPLAYABLE answer, a bot check, no
 * answer at all) is what YouTube limiting the session looks like, so a download tries it again
 * (Core's `refused` plan, as `ytRefused`). Only a clear answer fails it at once
 * (`ytUnavailable`): the video removed or unavailable (status ERROR), private, age-restricted,
 * or a song innertubex won't serve for what it is.
 */
object YtRefusal {
  /** innertubex's resolve reasons (`StreamResolveException.Reason`) that say what the song is. */
  private val CLEAR_REASONS = setOf("AGE_RESTRICTED", "EXPLICIT_UNSUPPORTED", "NO_MUSIC_VIDEO")
  /** Playability statuses that answer for the video, whichever client asks. */
  private val CLEAR_STATUSES = setOf("ERROR", "AGE_CHECK_REQUIRED", "CONTENT_CHECK_REQUIRED")
  /** What a playability reason says when it's the video's own state. */
  private val CLEAR_WORDS = Regex("private|removed|terminated|confirm your age|age-restricted", RegexOption.IGNORE_CASE)

  /**
   * True when the lookup that failed with innertubex's [resolveReason] was refused, given each
   * player client's [answers]; false when any answer is clear about the video.
   */
  fun refused(resolveReason: String?, answers: List<YtPlayerAttempt>): Boolean {
    if (resolveReason in CLEAR_REASONS) return false
    return answers.none { it.status in CLEAR_STATUSES || it.reason?.let(CLEAR_WORDS::containsMatchIn) == true }
  }
}
