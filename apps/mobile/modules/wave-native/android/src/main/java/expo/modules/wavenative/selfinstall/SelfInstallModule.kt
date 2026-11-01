package expo.modules.wavenative.selfinstall

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.log.WaveLog
import kotlin.concurrent.thread

/** [SelfInstallSpike] for Settings › Developer. */
class SelfInstallModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WaveSelfInstall")

    Function("report") { SelfInstallSpike.report(context) }

    AsyncFunction("start") { url: String, promise: Promise ->
      val context = context
      thread(name = "WaveSelfInstall") {
        try {
          promise.resolve(SelfInstallSpike.start(context, url))
        } catch (error: Exception) {
          WaveLog.w(SELF_INSTALL_TAG, "The self-install stopped", error)
          promise.reject("ERR_SELF_INSTALL", error.message ?: "The self-install stopped", error)
        }
      }
    }
  }
}
