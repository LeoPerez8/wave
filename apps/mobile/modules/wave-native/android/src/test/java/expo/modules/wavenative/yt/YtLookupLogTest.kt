package expo.modules.wavenative.yt

import expo.modules.wavenative.log.AppLogEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class YtLookupLogTest {
  private fun playerRequest(videoId: String, client: String, poToken: String? = null) =
    """{"context":{"client":{"clientName":"$client","clientVersion":"1.2","visitorData":"CgtWaXNpdG9yU2VjcmV0"}},""" +
      """"videoId":"$videoId"""" +
      (poToken?.let { ""","serviceIntegrityDimensions":{"poToken":"$it"}""" } ?: "") + "}"

  private fun playerAnswer(status: String, reason: String? = null) =
    """{"responseContext":{"visitorData":"CgtWaXNpdG9yU2VjcmV0"},"playabilityStatus":{"status":"$status"""" +
      (reason?.let { ""","reason":"$it"""" } ?: "") + "}}"

  @Test
  fun aPlayerRequestNamesItsSong() {
    assertEquals("dQw4w9WgXcQ", YtPlayerAttempt.videoIdOf(playerRequest("dQw4w9WgXcQ", "WEB_REMIX")))
    assertEquals(null, YtPlayerAttempt.videoIdOf("not json"))
  }

  @Test
  fun anAnsweredRequestKeepsTheClientTheStatusTheReasonAndTokenUse() {
    val attempt = YtPlayerAttempt.answered(
      playerRequest("v1", "WEB_REMIX", poToken = "MnPoTokenValue444"),
      httpStatus = 200,
      responseBody = playerAnswer("UNPLAYABLE", "Video unavailable"),
      elapsedMs = 812,
    )
    assertEquals(YtPlayerAttempt("WEB_REMIX", 200, "UNPLAYABLE", "Video unavailable", poToken = true, elapsedMs = 812), attempt)
  }

  @Test
  fun anAnswerThatIsntJsonStillKeepsItsHttpStatus() {
    val attempt = YtPlayerAttempt.answered(playerRequest("v1", "ANDROID_VR"), 429, "<html>Too many requests</html>", 95)
    assertEquals(YtPlayerAttempt("ANDROID_VR", 429, null, null, poToken = false, elapsedMs = 95), attempt)
  }

  @Test
  fun aRequestWithoutAnAnswerKeepsWhatWentWrong() {
    val attempt = YtPlayerAttempt.unanswered(playerRequest("v1", "IOS"), java.net.SocketTimeoutException("timeout"), 20_001)
    assertEquals(YtPlayerAttempt("IOS", null, null, null, poToken = false, elapsedMs = 20_001, error = "SocketTimeoutException"), attempt)
  }

  @Test
  fun onlyTheSongsBeingLookedUpAreCollectedAndTakingThemStopsIt() {
    val attempts = YtLookupAttempts()
    val one = YtPlayerAttempt("WEB_REMIX", 200, "OK", null, poToken = true, elapsedMs = 300)
    attempts.record("ignored", one)
    attempts.watch("v1")
    attempts.record("v1", one)
    assertEquals(listOf(one), attempts.take("v1"))
    assertEquals(emptyList<YtPlayerAttempt>(), attempts.take("ignored"))
    attempts.record("v1", one)
    assertEquals(emptyList<YtPlayerAttempt>(), attempts.take("v1"))
  }

  @Test
  fun aSongLookedUpTwiceAtOnceKeepsCollectingUntilBothAreDone() {
    val attempts = YtLookupAttempts()
    val one = YtPlayerAttempt("WEB_REMIX", 200, "OK", null, poToken = true, elapsedMs = 300)
    attempts.watch("v1")
    attempts.watch("v1")
    attempts.record("v1", one)
    attempts.take("v1")
    attempts.record("v1", one)
    assertEquals(listOf(one, one), attempts.take("v1"))
  }

  @Test
  fun aFailureLineNamesTheSongAndEachClientsAnswer() {
    val line = YtLookupLog.failedLine(
      videoId = "dQw4w9WgXcQ",
      failure = "unavailable",
      reason = "UNPLAYABLE",
      elapsedMs = 2140,
      attempts = listOf(
        YtPlayerAttempt("WEB_REMIX", 200, "UNPLAYABLE", "Video unavailable", poToken = true, elapsedMs = 812),
        YtPlayerAttempt("ANDROID_VR", 200, "LOGIN_REQUIRED", "Sign in to confirm you're not a bot", poToken = false, elapsedMs = 420),
        YtPlayerAttempt("IOS", null, null, null, poToken = false, elapsedMs = 20_001, error = "SocketTimeoutException"),
      ),
      extractorOutcomes = emptyList(),
    )
    assertEquals(
      "Stream lookup for video dQw4w9WgXcQ failed (unavailable, UNPLAYABLE) in 2140 ms: " +
        "WEB_REMIX HTTP 200 UNPLAYABLE \"Video unavailable\" with PO, 812 ms; " +
        "ANDROID_VR HTTP 200 LOGIN_REQUIRED \"Sign in to confirm you're not a bot\" without PO, 420 ms; " +
        "IOS no answer (SocketTimeoutException) without PO, 20001 ms",
      line,
    )
    // The redaction every line goes through leaves it as it is: nothing in it looks like a secret.
    assertEquals(line, AppLogEntry.redactSecrets(line))
  }

  @Test
  fun aReasonStaysOnOneShortLine() {
    val long = "Line one\nline \"two\" " + "x".repeat(400)
    val line = YtLookupLog.failedLine("v1", "unavailable", null, 10, listOf(YtPlayerAttempt("WEB", 200, "ERROR", long, false, 5)), emptyList())
    assertFalse(line.contains('\n'))
    assertTrue(line.contains("\"Line one line 'two' xxx"))
    assertTrue(line.length < 400)
  }

  @Test
  fun withoutPlayerRequestsTheExtractorsOwnOutcomesAreNamed() {
    val line = YtLookupLog.failedLine(
      "v1", "failed", null, 30, emptyList(),
      extractorOutcomes = listOf("WEB_REMIX request_InnerTubeHttpException", "ANDROID_VR po_token_unavailable"),
    )
    assertEquals(
      "Stream lookup for video v1 failed (failed) in 30 ms: no player answer seen; " +
        "extractor: WEB_REMIX request_InnerTubeHttpException; ANDROID_VR po_token_unavailable",
      line,
    )
  }

  @Test
  fun tokensCookiesAndVisitorDataNeverReachTheLine() {
    val attempt = YtPlayerAttempt.answered(
      playerRequest("v1", "WEB_REMIX", poToken = "MnPoTokenValue444"),
      200,
      playerAnswer("LOGIN_REQUIRED", "Sign in"),
      100,
    )
    val line = YtLookupLog.failedLine("v1", "unavailable", "LOGIN_REQUIRED", 100, listOf(attempt), emptyList())
    assertFalse(line.contains("MnPoTokenValue444"))
    assertFalse(line.contains("CgtWaXNpdG9yU2VjcmV0"))
  }
}
