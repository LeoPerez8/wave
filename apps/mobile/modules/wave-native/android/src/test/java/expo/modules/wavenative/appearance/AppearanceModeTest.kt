package expo.modules.wavenative.appearance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppearanceModeTest {
  // UiModeManager's night modes: MODE_NIGHT_AUTO 0, MODE_NIGHT_NO 1, MODE_NIGHT_YES 2.

  @Test
  fun `System follows Android's own setting`() {
    assertEquals(0, AppearanceMode.nightMode("system"))
  }

  @Test
  fun `Light and Dark pin the app's night mode off and on`() {
    assertEquals(1, AppearanceMode.nightMode("light"))
    assertEquals(2, AppearanceMode.nightMode("dark"))
  }

  @Test
  fun `an appearance this build doesn't know is refused`() {
    assertNull(AppearanceMode.nightMode("sepia"))
    assertNull(AppearanceMode.nightMode("Dark"))
  }
}
