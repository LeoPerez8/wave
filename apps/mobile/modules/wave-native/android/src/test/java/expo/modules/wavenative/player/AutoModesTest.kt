package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AutoModesTest {
  @Test
  fun `the shuffle button asks JS to toggle shuffle`() {
    assertEquals(
      AutoCommandRequest("command", """{"command":"toggleShuffle"}"""),
      AutoModes.request(AutoModes.SHUFFLE_ACTION),
    )
  }

  @Test
  fun `the repeat button asks JS to cycle repeat`() {
    assertEquals(
      AutoCommandRequest("command", """{"command":"cycleRepeat"}"""),
      AutoModes.request(AutoModes.REPEAT_ACTION),
    )
  }

  @Test
  fun `other custom actions are not mode commands`() {
    assertNull(AutoModes.request("expo.modules.wavenative.SLEEP_TIMER_START"))
  }

  @Test
  fun `the buttons show shuffle then repeat in their current state`() {
    assertEquals(
      listOf(
        ModeButton(AutoModes.SHUFFLE_ACTION, ModeIcon.SHUFFLE_OFF, "Shuffle off"),
        ModeButton(AutoModes.REPEAT_ACTION, ModeIcon.REPEAT_OFF, "Repeat off"),
      ),
      AutoModes.buttons(PlaybackModes(shuffle = false, repeat = RepeatSetting.OFF)),
    )
    assertEquals(
      listOf(
        ModeButton(AutoModes.SHUFFLE_ACTION, ModeIcon.SHUFFLE_ON, "Shuffle on"),
        ModeButton(AutoModes.REPEAT_ACTION, ModeIcon.REPEAT_ALL, "Repeat all"),
      ),
      AutoModes.buttons(PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL)),
    )
    assertEquals(
      ModeButton(AutoModes.REPEAT_ACTION, ModeIcon.REPEAT_ONE, "Repeat one"),
      AutoModes.buttons(PlaybackModes(shuffle = false, repeat = RepeatSetting.ONE))[1],
    )
  }

  @Test
  fun `JS's modes are read from its wire values`() {
    assertEquals(PlaybackModes(true, RepeatSetting.ONE), AutoModes.fromJs(true, "one"))
    assertEquals(PlaybackModes(false, RepeatSetting.ALL), AutoModes.fromJs(false, "all"))
    assertEquals(PlaybackModes(false, RepeatSetting.OFF), AutoModes.fromJs(false, "off"))
    assertNull(AutoModes.fromJs(false, "sometimes"))
  }

  @Test
  fun `nothing is published before JS reports its modes`() {
    val state = PlaybackModesState()
    assertEquals(PlaybackModes(shuffle = false, repeat = RepeatSetting.OFF), state.current)
  }

  @Test
  fun `a change made on the phone reaches the session's listener`() {
    val state = PlaybackModesState()
    val published = mutableListOf<PlaybackModes>()
    state.listen { published += it }

    state.publish(PlaybackModes(shuffle = true, repeat = RepeatSetting.OFF))
    state.publish(PlaybackModes(shuffle = true, repeat = RepeatSetting.OFF))
    state.publish(PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL))

    assertEquals(
      listOf(
        PlaybackModes(shuffle = true, repeat = RepeatSetting.OFF),
        PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL),
      ),
      published,
    )
    assertEquals(PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL), state.current)
  }

  @Test
  fun `a listener that stopped listening hears nothing more`() {
    val state = PlaybackModesState()
    val published = mutableListOf<PlaybackModes>()
    val stop = state.listen { published += it }
    stop()

    state.publish(PlaybackModes(shuffle = true, repeat = RepeatSetting.ONE))

    assertEquals(emptyList<PlaybackModes>(), published)
  }
}
