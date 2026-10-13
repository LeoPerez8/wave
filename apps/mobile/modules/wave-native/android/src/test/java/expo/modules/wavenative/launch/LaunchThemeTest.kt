package expo.modules.wavenative.launch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LaunchThemeTest {
  /** Core's `launchTheme(choice)` as JS sends it. */
  private fun fromCore(splashTheme: String? = "Theme.Wave.Launch.sand.navy") = mapOf(
    "splashTheme" to splashTheme,
    "light" to mapOf("background" to "#ede6da", "primary" to "#006a5f", "secondary" to "#a14f09"),
    "dark" to mapOf("background" to "#0a0f1f", "primary" to "#59c0ad", "secondary" to "#ec9d53"),
  )

  @Test
  fun readsCoresColoursAsOpaqueArgb() {
    val theme = LaunchTheme.fromJs(fromCore())!!
    assertEquals("Theme.Wave.Launch.sand.navy", theme.splashTheme)
    assertEquals(LaunchColors(0xFFEDE6DA.toInt(), 0xFF006A5F.toInt(), 0xFFA14F09.toInt()), theme.light)
    assertEquals(LaunchColors(0xFF0A0F1F.toInt(), 0xFF59C0AD.toInt(), 0xFFEC9D53.toInt()), theme.dark)
  }

  @Test
  fun theShippedGroundsHaveNoSplashTheme() {
    assertNull(LaunchTheme.fromJs(fromCore(splashTheme = null))!!.splashTheme)
  }

  @Test
  fun picksTheColoursOfTheCurrentMode() {
    val theme = LaunchTheme.fromJs(fromCore())!!
    assertEquals(theme.dark, theme.colors(night = true))
    assertEquals(theme.light, theme.colors(night = false))
  }

  @Test
  fun refusesAnythingButSixDigitHexColours() {
    for (bad in listOf("ede6da", "#ede6d", "#ede6dag", "#ff0a0f1f", "")) {
      val light = mapOf("background" to bad, "primary" to "#006a5f", "secondary" to "#a14f09")
      assertNull(bad, LaunchTheme.fromJs(fromCore() + ("light" to light)))
    }
    assertNull(LaunchTheme.fromJs(fromCore() - "dark"))
  }

  @Test
  fun survivesBeingSavedAndReadBack() {
    for (splashTheme in listOf("Theme.Wave.Launch.sand.navy", null)) {
      val theme = LaunchTheme.fromJs(fromCore(splashTheme))!!
      assertEquals(theme, LaunchTheme.fromEntries(theme.toEntries()))
    }
  }

  @Test
  fun nothingSavedReadsAsNoTheme() {
    assertNull(LaunchTheme.fromEntries(emptyMap<String, Any>()))
  }
}
