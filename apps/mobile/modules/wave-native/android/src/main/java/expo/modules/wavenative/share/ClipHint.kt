package expo.modules.wavenative.share

import android.content.ClipDescription
import android.view.textclassifier.TextClassifier

/**
 * What the clipboard's [ClipDescription] says about the clip, read without its text: Android 12+
 * shows "Wave pasted from your clipboard" when an app reads a clip's data (`getPrimaryClip`), not its
 * description, so Core's `readsCopiedText` decides from this whether the text is worth reading.
 * Offer copied links (docs/spec.md, "Opening a song link") reads it on every return to Wave.
 */
object ClipHint {
  /**
   * The flag an app sets on a clip it marks sensitive (a password). `ClipDescription.EXTRA_IS_SENSITIVE`
   * from API 33; the same key was the documented convention before it.
   */
  private const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"

  /** The hint for [description], or null when there's no clip (or Wave may not read it now). */
  fun of(description: ClipDescription?): Map<String, Any?>? =
    description?.let { clip ->
      of(
        mimeTypes = (0 until clip.mimeTypeCount).map { clip.getMimeType(it) },
        classificationStatus = clip.classificationStatus,
        urlConfidence = { clip.getConfidenceScore(TextClassifier.TYPE_URL) },
        sensitive = clip.extras?.getBoolean(EXTRA_IS_SENSITIVE) == true,
        timestamp = clip.timestamp,
      )
    }

  /**
   * The hint as JS reads it (Core's `ClipHint`). [urlConfidence] is asked only once the classifier is
   * done: before then `getConfidenceScore` throws.
   */
  fun of(
    mimeTypes: List<String>,
    classificationStatus: Int,
    urlConfidence: () -> Float,
    sensitive: Boolean,
    timestamp: Long,
  ): Map<String, Any?> {
    val classification = when (classificationStatus) {
      ClipDescription.CLASSIFICATION_COMPLETE -> "complete"
      ClipDescription.CLASSIFICATION_NOT_COMPLETE -> "pending"
      else -> "notPerformed"
    }
    return mapOf(
      "mimeTypes" to mimeTypes,
      "classification" to classification,
      "urlConfidence" to
        if (classification == "complete") runCatching { urlConfidence().toDouble() }.getOrNull() else null,
      "sensitive" to sensitive,
      "timestamp" to timestamp.toDouble(),
    )
  }
}
