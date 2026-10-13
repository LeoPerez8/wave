package expo.modules.wavenative.launch

import org.junit.Assert.assertEquals
import org.junit.Test

/** The same cases as Core's `launchLogoExit` tests. */
class LaunchLogoExitTest {
  @Test
  fun aQuickStartHoldsTheSplashSoTheFadeEndsAsTheFirstSweepDoes() {
    assertEquals(LaunchLogoExit(350, 400), LaunchLogoExit.plan(250, animationsOn = true))
    assertEquals(LaunchLogoExit(600, 400), LaunchLogoExit.plan(0, animationsOn = true))
  }

  @Test
  fun onceTheFirstSweepIsFarEnoughAlongTheSplashFadesOutAtOnce() {
    for (elapsed in listOf(600L, 1000L, 2750L, 12_000L)) {
      assertEquals(LaunchLogoExit(0, 400), LaunchLogoExit.plan(elapsed, animationsOn = true))
    }
  }

  @Test
  fun withAnimationsRemovedTheSplashGoesAsItAlwaysDid() {
    assertEquals(LaunchLogoExit(0, 400), LaunchLogoExit.plan(100, animationsOn = false))
  }

  @Test
  fun aLogoThatIsNotMovingIsNotWaitedFor() {
    assertEquals(LaunchLogoExit(0, 400), LaunchLogoExit.plan(null, animationsOn = true))
  }

  @Test
  fun aStartTimeFromTheFutureNeverHoldsTheSplashPastOneSweep() {
    assertEquals(LaunchLogoExit(600, 400), LaunchLogoExit.plan(-5000, animationsOn = true))
  }
}
