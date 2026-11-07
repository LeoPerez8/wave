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
  fun `the Favorite button asks JS to toggle the playing song's star`() {
    assertEquals(
      AutoCommandRequest("command", """{"command":"toggleFavorite"}"""),
      AutoModes.request(AutoModes.FAVORITE_ACTION),
    )
  }

  @Test
  fun `the retired repeat button's action is no command`() {
    assertNull(AutoModes.request("expo.modules.wavenative.AUTO_REPEAT"))
  }

  @Test
  fun `other custom actions are not mode commands`() {
    assertNull(AutoModes.request("expo.modules.wavenative.SLEEP_TIMER_START"))
  }

  @Test
  fun `the buttons show shuffle then the playing song's star, whatever the repeat`() {
    assertEquals(
      listOf(
        ModeButton(AutoModes.SHUFFLE_ACTION, ModeIcon.SHUFFLE_OFF, "Shuffle off"),
        ModeButton(AutoModes.FAVORITE_ACTION, ModeIcon.STAR_OUTLINE, "Favorite"),
      ),
      AutoModes.buttons(PlaybackModes(shuffle = false, repeat = RepeatSetting.OFF)),
    )
    assertEquals(
      listOf(
        ModeButton(AutoModes.SHUFFLE_ACTION, ModeIcon.SHUFFLE_ON, "Shuffle on"),
        ModeButton(AutoModes.FAVORITE_ACTION, ModeIcon.STAR_FILLED, "Unfavorite"),
      ),
      AutoModes.buttons(PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL, starred = true)),
    )
    assertEquals(
      AutoModes.buttons(PlaybackModes(shuffle = false, repeat = RepeatSetting.OFF)),
      AutoModes.buttons(PlaybackModes(shuffle = false, repeat = RepeatSetting.ONE)),
    )
  }

  @Test
  fun `JS's modes are read from its wire values`() {
    assertEquals(PlaybackModes(true, RepeatSetting.ONE, true), AutoModes.fromJs(true, "one", true))
    assertEquals(PlaybackModes(false, RepeatSetting.ALL), AutoModes.fromJs(false, "all", false))
    assertEquals(PlaybackModes(false, RepeatSetting.OFF), AutoModes.fromJs(false, "off", false))
    assertNull(AutoModes.fromJs(false, "sometimes", false))
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
    state.publish(PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL, starred = true))

    assertEquals(
      listOf(
        PlaybackModes(shuffle = true, repeat = RepeatSetting.OFF),
        PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL),
        PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL, starred = true),
      ),
      published,
    )
    assertEquals(PlaybackModes(shuffle = true, repeat = RepeatSetting.ALL, starred = true), state.current)
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
