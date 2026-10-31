package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueSyncTest {
  @Test
  fun `covers on several songs are one replacement, the songs between them kept`() {
    val batch = QueueSync.artworkBatch(
      listOf("a", "b", "c", "d", "e"),
      { it },
      mapOf("b" to "1.jpg", "d" to "2.jpg", "gone" to "3.jpg"),
    ) { item, artwork -> "$item+$artwork" }
    assertEquals(ItemBatch(1, 4, listOf("b+1.jpg", "c", "d+2.jpg")), batch)
  }

  @Test
  fun `covers for songs the player doesn't hold change nothing`() {
    val batch = QueueSync.artworkBatch(listOf("a"), { it }, mapOf("gone" to "1.jpg")) { item, _ -> item }
    assertEquals(null, batch)
  }

  /**
   * A player list holding item names ("old:1", "new:4"), recording what was
   * done to it and how many loaded items were read.
   */
  private class FakePlaylist(initial: List<String>, var current: Int) : PlaylistEditor<String> {
    val items = initial.map { "old:$it" }.toMutableList()
    val ops = mutableListOf<String>()
    var keyReads = 0
    var itemReads = 0

    val keys: List<String> get() = items.map { it.substringAfter(':') }

    override val size: Int get() = items.size
    override val currentKey: String? get() = items.getOrNull(current)?.substringAfter(':')

    override fun keyAt(index: Int): String {
      keyReads += 1
      return items[index].substringAfter(':')
    }

    override fun itemAt(index: Int): String {
      itemReads += 1
      return items[index]
    }

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

  private fun incoming(vararg keys: String): Map<String, String> = keys.associateWith { "new:$it" }

  private fun longPlaylist(size: Int, current: Int) =
    FakePlaylist((1..size).map(Int::toString), current)

  @Test
  fun editsAroundThePlayingItemReuseLoadedItems() {
    val playlist = FakePlaylist(listOf("1", "2", "3", "4"), current = 1)
    QueueSync.apply(
      listOf(
        SyncStep.Edit(at = 2, removeCount = 1, insertKeys = listOf("9", "1")),
        SyncStep.Edit(at = 0, removeCount = 1, insertKeys = emptyList()),
      ),
      playlist,
      incoming("9"),
    )
    assertEquals(listOf("old:2", "new:9", "old:1", "old:4"), playlist.items)
    assertEquals("2", playlist.currentKey)
  }

  @Test
  fun seeksOnlyWhenThePlayerIsElsewhere() {
    val playlist = FakePlaylist(listOf("1", "2", "3"), current = 2)
    QueueSync.apply(listOf(SyncStep.Seek("3", 2)), playlist, incoming())
    QueueSync.apply(listOf(SyncStep.Seek("1", 0)), playlist, incoming())
    assertEquals(listOf("seek 0"), playlist.ops)
    assertEquals("1", playlist.currentKey)
  }

  @Test
  fun seeksStraightToTheLoadedItemInALongList() {
    val playlist = longPlaylist(5000, current = 4000)
    QueueSync.apply(listOf(SyncStep.Seek("4002", 4001)), playlist, incoming())
    assertEquals(listOf("seek 4001"), playlist.ops)
    assertEquals(1, playlist.keyReads)
    assertEquals(0, playlist.itemReads)
  }

  @Test
  fun findsTheItemWhenTheListChangedSinceJsLookedAtIt() {
    // Something else (Android Auto, the notification) moved items: the index JS saw is stale.
    val playlist = FakePlaylist(listOf("1", "2", "3", "4", "5"), current = 0)
    QueueSync.apply(listOf(SyncStep.Seek("4", 1)), playlist, incoming())
    QueueSync.apply(listOf(SyncStep.Seek("2", 99)), playlist, incoming())
    QueueSync.apply(listOf(SyncStep.Seek("5", -1)), playlist, incoming())
    assertEquals(listOf("seek 3", "seek 1", "seek 4"), playlist.ops)
    assertEquals("5", playlist.currentKey)
  }

  @Test
  fun insertingNewItemsReadsNoLoadedOnes() {
    val playlist = longPlaylist(5000, current = 2500)
    QueueSync.apply(listOf(SyncStep.Edit(2501, 0, listOf("new"))), playlist, incoming("new"))
    assertEquals(listOf("insert 2501 1"), playlist.ops)
    assertEquals("new:new", playlist.items[2501])
    assertEquals(0, playlist.keyReads)
    assertEquals(0, playlist.itemReads)
  }

  @Test
  fun removingItemsReadsNoLoadedOnes() {
    val playlist = longPlaylist(5000, current = 2500)
    QueueSync.apply(listOf(SyncStep.Edit(2501, 2, emptyList())), playlist, incoming())
    assertEquals(listOf("remove 2501 2503"), playlist.ops)
    assertEquals(4998, playlist.items.size)
    assertEquals(0, playlist.keyReads + playlist.itemReads)
  }

  @Test
  fun readsTheLoadedItemsAStepReusesOnlyOnceAndBeforeEditing() {
    val playlist = longPlaylist(1000, current = 0)
    // Moving 500 to the end: the edit removes it before inserting it again.
    QueueSync.apply(
      listOf(
        SyncStep.Edit(at = 499, removeCount = 1, insertKeys = emptyList()),
        SyncStep.Edit(at = 999, removeCount = 0, insertKeys = listOf("500", "new")),
      ),
      playlist,
      incoming("new"),
    )
    assertEquals(listOf("old:1000", "old:500", "new:new"), playlist.items.takeLast(3))
    assertEquals(1, playlist.itemReads)
    assertTrue(playlist.keyReads <= 1000)
  }

  @Test
  fun replacesAndClears() {
    val playlist = FakePlaylist(listOf("1", "2"), current = 0)
    QueueSync.apply(listOf(SyncStep.Replace(listOf("2", "5"), index = 1)), playlist, incoming("5"))
    assertEquals(listOf("old:2", "new:5"), playlist.items)
    assertEquals("5", playlist.currentKey)
    QueueSync.apply(listOf(SyncStep.Clear), playlist, incoming())
    assertEquals(emptyList<String>(), playlist.items)
  }

  @Test
  fun rejectsStepsThatDoNotFitThePlayer() {
    val playlist = FakePlaylist(listOf("1", "2"), current = 0)
    assertThrows(IllegalArgumentException::class.java) {
      QueueSync.apply(listOf(SyncStep.Edit(1, 5, emptyList())), playlist, incoming())
    }
    assertThrows(IllegalArgumentException::class.java) {
      QueueSync.apply(listOf(SyncStep.Seek("7", 1)), playlist, incoming())
    }
    assertThrows(IllegalArgumentException::class.java) {
      QueueSync.apply(listOf(SyncStep.Edit(2, 0, listOf("unknown"))), playlist, incoming())
    }
    assertEquals(emptyList<String>(), playlist.ops)
  }

  @Test
  fun readsStepsSentFromJs() {
    assertEquals(SyncStep.Clear, SyncStep.of("clear", 0, 0, emptyList(), 0, ""))
    assertEquals(
      SyncStep.Replace(listOf("1", "2"), 1),
      SyncStep.of("replace", 0, 0, listOf("1", "2"), 1, ""),
    )
    assertEquals(SyncStep.Seek("2", 1), SyncStep.of("seek", 0, 0, emptyList(), 1, "2"))
    assertEquals(SyncStep.Edit(3, 1, listOf("9")), SyncStep.of("edit", 3, 1, listOf("9"), 0, ""))
    assertThrows(IllegalArgumentException::class.java) {
      SyncStep.of("shuffle", 0, 0, emptyList(), 0, "")
    }
  }
}
