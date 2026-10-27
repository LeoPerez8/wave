package expo.modules.waveglass

/** Where a view sits in its window, in pixels: left and top inclusive, right and bottom not. */
internal data class WindowBounds(val left: Int, val top: Int, val right: Int, val bottom: Int) {
  val isEmpty: Boolean
    get() = right <= left || bottom <= top

  fun contains(other: WindowBounds): Boolean =
    left <= other.left && top <= other.top && right >= other.right && bottom >= other.bottom
}

/** When Now Playing may hide the screen under it from drawing (#721, [WaveCoverView]). */
internal object NowPlayingCover {
  /**
   * The screen under the sheet goes undrawn only while JS says the sheet settled open
   * ([settled]) and the sheet, as it is placed this frame, lies over every pixel of it.
   * A sheet a pixel off its rest (a drag down, a closing spring's first frame) or not laid
   * out ([sheet] or [under] null or empty) leaves the screen drawn.
   */
  fun hides(settled: Boolean, sheet: WindowBounds?, under: WindowBounds?): Boolean =
    settled &&
      sheet != null &&
      under != null &&
      !sheet.isEmpty &&
      !under.isEmpty &&
      sheet.contains(under)
}
