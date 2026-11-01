package expo.modules.wavenative.selfinstall

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import expo.modules.wavenative.log.WaveLog
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

internal const val SELF_INSTALL_TAG = "WaveSelfInstall"

/**
 * The self-install spike (#886): Wave downloads an APK and installs it over itself through
 * [PackageInstaller] with USER_ACTION_NOT_REQUIRED, writing each step to the app log. To remove
 * it, delete this folder and its test, `src/settings/selfInstallSpike.ts` and its test,
 * `src/native/waveSelfInstall.ts`, the module's line in `expo-module.config.json`, the two
 * permissions and the receiver in the manifest, and the section in Settings › Developer.
 */
object SelfInstallSpike {
  fun report(context: Context): String {
    val line = phoneState(context).line()
    WaveLog.i(SELF_INSTALL_TAG, line)
    return line
  }

  /** Blocks on the download: call it off the main thread. Returns what it did, for the screen. */
  fun start(context: Context, url: String): String {
    report(context)
    require(isDownloadableApkUrl(url)) { "The APK URL must be https" }
    if (!context.packageManager.canRequestPackageInstalls()) {
      WaveLog.i(SELF_INSTALL_TAG, "Asking for the install-from-this-source permission")
      context.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      return "Allow Wave as a source, come back and press Install again"
    }
    val apk = File(context.cacheDir, "self-install.apk")
    try {
      download(url, apk)
      commit(context, apk)
    } finally {
      apk.delete()
    }
    return "Committed. The status follows in the app log"
  }

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
    )
  }

  private fun download(url: String, apk: File) {
    WaveLog.i(SELF_INSTALL_TAG, "Downloading $url")
    val started = SystemClock.elapsedRealtime()
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      val code = connection.responseCode
      check(code == HttpURLConnection.HTTP_OK) { "The download answered http $code" }
      connection.inputStream.use { input -> apk.outputStream().use { input.copyTo(it) } }
    } finally {
      connection.disconnect()
    }
    WaveLog.i(SELF_INSTALL_TAG, "Downloaded ${apk.length()} bytes in ${SystemClock.elapsedRealtime() - started} ms")
  }

  private fun commit(context: Context, apk: File) {
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
}
