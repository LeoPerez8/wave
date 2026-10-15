package expo.modules.wavenative

import org.junit.Assert.assertEquals
import org.junit.Test

// Temporary (#190): proves a failing native test shows in its own CI comment.
class CiProbeTest {
  @Test
  fun failsOnPurpose() {
    assertEquals("expected by the probe", "what CI got")
  }
}
