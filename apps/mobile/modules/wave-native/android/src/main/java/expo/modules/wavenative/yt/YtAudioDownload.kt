package expo.modules.wavenative.yt

import expo.modules.wavenative.download.RangeDownload
import expo.modules.wavenative.download.RangeSource
import expo.modules.wavenative.download.RangeSourceChanged
import java.io.File
import java.io.IOException
import java.io.InputStream

/** What was downloaded: the stream YouTube served (M4A, as it is) and its size. */
data class YtAudioFile(val itag: Int, val bitrate: Int, val mimeType: String, val bytes: Long)

/** One answer from googlevideo for a byte range: its HTTP status and, for 200/206, the bytes. */
class YtRange(val status: Int, val body: InputStream?)

/**
 * How a download reaches YouTube (`AndroidYtAudioStreams` on the phone): the song's M4A stream,
 * dropping an address googlevideo turned down, and the bytes of a stream.
 */
interface YtAudioStreams {
  /** [videoId]'s best M4A stream for the account; throws [YtException] when it can't. */
  fun resolve(videoId: String): YtStream
  /** googlevideo turned [videoId]'s address down: the next [resolve] gets a fresh one. */
  fun reject(videoId: String)
  /** Bytes [start] to [end] (inclusive) of [stream]. */
  fun open(stream: YtStream, start: Long, end: Long): YtRange
  /** The file's length from a HEAD request, when neither the stream nor its address says. */
  fun headLength(stream: YtStream): Long?
}

/**
 * Downloads a YT Music song's audio as YouTube serves it, without re-encoding: the best M4A
 * (AAC) stream the account gets, 256 kbps (itag 141) with Premium, about 128 kbps (itag 140)
 * without. M4A takes every tag a download gets; YouTube's Opus streams come in WebM, which
 * doesn't.
 *
 * The audio is fetched in ranges into a part file ([RangeDownload]): a request that breaks off
 * goes on from the last byte that arrived. An address YouTube stops accepting (403/410) is
 * resolved again and the download goes on from where it was, or starts over when the fresh
 * address serves another stream ([YtStreams.resumesDownload]). The file is complete, the length
 * YouTube announced, or the part file is deleted.
 */
class YtAudioDownload(private val streams: YtAudioStreams, private val ranges: RangeDownload = RangeDownload()) {
  /**
   * Downloads [videoId]'s audio into [part], reporting bytes received and the total, until
   * [isCancelled]. Throws [YtException] when YouTube won't give a stream, [IOException] when the
   * bytes don't arrive, and a `CancellationException` once cancelled.
   */
  fun download(
    videoId: String,
    part: File,
    onProgress: (Long, Long) -> Unit = { _, _ -> },
    isCancelled: () -> Boolean = { false },
  ): YtAudioFile {
    var stream = m4a(streams.resolve(videoId))
    var length = lengthOf(stream) ?: throw IOException("YouTube didn't say how long the file is")
    var refreshes = 0
    val source = RangeSource { start, end ->
      val range = streams.open(stream, start, end)
      when (range.status) {
        200, 206 -> range.body ?: throw IOException("No audio in the answer")
        403, 410 -> {
          if (refreshes++ >= MAX_REFRESHES) throw IOException("HTTP ${range.status} for the audio")
          // The address expired or was refused: a fresh one carries on from here.
          streams.reject(videoId)
          val fresh = m4a(streams.resolve(videoId))
          val freshLength = lengthOf(fresh)
          val resumes = YtStreams.resumesDownload(stream.itag, length, fresh.itag, freshLength)
          stream = fresh
          if (!resumes) {
            length = freshLength ?: throw IOException("YouTube didn't say how long the file is")
            // Another file: the bytes so far don't belong to it.
            throw RangeSourceChanged(length)
          }
          throw IOException("HTTP ${range.status} for the audio; asking a fresh address")
        }
        else -> throw IOException("HTTP ${range.status} for the audio")
      }
    }
    val bytes = ranges.download(source, length, part, onProgress = { onProgress(it, length) }, isCancelled = isCancelled)
    if (part.length() != bytes) {
      part.delete()
      throw IOException("The audio arrived incomplete")
    }
    // The stream the file came from: the last one resolved, whichever that was.
    return YtAudioFile(stream.itag, stream.bitrate, stream.mimeType, bytes)
  }

  private fun m4a(stream: YtStream): YtStream =
    if (stream.mimeType.startsWith(M4A_MIME)) stream else throw YtException(YtFailure.FAILED)

  private fun lengthOf(stream: YtStream): Long? =
    stream.contentLength ?: YtMediaUrls.contentLength(stream.url) ?: streams.headLength(stream)

  companion object {
    private const val M4A_MIME = "audio/mp4"
    /** How many fresh addresses one download may ask for. */
    const val MAX_REFRESHES = 3
  }
}
