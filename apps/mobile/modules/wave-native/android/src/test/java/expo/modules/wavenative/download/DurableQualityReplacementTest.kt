package expo.modules.wavenative.download

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

/**
 * A quality replacement's publication: the new file takes the old one's very path when the
 * publish answer says it replaces it (Core's `qualityReplacementTarget`), instead of a "(2)" copy
 * beside it. The old file is overwritten only once the new one is downloaded, validated and tagged.
 */
class DurableQualityReplacementTest {
  @Test fun aReplacementTakesTheOldFilesVeryPath() {
    val folder = Files.createTempDirectory("wave-replace").toFile()
    try {
      val target = File(folder, "Recording.mp3").apply { writeText("old 128k audio") }
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      publish(owner, target, replaces = target.path)
      assertEquals("complete validated audio trusted tags", target.readText())
      assertEquals(listOf("Recording.mp3"), audioFiles(folder))
      val job = owner.snapshot().single()
      assertEquals("completed", job["phase"])
      assertEquals(target.path, (job["saved"] as Map<*, *>)["path"])
    } finally { folder.deleteRecursively() }
  }

  @Test fun theOldFileStaysUntilTheNewOneIsPublished() {
    val folder = Files.createTempDirectory("wave-replace-late").toFile()
    try {
      val target = File(folder, "Recording.mp3").apply { writeText("old 128k audio") }
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      prepare(owner, target)
      owner.advance(GoodTransfer, GoodPublication)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(GoodTransfer, GoodPublication)
      // Downloaded, validated and tagged, but not published: the old file is untouched.
      assertEquals("old 128k audio", target.readText())
    } finally { folder.deleteRecursively() }
  }

  @Test fun aReplacementOfAnotherFileNeverOverwritesTheTarget() {
    val folder = Files.createTempDirectory("wave-replace-other").toFile()
    try {
      val target = File(folder, "Recording.mp3").apply { writeText("someone else's file") }
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      publish(owner, target, replaces = File(folder, "Recording.m4a").path)
      assertEquals("someone else's file", target.readText())
      assertEquals(listOf("Recording (2).mp3", "Recording.mp3"), audioFiles(folder))
    } finally { folder.deleteRecursively() }
  }

  @Test fun aDownloadThatReplacesNothingStillGetsAFreeName() {
    val folder = Files.createTempDirectory("wave-replace-none").toFile()
    try {
      val target = File(folder, "Recording.mp3").apply { writeText("old 128k audio") }
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null)
      publish(owner, target, replaces = null)
      assertEquals("old 128k audio", target.readText())
      assertEquals(listOf("Recording (2).mp3", "Recording.mp3"), audioFiles(folder))
    } finally { folder.deleteRecursively() }
  }

  private fun audioFiles(folder: File) =
    folder.listFiles()!!.filter { it.extension == "mp3" && !it.name.startsWith(".") }.map { it.name }.sorted()

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val candidate = mapOf("username" to "peer", "filename" to "Recording.mp3", "bitrateKbps" to 320)
  private val GoodTransfer = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      source.parentFile.mkdirs(); source.writeText("complete validated audio")
      return mapOf("durationMs" to 12_000L, "receivedTags" to emptyMap<String, Any?>())
    }
  }
  private val GoodPublication = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) { source.appendText(" trusted tags") }
    override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
  }
  private fun prepare(owner: DurableDownloads, target: File) {
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "prepare", mapOf("candidates" to listOf(candidate), "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.soulseek(ytMusicOn = false)))
  }
  private fun publish(owner: DurableDownloads, target: File, replaces: String?) {
    prepare(owner, target)
    owner.advance(GoodTransfer, GoodPublication)
    answer(owner, "confirm", mapOf("acceptable" to true))
    owner.advance(GoodTransfer, GoodPublication)
    val revision = owner.refreshPolicy(listOf(target.parentFile.path), emptyList())
    answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to revision, "replaces" to replaces))
    owner.advance(GoodTransfer, GoodPublication)
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("song")!!
    assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
}
