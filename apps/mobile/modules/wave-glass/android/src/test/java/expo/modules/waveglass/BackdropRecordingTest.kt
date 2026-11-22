package expo.modules.waveglass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackdropRecordingTest {
  private val place = BackdropPlace(dx = 0, dy = -2100, width = 1000, height = 180)

  @Test
  fun `a glass with no recording records`() {
    assertTrue(BackdropRecording.needed(shownBefore = true, backdropChanged = false, recorded = null, place = place))
  }

  @Test
  fun `a backdrop that changed since the last frame is recorded again`() {
    assertTrue(BackdropRecording.needed(shownBefore = true, backdropChanged = true, recorded = place, place = place))
  }

  @Test
  fun `an unchanged backdrop under a glass that stayed put keeps its recording`() {
    assertFalse(
      BackdropRecording.needed(shownBefore = true, backdropChanged = false, recorded = place, place = place),
    )
  }

  @Test
  fun `a glass that moved or changed size over the backdrop records again`() {
    assertTrue(
      BackdropRecording.needed(
        shownBefore = true,
        backdropChanged = false,
        recorded = place,
        place = place.copy(dy = place.dy - 1),
      ),
    )
    assertTrue(
      BackdropRecording.needed(
        shownBefore = true,
        backdropChanged = false,
        recorded = place,
        place = place.copy(width = place.width + 1),
      ),
    )
  }

  @Test
  fun `a glass shown again records, since the backdrop went on changing while it was hidden`() {
    assertTrue(
      BackdropRecording.needed(shownBefore = false, backdropChanged = false, recorded = place, place = place),
    )
  }
}
