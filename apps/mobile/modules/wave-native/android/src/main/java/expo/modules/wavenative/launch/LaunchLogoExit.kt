package expo.modules.wavenative.launch

/**
 * How the launch splash leaves once Wave's first screen is ready: Core's
 * `launchLogoExit` (packages/core/src/launchLogo.ts), mirrored because it runs
 * natively as the splash goes. The fade starts at once, wherever the sweep is;
 * with animations removed it goes as it always did. `launchLogoExit.test.ts` in the
 * app keeps the numbers in step with Core's `LAUNCH_LOGO`.
 */
data class LaunchLogoExit(val delayMs: Long, val fadeMs: Long) {
  companion object {
    /** One sweep of the waves (`LAUNCH_LOGO.cycleMs`). */
    const val CYCLE_MS = 1500L

    /** The splash's fade-out (`LAUNCH_LOGO.fadeMs`). */
    const val FADE_MS = 400L

    /**
     * [elapsedMs] since the waves started moving (null when Android didn't
     * animate them); [animationsOn] is false with "Remove animations" on.
     */
    @Suppress("UNUSED_PARAMETER")
    fun plan(elapsedMs: Long?, animationsOn: Boolean): LaunchLogoExit = LaunchLogoExit(0, FADE_MS)
  }
}
