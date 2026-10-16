package expo.modules.wavenative.player

/**
 * One step of the plan Core's `planPlayerSync` makes to bring the player's
 * item list in line with the queue. Items are identified by queue entry keys
 * (their media ids).
 */
sealed interface SyncStep {
  data object Clear : SyncStep

  data class Replace(val keys: List<String>, val index: Int) : SyncStep

  /** Moves to the loaded item [key]; [index] is where JS last saw it, checked before use. */
  data class Seek(val key: String, val index: Int) : SyncStep

  data class Edit(val at: Int, val removeCount: Int, val insertKeys: List<String>) : SyncStep

  companion object {
    /** Reads a step as JS sends it (a flat record with a `type`). */
    fun of(type: String, at: Int, removeCount: Int, keys: List<String>, index: Int, key: String): SyncStep =
      when (type) {
        "clear" -> Clear
        "replace" -> Replace(keys, index)
        "seek" -> Seek(key, index)
        "edit" -> Edit(at, removeCount, keys)
        else -> throw IllegalArgumentException("Unknown sync step '$type'")
      }
  }
}

/**
 * The player's item list as [QueueSync] edits it. Reads go one item at a time,
 * so a step only touches the items it needs.
 */
interface PlaylistEditor<T> {
  val size: Int
  val currentKey: String?

  fun keyAt(index: Int): String

  fun itemAt(index: Int): T

  fun clear()

  fun replace(items: List<T>, index: Int)

  fun seek(index: Int)

  fun remove(from: Int, toExclusive: Int)

  fun insert(at: Int, items: List<T>)
}

object QueueSync {
  /**
   * Applies [steps] in order. A key resolves to the item JS sent for it in
   * [incoming], or else to the one the player already holds. Loaded items are
   * only read for keys a step re-inserts, once and before any edit, so a seek
   * or a plain insertion or removal doesn't walk the list. Throws
   * [IllegalArgumentException] when a step doesn't fit the list (JS then reads
   * the player's list and plans again); a key that can't be resolved fails
   * before anything changes.
   */
  fun <T> apply(steps: List<SyncStep>, editor: PlaylistEditor<T>, incoming: Map<String, T>) {
    val loaded = loadedItems(steps, editor, incoming)
    fun items(keys: List<String>): List<T> =
      keys.map { key -> incoming[key] ?: loaded.getValue(key) }

    for (step in steps) {
      when (step) {
        SyncStep.Clear -> editor.clear()
        is SyncStep.Replace -> {
          require(step.index in step.keys.indices) { "Start index ${step.index} out of range" }
          editor.replace(items(step.keys), step.index)
        }
        is SyncStep.Seek -> {
          if (editor.currentKey == step.key) continue
          val index = indexOf(editor, step.key, step.index)
          require(index >= 0) { "Key ${step.key} isn't loaded" }
          editor.seek(index)
        }
        is SyncStep.Edit -> {
          val size = editor.size
          require(step.at in 0..size && step.removeCount >= 0 && step.at + step.removeCount <= size) {
            "Edit at ${step.at} removing ${step.removeCount} doesn't fit $size items"
          }
          val inserted = items(step.insertKeys)
          if (step.removeCount > 0) editor.remove(step.at, step.at + step.removeCount)
          if (inserted.isNotEmpty()) editor.insert(step.at, inserted)
        }
      }
    }
  }

  /**
   * The loaded items for the keys [steps] insert without JS sending them (a
   * moved entry), read before any step edits the list. Empty, without reading
   * anything, when there are none.
   */
  private fun <T> loadedItems(
    steps: List<SyncStep>,
    editor: PlaylistEditor<T>,
    incoming: Map<String, T>,
  ): Map<String, T> {
    val wanted = HashSet<String>()
    for (step in steps) {
      val keys = when (step) {
        is SyncStep.Replace -> step.keys
        is SyncStep.Edit -> step.insertKeys
        else -> continue
      }
      for (key in keys) if (key !in incoming) wanted += key
    }
    if (wanted.isEmpty()) return emptyMap()
    val found = HashMap<String, T>(wanted.size * 2)
    for (index in 0 until editor.size) {
      val key = editor.keyAt(index)
      if (key in wanted && key !in found) {
        found[key] = editor.itemAt(index)
        if (found.size == wanted.size) break
      }
    }
    val missing = wanted.firstOrNull { it !in found }
    require(missing == null) { "No item for key $missing" }
    return found
  }

  /**
   * Where the player holds [key]: [hint] when it's there (JS's picture is
   * normally current), else wherever it is now, or -1.
   */
  private fun <T> indexOf(editor: PlaylistEditor<T>, key: String, hint: Int): Int {
    if (hint in 0 until editor.size && editor.keyAt(hint) == key) return hint
    for (index in 0 until editor.size) if (editor.keyAt(index) == key) return index
    return -1
  }
}
