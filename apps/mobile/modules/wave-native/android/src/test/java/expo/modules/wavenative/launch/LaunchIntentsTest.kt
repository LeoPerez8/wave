package expo.modules.wavenative.launch

import org.junit.Assert.*
import org.junit.Test

class LaunchIntentsTest {
  private class Screen
  private class Delivery

  @Test fun `a fresh screen's launch intent is new`() {
    val intents = LaunchIntents()
    val screen = Screen()
    intents.preCreated(screen, restored = false)
    assertTrue(intents.launchIsNew(screen, fromHistory = false))
  }

  @Test fun `a screen Android restores after its process died keeps the intent it already handled`() {
    val intents = LaunchIntents()
    val screen = Screen()
    intents.preCreated(screen, restored = true)
    assertFalse(intents.launchIsNew(screen, fromHistory = false))
    val restartedAgain = Screen()
    intents.preCreated(restartedAgain, restored = true)
    assertFalse(intents.launchIsNew(restartedAgain, fromHistory = false))
  }

  @Test fun `a screen reopened from Recents replays an old intent`() {
    val intents = LaunchIntents()
    val screen = Screen()
    intents.preCreated(screen, restored = false)
    assertFalse(intents.launchIsNew(screen, fromHistory = true))
  }

  @Test fun `an intent both Expo and the activity pass on arrives once`() {
    val intents = LaunchIntents()
    val tap = Delivery()
    assertTrue(intents.firstDelivery(tap))
    assertFalse(intents.firstDelivery(tap))
    assertTrue(intents.firstDelivery(Delivery()))
  }
}
