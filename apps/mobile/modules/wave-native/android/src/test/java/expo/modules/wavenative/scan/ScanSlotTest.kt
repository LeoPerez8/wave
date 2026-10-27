package expo.modules.wavenative.scan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanSlotTest {
  @Test
  fun `a new scan cancels the one running`() {
    val slot = ScanSlot()
    val first = claimed(slot.claim(1))
    val second = claimed(slot.claim(2))
    assertTrue(first.get())
    assertFalse(second.get())
  }

  @Test
  fun `a start that arrives after a newer one's doesn't run or cancel it`() {
    val slot = ScanSlot()
    val newer = claimed(slot.claim(5))
    assertNull(slot.claim(4))
    assertFalse(newer.get())
  }

  @Test
  fun `cancelling names the scan, so an older id leaves the current one running`() {
    val slot = ScanSlot()
    slot.claim(1)
    val current = claimed(slot.claim(2))
    slot.cancel(1)
    assertFalse(current.get())
    slot.cancel(2)
    assertTrue(current.get())
  }

  @Test
  fun `a finished scan leaves the slot, and cancelling every scan stops the current one`() {
    val slot = ScanSlot()
    val first = claimed(slot.claim(1))
    slot.finished(1)
    slot.cancel(1)
    assertFalse(first.get())
    val second = claimed(slot.claim(2))
    slot.cancelAll()
    assertTrue(second.get())
  }

  private fun <T> claimed(value: T?): T = requireNotNull(value) { "the scan didn't claim the slot" }
}
