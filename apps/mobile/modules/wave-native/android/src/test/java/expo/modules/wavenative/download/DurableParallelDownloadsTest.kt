package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.*
import org.junit.Test

/** Several songs download at once: three at a time, and a song that waits never holds up the rest. */
class DurableParallelDownloadsTest {
  @Test fun twelveQueuedSongsStartThreeAtATimeAndTheRestStartAsSlotsFreeUp() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    for (id in ids) owner.enqueue(song(id), null)
    owner.advance(NoTransfer, NoPublication)
    assertEquals(List(3) { "preparing" } + List(9) { "queued" }, phases(owner))
    owner.cancel("song-2", NoTransfer)
    owner.advance(NoTransfer, NoPublication)
    assertEquals(listOf("preparing", "cancelled", "preparing", "preparing") + List(8) { "queued" }, phases(owner))
  }

  @Test fun threeSongsTransferAtOnceAndTheFourthStartsOnceOneIsTagged() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    for (id in ids) owner.enqueue(song(id), null)
    owner.advance(NoTransfer, NoPublication)
    for (id in ids.take(3)) prepare(owner, id, File(folder, "$id.mp3"))
    val sending = CountDownLatch(3)
    val finish = CountDownLatch(1)
    val slow = object : DurableTransfer {
      override fun cancel(id: String) {}
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        source.parentFile.mkdirs(); source.writeText("audio of $id")
        sending.countDown(); finish.await(10, TimeUnit.SECONDS)
        return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
      }
    }
    val steps = generateSequence { owner.nextStep(slow, GoodPublication) }.toList()
    assertEquals(3, steps.size)
    val workers = steps.map { thread { it() } }
    try {
      assertTrue(sending.await(2, TimeUnit.SECONDS))
      assertEquals(List(3) { "transferring" } + List(9) { "queued" }, phases(owner))
    } finally { finish.countDown(); workers.forEach { it.join(5_000) } }
    assertEquals(List(3) { "sourceReady" } + List(9) { "queued" }, phases(owner))
    answer(owner, "song-1", "confirm", mapOf("acceptable" to true))
    owner.advance(NoTransfer, GoodPublication)
    assertEquals("awaitingPublication", phases(owner)[0])
    owner.advance(NoTransfer, NoPublication)
    assertEquals(listOf("awaitingPublication", "sourceReady", "sourceReady", "preparing") + List(8) { "queued" }, phases(owner))
  }

  @Test fun songsWaitingForJsDoNotHoldUpTheSongsBehindThem() = inFolder { folder ->
    var now = 1_000L
    val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
    for (id in ids) owner.enqueue(song(id), null)
    owner.advance(NoTransfer, NoPublication)
    // JS doesn't answer for the first three (a search that hangs): after a while they leave their slots.
    now += 31_000
    owner.advance(NoTransfer, NoPublication)
    assertEquals(List(6) { "preparing" } + List(6) { "queued" }, phases(owner))
    prepare(owner, "song-4", File(folder, "song-4.mp3"))
    owner.advance(GoodTransfer, NoPublication)
    assertEquals("sourceReady", phases(owner)[3])
    // However long they wait, no more than six songs are started at once.
    now += 31_000
    owner.advance(NoTransfer, NoPublication)
    assertEquals(List(3) { "preparing" } + listOf("sourceReady", "preparing", "preparing") + List(6) { "queued" }, phases(owner))
    // The first song's answer still counts once it comes.
    prepare(owner, "song-1", File(folder, "song-1.mp3"))
    owner.advance(GoodTransfer, NoPublication)
    assertEquals("sourceReady", phases(owner)[0])
  }

  @Test fun aSongInAPeersQueueDoesNotHoldUpTheNextOne() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"), slots = 1)
    owner.enqueue(song("song-1"), null); owner.enqueue(song("song-2"), null)
    owner.advance(NoTransfer, NoPublication)
    prepare(owner, "song-1", File(folder, "song-1.mp3"))
    val queued = CountDownLatch(1)
    val cancelled = CountDownLatch(1)
    val busyPeer = object : DurableTransfer {
      override fun cancel(id: String) { if (id == "song-1") cancelled.countDown() }
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        if (id != "song-1") return GoodTransfer.receive(id, candidate, source, durationMs, progress)
        progress(0, 0, 40); queued.countDown(); cancelled.await(10, TimeUnit.SECONDS)
        throw DurableFailure("cancelled")
      }
    }
    val worker = thread { owner.nextStep(busyPeer, NoPublication)!!() }
    try {
      assertTrue(queued.await(2, TimeUnit.SECONDS))
      owner.advance(busyPeer, NoPublication)
      prepare(owner, "song-2", File(folder, "song-2.mp3"))
      owner.advance(busyPeer, NoPublication)
      assertEquals(listOf("transferring", "sourceReady"), phases(owner))
    } finally { owner.cancelJob("song-1", busyPeer); worker.join(5_000) }
  }

  /**
   * Three songs of an album finish together and all want the same name. They join the Library one
   * at a time, each once: the next is only offered its publish decision once the one before is imported.
   */
  @Test fun songsFinishedTogetherJoinTheLibraryOneAtATimeEachOnce() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    val revision = owner.refreshPolicy(listOf(folder.path), emptyList())
    val target = File(folder, "Recording.mp3")
    val three = ids.take(3)
    for (id in three) owner.enqueue(song(id), null)
    owner.advance(NoTransfer, NoPublication)
    for (id in three) prepare(owner, id, target)
    repeat(3) { owner.advance(GoodTransfer, NoPublication) }
    for (id in three) answer(owner, id, "confirm", mapOf("acceptable" to true))
    repeat(3) { owner.advance(NoTransfer, GoodPublication) }
    assertEquals(List(3) { "awaitingPublication" }, phases(owner))
    val imported = mutableListOf<String>()
    while (imported.size < 3) {
      val offered = three.mapNotNull { id -> owner.claim(id)?.let { id to it } }
      assertEquals(1, offered.size)
      val (id, lease) = offered.single()
      assertEquals("publish", lease["decision"])
      assertTrue(owner.submit(id, lease["generation"] as Long, lease["token"] as String, "publish", mapOf("targetPath" to target.path, "revision" to revision)))
      assertTrue(three.filter { it != id }.all { owner.claim(it) == null })
      owner.advance(NoTransfer, GoodPublication)
      assertTrue(three.filter { it != id }.all { owner.claim(it) == null })
      val saved = owner.snapshot().single { it["id"] == id }["saved"] as Map<*, *>
      answer(owner, id, "import", mapOf("path" to saved["path"]))
      imported += saved["path"] as String
    }
    assertEquals(listOf("Recording (2).mp3", "Recording (3).mp3", "Recording.mp3"), imported.map { File(it).name }.sorted())
    assertEquals(listOf("Recording (2).mp3", "Recording (3).mp3", "Recording.mp3"), folder.listFiles()!!.filter { !it.name.startsWith(".") && it.extension == "mp3" }.map { it.name }.sorted())
    assertTrue(owner.snapshot().all { it["acknowledged"] == true })
  }

  @Test fun theNotificationCountsTheSongsDownloadingAndTheSongsLeft() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    for (id in ids) owner.enqueue(song(id), null)
    assertEquals(DownloadCounts(running = 0, left = 12), owner.counts())
    owner.advance(NoTransfer, NoPublication)
    assertEquals(DownloadCounts(running = 3, left = 9), owner.counts())
    owner.cancel("song-2", NoTransfer)
    owner.cancel("song-12", NoTransfer)
    assertEquals(DownloadCounts(running = 2, left = 8), owner.counts())
    owner.advance(NoTransfer, NoPublication)
    assertEquals(DownloadCounts(running = 3, left = 7), owner.counts())
  }

  @Test fun cancellingOneSongStopsOnlyItsTransferAndStoppingTheServiceStopsThemAll() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    for (id in ids.take(3)) owner.enqueue(song(id), null)
    owner.advance(NoTransfer, NoPublication)
    for (id in ids.take(3)) prepare(owner, id, File(folder, "$id.mp3"))
    val sending = CountDownLatch(3)
    val stops = java.util.concurrent.ConcurrentHashMap<String, CountDownLatch>()
    val cancelled = java.util.Collections.synchronizedList(mutableListOf<String>())
    val endless = object : DurableTransfer {
      override fun cancel(id: String) { cancelled += id; stops[id]?.countDown() }
      override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
        val stop = stops.getOrPut(id) { CountDownLatch(1) }
        source.parentFile.mkdirs(); source.writeText("partial"); sending.countDown()
        stop.await(10, TimeUnit.SECONDS); throw DurableFailure("cancelled")
      }
    }
    val workers = generateSequence { owner.nextStep(endless, NoPublication) }.toList().map { thread { it() } }
    try {
      assertTrue(sending.await(2, TimeUnit.SECONDS))
      owner.cancelJob("song-2", endless)
      assertEquals(listOf("song-2"), cancelled.toList())
      assertEquals(listOf("transferring", "cancelled", "transferring"), phases(owner))
      owner.stopWork(endless)
      assertEquals(setOf("song-1", "song-2", "song-3"), cancelled.toSet())
    } finally { stops.values.forEach { it.countDown() }; workers.forEach { it.join(5_000) } }
    // The service stopping isn't the peers' fault: the next start tries them again.
    assertEquals(listOf("prepared", "cancelled", "prepared"), phases(owner))
  }

  /** Tagging fetches the cover without the journal's lock, so a Cancel can come in the meantime. */
  @Test fun aSongCancelledWhileItIsTaggedLeavesNoFileBehind() = inFolder { folder ->
    val owner = DurableDownloads(File(folder, "jobs"))
    owner.enqueue(song("song-1"), null)
    owner.advance(NoTransfer, NoPublication)
    prepare(owner, "song-1", File(folder, "song-1.mp3"))
    owner.advance(GoodTransfer, NoPublication)
    answer(owner, "song-1", "confirm", mapOf("acceptable" to true))
    val tagging = CountDownLatch(1)
    val coverArrives = CountDownLatch(1)
    val slowCover = object : DurablePublication {
      override fun tag(source: File, tags: Map<String, Any?>) { tagging.countDown(); coverArrives.await(10, TimeUnit.SECONDS); source.writeText("tagged audio") }
      override fun index(file: File): Map<String, Any?> = error("No publication expected")
    }
    val worker = thread { owner.advance(NoTransfer, slowCover) }
    try {
      assertTrue(tagging.await(2, TimeUnit.SECONDS))
      owner.cancelJob("song-1", NoTransfer)
    } finally { coverArrives.countDown(); worker.join(5_000) }
    assertEquals(listOf("cancelled"), phases(owner))
    assertEquals(emptyList<String>(), folder.listFiles()!!.filter { it.name != "jobs" && !it.name.startsWith("jobs.") }.map { it.name })
  }

  private fun prepare(owner: DurableDownloads, id: String, target: File) =
    answer(owner, id, "prepare", mapOf("candidates" to listOf(candidate), "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
  private fun answer(owner: DurableDownloads, id: String, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim(id)!!
    assertTrue(owner.submit(id, lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
  private val candidate = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private val GoodTransfer = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      source.parentFile.mkdirs(); source.writeText("audio of $id")
      return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
    }
  }
  private val GoodPublication = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) { source.appendText(" trusted tags") }
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private val ids = (1..12).map { "song-$it" }
  private fun song(id: String) = mapOf("videoId" to id, "title" to id, "durationMs" to 12_000L)
  private fun phases(owner: DurableDownloads) = owner.snapshot().map { it["phase"] }
  private fun inFolder(test: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-parallel").toFile()
    try { test(folder) } finally { folder.deleteRecursively() }
  }

  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object NoPublication : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) = error("No tag expected")
    override fun index(file: File): Map<String, Any?> = error("No publication expected")
  }
}
