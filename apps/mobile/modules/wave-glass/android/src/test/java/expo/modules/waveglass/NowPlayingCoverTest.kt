package expo.modules.waveglass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NowPlayingCoverTest {
  private val screen = WindowBounds(0, 0, 1440, 3120)

  @Test
  fun `a settled sheet lying over the whole screen hides it`() {
    assertTrue(NowPlayingCover.hides(settled = true, sheet = screen, under = screen))
  }

  @Test
  fun `a sheet larger than the screen under it hides it too`() {
    assertTrue(
      NowPlayingCover.hides(
        settled = true,
        sheet = WindowBounds(-10, -10, 1450, 3130),
        under = screen,
      ),
    )
  }

  @Test
  fun `until JS says the sheet settled open, the screen stays drawn`() {
    assertFalse(NowPlayingCover.hides(settled = false, sheet = screen, under = screen))
  }

  @Test
  fun `a sheet a pixel down (a drag, a close's first frame) shows the screen at once`() {
    assertFalse(
      NowPlayingCover.hides(
        settled = true,
        sheet = WindowBounds(0, 1, 1440, 3121),
        under = screen,
      ),
    )
  }

  @Test
  fun `a narrower sheet leaves the screen drawn`() {
    assertFalse(
      NowPlayingCover.hides(
        settled = true,
        sheet = WindowBounds(0, 0, 1439, 3120),
        under = screen,
      ),
    )
  }

  @Test
  fun `a sheet or screen not shown or not laid out hides nothing`() {
    assertFalse(NowPlayingCover.hides(settled = true, sheet = null, under = screen))
    assertFalse(NowPlayingCover.hides(settled = true, sheet = screen, under = null))
    assertFalse(
      NowPlayingCover.hides(settled = true, sheet = screen, under = WindowBounds(0, 0, 0, 0)),
    )
    assertFalse(
      NowPlayingCover.hides(settled = true, sheet = WindowBounds(0, 0, 0, 0), under = screen),
    )
  }
}
