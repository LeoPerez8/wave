package expo.modules.wavenative.selfinstall

import android.app.ActivityManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.wavenative.log.WaveLog
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

internal const val SELF_INSTALL_TAG = "WaveSelfInstall"

private const val PREFERENCES = "wave_self_install"
private const val CONFIRMATION_OWED = "confirmationOwed"
private const val CONNECT_TIMEOUT_MS = 15_000
private const val READ_TIMEOUT_MS = 30_000
private const val METERED_CHECK_BYTES = 1L shl 20
private const val UPDATE_CERTIFICATE = "expo.modules.updates.CODE_SIGNING_CERTIFICATE"

/**
 * Native updates (docs/spec.md, Build and CI): Wave downloads the channel's APK and installs it over
 * itself through [PackageInstaller] with USER_ACTION_NOT_REQUIRED, only after a tap on "Update the
 * app", so usually with Wave in front. Core's update policy says when; each step goes to the app log. minSdk is 31, the API that silent install needs.
 */
object SelfInstaller {
  private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  private fun phoneState(context: Context): PhoneState {
    val packageManager = context.packageManager
    val packageName = context.packageName
    val source = packageManager.getInstallSourceInfo(packageName)
    val info = packageManager.getPackageInfo(packageName, 0)
    return PhoneState(
      android = Build.VERSION.RELEASE,
      api = Build.VERSION.SDK_INT,
      targetSdk = context.applicationInfo.targetSdkVersion,
      packageName = packageName,
      version = "${info.versionName} (${info.longVersionCode})",
      installer = source.installingPackageName,
      initiator = source.initiatingPackageName,
      updateOwner = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) source.updateOwnerPackageName else null,
      canRequestInstalls = packageManager.canRequestPackageInstalls(),
      confirmationOwed = preferences(context).getBoolean(CONFIRMATION_OWED, false),
    )
  }

  fun access(context: Context): InstallAccess = phoneState(context).access()

  fun installedVersion(context: Context): String =
    context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""

  /**
   * Whether CI signed the channel's APK metadata, by the certificate this APK checks updates with.
   * Android only checks that an APK has the keystore's signature, and that keystore is public.
   */
  fun checkMetadata(context: Context, metadata: String, signature: String): ApkMetadataCheck {
    val manifest = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
    return checkApkMetadata(metadata, signature, manifest?.getString(UPDATE_CERTIFICATE))
  }

  /** Android's screen for the "install from this source" permission. Only Wave in front calls it. */
  fun openPermissionScreen(context: Context) {
    WaveLog.i(SELF_INSTALL_TAG, "Opening the install-from-this-source screen")
    context.startActivity(
      Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  private fun folder(context: Context) = File(context.noBackupFilesDir, "updates")

  private fun apkFile(context: Context, version: String): File =
    File(folder(context), requireNotNull(apkFileName(version)) { "Not a version: $version" })

  fun hasApk(context: Context, version: String, size: Long): Boolean =
    apkFile(context, version).length() == size

  private fun holdsApk(file: File, size: Long, sha256: String): Boolean =
    file.length() == size && file.inputStream().use(::sha256Hex) == sha256

  /**
   * Blocks on the download: call it off the main thread. A whole file already there is kept. False
   * when what came isn't the file CI signed for, which downloading again wouldn't change.
   */
  fun download(context: Context, url: String, version: String, size: Long, sha256: String): Boolean {
    require(isDownloadableApkUrl(url)) { "The APK URL must be https" }
    val apk = apkFile(context, version)
    if (holdsApk(apk, size, sha256)) return true
    deleteApks(context)
    val dir = apk.parentFile ?: error("No folder for the APK")
    dir.mkdirs()
    val part = File(dir, "${apk.name}.part")
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    // A metered Wi-Fi counts as mobile data here, which JS can't tell.
    check(!connectivity.isActiveNetworkMetered) { "The network is metered" }
    WaveLog.i(SELF_INSTALL_TAG, "Downloading $url ($size bytes)")
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = CONNECT_TIMEOUT_MS
    connection.readTimeout = READ_TIMEOUT_MS
    try {
      val code = connection.responseCode
      check(code == HttpURLConnection.HTTP_OK) { "The download answered http $code" }
      connection.inputStream.use { input ->
        part.outputStream().use { output ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          var total = 0L
          var nextCheck = METERED_CHECK_BYTES
          var logged = 0
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            total += read
            downloadProgressToLog(total, size, logged)?.let {
              logged = it
              WaveLog.i(SELF_INSTALL_TAG, "Downloaded $it% of the APK")
            }
            if (total >= nextCheck) {
              check(!connectivity.isActiveNetworkMetered) { "The network became metered" }
              nextCheck = total + METERED_CHECK_BYTES
            }
          }
        }
      }
      if (!holdsApk(part, size, sha256)) {
        WaveLog.w(SELF_INSTALL_TAG, "Refused the download: ${part.length()} bytes of $size, or not the signed SHA-256")
        return false
      }
      check(part.renameTo(apk)) { "Couldn't keep the download" }
    } finally {
      connection.disconnect()
      part.delete()
    }
    WaveLog.i(SELF_INSTALL_TAG, "Downloaded ${apk.length()} bytes")
    return true
  }

  /**
   * Blocks while it copies the APK into the session: call it off the main thread. Android checks
   * the APK's signing certificate, and its answer reaches [SelfInstallStatusReceiver].
   */
  fun install(context: Context, version: String, sha256: String) {
    val apk = apkFile(context, version)
    check(apk.isFile) { "No APK of $version on the phone" }
    if (apk.inputStream().use(::sha256Hex) != sha256) {
      apk.delete()
      error("The APK of $version isn't the file CI signed for")
    }
    val state = phoneState(context)
    WaveLog.i(SELF_INSTALL_TAG, state.line())
    check(state.access() != InstallAccess.NEEDS_PERMISSION) { "Wave may not install yet" }
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(context.packageName)
      setSize(apk.length())
      setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
    val sessionId = installer.createSession(params)
    WaveLog.i(SELF_INSTALL_TAG, "Session $sessionId created with USER_ACTION_NOT_REQUIRED")
    try {
      installer.openSession(sessionId).use { session ->
        apk.inputStream().use { input ->
          session.openWrite("wave.apk", 0, apk.length()).use { output ->
            input.copyTo(output)
            session.fsync(output)
          }
        }
        // Mutable because Android fills in the status. Explicit, so only Wave's receiver gets it.
        val status = PendingIntent.getBroadcast(
          context,
          sessionId,
          Intent(context, SelfInstallStatusReceiver::class.java),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        WaveLog.i(SELF_INSTALL_TAG, "Session $sessionId committing; the install may kill this process")
        session.commit(status.intentSender)
      }
    } catch (error: Exception) {
      runCatching { installer.abandonSession(sessionId) }
      throw error
    }
  }

  internal fun isInForeground(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  internal fun oweConfirmation(context: Context) {
    preferences(context).edit().putBoolean(CONFIRMATION_OWED, true).apply()
  }

  internal fun deleteApks(context: Context) {
    folder(context).listFiles()?.forEach { it.delete() }
  }

  /** What an installed update leaves behind: its APK, and any confirmation it owed. */
  internal fun forgetInstalled(context: Context) {
    deleteApks(context)
    preferences(context).edit().remove(CONFIRMATION_OWED).apply()
  }
}
