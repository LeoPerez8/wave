package expo.modules.waveglass

/** Where a glass view draws its backdrop from: the backdrop's offset from it, and its own size. */
internal data class BackdropPlace(val dx: Int, val dy: Int, val width: Int, val height: Int)

/**
 * When a glass view records its backdrop again ([WaveGlassView]).
 *
 * A pre-draw decides and the glass view's own draw records. The window's draw
 * pass begins after every pre-draw listener has run (`ViewTreeObserver.OnDrawListener`
 * fires then), and Reanimated defers its work while a draw pass is on. Drawing the
 * backdrop's dirty views from a pre-draw ran their code (a fling's `computeScroll`,
 * which sends a scroll event) before that, so Reanimated committed and Fabric
 * mounted queued views in the middle of a `dispatchDraw`, which crashed
 * (`NullPointerException` on `mViewFlags`, #1432). In the draw, the window has
 * already re-recorded the backdrop, drawn before the glass over it, so a recording
 * only references its fresh display lists.
 */
internal object BackdropRecording {
  /**
   * Whether the coming draw should record the backdrop: there's no recording yet
   * ([recorded] null), the backdrop changed since the last one ([backdropChanged], from
   * `View.isDirty`), the glass moved or changed size over it, or the glass is shown again
   * after a frame hidden ([shownBefore] false), during which the backdrop went unwatched.
   *
   * A recording holds the backdrop's own drawing plus references to its children's
   * RenderNodes, so a child that only re-records or moves shows through without one.
   */
  fun needed(
    shownBefore: Boolean,
    backdropChanged: Boolean,
    recorded: BackdropPlace?,
    place: BackdropPlace,
  ): Boolean = !shownBefore || backdropChanged || recorded != place
}
