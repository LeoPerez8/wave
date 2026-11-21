package expo.modules.waveglass

import org.junit.Assert.assertEquals
import org.junit.Test

class GlassRimTest {
  @Test
  fun `the shipped strength draws the rim as it was before it had levels`() {
    assertEquals(150, GlassRim.alpha(GlassRim.TOP_ALPHA, 100f))
    assertEquals(30, GlassRim.alpha(GlassRim.BOTTOM_ALPHA, 100f))
    assertEquals(1f, GlassRim.widthDp(100f), 0f)
  }

  @Test
  fun `a fainter rim is the same hairline at a lower alpha`() {
    assertEquals(75, GlassRim.alpha(GlassRim.TOP_ALPHA, 50f))
    assertEquals(15, GlassRim.alpha(GlassRim.BOTTOM_ALPHA, 50f))
    assertEquals(1f, GlassRim.widthDp(50f), 0f)
    assertEquals(0, GlassRim.alpha(GlassRim.TOP_ALPHA, 0f))
  }

  @Test
  fun `a stronger rim is brighter and wider, and its alpha stops at opaque`() {
    assertEquals(225, GlassRim.alpha(GlassRim.TOP_ALPHA, 150f))
    assertEquals(1.25f, GlassRim.widthDp(150f), 0f)
    assertEquals(255, GlassRim.alpha(GlassRim.TOP_ALPHA, 200f))
    assertEquals(60, GlassRim.alpha(GlassRim.BOTTOM_ALPHA, 200f))
    assertEquals(1.5f, GlassRim.widthDp(200f), 0f)
  }

  @Test
  fun `a strength that is not a number or below zero is held`() {
    assertEquals(150, GlassRim.alpha(GlassRim.TOP_ALPHA, Float.NaN))
    assertEquals(0, GlassRim.alpha(GlassRim.TOP_ALPHA, -40f))
    assertEquals(1f, GlassRim.widthDp(-40f), 0f)
  }
}
