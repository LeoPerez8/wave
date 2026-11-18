package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A published file's digest is taken while the file is written (#455): by the tag writer as it
 * writes the file, or by the copy to another folder. The journal doesn't read the file again just
 * to compute it.
 */
class DurablePublicationDigestTest {
  @Test fun aTaggedFileIsPublishedWithTheDigestItsTagWriterTookWhileWritingIt() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      val target = File(folder, "Recording.mp3")
      // What the tag writer says it wrote: the journal takes its word rather than reading the file.
      publish(owner, target, tagging(digest = "computed-while-tagging"))
      val job = owner.snapshot().single()
      assertEquals("completed", job["phase"])
      assertEquals("computed-while-tagging", job["digest"])
      assertEquals("complete audio trusted tags", target.readText())
    }
  }

  @Test fun aTagWriterThatCouldNotSeeEveryByteLeavesTheDigestToTheJournal() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      val target = File(folder, "Recording.mp3")
      publish(owner, target, tagging(digest = null))
      val job = owner.snapshot().single()
      assertEquals("completed", job["phase"])
      assertEquals(sha256("complete audio trusted tags"), job["digest"])
    }
  }

  @Test fun aFileCopiedToAnotherFolderIsPublishedWithTheCopysDigest() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null)
      // The Library's folders changed after the download started: its file is copied over.
      val downloadedTo = File(folder, "old root/Recording.mp3")
      val target = File(folder, "new root/Recording.mp3")
      publish(owner, target, tagging(digest = "the part file's, not the copy's"), downloadedTo = downloadedTo)
      val job = owner.snapshot().single()
      assertEquals("completed", job["phase"])
      assertEquals(sha256("complete audio trusted tags"), job["digest"])
      assertEquals("complete audio trusted tags", target.readText())
    }
  }

  private var now = 1_000L

  private fun withFolder(test: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-digest").toFile()
    try { test(folder) } finally { folder.deleteRecursively() }
  }

  private fun sha256(text: String) =
    MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

  private val song = mapOf("videoId" to "abc", "title" to "Recording", "durationMs" to 12_000L)
  private val candidate = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private val transfer = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      source.parentFile.mkdirs(); source.writeText("complete audio")
      return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
    }
  }

  /** Tags the file and reports [digest] as what it wrote (null: it didn't see every byte). */
  private fun tagging(digest: String?) = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>): String? { source.appendText(" trusted tags"); return digest }
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }

  /** Drives job `abc` to its import, downloaded beside [downloadedTo] and published to [target]. */
  private fun publish(owner: DurableDownloads, target: File, publication: DurablePublication, downloadedTo: File = target) {
    owner.advance(transfer, publication)
    answer(owner, "prepare", mapOf("candidates" to listOf(candidate), "targetPath" to downloadedTo.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
    owner.advance(transfer, publication)
    answer(owner, "confirm", mapOf("acceptable" to true))
    owner.advance(transfer, publication)
    val revision = owner.refreshPolicy(listOf(target.parentFile.path), emptyList())
    answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to revision))
    owner.advance(transfer, publication)
    assertTrue(target.isFile)
  }

  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("abc")!!
    assertTrue(owner.submit("abc", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
}
