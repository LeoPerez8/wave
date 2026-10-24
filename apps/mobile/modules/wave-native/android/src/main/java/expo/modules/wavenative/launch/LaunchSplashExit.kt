package expo.modules.wavenative.launch

import android.app.Activity
import android.view.animation.AccelerateInterpolator
import android.window.SplashScreenView

/**
 * Hands the launch splash over to Wave's first screen. Android draws the
 * splash with the moving logo (`launch_logo.xml`) and expo-splash-screen keeps
 * it up until the first screen is ready; then Android gives the splash to the
 * app to take away. This replaces expo-splash-screen's plain fade with one
 * timed by [LaunchLogoExit]: the fade starts as soon as Wave is ready,
 * wherever the waves are in their sweep.
 */
object LaunchSplashExit {
  /** Call after expo-splash-screen registered on [activity] (its listener is replaced). */
  fun install(activity: Activity) {
    activity.splashScreen.setOnExitAnimationListener { view -> exit(view) }
  }

  private fun exit(view: SplashScreenView) {
    val plan = LaunchLogoExit.plan()
    view.animate()
      .alpha(0f)
      .setStartDelay(plan.delayMs)
      .setDuration(plan.fadeMs)
      .setInterpolator(AccelerateInterpolator())
      .withEndAction { view.remove() }
      .start()
  }

}
