package expo.modules.wavenative.share

import android.content.ClipDescription
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What the clip's description tells JS before Wave reads (and Android announces) the clip's text. */
class ClipHintTest {
  private fun hint(
    status: Int,
    urlConfidence: () -> Float = { 0.9f },
    mimeTypes: List<String> = listOf("text/plain"),
  ) = ClipHint.of(mimeTypes, status, urlConfidence, sensitive = false, timestamp = 1234L)

  @Test
  fun aClassifiedClipCarriesItsLinkConfidence() {
    val clip = hint(ClipDescription.CLASSIFICATION_COMPLETE, { 0.75f })
    assertEquals("complete", clip["classification"])
    assertEquals(0.75, clip["urlConfidence"] as Double, 0.0001)
    assertEquals(listOf("text/plain"), clip["mimeTypes"])
    assertEquals(1234.0, clip["timestamp"])
    assertEquals(false, clip["sensitive"])
  }

  @Test
  fun theConfidenceIsntAskedBeforeTheClassifierIsDone() {
    val asked = { throw IllegalStateException("Confidence scores not available") }
    val pending = hint(ClipDescription.CLASSIFICATION_NOT_COMPLETE, asked)
    assertEquals("pending", pending["classification"])
    assertNull(pending["urlConfidence"])
    val notPerformed = hint(ClipDescription.CLASSIFICATION_NOT_PERFORMED, asked)
    assertEquals("notPerformed", notPerformed["classification"])
    assertNull(notPerformed["urlConfidence"])
  }

  @Test
  fun aConfidenceAndroidFailsToGiveIsNone() {
    val clip = hint(ClipDescription.CLASSIFICATION_COMPLETE, { throw IllegalStateException("gone") })
    assertNull(clip["urlConfidence"])
  }
}
