package expo.modules.wavenative.player

/** One row of text in a lyrics image, centred on [centreX] and standing on [baseline]. */
data class LyricRow(
  val text: String,
  val centreX: Float,
  val baseline: Float,
  val sizePx: Float,
  val bold: Boolean,
  val alpha: Float,
)

/** Where a lyrics image is drawn: Android's canvas in the app, Java 2D in JVM tests. */
interface LyricArtCanvas {
  /** The square image's side, in pixels. */
  val size: Int

  /** How wide [text] is at [sizePx]. */
  fun textWidth(text: String, sizePx: Float, bold: Boolean): Float

  /** The track's cover, centre-cropped and dimmed by [LyricArtPainter.DIM]; without one, Wave's gradient. */
  fun drawBackground()

  /** Draws [row] in white at its alpha. */
  fun drawText(row: LyricRow)
}

/**
 * Draws the lyrics into the square artwork handed to Android Auto, the
 * owner's pick from #150: the line being sung big and bold in the middle,
 * the lines before and after it smaller and dimmed above and below, over the
 * dimmed cover. Auto's split-screen card shows a wide band across the middle
 * of the square, so everything stays within [BAND_TOP]..[BAND_BOTTOM]; the
 * full-screen player shows it whole. Sizes are fractions of the side, so any
 * image size lays out the same. Plain Kotlin, so it is JVM-testable.
 */
object LyricArtPainter {
  /** The side of the image handed to Auto, in pixels. */
  const val SIZE = 800

  /** How much of the cover's light is taken away under the text. */
  const val DIM = 0.55f

  /** Wave's gradient when the track has no cover (top-left, bottom-right). */
  const val FALLBACK_TOP = 0x0d2c40
  const val FALLBACK_BOTTOM = 0x07090c

  /** The widest a row may be. */
  const val WIDTH = 0.88f

  /** The band of the square every row stays inside. */
  const val BAND_TOP = 0.27f
  const val BAND_BOTTOM = 0.73f

  private const val SUNG_MAX = 0.108f
  private const val SUNG_MIN = 0.064f
  private const val NEIGHBOUR_MAX = 0.066f
  private const val NEIGHBOUR_MIN = 0.044f
  private const val NEIGHBOUR_ALPHA = 0.55f

  /** A sung row's height, for two of them, in its text size. */
  private const val LINE_HEIGHT = 1.12f

  /** The room between the sung line and a neighbour. */
  private const val GAP = 0.037f

  /** How far below a row's middle its baseline is, in its text size (about half a capital). */
  private const val BASELINE_DROP = 0.36f

  private const val ELLIPSIS = "…"

  /** Draws [lines] onto [canvas]. */
  fun paint(lines: LyricFrame, canvas: LyricArtCanvas) {
    canvas.drawBackground()
    layout(lines, canvas.size, canvas::textWidth).forEach(canvas::drawText)
  }

  /** The rows [lines] take in an image [size] pixels square, from top to bottom; [measure] gives text widths. */
  fun layout(lines: LyricFrame, size: Int, measure: (String, Float, Boolean) -> Float): List<LyricRow> {
    val side = size.toFloat()
    val room = side * WIDTH
    val centreX = side / 2
    val sung = sungRows(lines.current, side, room, measure)
    val sungSize = sung.sizePx
    val blockTop = side / 2 - sung.texts.size * sungSize * LINE_HEIGHT / 2
    val blockBottom = side / 2 + sung.texts.size * sungSize * LINE_HEIGHT / 2

    fun row(text: String, middle: Float, sizePx: Float, bold: Boolean, alpha: Float) =
      LyricRow(text, centreX, middle + sizePx * BASELINE_DROP, sizePx, bold, alpha)

    fun neighbour(text: String?, above: Boolean): LyricRow? {
      text ?: return null
      val (fitted, sizePx) = fitOneRow(text, side * NEIGHBOUR_MAX, side * NEIGHBOUR_MIN, room, false, measure)
      val middle =
        if (above) blockTop - side * GAP - sizePx / 2 else blockBottom + side * GAP + sizePx / 2
      return row(fitted, middle, sizePx, false, NEIGHBOUR_ALPHA)
    }

    return listOfNotNull(neighbour(lines.previous, above = true)) +
      sung.texts.mapIndexed { index, text ->
        row(text, blockTop + sungSize * LINE_HEIGHT * (index + 0.5f), sungSize, true, 1f)
      } +
      listOfNotNull(neighbour(lines.next, above = false))
  }

  private class Rows(val texts: List<String>, val sizePx: Float)

  /**
   * The sung line: one row, shrunk to fit down to the smallest size; else two
   * rows split where they're most even; else as much as fits, ending in "…".
   */
  private fun sungRows(text: String, side: Float, room: Float, measure: (String, Float, Boolean) -> Float): Rows {
    val max = side * SUNG_MAX
    val min = side * SUNG_MIN
    val single = largestFitting(listOf(text), max, min, room, measure)
    if (single != null) return Rows(listOf(text), single)
    val words = text.split(' ').filter { it.isNotEmpty() }
    if (words.size < 2) return Rows(listOf(ellipsize(text, min, room, true, measure)), min)
    val split = (1 until words.size)
      .map { at -> listOf(words.take(at).joinToString(" "), words.drop(at).joinToString(" ")) }
      .minBy { rows -> rows.maxOf { measure(it, min, true) } }
    largestFitting(split, max, min, room, measure)?.let { return Rows(split, it) }
    // Too long for two rows: the first takes all the words it can, the second the rest, cut short.
    var taken = 1
    while (taken < words.size - 1 && measure(words.take(taken + 1).joinToString(" "), min, true) <= room) taken += 1
    val first = words.take(taken).joinToString(" ")
    return Rows(listOf(ellipsize(first, min, room, true, measure), ellipsize(words.drop(taken).joinToString(" "), min, room, true, measure)), min)
  }

  /** The largest size from [max] down to [min] at which every one of [rows] fits [room]; null if none does. */
  private fun largestFitting(
    rows: List<String>,
    max: Float,
    min: Float,
    room: Float,
    measure: (String, Float, Boolean) -> Float,
  ): Float? {
    // Width grows with the size, so the size that fits exactly is a ratio away.
    val widest = rows.maxOf { measure(it, max, true) }
    if (widest <= room) return max
    val fitting = max * room / widest
    return fitting.takeIf { it >= min && rows.all { row -> measure(row, it, true) <= room } }
  }

  /** [text] in one row: shrunk from [max] to fit, and at [min] cut short with "…" if it still doesn't. */
  private fun fitOneRow(
    text: String,
    max: Float,
    min: Float,
    room: Float,
    bold: Boolean,
    measure: (String, Float, Boolean) -> Float,
  ): Pair<String, Float> {
    val width = measure(text, max, bold)
    if (width <= room) return text to max
    val fitting = max * room / width
    if (fitting >= min && measure(text, fitting, bold) <= room) return text to fitting
    return ellipsize(text, min, room, bold, measure) to min
  }

  /** [text] cut short, at a character, with "…" so that it fits [room]. */
  private fun ellipsize(
    text: String,
    sizePx: Float,
    room: Float,
    bold: Boolean,
    measure: (String, Float, Boolean) -> Float,
  ): String {
    if (measure(text, sizePx, bold) <= room) return text
    var end = text.length
    while (end > 0 && measure(text.take(end).trimEnd() + ELLIPSIS, sizePx, bold) > room) end -= 1
    return text.take(end).trimEnd() + ELLIPSIS
  }
}
