package expo.modules.wavenative.log

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Native code's entries in the app log: what `WaveLog` writes, in Core's `formatLogEntry` shape. */
class WaveLogTest {
  private val folder: File = Files.createTempDirectory("wave-log").toFile()
  private val file = AppLogFile(File(File(folder, "logs"), "wave.log"))

  // 2026-10-16T14:03:22.415Z
  private val at = 1_792_159_402_415L

  init {
    WaveLog.writeTo(file, clock = { at })
  }

  @After
  fun stop() = WaveLog.writeTo(null)

  @Test
  fun aWarningGoesInTheLogUnderItsTag() {
    WaveLog.w("WaveDownloads", "A YouTube transfer failed (http 403)")

    assertEquals("2026-10-16T14:03:22.415Z W WaveDownloads: A YouTube transfer failed (http 403)\n", file.read())
  }

  @Test
  fun eachLevelHasItsLetter() {
    WaveLog.i("WaveAuto", "Auto connected")
    WaveLog.e("WaveResume", "Couldn't read the resume snapshot")
    WaveLog.f("crash", "Wave stopped")

    assertEquals(
      "2026-10-16T14:03:22.415Z I WaveAuto: Auto connected\n" +
        "2026-10-16T14:03:22.415Z E WaveResume: Couldn't read the resume snapshot\n" +
        "2026-10-16T14:03:22.415Z F crash: Wave stopped\n",
      file.read(),
    )
  }

  @Test
  fun anErrorFollowsWithItsStackIndented() {
    val error = IllegalStateException("disk full")

    WaveLog.w("WaveResume", "Couldn't save the resume snapshot", error)

    val lines = file.read().trimEnd('\n').split("\n")
    assertEquals("2026-10-16T14:03:22.415Z W WaveResume: Couldn't save the resume snapshot", lines[0])
    assertEquals("  java.lang.IllegalStateException: disk full", lines[1])
    assertTrue(lines[2], lines[2].startsWith("  \tat expo.modules.wavenative.log.WaveLogTest."))
    assertTrue("only the first line starts with a time", lines.drop(1).all { it.startsWith("  ") })
  }

  @Test
  fun secretsNeverReachTheLog() {
    // The shapes Core's redactSecrets covers (packages/core/src/appLog.test.ts).
    val secrets = listOf(
      "login failed user=leo&password=hunter22&x=1" to "hunter22",
      """Soulseek login {"username":"leo","password":"s3cr3t pass"}""" to "s3cr3t",
      "{ username: 'leo', password: 'pw-123' }" to "pw-123",
      "GET /v1/pull Authorization: Bearer abc.DEF-123_xyz" to "abc.DEF-123_xyz",
      "sent bearer QVRfdG9rZW4tMTIz" to "QVRfdG9rZW4tMTIz",
      "Cookie: SAPISID=sapi-777; __Secure-3PSID=psid-888" to "sapi-777",
      "Cookie: SAPISID=sapi-777; __Secure-3PSID=psid-888" to "psid-888",
      "Set-Cookie: SID=sid-999; Path=/; Secure" to "sid-999",
      "GET https://x.test/a?access_token=tok-111&page=2" to "tok-111",
      """{"accessToken":"BQ-spotify-222","expires":3600}""" to "BQ-spotify-222",
      """{"sessionToken":"wave-sess-333"}""" to "wave-sess-333",
      "poToken: MnPoTokenValue444" to "MnPoTokenValue444",
      "signing in with eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl" to
        "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
      "using ya29.a0AfH6SM-token_555 for YouTube" to "ya29.a0AfH6SM-token_555",
      "fetch https://leo:hunter22@example.test/x failed" to "hunter22",
    )
    for ((message, secret) in secrets) {
      WaveLog.w("WaveYtPoToken", message)
      val written = file.read()
      assertFalse(written, written.contains(secret))
      assertTrue(written, written.contains("[redacted]"))
      file.dropHead(Long.MAX_VALUE)
    }
  }

  @Test
  fun songTitlesArtistsAndPathsStay() {
    val message =
      """Couldn't fill in /Music/twenty one pilots - Heathens.mp3 (Session expired) {"title":"Stressed Out","artist":"twenty one pilots"}"""

    WaveLog.w("WaveDownloads", message)

    assertEquals("2026-10-16T14:03:22.415Z W WaveDownloads: $message\n", file.read())
  }

  @Test
  fun withoutALogItOnlyGoesToLogcat() {
    WaveLog.writeTo(null)

    WaveLog.w("WaveDownloads", "nobody hears this")

    assertEquals("", file.read())
  }
}
