package expo.modules.wavenative.download

import expo.modules.wavenative.Fixtures
import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.DownloadTagWriter
import expo.modules.wavenative.tags.DownloadTags
import expo.modules.wavenative.tags.JAudioTaggerReader
import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.jaudiotagger.audio.exceptions.CannotWriteException
import org.junit.Assert.*
import org.junit.Test

/**
 * What a download that fails while it's saved ends as (#237). A failure keeps its underlying
 * cause (`cause`: exception class and message) in the journal and the log, and only a real
 * storage problem (full storage, an unwritable folder) is `storage`.
 */
class DurableDownloadFailuresTest {
  /** "Swallow the Bomb" came from YouTube as a fragmented M4A, which failed at Saving to the Library. */
  @Test fun theFragmentedM4aYoutubeServesIsTaggedAndJoinsTheLibrary() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val target = File(folder, "Royal Blood/Swallow The Bomb/01 Swallow The Bomb.m4a")
      val served = transfer { source -> source.parentFile.mkdirs(); Fixtures.file("fragmented-aac.m4a").copyTo(source, overwrite = true) }
      val tagging = object : DurablePublication {
        override fun tag(source: File, tags: Map<String, Any?>) = DownloadTagWriter().write(source, DownloadTags.fromJs(tags)!!, null)
        override fun index(file: File): Map<String, Any?> = mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
      }
      owner.enqueue(song, null, emptyMap(), "youtube")
      owner.advance(served, tagging)
      answer(owner, "prepare", mapOf(
        "source" to "youtube", "targetPath" to target.path, "failurePlan" to CorePlans.youtube,
        "tags" to mapOf("title" to "Swallow The Bomb", "artist" to "Royal Blood", "album" to "Swallow The Bomb", "albumArtist" to "Royal Blood", "trackNumber" to 1),
      ))
      owner.advance(served, tagging)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(served, tagging)
      answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList())))
      owner.advance(served, tagging)

      val job = owner.snapshot().single()
      assertEquals("completed", job["phase"])
      assertEquals(target.path, (job["saved"] as Map<*, *>)["path"])
      val read = AudioTagReader(primary = JAudioTaggerReader()).read(target)
      assertEquals("Swallow The Bomb", read.title)
      assertEquals("Royal Blood", read.artist)
      assertEquals("1", read.trackNumber)
    }
  }

  @Test fun aTagWriterThatThrowsFailsTheDownloadWithItsCauseInTheJournalAndTheLog() {
    withFolder { folder ->
      val log = mutableListOf<String>()
      val owner = DurableDownloads(File(folder, "jobs"), log = { log += it })
      val cannotWrite = publication(tag = { throw CannotWriteException("Unable to make changes to Mp4 file, incorrect offsets written difference was -208") })
      owner.enqueue(song, null, emptyMap(), "youtube")
      upToTagging(owner, File(folder, "Recording.m4a"), cannotWrite)
      owner.advance(Served, cannotWrite)

      val job = owner.snapshot().single()
      assertEquals("failed", job["phase"])
      assertEquals("failed", job["reason"])
      val cause = "org.jaudiotagger.audio.exceptions.CannotWriteException: Unable to make changes to Mp4 file, incorrect offsets written difference was -208"
      assertEquals(cause, job["cause"])
      assertTrue(log.joinToString("\n"), log.any { it.contains(cause) && it.contains("tagging") })
      // The journal keeps it across a restart, so the next start can still show it.
      owner.flush()
      assertEquals(cause, DurableDownloads(File(folder, "jobs")).snapshot().single()["cause"])
    }
  }

  @Test fun fullStorageWhileSavingIsAStorageFailure() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val full = publication(tag = { throw IOException("write failed: ENOSPC (No space left on device)") })
      owner.enqueue(song, null, emptyMap(), "youtube")
      upToTagging(owner, File(folder, "Recording.m4a"), full)
      owner.advance(Served, full)

      val job = owner.snapshot().single()
      assertEquals("storage", job["reason"])
      assertEquals("java.io.IOException: write failed: ENOSPC (No space left on device)", job["cause"])
    }
  }

  @Test fun aFolderThatCantBeMadeIsAStorageFailureThatSaysWhichFolder() {
    withFolder { folder ->
      File(folder, "Revoked").writeText("a file where the album folder should go")
      val owner = DurableDownloads(File(folder, "jobs"))
      val revision = owner.refreshPolicy(listOf(folder.path), emptyList())
      owner.enqueue(song, null, emptyMap(), "youtube")
      upToTagging(owner, File(folder, "Recording.m4a"), Untouched)
      owner.advance(Served, Untouched)
      val target = File(folder, "Revoked/Album/Recording.m4a")
      answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to revision))
      owner.advance(Served, Untouched)

      val job = owner.snapshot().single()
      assertEquals("storage", job["reason"])
      assertTrue(job["cause"] as String, (job["cause"] as String).contains(target.parentFile.path))
    }
  }

  @Test fun aPublishedFileTheScannerCantReadFailsWithItsCauseNotAsStorage() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val target = File(folder, "Recording.m4a")
      val unreadable = publication(index = { throw IllegalStateException("No audio header") })
      owner.enqueue(song, null, emptyMap(), "youtube")
      upToPublication(owner, folder, target, unreadable)
      repeat(4) { owner.advance(Served, unreadable) }

      val job = owner.snapshot().single()
      assertEquals("failed", job["phase"])
      assertEquals("failed", job["reason"])
      assertEquals("java.lang.IllegalStateException: No audio header", job["cause"])
      assertTrue(target.isFile)
    }
  }

  /**
   * The file a download was published to was replaced by another before the Library imported
   * it. Retry downloads the song again and saves it under a free name; the other file is never
   * touched, and the download never ends as "couldn't save the file".
   */
  @Test fun aPublicationPathHeldByAnotherFileIsSavedUnderAFreeNameOnRetry() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      val target = File(folder, "Recording.m4a")
      var scannerFails = true
      val scanner = publication(index = { file ->
        if (scannerFails) throw IOException("Scanner interrupted")
        mapOf("path" to file.path, "track" to mapOf("path" to file.path), "artwork" to null)
      })
      owner.enqueue(song, null, emptyMap(), "youtube")
      upToPublication(owner, folder, target, scanner)
      repeat(4) { owner.advance(Served, scanner) }
      assertEquals("failed", owner.snapshot().single()["phase"])
      target.writeText("another song the owner put there")
      scannerFails = false

      owner.enqueue(song, null, emptyMap(), "youtube")
      prepareYoutube(owner, target, scanner)
      owner.advance(Served, scanner)
      answer(owner, "confirm", mapOf("acceptable" to true))
      owner.advance(Served, scanner)
      answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList())))
      owner.advance(Served, scanner)

      val job = owner.snapshot().single()
      assertEquals("completed", job["phase"])
      val saved = File(folder, "Recording (2).m4a")
      assertEquals(saved.path, (job["saved"] as Map<*, *>)["path"])
      assertArrayEquals(SERVED, saved.readBytes())
      assertEquals("another song the owner put there", target.readText())
      assertNull(job["cause"])
    }
  }

  @Test fun anImportFailureKeepsTheReasonAndCauseJsReports() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "youtube")
      upToPublication(owner, folder, File(folder, "Recording.m4a"), Untouched)
      owner.advance(Served, Untouched)
      repeat(DurableDownloads.MAX_DECISIONS.toInt()) {
        answer(owner, "import", mapOf("failure" to "failed", "cause" to "Error: A credit names no artist"))
        now += 2_000
      }
      val job = owner.snapshot().single()
      assertEquals("failed", job["importFailure"])
      assertEquals("Error: A credit names no artist", job["cause"])
    }
  }

  @Test fun anImportNobodyAnswersIsAFailedImportThatSaysSoNotAStorageOne() {
    withFolder { folder ->
      var now = 1_000L
      val owner = DurableDownloads(File(folder, "jobs"), clock = { now })
      owner.enqueue(song, null, emptyMap(), "youtube")
      upToPublication(owner, folder, File(folder, "Recording.m4a"), Untouched)
      owner.advance(Served, Untouched)
      repeat(DurableDownloads.MAX_DECISIONS.toInt()) {
        assertNotNull(owner.claim("song"))
        now += DurableDownloads.LEASE_MS + 1
        owner.expire(Served)
      }
      val job = owner.snapshot().single()
      assertEquals("failed", job["importFailure"])
      assertTrue(job["cause"] as String, (job["cause"] as String).contains("import"))
    }
  }

  @Test fun aPrepareFailureKeepsTheCauseJsReportsAndRetryForgetsIt() {
    withFolder { folder ->
      val owner = DurableDownloads(File(folder, "jobs"))
      owner.enqueue(song, null, emptyMap(), "youtube")
      owner.advance(Served, Untouched)
      answer(owner, "prepare", mapOf("failure" to "failed", "cause" to "TypeError: undefined is not an object", "failurePlan" to CorePlans.youtube))
      val job = owner.snapshot().single()
      assertEquals("failed", job["reason"])
      assertEquals("TypeError: undefined is not an object", job["cause"])

      owner.enqueue(song, null, emptyMap(), "youtube")
      assertNull(owner.snapshot().single()["cause"])
    }
  }

  private val song = mapOf("videoId" to "song", "title" to "Recording", "durationMs" to 12_000L)
  private val SERVED = ByteArray(70_000) { (it * 31 % 251).toByte() }

  private fun withFolder(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-failures").toFile()
    try { block(folder) } finally { folder.deleteRecursively() }
  }
  private fun transfer(write: (File) -> Unit) = object : DurableTransfer {
    override fun cancel(id: String) {}
    override fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?> {
      write(source)
      return mapOf("partPath" to source.path, "bytes" to source.length(), "mimeType" to "audio/mp4", "durationMs" to 12_000L)
    }
  }
  private val Served = transfer { source -> source.parentFile.mkdirs(); source.writeBytes(SERVED) }
  private fun publication(
    tag: (File) -> Unit = {},
    index: (File) -> Map<String, Any?> = { mapOf("path" to it.path, "track" to mapOf("path" to it.path), "artwork" to null) },
  ) = object : DurablePublication {
    override fun tag(source: File, tags: Map<String, Any?>) = tag(source)
    override fun index(file: File): Map<String, Any?> = index(file)
  }
  private val Untouched = publication()

  private fun prepareYoutube(owner: DurableDownloads, target: File, publication: DurablePublication) {
    owner.advance(Served, publication)
    answer(owner, "prepare", mapOf("source" to "youtube", "targetPath" to target.path, "tags" to emptyMap<String, Any?>(), "failurePlan" to CorePlans.youtube))
  }
  /** Up to the audio being accepted, with tagging next. */
  private fun upToTagging(owner: DurableDownloads, target: File, publication: DurablePublication) {
    prepareYoutube(owner, target, publication)
    owner.advance(Served, publication)
    answer(owner, "confirm", mapOf("acceptable" to true))
  }
  /** Up to publishing to [target], next. */
  private fun upToPublication(owner: DurableDownloads, folder: File, target: File, publication: DurablePublication) {
    upToTagging(owner, target, publication)
    owner.advance(Served, publication)
    answer(owner, "publish", mapOf("targetPath" to target.path, "revision" to owner.refreshPolicy(listOf(folder.path), emptyList())))
  }
  private fun answer(owner: DurableDownloads, decision: String, payload: Map<String, Any?>) {
    val lease = owner.claim("song")!!
    assertTrue(owner.submit("song", lease["generation"] as Long, lease["token"] as String, decision, payload + if (decision == "confirm") mapOf("receiptId" to lease["receiptId"]) else emptyMap()))
  }
}
