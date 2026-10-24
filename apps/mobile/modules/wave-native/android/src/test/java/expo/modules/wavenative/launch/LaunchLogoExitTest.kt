package expo.modules.wavenative.launch

import org.junit.Assert.assertEquals
import org.junit.Test

/** The same cases as Core's `launchLogoExit` tests. */
class LaunchLogoExitTest {
  @Test
  fun fadesImmediatelyWhenWaveIsReady() {
    assertEquals(LaunchLogoExit(0, 400), LaunchLogoExit.plan())
  }
}
