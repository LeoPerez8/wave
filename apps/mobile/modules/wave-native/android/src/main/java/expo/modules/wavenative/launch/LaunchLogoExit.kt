package expo.modules.wavenative.launch

/**
 * How the launch splash leaves once Wave's first screen is ready: Core's
 * `launchLogoExit` (packages/core/src/launchLogo.ts), mirrored because it runs
 * natively as the splash goes. A quick start still lets the logo's first sweep
 * finish (the fade ends as it does); later the splash fades out at once; with
 * animations removed it goes as it always did. `launchLogoExit.test.ts` in the
 * app keeps the numbers in step with Core's `LAUNCH_LOGO`.
 */
data class LaunchLogoExit(val delayMs: Long, val fadeMs: Long) {
  companion object {
    /** One sweep of the waves (`LAUNCH_LOGO.cycleMs`). */
    const val CYCLE_MS = 1000L

    /** The splash's fade-out (`LAUNCH_LOGO.fadeMs`). */
    const val FADE_MS = 400L

    /**
     * [elapsedMs] since the waves started moving (null when Android didn't
     * animate them); [animationsOn] is false with "Remove animations" on.
     */
    fun plan(elapsedMs: Long?, animationsOn: Boolean): LaunchLogoExit {
      if (!animationsOn || elapsedMs == null) return LaunchLogoExit(0, FADE_MS)
      return LaunchLogoExit(maxOf(0L, CYCLE_MS - FADE_MS - maxOf(0L, elapsedMs)), FADE_MS)
    }
  }
}
