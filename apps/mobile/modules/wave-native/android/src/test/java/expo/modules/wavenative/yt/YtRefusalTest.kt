package expo.modules.wavenative.yt

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A song YouTube wouldn't serve: refused (tried again) or clearly unavailable (fails at once). */
class YtRefusalTest {
  private fun answer(client: String, status: String?, reason: String? = null, http: Int? = 200) =
    YtPlayerAttempt(client, http, status, reason, poToken = true, elapsedMs = 40)

  @Test
  fun anUnplayableAnswerOnEveryClientIsARefusal() {
    assertTrue(YtRefusal.refused("UNAVAILABLE", listOf(answer("WEB_REMIX", "UNPLAYABLE", "Video unavailable"), answer("ANDROID_VR", "UNPLAYABLE"))))
  }

  @Test
  fun aBotCheckIsARefusal() {
    assertTrue(YtRefusal.refused("UNAVAILABLE", listOf(answer("WEB_REMIX", "LOGIN_REQUIRED", "Sign in to confirm you’re not a bot"))))
  }

  @Test
  fun noAnswerAtAllIsARefusal() {
    assertTrue(YtRefusal.refused("NO_PLAYABLE_STREAM", emptyList()))
    assertTrue(YtRefusal.refused(null, listOf(answer("WEB_REMIX", null, http = null))))
  }

  @Test
  fun aRemovedVideoIsClearlyUnavailable() {
    assertFalse(YtRefusal.refused("UNAVAILABLE", listOf(answer("WEB_REMIX", "ERROR", "Video unavailable"), answer("ANDROID_VR", "UNPLAYABLE"))))
    assertFalse(YtRefusal.refused("UNAVAILABLE", listOf(answer("WEB_REMIX", "UNPLAYABLE", "This video has been removed by the uploader"))))
  }

  @Test
  fun aPrivateVideoIsClearlyUnavailable() {
    assertFalse(YtRefusal.refused("UNAVAILABLE", listOf(answer("WEB_REMIX", "LOGIN_REQUIRED", "This video is private"))))
  }

  @Test
  fun anAgeRestrictedVideoIsClearlyUnavailable() {
    assertFalse(YtRefusal.refused("AGE_RESTRICTED", emptyList()))
    assertFalse(YtRefusal.refused("UNAVAILABLE", listOf(answer("WEB_REMIX", "LOGIN_REQUIRED", "Sign in to confirm your age"))))
    assertFalse(YtRefusal.refused("UNAVAILABLE", listOf(answer("TVHTML5", "AGE_CHECK_REQUIRED"))))
  }

  @Test
  fun aSongInnertubexWontServeForWhatItIsIsClearlyUnavailable() {
    assertFalse(YtRefusal.refused("EXPLICIT_UNSUPPORTED", emptyList()))
    assertFalse(YtRefusal.refused("NO_MUSIC_VIDEO", emptyList()))
  }
}
