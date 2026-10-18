package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/** Each job remembers the playlist, album or mix whose Download asked for it (its `origin`). */
class DurableDownloadOriginsTest {
  @Test fun aJobKeepsWhereItWasAskedFromAcrossRecreation() {
    val folder = Files.createTempDirectory("wave-origin").toFile()
    try {
      val journal = File(folder, "jobs")
      val owner = DurableDownloads(journal)
      owner.enqueue(song, null, origin = roadTrip)
      owner.enqueue(song + ("videoId" to "own"), null)
      val restored = DurableDownloads(journal)
      assertEquals(listOf(roadTrip, null), restored.snapshot().map { it["origin"] })
    } finally { folder.deleteRecursively() }
  }

  @Test fun aSongAnotherSourceAsksForTooKeepsTheFirstSource() {
    val folder = Files.createTempDirectory("wave-origin-shared").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, origin = roadTrip)
      owner.enqueue(song, null, origin = focus)
      // Another result positively matched to the same recording shares the job.
      owner.enqueue(song + ("videoId" to "other"), "song", origin = focus)
      owner.enqueue(song, null)
      assertEquals(roadTrip, owner.snapshot().single()["origin"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun aRetryTakesTheSourceThatAsksAgainOrKeepsItsOwn() {
    val folder = Files.createTempDirectory("wave-origin-retry").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      fun failIt() {
        owner.advance(NoTransfer, NoPublication)
        val lease = owner.claim("song")!!
        owner.submit("song", lease["generation"] as Long, lease["token"] as String, "prepare", mapOf("failure" to "unavailable"))
        assertEquals("failed", owner.snapshot().single()["phase"])
      }
      owner.enqueue(song, null, origin = roadTrip)
      failIt()
      // Settings › Downloads' Retry asks with no source: it stays in its playlist's group.
      owner.enqueue(song, null)
      assertEquals(roadTrip, owner.snapshot().single()["origin"])
      failIt()
      // Another playlist's Retry Failed asks for it now.
      owner.enqueue(song, null, origin = focus)
      assertEquals(focus, owner.snapshot().single()["origin"])
    } finally { folder.deleteRecursively() }
  }

  /** JS follows the journal by its changes (`jobsChangedSince`): each changed job comes with its origin. */
  @Test fun readersFollowingChangesGetEachJobsOrigin() {
    val folder = Files.createTempDirectory("wave-origin-changes").toFile()
    try {
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, origin = roadTrip)
      owner.enqueue(song + ("videoId" to "own"), null)
      val first = owner.changesSince(0)
      assertEquals(listOf(roadTrip, null), first.jobs.map { it["origin"] })
      owner.cancel("song", NoTransfer)
      val cancelled = owner.changesSince(first.revision)
      assertEquals(listOf(roadTrip), cancelled.jobs.map { it["origin"] })
      // Another playlist's Retry Failed: the job comes again with its new origin, at the queue's end.
      owner.enqueue(song, null, origin = focus)
      val retried = owner.changesSince(cancelled.revision)
      assertEquals(listOf(focus), retried.jobs.map { it["origin"] })
      assertEquals(listOf("own", "song"), retried.ids)
    } finally { folder.deleteRecursively() }
  }

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val roadTrip = mapOf("kind" to "playlist", "id" to "7", "name" to "Road Trip")
  private val focus = mapOf("kind" to "playlist", "id" to "9", "name" to "Focus")

  private object NoTransfer : DurableTransfer {
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> = error("No transfer expected")
    override fun cancel(id: String) {}
  }
  private object NoPublication : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) = error("No tag expected")
    override fun index(file: File): Map<String, Any?> = error("No publication expected")
  }
}
