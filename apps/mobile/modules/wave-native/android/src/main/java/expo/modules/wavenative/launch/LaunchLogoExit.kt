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
    /** The splash's fade-out (`LAUNCH_LOGO.fadeMs`). */
    const val FADE_MS = 400L

    /** Starts fading as soon as Wave is ready. Android applies the system animator scale. */
    fun plan(): LaunchLogoExit = LaunchLogoExit(0, FADE_MS)
  }
}
