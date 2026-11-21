package expo.modules.wavenative.recognize

import org.junit.Assert.*
import org.junit.Test

class RecognizeFavoriteInboxTest {
  @Test fun `taps wait in order until JS takes them, each once`() {
    val inbox = RecognizeFavoriteInbox()
    inbox.add("first", on = true)
    inbox.add("second", on = false)
    val first = inbox.take()!!
    assertEquals("first", first.match)
    assertTrue(first.on)
    val second = inbox.take()!!
    assertEquals("second", second.match)
    assertFalse(second.on)
    assertNull(inbox.take())
  }

  @Test fun `JS hears of each tap as it comes`() {
    val inbox = RecognizeFavoriteInbox()
    var heard = 0
    inbox.onRequested = { heard++ }
    inbox.add("kept", on = true)
    inbox.add("kept", on = false)
    assertEquals(2, heard)
  }

  @Test fun `the service may go only once every tap is answered`() {
    val inbox = RecognizeFavoriteInbox()
    inbox.add("first", on = true)
    inbox.add("second", on = true)
    inbox.take()
    assertFalse(inbox.done())
    inbox.take()
    assertTrue(inbox.done())
  }

  @Test fun `a tap that comes while another is answered keeps the service`() {
    val inbox = RecognizeFavoriteInbox()
    inbox.add("first", on = true)
    inbox.take()
    inbox.add("second", on = true)
    assertFalse(inbox.done())
  }

  @Test fun `an answer with nothing waiting leaves nothing to keep`() {
    val inbox = RecognizeFavoriteInbox()
    assertTrue(inbox.done())
    inbox.add("kept", on = true)
    assertFalse(inbox.done())
    assertTrue(inbox.done())
  }

  @Test fun `clearing forgets the taps JS never took`() {
    val inbox = RecognizeFavoriteInbox()
    inbox.add("kept", on = true)
    inbox.clear()
    assertNull(inbox.take())
    assertTrue(inbox.done())
  }
}
