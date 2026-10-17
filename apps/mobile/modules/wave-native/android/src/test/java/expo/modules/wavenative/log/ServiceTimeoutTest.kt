package expo.modules.wavenative.log

import org.junit.Assert.assertEquals
import org.junit.Test

class ServiceTimeoutTest {
  @Test
  fun androidEndingAServiceOnItsTimeLimitSaysWhichAndHowLongItRan() {
    assertEquals(
      "Android ended the lyrics and genre service on its time limit after 6 h 2 min",
      ServiceTimeout.line("the lyrics and genre service", (6 * 60 + 2) * 60_000L + 30_000L),
    )
    assertEquals(
      "Android ended the downloads service on its time limit after 42 min 5 s",
      ServiceTimeout.line("the downloads service", 42 * 60_000L + 5_000L),
    )
    assertEquals(
      "Android ended the downloads service on its time limit after 30 s",
      ServiceTimeout.line("the downloads service", 30_000L),
    )
    assertEquals(
      "Android ended the downloads service on its time limit after 6 h",
      ServiceTimeout.line("the downloads service", 6 * 60 * 60_000L),
    )
  }
}
