package expo.modules.wavenative.recognize

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class RecognizeWindowTest {
  private fun samples(from: Int, to: Int) = ShortArray(to - from) { (from + it).toShort() }

  private fun RecognizeWindow.add(samples: ShortArray) = append(samples, samples.size)

  @Test
  fun `holds what it has heard, in order, until it is full`() {
    val window = RecognizeWindow(capacity = 8)
    window.add(samples(0, 5))

    assertArrayEquals(samples(0, 5), window.latest(8))
    assertArrayEquals(samples(3, 5), window.latest(2))
  }

  @Test
  fun `past its capacity it keeps only the latest samples`() {
    val window = RecognizeWindow(capacity = 8)
    window.add(samples(0, 6))
    window.add(samples(6, 11))

    assertArrayEquals(samples(3, 11), window.latest(8))
    assertArrayEquals(samples(7, 11), window.latest(4))
  }

  @Test
  fun `one read longer than its capacity leaves that read's end`() {
    val window = RecognizeWindow(capacity = 8)
    window.add(samples(0, 3))
    window.add(samples(3, 23))

    assertArrayEquals(samples(15, 23), window.latest(8))
  }

  @Test
  fun `takes only the samples a read filled`() {
    val window = RecognizeWindow(capacity = 8)
    window.append(samples(0, 8), 3)

    assertArrayEquals(samples(0, 3), window.latest(8))
  }

  @Test
  fun `however much it hears, it never gives back more than its capacity`() {
    val window = RecognizeWindow(capacity = 8)
    repeat(10_000) { window.add(samples(it * 3, it * 3 + 3)) }

    assertArrayEquals(samples(29_992, 30_000), window.latest(Int.MAX_VALUE))
  }

  @Test
  fun `asks for no samples when none were heard`() {
    assertEquals(0, RecognizeWindow(capacity = 8).latest(8).size)
  }
}
