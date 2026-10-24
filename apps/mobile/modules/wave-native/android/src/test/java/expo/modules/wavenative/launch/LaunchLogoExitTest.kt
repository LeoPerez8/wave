package expo.modules.wavenative.launch

import org.junit.Assert.assertEquals
import org.junit.Test

/** The same cases as Core's `launchLogoExit` tests. */
class LaunchLogoExitTest {
  @Test
  fun aQuickStartFadesAtOnceWhereverTheFirstSweepIs() {
    for (elapsed in listOf(0L, 100L, 250L, 600L, 1100L, 1499L)) {
      assertEquals(LaunchLogoExit(0, 400), LaunchLogoExit.plan(elapsed, animationsOn = true))
    }
  }

  @Test
  fun aLaterStartFadesAtOnceWhereverTheSweepIs() {
    for (elapsed in listOf(1500L, 2750L, 12_000L)) {
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
  fun aStartTimeFromTheFutureNeverHoldsTheSplash() {
    assertEquals(LaunchLogoExit(0, 400), LaunchLogoExit.plan(-5000, animationsOn = true))
  }
}
