package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class QueueSyncTest {
  /** A player list holding item names ("old:1", "new:4"), recording what was done to it. */
  private class FakePlaylist(initial: List<String>, var current: Int) : PlaylistEditor<String> {
    val items = initial.map { "old:$it" }.toMutableList()
    val ops = mutableListOf<String>()

    override val keys: List<String> get() = items.map { it.substringAfter(':') }
    override val currentKey: String? get() = keys.getOrNull(current)

    override fun clear() {
      ops += "clear"
      items.clear()
      current = -1
    }

    override fun replace(items: List<String>, index: Int) {
      ops += "replace"
      this.items.clear()
      this.items += items
      current = index
    }

    override fun seek(index: Int) {
      ops += "seek $index"
      current = index
    }

    override fun remove(from: Int, toExclusive: Int) {
      ops += "remove $from $toExclusive"
      repeat(toExclusive - from) { items.removeAt(from) }
      if (current >= toExclusive) current -= toExclusive - from
    }

    override fun insert(at: Int, items: List<String>) {
      ops += "insert $at ${items.size}"
      this.items.addAll(at, items)
      if (current >= at) current += items.size
    }
  }

  private fun resolver(playlist: FakePlaylist, newKeys: List<String>): (String) -> String? {
    val existing = playlist.items.associateBy { it.substringAfter(':') }
    return { key -> if (key in newKeys) "new:$key" else existing[key] }
  }

  @Test
  fun editsAroundThePlayingItemReuseLoadedItems() {
    val playlist = FakePlaylist(listOf("1", "2", "3", "4"), current = 1)
    QueueSync.apply(
      listOf(
        SyncStep.Edit(at = 2, removeCount = 1, insertKeys = listOf("9", "1")),
        SyncStep.Edit(at = 0, removeCount = 1, insertKeys = emptyList()),
      ),
      playlist,
      resolver(playlist, newKeys = listOf("9")),
    )
    assertEquals(listOf("old:2", "new:9", "old:1", "old:4"), playlist.items)
    assertEquals("2", playlist.currentKey)
  }

  @Test
  fun seeksOnlyWhenThePlayerIsElsewhere() {
    val playlist = FakePlaylist(listOf("1", "2", "3"), current = 2)
    QueueSync.apply(listOf(SyncStep.Seek("3")), playlist, resolver(playlist, emptyList()))
    QueueSync.apply(listOf(SyncStep.Seek("1")), playlist, resolver(playlist, emptyList()))
    assertEquals(listOf("seek 0"), playlist.ops)
    assertEquals("1", playlist.currentKey)
  }

  @Test
  fun replacesAndClears() {
    val playlist = FakePlaylist(listOf("1", "2"), current = 0)
    QueueSync.apply(
      listOf(SyncStep.Replace(listOf("2", "5"), index = 1)),
      playlist,
      resolver(playlist, newKeys = listOf("5")),
    )
    assertEquals(listOf("old:2", "new:5"), playlist.items)
    assertEquals("5", playlist.currentKey)
    QueueSync.apply(listOf(SyncStep.Clear), playlist, resolver(playlist, emptyList()))
    assertEquals(emptyList<String>(), playlist.items)
  }

  @Test
  fun rejectsStepsThatDoNotFitThePlayer() {
    val playlist = FakePlaylist(listOf("1", "2"), current = 0)
    val resolve = resolver(playlist, emptyList())
    assertThrows(IllegalArgumentException::class.java) {
      QueueSync.apply(listOf(SyncStep.Edit(1, 5, emptyList())), playlist, resolve)
    }
    assertThrows(IllegalArgumentException::class.java) {
      QueueSync.apply(listOf(SyncStep.Seek("7")), playlist, resolve)
    }
    assertThrows(IllegalArgumentException::class.java) {
      QueueSync.apply(listOf(SyncStep.Edit(2, 0, listOf("unknown"))), playlist, resolve)
    }
  }

  @Test
  fun readsStepsSentFromJs() {
    assertEquals(SyncStep.Clear, SyncStep.of("clear", 0, 0, emptyList(), 0, ""))
    assertEquals(
      SyncStep.Replace(listOf("1", "2"), 1),
      SyncStep.of("replace", 0, 0, listOf("1", "2"), 1, ""),
    )
    assertEquals(SyncStep.Seek("2"), SyncStep.of("seek", 0, 0, emptyList(), 0, "2"))
    assertEquals(SyncStep.Edit(3, 1, listOf("9")), SyncStep.of("edit", 3, 1, listOf("9"), 0, ""))
    assertThrows(IllegalArgumentException::class.java) {
      SyncStep.of("shuffle", 0, 0, emptyList(), 0, "")
    }
  }
}
