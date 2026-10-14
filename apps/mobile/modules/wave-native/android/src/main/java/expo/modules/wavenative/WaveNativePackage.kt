package expo.modules.wavenative

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import expo.modules.wavenative.launch.LaunchSplashExit
import expo.modules.wavenative.share.SharedTextInbox

/** Hooks Wave's own handling into the main activity's lifecycle. */
class WaveNativePackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> = listOf(
    object : ReactActivityLifecycleListener {
      // Runs inside MainActivity's super.onCreate, after expo-splash-screen registered its
      // splash handling, so the launch splash leaves the way LaunchSplashExit times it.
      override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        LaunchSplashExit.install(activity)
        // A share that started Wave. A recreated activity carries the same intent, already handled.
        if (savedInstanceState == null) SharedTextInbox.receive(activity.intent)
      }

      // A share with Wave already open (the main activity is singleTask).
      override fun onNewIntent(intent: Intent): Boolean {
        SharedTextInbox.receive(intent)
        return false
      }
    },
  )
}
