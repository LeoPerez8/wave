package expo.modules.wavenative

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import expo.modules.wavenative.launch.LaunchSplashExit

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
      }
    },
  )
}
