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

/** What the spike's verdict needs from the phone. */
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
) {
  fun line(): String =
    "Android $android (API $api), target SDK $targetSdk, version $version, " +
      "Wave is the installer of record: ${yesNo(installer == packageName)} " +
      "(installer ${installer ?: "none"}, initiator ${initiator ?: "none"}, update owner ${updateOwner ?: "none"}), " +
      "may install: ${yesNo(canRequestInstalls)}"
}

private fun yesNo(value: Boolean) = if (value) "yes" else "no"
