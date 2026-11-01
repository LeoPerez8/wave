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

  private fun inBackground(promise: Promise, work: () -> Unit) {
    thread(name = "WaveSelfInstall") {
      try {
        work()
        promise.resolve(null)
      } catch (error: Exception) {
        WaveLog.w(SELF_INSTALL_TAG, "The self-install stopped", error)
        promise.reject("ERR_SELF_INSTALL", error.message ?: "The self-install stopped", error)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("WaveSelfInstall")

    Function("installAccess") { SelfInstaller.access(context).policyName }

    Function("installedVersion") { SelfInstaller.installedVersion(context) }

    Function("hasApk") { version: String, size: Double -> SelfInstaller.hasApk(context, version, size.toLong()) }

    Function("openPermissionScreen") { SelfInstaller.openPermissionScreen(context) }

    AsyncFunction("downloadApk") { url: String, version: String, size: Double, promise: Promise ->
      val context = context
      inBackground(promise) { SelfInstaller.download(context, url, version, size.toLong()) }
    }

    AsyncFunction("install") { version: String, promise: Promise ->
      val context = context
      inBackground(promise) { SelfInstaller.install(context, version) }
    }
  }
}
