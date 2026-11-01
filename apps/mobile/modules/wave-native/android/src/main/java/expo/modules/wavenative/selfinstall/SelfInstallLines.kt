package expo.modules.wavenative.selfinstall

/** `PackageInstaller.STATUS_*` by name, for the log. The values are Android's public constants. */
fun installStatusName(status: Int): String = when (status) {
  -1 -> "PENDING_USER_ACTION"
  0 -> "SUCCESS"
  1 -> "FAILURE"
  2 -> "FAILURE_BLOCKED"
  3 -> "FAILURE_ABORTED"
  4 -> "FAILURE_INVALID"
  5 -> "FAILURE_CONFLICT"
  6 -> "FAILURE_STORAGE"
  7 -> "FAILURE_INCOMPATIBLE"
  8 -> "FAILURE_TIMEOUT"
  else -> "UNKNOWN($status)"
}

fun isDownloadableApkUrl(url: String): Boolean = url.startsWith("https://")

/** The downloaded APK's file name, or null for a version that isn't one, as it comes from the network. */
fun apkFileName(version: String): String? =
  if (Regex("""\d+\.\d{1,2}\.\d{1,2}(-ti)?""").matches(version)) "wave-$version.apk" else null

/** What installing an APK takes. The names are what Core's update policy reads. */
enum class InstallAccess(val policyName: String) {
  NEEDS_PERMISSION("needsPermission"),
  NEEDS_CONFIRMATION("needsConfirmation"),
  SILENT("silent"),
}

/** The install source facts that decide what an install takes, and the log's line about them. */
data class PhoneState(
  val android: String,
  val api: Int,
  val targetSdk: Int,
  val packageName: String,
  val version: String,
  val installer: String?,
  val initiator: String?,
  val updateOwner: String?,
  val canRequestInstalls: Boolean,
  /** Android asked for a confirmation in the background, which Wave couldn't show. */
  val confirmationOwed: Boolean,
) {
  /**
   * Android installs silently only for the installer of record, and on Android 14+ only if no other
   * app owns the updates.
   */
  fun access(): InstallAccess = when {
    !canRequestInstalls -> InstallAccess.NEEDS_PERMISSION
    confirmationOwed -> InstallAccess.NEEDS_CONFIRMATION
    installer != packageName -> InstallAccess.NEEDS_CONFIRMATION
    updateOwner != null && updateOwner != packageName -> InstallAccess.NEEDS_CONFIRMATION
    else -> InstallAccess.SILENT
  }

  fun line(): String =
    "Android $android (API $api), target SDK $targetSdk, version $version, " +
      "Wave is the installer of record: ${yesNo(installer == packageName)} " +
      "(installer ${installer ?: "none"}, initiator ${initiator ?: "none"}, update owner ${updateOwner ?: "none"}), " +
      "may install: ${yesNo(canRequestInstalls)}"
}

private fun yesNo(value: Boolean) = if (value) "yes" else "no"

/**
 * Whether to keep the APK after Android's answer. A declined confirmation or a pending one leaves it
 * good. Any other failure may be the file's, so the next try downloads it afresh.
 */
fun keepsApkAfter(status: Int): Boolean = status == -1 || status == 3 || status == 0

/** The step of [DOWNLOAD_LOG_STEP] percent a download just reached past [logged], if it did. */
fun downloadProgressToLog(done: Long, size: Long, logged: Int): Int? {
  if (size <= 0) return null
  val percent = (done.toDouble() / size * 100).toInt()
  val step = percent / DOWNLOAD_LOG_STEP * DOWNLOAD_LOG_STEP
  return step.takeIf { it > logged && it < 100 }
}

private const val DOWNLOAD_LOG_STEP = 25
