package expo.modules.wavenative

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.core.app.OnNewIntentProvider
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import expo.modules.wavenative.launch.LaunchIntents
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
      override fun onCreate(application: Application) {
        NativeLog.start(application)
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
          // Before MainActivity drops its saved state: non-null when Android restores it.
          override fun onActivityPreCreated(activity: Activity, savedInstanceState: Bundle?) {
            LaunchIntents.shared.preCreated(activity, restored = savedInstanceState != null)
          }
          override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
          override fun onActivityStarted(activity: Activity) {}
          override fun onActivityResumed(activity: Activity) {}
          override fun onActivityPaused(activity: Activity) {}
          override fun onActivityStopped(activity: Activity) {}
          override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
          override fun onActivityDestroyed(activity: Activity) {}
        })
      }
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
        // A share that started Wave. A restored activity carries the same intent, already handled.
        val fromHistory = (activity.intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        if (LaunchIntents.shared.launchIsNew(activity, fromHistory)) receive(activity.intent)
        // Expo drops a new intent until the app has loaded, as on a cold start from a notification.
        (activity as? OnNewIntentProvider)?.addOnNewIntentListener { receive(it) }
        // Wave in the share sheet's direct-share row, published again in case it's gone.
        ShareShortcut.publish(activity)
      }

      // A share with Wave already open (the main activity is singleTask).
      override fun onNewIntent(intent: Intent): Boolean {
        receive(intent)
        return false
      }
    },
  )

  private fun receive(intent: Intent) {
    if (!LaunchIntents.shared.firstDelivery(intent)) return
    SharedTextInbox.receive(intent)
    receiveRecognize(intent)
  }

  private fun receiveRecognize(intent: Intent?) {
    RecognizeInbox.receive(
      intent?.action,
      match = intent?.getStringExtra(RecognizeInbox.MATCH_EXTRA),
      fromHistory = ((intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0,
    )
  }
}
