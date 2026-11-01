package expo.modules.wavenative.selfinstall

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SelfInstallLinesTest {
  private val wave = "dev.leoperez.wave"
  private fun phone(
    installer: String? = wave,
    updateOwner: String? = null,
    canRequestInstalls: Boolean = true,
    confirmationOwed: Boolean = false,
  ) = PhoneState(
    android = "14",
    api = 34,
    targetSdk = 36,
    packageName = wave,
    version = "0.46.2 (4602)",
    installer = installer,
    initiator = installer,
    updateOwner = updateOwner,
    canRequestInstalls = canRequestInstalls,
    confirmationOwed = confirmationOwed,
  )

  @Test
  fun `names the statuses`() {
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
    assertEquals(
      "Android 14 (API 34), target SDK 36, version 0.46.2 (4602), Wave is the installer of record: yes " +
        "(installer $wave, initiator $wave, update owner none), may install: yes",
      phone().line(),
    )
  }

  @Test
  fun `says when another app is the installer of record`() {
    val line = phone(installer = "com.samsung.android.packageinstaller", canRequestInstalls = false).line()
    assertTrue(line, line.contains("installer of record: no (installer com.samsung.android.packageinstaller"))
    assertTrue(line, line.endsWith("may install: no"))
  }

  @Test
  fun `downloads only over https`() {
    assertTrue(isDownloadableApkUrl("https://github.com/LeoPerez8/wave/releases/download/v1.0.0/wave-1.0.0.apk"))
    assertFalse(isDownloadableApkUrl("http://example.com/wave.apk"))
    assertFalse(isDownloadableApkUrl(""))
  }

  @Test
  fun `names a file only for a real version`() {
    assertEquals("wave-1.2.3-ti.apk", apkFileName("1.2.3-ti"))
    assertNull(apkFileName("../../evil"))
    assertNull(apkFileName("1.2.3/../x"))
    assertNull(apkFileName(""))
  }

  @Test
  fun `asks for the permission first`() {
    assertEquals(InstallAccess.NEEDS_PERMISSION, phone(installer = "other", canRequestInstalls = false).access())
  }

  @Test
  fun `needs one confirmation until Wave is the installer of record`() {
    assertEquals(InstallAccess.NEEDS_CONFIRMATION, phone(installer = "com.google.android.packageinstaller").access())
    assertEquals(InstallAccess.NEEDS_CONFIRMATION, phone(installer = null).access())
  }

  @Test
  fun `needs a confirmation when another app owns the updates`() {
    assertEquals(InstallAccess.NEEDS_CONFIRMATION, phone(updateOwner = "com.android.vending").access())
  }

  @Test
  fun `a confirmation Android asked for in the background is owed`() {
    assertEquals(InstallAccess.NEEDS_CONFIRMATION, phone(confirmationOwed = true).access())
  }

  @Test
  fun `is silent as the installer of record`() {
    assertEquals(InstallAccess.SILENT, phone().access())
    assertEquals(InstallAccess.SILENT, phone(updateOwner = wave).access())
  }

  @Test
  fun `speaks the policy's names`() {
    assertEquals("needsPermission", InstallAccess.NEEDS_PERMISSION.policyName)
    assertEquals("needsConfirmation", InstallAccess.NEEDS_CONFIRMATION.policyName)
    assertEquals("silent", InstallAccess.SILENT.policyName)
  }

  @Test
  fun `keeps the APK after a decline, drops it after a failure that may be the file's`() {
    assertTrue(keepsApkAfter(3))
    assertTrue(keepsApkAfter(-1))
    assertFalse(keepsApkAfter(4))
    assertFalse(keepsApkAfter(1))
  }

  @Test
  fun aDownloadsPercentStaysWhole() {
    assertEquals(0, downloadPercent(done = 10, size = 0))
    assertEquals(41, downloadPercent(done = 419, size = 1000))
    assertEquals(100, downloadPercent(done = 2000, size = 1000))
  }

  @Test
  fun logsADownloadAtEachQuarter() {
    assertNull(downloadProgressToLog(done = 24, size = 100, logged = 0))
    assertEquals(25, downloadProgressToLog(done = 25, size = 100, logged = 0))
    assertNull(downloadProgressToLog(done = 49, size = 100, logged = 25))
    assertEquals(50, downloadProgressToLog(done = 60, size = 100, logged = 25))
  }

  @Test
  fun aBigStepLogsOnlyWhereItLanded() {
    assertEquals(75, downloadProgressToLog(done = 80, size = 100, logged = 0))
  }

  @Test
  fun theEndOfADownloadHasItsOwnLine() {
    assertNull(downloadProgressToLog(done = 100, size = 100, logged = 75))
  }

  @Test
  fun aSizeOfNothingLogsNothing() {
    assertNull(downloadProgressToLog(done = 10, size = 0, logged = 0))
  }

  @Test
  fun aFileOfSeveralGigabytesDoesntOverflow() {
    val size = 8L * 1024 * 1024 * 1024
    assertEquals(50, downloadProgressToLog(done = size / 2, size = size, logged = 25))
  }

  @Test
  fun `a failed step after an update leaves the others to run`() {
    val ran = mutableListOf<String>()
    val failed = mutableListOf<String>()
    runUpdateSteps(
      listOf(
        "notification" to { throw SecurityException("no permission") },
        "downloads" to { ran += "downloads" },
      ),
    ) { name, _ -> failed += name }
    assertEquals(listOf("downloads"), ran)
    assertEquals(listOf("notification"), failed)
  }
}
