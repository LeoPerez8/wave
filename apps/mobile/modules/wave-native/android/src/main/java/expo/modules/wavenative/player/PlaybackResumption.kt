package expo.modules.wavenative.player

/** What the session sets on the player to resume: the items, where to start, and repeat. */
data class Resumption<T>(
  val items: List<T>,
  val startIndex: Int,
  val positionMs: Long,
  /** The player's repeat mode (`Player.REPEAT_MODE_*`). */
  val repeatMode: Int,
  /** Where the resumed plays come from (`phone` or `auto`). */
  val source: String,
)

/** Turns the last snapshot into Media3's playback resumption (see [PlaybackService]). */
object PlaybackResumption {
  /**
   * The resumption for [snapshot], with each item built by [build]; null when
   * there's nothing to resume. A current item that isn't there anymore starts
   * the first one from the top. Plays resumed [byAuto] come from Auto;
   * otherwise from wherever the queue was started.
   */
  fun <T> plan(snapshot: ResumeSnapshot?, byAuto: Boolean, build: (ResumeItem) -> T): Resumption<T>? {
    if (snapshot == null || snapshot.items.isEmpty()) return null
    val known = snapshot.index in snapshot.items.indices
    return Resumption(
      items = snapshot.items.map(build),
      startIndex = if (known) snapshot.index else 0,
      positionMs = if (known) snapshot.positionMs.coerceAtLeast(0) else 0,
      repeatMode = PlayerEvents.repeatMode(snapshot.repeat),
      source = if (byAuto) "auto" else snapshot.source,
    )
  }
}
