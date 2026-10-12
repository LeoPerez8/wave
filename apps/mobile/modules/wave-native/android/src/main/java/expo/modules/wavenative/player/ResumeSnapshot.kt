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
 * The last player state, kept on disk so the playback service can resume it
 * after Wave's process died, before JS is up (Media3's playback resumption):
 * the items, the current one and its position, shuffle and repeat (Core's
 * `off`, `all` or `one`), where the queue was started from ([source], `phone`
 * or `auto`, as plays record it), and the queue JS last saved ([queueJson],
 * Core's `QueueState`), which JS adopts when it comes up.
 *
 * Written as plain text (one tab-separated record per line) so it reads and
 * writes on the JVM without Android's JSON.
 */
data class ResumeSnapshot(
  val items: List<ResumeItem>,
  val index: Int,
  val positionMs: Long,
  val shuffle: Boolean,
  val repeat: String,
  val source: String,
  val queueJson: String?,
) {
  fun encode(): String = buildString {
    appendLine(HEADER)
    appendLine(record("index", index.toString()))
    appendLine(record("position", positionMs.toString()))
    appendLine(record("shuffle", shuffle.toString()))
    appendLine(record("repeat", repeat))
    appendLine(record("source", source))
    appendLine(record("queue", queueJson))
    for (item in items) {
      appendLine(record("item", item.id, item.path, item.title, item.artist, item.album, item.artworkPath))
    }
  }

  companion object {
    private const val HEADER = "wave-resume 1"
    private const val NULL = "\\N"

    /** The snapshot in [text], or null when there is none or it can't be read. */
    fun decode(text: String?): ResumeSnapshot? {
      if (text == null) return null
      val lines = text.split('\n').filter { it.isNotEmpty() }
      if (lines.firstOrNull() != HEADER) return null
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
      return ResumeSnapshot(
        items = items,
        index = fields["index"]?.toIntOrNull() ?: return null,
        positionMs = fields["position"]?.toLongOrNull() ?: return null,
        shuffle = fields["shuffle"]?.toBooleanStrictOrNull() ?: return null,
        repeat = fields["repeat"] ?: return null,
        source = fields["source"] ?: return null,
        queueJson = fields["queue"],
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
