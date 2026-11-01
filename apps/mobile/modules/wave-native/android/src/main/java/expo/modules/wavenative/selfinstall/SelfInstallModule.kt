package expo.modules.wavenative.selfinstall

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.log.WaveLog
import kotlin.concurrent.thread

/** [SelfInstaller] for the update runner (`src/updates`). */
class SelfInstallModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun inBackground(promise: Promise, work: () -> Any?) {
    thread(name = "WaveSelfInstall") {
      try {
        promise.resolve(work())
      } catch (error: Exception) {
        WaveLog.w(SELF_INSTALL_TAG, "The self-install stopped", error)
        promise.reject("ERR_SELF_INSTALL", error.message ?: "The self-install stopped", error)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("WaveSelfInstall")

    // Async, as they're binder calls and preference reads and Wave asks at every AppState change.
    AsyncFunction("installAccess") { SelfInstaller.access(context).policyName }

    AsyncFunction("installedVersion") { SelfInstaller.installedVersion(context) }

    AsyncFunction("hasApk") { version: String, size: Double -> SelfInstaller.hasApk(context, version, size.toLong()) }

    AsyncFunction("checkApkMetadata") { metadata: String, signature: String ->
      SelfInstaller.checkMetadata(context, metadata, signature).jsName
    }

    Function("openPermissionScreen") { SelfInstaller.openPermissionScreen(context) }

    AsyncFunction("downloadApk") { url: String, version: String, size: Double, sha256: String, promise: Promise ->
      val context = context
      inBackground(promise) { SelfInstaller.download(context, url, version, size.toLong(), sha256) }
    }

    AsyncFunction("install") { version: String, sha256: String, promise: Promise ->
      val context = context
      inBackground(promise) { SelfInstaller.install(context, version, sha256) }
    }
  }
}
