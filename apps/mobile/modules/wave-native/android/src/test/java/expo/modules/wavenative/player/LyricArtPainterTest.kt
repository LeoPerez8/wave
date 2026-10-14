package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricArtPainterTest {
  /** Text as wide as 0.55 of its size per character, bold or not: enough to lay out by. */
  private val measure = { text: String, sizePx: Float, _: Boolean -> text.length * sizePx * 0.55f }

  private val size = 1000

  private val sung = LyricFrame("Tudo o que eu sinto", "Mais real ainda", "Quando fecho os olhos")

  private fun layout(lines: LyricFrame) = LyricArtPainter.layout(lines, size, measure)

  private fun fits(row: LyricRow) = measure(row.text, row.sizePx, row.bold) <= size * LyricArtPainter.WIDTH + 0.5f

  @Test
  fun `the sung line is big and bold in the middle, its neighbours dimmed above and below`() {
    val (previous, current, next) = layout(sung)

    assertEquals("Tudo o que eu sinto", previous.text)
    assertEquals("Mais real ainda", current.text)
    assertEquals("Quando fecho os olhos", next.text)
    assertTrue(current.bold && !previous.bold && !next.bold)
    assertTrue(current.sizePx > previous.sizePx && current.sizePx > next.sizePx)
    assertEquals(1f, current.alpha)
    assertTrue(previous.alpha < 1f && next.alpha < 1f)
    assertTrue(previous.baseline < current.baseline && current.baseline < next.baseline)
    assertTrue(listOf(previous, current, next).all { it.centreX == size / 2f })
  }

  @Test
  fun `the lines sit inside the centre band the split-screen card shows of a square`() {
    val wrapped = sung.copy(current = "Eu deixo afundar sem medo do escuro")
    for (lines in listOf(sung, wrapped)) {
      for (row in layout(lines)) {
        assertTrue("${row.text} at ${row.baseline}", row.baseline - row.sizePx > size * LyricArtPainter.BAND_TOP)
        assertTrue("${row.text} at ${row.baseline}", row.baseline + row.sizePx * 0.3f < size * LyricArtPainter.BAND_BOTTOM)
      }
    }
  }

  @Test
  fun `a long sung line shrinks to fit the width`() {
    val short = layout(sung)[1]
    val long = layout(sung.copy(current = "Mais real ainda que o mar"))[1]

    assertTrue(long.sizePx < short.sizePx)
    assertTrue(fits(long))
  }

  @Test
  fun `a sung line too long for one row at the smallest size wraps onto two`() {
    val text = "Eu deixo afundar sem medo do escuro"
    val rows = layout(sung.copy(current = text)).filter { it.bold }

    assertEquals(2, rows.size)
    assertEquals(text, rows.joinToString(" ") { it.text })
    assertTrue(rows.all(::fits))
    assertTrue(rows[0].baseline < rows[1].baseline)
  }

  @Test
  fun `text too long for its room ends in an ellipsis`() {
    val endless = "la ".repeat(80).trim()
    val rows = layout(LyricFrame(endless, endless, endless))

    assertTrue(rows.all(::fits))
    assertTrue(rows.filterNot { it.bold }.all { it.text.endsWith("…") })
    assertEquals(2, rows.count { it.bold })
    assertTrue(rows.last { it.bold }.text.endsWith("…"))
  }

  @Test
  fun `one word too long for a row ends in an ellipsis`() {
    val rows = layout(LyricFrame(null, "A".repeat(60), null))

    assertEquals(1, rows.size)
    assertTrue(fits(rows[0]))
    assertTrue(rows[0].text.endsWith("…"))
  }

  @Test
  fun `a missing neighbour leaves its row out and the sung line stays in the middle`() {
    val full = layout(sung)
    val first = layout(LyricFrame(null, "Mais real ainda", "Quando fecho os olhos"))
    val last = layout(LyricFrame("Tudo o que eu sinto", "Mais real ainda", null))

    assertEquals(listOf("Mais real ainda", "Quando fecho os olhos"), first.map { it.text })
    assertEquals(listOf("Tudo o que eu sinto", "Mais real ainda"), last.map { it.text })
    assertEquals(full[1].baseline, first[0].baseline)
    assertEquals(full[1].baseline, last[1].baseline)
  }

  @Test
  fun `the layout scales with the image`() {
    val small = LyricArtPainter.layout(sung, 500, measure)
    val large = layout(sung)

    assertEquals(large[1].sizePx / 2, small[1].sizePx, 0.01f)
    assertEquals(large[1].baseline / 2, small[1].baseline, 0.01f)
  }

  @Test
  fun `painting draws the background, then the rows the layout gives`() {
    val drawn = mutableListOf<String>()
    val canvas = object : LyricArtCanvas {
      override val size = 1000

      override fun textWidth(text: String, sizePx: Float, bold: Boolean) = measure(text, sizePx, bold)

      override fun drawBackground() {
        drawn += "background"
      }

      override fun drawText(row: LyricRow) {
        drawn += row.text
      }
    }

    LyricArtPainter.paint(sung, canvas)

    assertEquals(listOf("background", "Tudo o que eu sinto", "Mais real ainda", "Quando fecho os olhos"), drawn)
  }
}

