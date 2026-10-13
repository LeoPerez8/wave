package expo.modules.wavenative.launch

import android.animation.ValueAnimator
import android.app.Activity
import android.os.SystemClock
import android.view.animation.AccelerateInterpolator
import android.window.SplashScreenView

/**
 * Hands the launch splash over to Wave's first screen. Android draws the
 * splash with the moving logo (`launch_logo.xml`) and expo-splash-screen keeps
 * it up until the first screen is ready; then Android gives the splash to the
 * app to take away. This replaces expo-splash-screen's plain fade with one
 * timed by [LaunchLogoExit]: a quick start lets the waves finish their first
 * sweep, so they never flick on and off.
 */
object LaunchSplashExit {
  /** Wall-clock times are past this; uptimes (milliseconds since boot) aren't. */
  private const val WALL_CLOCK_FLOOR = 1_000_000_000_000L

  /** Call after expo-splash-screen registered on [activity] (its listener is replaced). */
  fun install(activity: Activity) {
    activity.splashScreen.setOnExitAnimationListener { view -> exit(view) }
  }

  private fun exit(view: SplashScreenView) {
    val plan = LaunchLogoExit.plan(
      elapsedMs = view.iconAnimationStart?.toEpochMilli()?.let(::elapsedSince),
      animationsOn = ValueAnimator.areAnimatorsEnabled(),
    )
    view.animate()
      .alpha(0f)
      .setStartDelay(plan.delayMs)
      .setDuration(plan.fadeMs)
      .setInterpolator(AccelerateInterpolator())
      .withEndAction { view.remove() }
      .start()
  }

  /** Milliseconds since [start], whichever clock Android stamped it with. */
  private fun elapsedSince(start: Long): Long {
    val now = if (start >= WALL_CLOCK_FLOOR) System.currentTimeMillis() else SystemClock.uptimeMillis()
    return now - start
  }
}
