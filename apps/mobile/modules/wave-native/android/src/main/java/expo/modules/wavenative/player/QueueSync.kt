package expo.modules.wavenative.player

/**
 * One step of the plan Core's `planPlayerSync` makes to bring the player's
 * item list in line with the queue. Items are identified by queue entry keys
 * (their media ids).
 */
sealed interface SyncStep {
  data object Clear : SyncStep

  data class Replace(val keys: List<String>, val index: Int) : SyncStep

  data class Seek(val key: String) : SyncStep

  data class Edit(val at: Int, val removeCount: Int, val insertKeys: List<String>) : SyncStep

  companion object {
    /** Reads a step as JS sends it (a flat record with a `type`). */
    fun of(type: String, at: Int, removeCount: Int, keys: List<String>, index: Int, key: String): SyncStep =
      when (type) {
        "clear" -> Clear
        "replace" -> Replace(keys, index)
        "seek" -> Seek(key)
        "edit" -> Edit(at, removeCount, keys)
        else -> throw IllegalArgumentException("Unknown sync step '$type'")
      }
  }
}

/** The player's item list as [QueueSync] edits it. */
interface PlaylistEditor<T> {
  val keys: List<String>
  val currentKey: String?

  fun clear()

  fun replace(items: List<T>, index: Int)

  fun seek(index: Int)

  fun remove(from: Int, toExclusive: Int)

  fun insert(at: Int, items: List<T>)
}

object QueueSync {
  /**
   * Applies [steps] in order. [resolve] turns a key into an item: the one
   * already loaded for it, or a new one JS sent. Throws [IllegalArgumentException]
   * when a step doesn't fit the list (JS then reloads the whole queue).
   */
  fun <T> apply(steps: List<SyncStep>, editor: PlaylistEditor<T>, resolve: (String) -> T?) {
    fun items(keys: List<String>): List<T> =
      keys.map { key -> requireNotNull(resolve(key)) { "No item for key $key" } }

    for (step in steps) {
      when (step) {
        SyncStep.Clear -> editor.clear()
        is SyncStep.Replace -> {
          require(step.index in step.keys.indices) { "Start index ${step.index} out of range" }
          editor.replace(items(step.keys), step.index)
        }
        is SyncStep.Seek -> {
          if (editor.currentKey == step.key) continue
          val index = editor.keys.indexOf(step.key)
          require(index >= 0) { "Key ${step.key} isn't loaded" }
          editor.seek(index)
        }
        is SyncStep.Edit -> {
          val size = editor.keys.size
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
}
