package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationAccentTest {
  @Test
  fun `JS's primary tones become opaque colours`() {
    assertEquals(
      AccentColours(light = 0xFF1F5FB8.toInt(), dark = 0xFF7AAEF5.toInt()),
      NotificationAccent.fromJs("#1f5fb8", "#7AAEF5"),
    )
  }

  @Test
  fun `anything but a #rrggbb tone is refused`() {
    assertNull(NotificationAccent.fromJs("teal", "#7aaef5"))
    assertNull(NotificationAccent.fromJs("#1f5fb8", "#fff"))
    assertNull(NotificationAccent.fromJs("#1f5fb8", "#7aaefg"))
    assertNull(NotificationAccent.fromJs("#1f5fb8", "#7aaef5ff"))
  }

  @Test
  fun `the notification takes the tone of the system's scheme`() {
    val colours = AccentColours(light = 1, dark = 2)
    assertEquals(1, colours.forScheme(night = false))
    assertEquals(2, colours.forScheme(night = true))
  }

  @Test
  fun `listeners hear a new primary, not the same one again`() {
    val state = AccentState()
    val heard = mutableListOf<AccentColours>()
    val stop = state.listen { heard += it }
    val blue = AccentColours(light = 1, dark = 2)

    state.publish(blue)
    state.publish(blue)
    assertEquals(blue, state.current)
    assertEquals(listOf(blue), heard)

    stop()
    state.publish(AccentColours(light = 3, dark = 4))
    assertEquals(listOf(blue), heard)
  }
}
