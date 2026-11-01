package expo.modules.wavenative

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import expo.modules.wavenative.launch.LaunchSplashExit
import expo.modules.wavenative.log.NativeLog
import expo.modules.wavenative.recognize.RecognizeInbox
import expo.modules.wavenative.share.ShareShortcut
import expo.modules.wavenative.share.SharedTextInbox

/** Hooks Wave's own handling into the application's and the main activity's lifecycle. */
class WaveNativePackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context,
  ): List<ApplicationLifecycleListener> = listOf(
    object : ApplicationLifecycleListener {
      // Early in every process start (the app, Android Auto, a download worker), before JS runs:
      // native warnings, crashes and freezes go in the app log from here on.
      override fun onCreate(application: Application) = NativeLog.start(application)
    },
  )

  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> = listOf(
    object : ReactActivityLifecycleListener {
      // Runs inside MainActivity's super.onCreate, after expo-splash-screen registered its
      // splash handling, so the launch splash leaves the way LaunchSplashExit times it.
      override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        LaunchSplashExit.install(activity)
        // A share that started Wave. A recreated activity carries the same intent, already handled.
        if (savedInstanceState == null) {
          SharedTextInbox.receive(activity.intent)
          receiveRecognize(activity.intent)
        }
        // Wave in the share sheet's direct-share row, published again in case it's gone.
        ShareShortcut.publish(activity)
      }

      // A share with Wave already open (the main activity is singleTask).
      override fun onNewIntent(intent: Intent): Boolean {
        SharedTextInbox.receive(intent)
        receiveRecognize(intent)
        return false
      }
    },
  )

  private fun receiveRecognize(intent: Intent?) {
    RecognizeInbox.receive(
      intent?.action,
      match = intent?.getStringExtra(RecognizeInbox.MATCH_EXTRA),
      fromHistory = ((intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0,
    )
  }
}
