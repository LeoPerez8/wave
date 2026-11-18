package expo.modules.wavenative.yt

import expo.modules.wavenative.download.RangeDownload
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class YtAudioDownloadTest {
  @Test fun theM4aYoutubeServesIsSavedByteForByteWithItsProgress() {
    withPart { part ->
      val youtube = FakeYoutube(stream("a", AUDIO.size.toLong()) to AUDIO)
      val progress = mutableListOf<Pair<Long, Long>>()
      val file = download(youtube).download("song", part, onProgress = { received, total -> progress += received to total })
      assertArrayEquals(AUDIO, part.readBytes())
      assertEquals(YtAudioFile(itag = 140, bitrate = 128_000, mimeType = M4A, bytes = AUDIO.size.toLong()), file)
      assertEquals(AUDIO.size.toLong() to AUDIO.size.toLong(), progress.last())
    }
  }

  @Test fun theFileSaysWhichVideoClientTypeAndLengthYoutubeAnsweredWith() {
    withPart { part ->
      val answered = YtStreamSource(videoId = "uumR0WQrJjw", client = "WEB_REMIX", videoType = "MUSIC_VIDEO_TYPE_ATV", lengthMs = 253_000)
      val youtube = FakeYoutube(stream("a", AUDIO.size.toLong()).copy(source = answered) to AUDIO)
      val file = download(youtube).download("uumR0WQrJjw", part)
      assertEquals(answered, file.source)
    }
  }

  @Test fun theLengthComesFromTheStreamItsAddressOrAHeadRequest() {
    withPart { part ->
      val clen = FakeYoutube(stream("a?clen=${AUDIO.size}", null) to AUDIO)
      download(clen).download("song", part)
      assertArrayEquals(AUDIO, part.readBytes())
      val head = FakeYoutube(stream("b", null) to AUDIO)
      download(head).download("song", part)
      assertArrayEquals(AUDIO, part.readBytes())
    }
  }

  @Test fun withoutAnyLengthNothingIsSaved() {
    withPart { part ->
      val youtube = FakeYoutube(stream("a", null) to AUDIO).apply { headAnswers = false }
      assertThrows(IOException::class.java) { download(youtube).download("song", part) }
      assertFalse(part.exists())
    }
  }

  @Test fun anExpiredAddressIsResolvedAgainAndTheDownloadGoesOnFromWhereItWas() {
    withPart { part ->
      val youtube = FakeYoutube(stream("a", AUDIO.size.toLong()) to AUDIO, stream("b", AUDIO.size.toLong()) to AUDIO)
      youtube.expiresFrom["a"] = 2 * CHUNK
      download(youtube).download("song", part)
      assertArrayEquals(AUDIO, part.readBytes())
      assertEquals(listOf("song"), youtube.rejected)
      assertEquals(2, youtube.resolved)
      // Only the bytes that hadn't arrived are asked for again.
      assertEquals(2 * CHUNK, youtube.asked.first { it.first == "b" }.second)
    }
  }

  @Test fun aFreshAddressServingAnotherStreamStartsTheFileOver() {
    withPart { part ->
      val premium = ByteArray(AUDIO.size * 2) { (it % 7).toByte() }
      val youtube = FakeYoutube(
        stream("a", AUDIO.size.toLong()) to AUDIO,
        stream("b", premium.size.toLong(), itag = 141, bitrate = 256_000) to premium,
      )
      youtube.expiresFrom["a"] = CHUNK
      val file = download(youtube).download("song", part)
      assertArrayEquals(premium, part.readBytes())
      assertEquals(141, file.itag)
      assertEquals(premium.size.toLong(), file.bytes)
    }
  }

  @Test fun aFreshAddressServingAnotherStreamOfUnknownLengthIsNeverAppendedToTheFirst() {
    withPart { part ->
      val other = ByteArray(AUDIO.size) { (it % 5).toByte() }
      val youtube = FakeYoutube(
        stream("a", AUDIO.size.toLong(), itag = 141, bitrate = 256_000) to AUDIO,
        stream("b", null) to other,
      ).apply { headAnswers = false }
      youtube.expiresFrom["a"] = CHUNK
      val saved = runCatching { download(youtube).download("song", part) }
      if (saved.isSuccess) {
        // Whatever was saved is one stream's file, whole.
        assertTrue(part.readBytes().contentEquals(AUDIO) || part.readBytes().contentEquals(other))
      } else {
        assertTrue(saved.exceptionOrNull() is IOException)
        // What's kept for the next attempt is only the first stream's.
        assertArrayEquals(AUDIO.copyOfRange(0, part.length().toInt()), part.readBytes())
      }
      assertFalse(youtube.asked.any { it.first == "b" && it.second > 0 })
    }
  }

  @Test fun anAddressRefusedAgainAndAgainFailsKeepingWhatArrivedForTheNextAttempt() {
    withPart { part ->
      val youtube = FakeYoutube(stream("a", AUDIO.size.toLong()) to AUDIO)
      youtube.expiresFrom["a"] = CHUNK
      assertThrows(IOException::class.java) { download(youtube).download("song", part) }
      assertArrayEquals(AUDIO.copyOfRange(0, CHUNK.toInt()), part.readBytes())
      assertTrue(youtube.resolved <= 1 + YtAudioDownload.MAX_REFRESHES)
    }
  }

  @Test fun anAttemptCutOffHalfwayIsContinuedByTheNextFromWhereItStopped() {
    withPart { part ->
      val youtube = FakeYoutube(stream("a", AUDIO.size.toLong()) to AUDIO)
      youtube.breaksFrom["a"] = 2 * CHUNK + 1_000
      assertThrows(IOException::class.java) { download(youtube).download("song", part) }
      assertEquals(2 * CHUNK + 1_000, part.length())

      youtube.breaksFrom.clear(); youtube.asked.clear()
      val resumed = mutableListOf<Pair<Long, Long>>()
      val file = download(youtube).download("song", part, onResume = { from, total -> resumed += from to total })
      assertArrayEquals(AUDIO, part.readBytes())
      assertEquals(AUDIO.size.toLong(), file.bytes)
      assertEquals(listOf((2 * CHUNK + 1_000) to AUDIO.size.toLong()), resumed)
      assertTrue(youtube.asked.none { it.second == 0L })
    }
  }

  @Test fun aKeptPartFileOfAnotherStreamIsStartedOver() {
    withPart { part ->
      val premium = ByteArray(AUDIO.size * 2) { (it % 7).toByte() }
      part.writeBytes(AUDIO.copyOfRange(0, 3 * CHUNK.toInt()))
      val youtube = FakeYoutube(stream("b", premium.size.toLong(), itag = 141, bitrate = 256_000) to premium)
      val resumed = mutableListOf<Long>()
      val file = download(youtube).download("song", part, onResume = { from, _ -> resumed += from })
      assertArrayEquals(premium, part.readBytes())
      assertEquals(141, file.itag)
      assertEquals(listOf(0L), resumed)
    }
  }

  @Test fun onlyM4aIsEverDownloaded() {
    withPart { part ->
      val youtube = FakeYoutube(stream("a", AUDIO.size.toLong(), mimeType = "audio/webm; codecs=\"opus\"") to AUDIO)
      assertThrows(YtException::class.java) { download(youtube).download("song", part) }
      assertTrue(youtube.asked.isEmpty())
      assertFalse(part.exists())
    }
  }

  private companion object {
    const val CHUNK = 16_384L
    const val M4A = "audio/mp4; codecs=\"mp4a.40.2\""
    val AUDIO = ByteArray(70_000) { (it * 31 % 251).toByte() }
  }

  private fun download(youtube: FakeYoutube) = YtAudioDownload(youtube, RangeDownload(chunkBytes = CHUNK, pause = {}))

  private fun withPart(block: (File) -> Unit) {
    val folder = Files.createTempDirectory("wave-yt-audio").toFile()
    try { block(File(folder, ".song.part.m4a")) } finally { folder.deleteRecursively() }
  }

  private fun stream(url: String, contentLength: Long?, itag: Int = 140, bitrate: Int = 128_000, mimeType: String = M4A) =
    YtStream(url = url, headers = emptyMap(), mimeType = mimeType, itag = itag, bitrate = bitrate, contentLength = contentLength, expiresAtMs = Long.MAX_VALUE)

  /** YouTube as a download sees it: each resolve gives the next address, the last one from then on. */
  private class FakeYoutube(vararg served: Pair<YtStream, ByteArray>) : YtAudioStreams {
    private val addresses = ArrayDeque(served.map { it.first })
    private val bytes = served.associate { it.first.url to it.second }
    var resolved = 0
    val rejected = mutableListOf<String>()
    /** The addresses googlevideo turns down (403) for any range from this byte on. */
    val expiresFrom = mutableMapOf<String, Long>()
    val asked = mutableListOf<Pair<String, Long>>()
    var headAnswers = true

    override fun resolve(videoId: String): YtStream {
      resolved++
      return if (addresses.size > 1) addresses.removeFirst() else addresses.first()
    }
    override fun reject(videoId: String) { rejected += videoId }
    override fun open(stream: YtStream, start: Long, end: Long): YtRange {
      asked += stream.url to start
      if ((expiresFrom[stream.url] ?: Long.MAX_VALUE) <= start) return YtRange(403, null)
      val data = bytes.getValue(stream.url)
      val breaks = breaksFrom[stream.url] ?: return YtRange(206, ByteArrayInputStream(data, start.toInt(), (end - start + 1).toInt()))
      if (start >= breaks) throw IOException("Connection reset")
      // The connection goes once the bytes before [breaks] have arrived.
      val served = ByteArrayInputStream(data, start.toInt(), (minOf(end + 1, breaks) - start).toInt())
      return YtRange(206, object : java.io.InputStream() {
        override fun read(): Int = served.read().takeIf { it >= 0 || end + 1 <= breaks } ?: throw IOException("Connection reset")
      })
    }
    /** The addresses whose connection breaks off at this byte, every time. */
    val breaksFrom = mutableMapOf<String, Long>()
    override fun headLength(stream: YtStream): Long? = if (headAnswers) bytes[stream.url]?.size?.toLong() else null
  }
}
