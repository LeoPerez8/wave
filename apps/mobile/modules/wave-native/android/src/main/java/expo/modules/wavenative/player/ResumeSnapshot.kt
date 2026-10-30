package expo.modules.wavenative.player

/** One player item as the snapshot keeps it: what [PlayerMediaItems.build] needs. */
data class ResumeItem(
  /** The queue entry key (the player item's media ID). */
  val id: String,
  val path: String,
  val title: String,
  val artist: String,
  val album: String?,
  /** The artwork file; the item builder turns it into the URI Auto and the notification read. */
  val artworkPath: String?,
)

/**
 * The player's [reported] items when they differ from the [kept] ones, or
 * null when they're the same: ExoPlayer raises a timeline change whenever it
 * prepares an item (before each song change), which mustn't rewrite the
 * items part.
 */
fun changedResumeItems(kept: List<ResumeItem>?, reported: List<ResumeItem>): List<ResumeItem>? =
  reported.takeIf { it != kept }

/**
 * The last player state, kept on disk so the playback service can resume it
 * after Wave's process died, before JS is up (Media3's playback resumption):
 * the items (the window of a long queue), the current one and its position, the
 * queue's shuffle and repeat (Core's `off`, `all` or `one`), where the queue was started from ([source], `phone`
 * or `auto`, as plays record it), and the queue JS last saved, which JS adopts
 * when it comes up: [queueJson] (Core's `QueueState`), with the index and
 * metadata JS saved apart from it since ([queueIndex], [queueMetadata]; Core's
 * `savedQueueState` reads them back together).
 *
 * Written in two parts ([ResumeFiles]): the items with the queue, rewritten
 * only when they change, and the small place part (everything else), written
 * on every song change and every few seconds while playing. Both are plain
 * text (one tab-separated record per line) so they read and write on the JVM
 * without Android's JSON.
 */
data class ResumeSnapshot(
  val items: List<ResumeItem>,
  val index: Int,
  val positionMs: Long,
  val shuffle: Boolean,
  val repeat: String,
  val source: String,
  val queueJson: String?,
  val queueIndex: Int? = null,
  val queueMetadata: String? = null,
) {
  /** The rarely written part: the items and the queue's JSON. */
  fun encodeItems(): String = buildString {
    appendLine(ITEMS_HEADER)
    appendLine(record("queue", queueJson))
    for (item in items) {
      appendLine(record("item", item.id, item.path, item.title, item.artist, item.album, item.artworkPath))
    }
  }

  /** The small part: where the player is, and what JS saved apart from the queue's JSON. */
  fun encodePlace(): String = buildString {
    appendLine(PLACE_HEADER)
    appendLine(record("index", index.toString()))
    appendLine(record("position", positionMs.toString()))
    appendLine(record("shuffle", shuffle.toString()))
    appendLine(record("repeat", repeat))
    appendLine(record("source", source))
    appendLine(record("queueIndex", queueIndex?.toString()))
    appendLine(record("queueMetadata", queueMetadata))
  }

  companion object {
    /** The one-file snapshot earlier versions wrote. */
    private const val HEADER = "wave-resume 1"
    private const val ITEMS_HEADER = "wave-resume-items 1"
    private const val PLACE_HEADER = "wave-resume-place 1"
    private const val NULL = "\\N"

    /** The snapshot an earlier version wrote in one file, or null when there is none or it can't be read. */
    fun decode(text: String?): ResumeSnapshot? {
      val parts = parse(text, HEADER) ?: return null
      return snapshot(parts, parts)
    }

    /** The snapshot written in its two parts, or null when either is missing or can't be read. */
    fun decode(items: String?, place: String?): ResumeSnapshot? {
      val itemsPart = parse(items, ITEMS_HEADER) ?: return null
      val placePart = parse(place, PLACE_HEADER) ?: return null
      if (placePart.items.isNotEmpty()) return null
      return snapshot(itemsPart, placePart)
    }

    private class Parsed(val fields: Map<String, String?>, val items: List<ResumeItem>)

    private fun parse(text: String?, header: String): Parsed? {
      if (text == null) return null
      val lines = text.split('\n').filter { it.isNotEmpty() }
      if (lines.firstOrNull() != header) return null
      val fields = mutableMapOf<String, String?>()
      val items = mutableListOf<ResumeItem>()
      for (line in lines.drop(1)) {
        val parts = line.split('\t').map(::unescape)
        when (parts[0]) {
          "item" -> {
            if (parts.size != 7) return null
            items += ResumeItem(
              id = parts[1] ?: return null,
              path = parts[2] ?: return null,
              title = parts[3] ?: return null,
              artist = parts[4] ?: return null,
              album = parts[5],
              artworkPath = parts[6],
            )
          }
          else -> {
            if (parts.size != 2) return null
            fields[parts[0] ?: return null] = parts[1]
          }
        }
      }
      return Parsed(fields, items)
    }

    private fun snapshot(items: Parsed, place: Parsed): ResumeSnapshot? {
      val fields = place.fields
      val queueIndex = fields["queueIndex"]
      return ResumeSnapshot(
        items = items.items,
        index = fields["index"]?.toIntOrNull() ?: return null,
        positionMs = fields["position"]?.toLongOrNull() ?: return null,
        shuffle = fields["shuffle"]?.toBooleanStrictOrNull() ?: return null,
        repeat = fields["repeat"] ?: return null,
        source = fields["source"] ?: return null,
        queueJson = items.fields["queue"],
        queueIndex = if (queueIndex == null) null else queueIndex.toIntOrNull() ?: return null,
        queueMetadata = fields["queueMetadata"],
      )
    }

    private fun record(vararg values: String?): String = values.joinToString("\t") { escape(it) }

    private fun escape(value: String?): String {
      if (value == null) return NULL
      return buildString {
        for (char in value) {
          when (char) {
            '\\' -> append("\\\\")
            '\t' -> append("\\t")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            else -> append(char)
          }
        }
      }
    }

    private fun unescape(value: String): String? {
      if (value == NULL) return null
      if ('\\' !in value) return value
      return buildString {
        var i = 0
        while (i < value.length) {
          val char = value[i]
          if (char == '\\' && i + 1 < value.length) {
            append(
              when (value[i + 1]) {
                't' -> '\t'
                'n' -> '\n'
                'r' -> '\r'
                else -> value[i + 1]
              },
            )
            i += 2
          } else {
            append(char)
            i++
          }
        }
      }
    }
  }
}
