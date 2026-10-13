package expo.modules.wavenative.player

/** Where the Lyrics toggle is kept between drives. */
interface LyricsToggleStore {
  fun load(): Boolean

  fun save(on: Boolean)
}

/** The lyric line JS last sent, for the item (queue entry key) it belongs to. */
private data class SentLine(val itemId: String, val text: String)

/**
 * The Lyrics toggle in the overflow menu of Auto's player screen. While it is
 * on and Auto is connected, the line under the title shows the synced lyric
 * line being sung instead of the artist. JS works out the line (Core's
 * `autoLyricLine`) and sends it with `setAutoLyricLine`; [PlaybackService]
 * shows it through [LyricLinePlayer]. Plain Kotlin, so it is JVM-testable.
 */
object AutoLyrics {
  const val TOGGLE_ACTION = "expo.modules.wavenative.AUTO_LYRICS"

  /** The toggle's label in Auto's overflow menu. */
  fun label(on: Boolean): String = if (on) "Lyrics on" else "Lyrics off"

  /** The process-wide state: the service and [WavePlayerModule] share it. */
  val state = AutoLyricsState()
}

/**
 * The toggle (kept in a [LyricsToggleStore]), whether Auto is connected, and
 * the line JS sent. The phone's notification and lock screen share the line
 * under the title with Auto, so a line only shows while both the toggle is on
 * and Auto is connected: turning either off brings the artist back at once,
 * without waiting for JS. Use it on the main thread.
 */
class AutoLyricsState {
  private val listeners = mutableListOf<() -> Unit>()
  private var store: LyricsToggleStore? = null
  private var line: SentLine? = null

  /** The Lyrics toggle; off on a fresh install. */
  var on = false
    private set

  /** Whether Android Auto is connected. */
  var carConnected = false
    private set

  /** Reads the toggle from [store], once per process. */
  fun init(store: LyricsToggleStore) {
    if (this.store != null) return
    this.store = store
    on = store.load()
  }

  /** A tap on the toggle: remembers the new state. */
  fun toggle() {
    on = !on
    store?.save(on)
    if (!on) line = null
    changed()
  }

  fun setCarConnected(connected: Boolean) {
    if (connected == carConnected) return
    carConnected = connected
    if (!connected) line = null
    changed()
  }

  /** Shows [text] under the title of item [itemId]; null shows the artist. Ignored while lyrics don't show. */
  fun showLine(itemId: String?, text: String?) {
    val next = if (on && carConnected && itemId != null && text != null) SentLine(itemId, text) else null
    if (next == line) return
    line = next
    changed()
  }

  /** The line to show under the title of item [itemId], or null for its artist. */
  fun lineFor(itemId: String?): String? =
    line?.takeIf { on && carConnected && it.itemId == itemId }?.text

  /** Calls [listener] on every change; the returned function stops it. */
  fun listen(listener: () -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }

  private fun changed() = listeners.toList().forEach { it() }
}
