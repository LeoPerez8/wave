package expo.modules.wavenative.player

import expo.modules.wavenative.artwork.ArtworkUris
import kotlin.random.Random

/** Where the Lyrics toggle is kept between drives. */
interface LyricsToggleStore {
  fun load(): Boolean

  fun save(on: Boolean)
}

/** The three lines drawn into the artwork (Core's `AutoLyricsFrame`): the one being sung and its neighbours. */
data class LyricFrame(val previous: String?, val current: String, val next: String?)

/** The lines JS last sent, for the item (queue entry key) they belong to. */
private data class SentLines(val itemId: String, val lines: LyricFrame)

/**
 * The Lyrics toggle in the overflow menu of Auto's player screen. While it is
 * on and Auto is connected, the artwork shows the synced lyrics being sung,
 * drawn into an image ([LyricArtworks], [LyricArtPainter]); the title and
 * artist stay as they are. JS works out the lines (Core's `autoLyricLines`)
 * and sends them with `setAutoLyricLines`; [PlaybackService] shows them
 * through [LyricArtworkPlayer]. Plain Kotlin, so it is JVM-testable.
 */
object AutoLyrics {
  const val TOGGLE_ACTION = "expo.modules.wavenative.AUTO_LYRICS"

  /** The toggle's label in Auto's overflow menu. */
  fun label(on: Boolean): String = if (on) "Lyrics on" else "Lyrics off"

  /** The process-wide state: the service and [WavePlayerModule] share it. */
  val state = AutoLyricsState()

  /** The lyrics images handed out in this process, which the artwork provider draws. */
  val artworks = LyricArtworks()
}

/**
 * The toggle (kept in a [LyricsToggleStore]), whether Auto is connected, and
 * the lines JS sent. The phone's notification and lock screen share the
 * artwork with Auto, so lyrics only show while both the toggle is on and Auto
 * is connected: turning either off brings the cover back at once, without
 * waiting for JS. Use it on the main thread.
 */
class AutoLyricsState {
  private val listeners = mutableListOf<() -> Unit>()
  private var store: LyricsToggleStore? = null
  private var sent: SentLines? = null

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
    if (!on) sent = null
    changed()
  }

  fun setCarConnected(connected: Boolean) {
    if (connected == carConnected) return
    carConnected = connected
    if (!connected) sent = null
    changed()
  }

  /** Draws [lines] into the artwork of item [itemId]; null shows its cover. Ignored while lyrics don't show. */
  fun showLines(itemId: String?, lines: LyricFrame?) {
    val next = if (on && carConnected && itemId != null && lines != null) SentLines(itemId, lines) else null
    if (next == sent) return
    sent = next
    changed()
  }

  /** The lines to draw into the artwork of item [itemId], or null for its cover. */
  fun linesFor(itemId: String?): LyricFrame? =
    sent?.takeIf { on && carConnected && it.itemId == itemId }?.lines

  /** Calls [listener] on every change; the returned function stops it. */
  fun listen(listener: () -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }

  private fun changed() = listeners.toList().forEach { it() }
}

/**
 * The lyrics images the session hands out, by id, so the artwork provider
 * (which runs on its own threads) can draw the one Auto asks for. Each new
 * set of lines over a cover gets a new id, and so a new URI that Auto loads
 * afresh; the same lines keep theirs, so a refresh doesn't make Auto reload.
 * Ids start with a token of this process, so an image Auto cached from an
 * earlier run is never shown for another line. Only the latest [KEPT] are
 * kept. Thread-safe.
 */
class LyricArtworks(private val token: String = Random.nextLong(1L shl 40).toString(36)) {
  /** What one image shows: [lines] over the cover file [coverPath] (null without one). */
  data class Entry(val lines: LyricFrame, val coverPath: String?)

  private val entries = LinkedHashMap<String, Entry>()
  private var serial = 0L

  /** The artwork URI showing [lines] over [coverPath], or null (the item's own artwork) without lines. */
  @Synchronized
  fun uriFor(authority: String, lines: LyricFrame?, coverPath: String?): String? {
    lines ?: return null
    val entry = Entry(lines, coverPath)
    val id = entries.entries.lastOrNull { it.value == entry }?.key ?: newId(entry)
    return ArtworkUris.lyrics(authority, id)
  }

  /** What image [id] shows, or null when it isn't one of the latest. */
  @Synchronized
  fun find(id: String): Entry? = entries[id]

  /** The ids of the images still kept, so the provider can drop the files of others. */
  @Synchronized
  fun liveIds(): Set<String> = entries.keys.toSet()

  private fun newId(entry: Entry): String {
    serial += 1
    val id = "${token}x${serial.toString(36)}"
    entries[id] = entry
    while (entries.size > KEPT) entries.remove(entries.keys.first())
    return id
  }

  companion object {
    /** Images kept: the one showing, and a few Auto or the notification may still be loading. */
    const val KEPT = 4
  }
}
