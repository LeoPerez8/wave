package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MoreFromArtistTest {
  @Test
  fun `the button asks JS for more from the current artist`() {
    assertEquals(
      AutoCommandRequest("command", """{"command":"moreFromArtist"}"""),
      MoreFromArtist.request(MoreFromArtist.ACTION),
    )
  }

  @Test
  fun `the mode buttons' actions are not this button's`() {
    assertNull(MoreFromArtist.request(AutoModes.SHUFFLE_ACTION))
    assertNull(MoreFromArtist.request(AutoModes.REPEAT_ACTION))
  }
}
