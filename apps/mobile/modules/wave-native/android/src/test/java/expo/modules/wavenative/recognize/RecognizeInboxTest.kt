package expo.modules.wavenative.recognize

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class RecognizeInboxTest {
  @Before fun clear() { RecognizeInbox.take(); RecognizeInbox.onReceived = null }

  @Test fun `a cold launch stays pending until JS takes it once`() {
    RecognizeInbox.receive("dev.leoperez.wave.action.RECOGNIZE")
    assertTrue(RecognizeInbox.take())
    assertFalse(RecognizeInbox.take())
  }

  @Test fun `ordinary launches and Recents never start listening`() {
    RecognizeInbox.receive(null)
    RecognizeInbox.receive("android.intent.action.MAIN")
    RecognizeInbox.receive("android.intent.action.SEND")
    RecognizeInbox.receive("dev.leoperez.wave.action.RECOGNIZE", fromHistory = true)
    assertFalse(RecognizeInbox.take())
  }

  @Test fun `warm requests notify JS and requests before it is ready coalesce`() {
    var ready = false
    var opened = 0
    RecognizeInbox.onReceived = {
      if (ready && RecognizeInbox.take()) opened++
    }
    repeat(3) { RecognizeInbox.receive("dev.leoperez.wave.action.RECOGNIZE") }
    assertEquals(0, opened)
    ready = true
    assertTrue(RecognizeInbox.take())
    assertFalse(RecognizeInbox.take())
    RecognizeInbox.receive("dev.leoperez.wave.action.RECOGNIZE")
    assertEquals(1, opened)
    assertFalse(RecognizeInbox.take())
  }
}
