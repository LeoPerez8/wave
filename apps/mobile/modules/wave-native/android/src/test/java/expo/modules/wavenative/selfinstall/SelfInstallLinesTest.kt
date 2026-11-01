package expo.modules.wavenative.selfinstall

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SelfInstallLinesTest {
  @Test
  fun `names the statuses the spike decides on`() {
    assertEquals("SUCCESS", installStatusName(0))
    assertEquals("PENDING_USER_ACTION", installStatusName(-1))
    assertEquals("FAILURE_BLOCKED", installStatusName(2))
    assertEquals("FAILURE_CONFLICT", installStatusName(5))
  }

  @Test
  fun `keeps an unknown status readable`() {
    assertEquals("UNKNOWN(99)", installStatusName(99))
  }

  @Test
  fun `says when Wave is the installer of record`() {
    val line = PhoneState(
      android = "14",
      api = 34,
      targetSdk = 36,
      packageName = "dev.leoperez.wave",
      version = "0.46.2 (4602)",
      installer = "dev.leoperez.wave",
      initiator = "dev.leoperez.wave",
      updateOwner = null,
      canRequestInstalls = true,
    ).line()
    assertEquals(
      "Android 14 (API 34), target SDK 36, version 0.46.2 (4602), Wave is the installer of record: yes " +
        "(installer dev.leoperez.wave, initiator dev.leoperez.wave, update owner none), may install: yes",
      line,
    )
  }

  @Test
  fun `says when another app is the installer of record`() {
    val line = PhoneState(
      android = "14",
      api = 34,
      targetSdk = 36,
      packageName = "dev.leoperez.wave",
      version = "0.46.2 (4602)",
      installer = "com.samsung.android.packageinstaller",
      initiator = null,
      updateOwner = null,
      canRequestInstalls = false,
    ).line()
    assertTrue(line, line.contains("installer of record: no (installer com.samsung.android.packageinstaller, initiator none"))
    assertTrue(line, line.endsWith("may install: no"))
  }

  @Test
  fun `downloads only over https`() {
    assertTrue(isDownloadableApkUrl("https://github.com/LeoPerez8/wave/releases/download/pr-1/wave-pr-1.apk"))
    assertFalse(isDownloadableApkUrl("http://example.com/wave.apk"))
    assertFalse(isDownloadableApkUrl(""))
  }
}
