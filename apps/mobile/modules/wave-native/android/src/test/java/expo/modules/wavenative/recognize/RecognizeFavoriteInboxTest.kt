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
    assertNotEquals(first.id, second.id)
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
    val first = inbox.take()!!
    val second = inbox.take()!!
    assertFalse(inbox.done(first.id))
    assertFalse(inbox.idle())
    assertTrue(inbox.done(second.id))
    assertTrue(inbox.idle())
  }

  @Test fun `a tap that comes while another is answered keeps the service`() {
    val inbox = RecognizeFavoriteInbox()
    inbox.add("first", on = true)
    val first = inbox.take()!!
    inbox.add("second", on = true)
    assertFalse(inbox.done(first.id))
  }

  @Test fun `a late answer for a tap already gone can't close a newer one`() {
    val inbox = RecognizeFavoriteInbox()
    inbox.add("old", on = true)
    val old = inbox.take()!!
    inbox.clear()
    inbox.add("new", on = true)
    assertFalse(inbox.done(old.id))
    assertFalse(inbox.done(old.id))
    assertTrue(inbox.done(inbox.take()!!.id))
  }

  @Test fun `clearing forgets the taps JS never took`() {
    val inbox = RecognizeFavoriteInbox()
    inbox.add("kept", on = true)
    inbox.clear()
    assertNull(inbox.take())
    assertTrue(inbox.idle())
  }
}
