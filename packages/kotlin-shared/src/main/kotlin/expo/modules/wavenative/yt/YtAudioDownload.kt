package expo.modules.wavenative.yt

import expo.modules.wavenative.download.RangeDownload
import expo.modules.wavenative.download.RangeSource
import expo.modules.wavenative.download.RangeSourceChanged
import java.io.File
import java.io.IOException
import java.io.InputStream

/** What was downloaded: the stream YouTube served (M4A, as it is), its size and the video it's the audio of. */
data class YtAudioFile(
  val itag: Int,
  val bitrate: Int,
  val mimeType: String,
  val bytes: Long,
  val source: YtStreamSource = YtStreamSource.UNKNOWN,
)

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
 * YouTube announced (clen, or a HEAD request; the fresh stream's once it starts over):
 * [RangeDownload] asks for ranges until exactly that many bytes are written.
 *
 * A download that fails or is cancelled keeps the bytes that arrived in the part file, and the next
 * one into the same part file goes on from there (once the bytes just before are checked to be the
 * same stream's; else it starts over), so an attempt the journal retries doesn't start from byte 0.
 * Deleting a part file nothing will continue is the journal's.
 */
class YtAudioDownload(private val streams: YtAudioStreams, private val ranges: RangeDownload = RangeDownload()) {
  /**
   * Downloads [videoId]'s audio into [part], reporting bytes received and the total, until
   * [isCancelled]. Throws [YtException] when YouTube won't give a stream, [IOException] when the
   * bytes don't arrive, and a `CancellationException` once cancelled. When [part] holds bytes from
   * an earlier attempt, [onResume] says the byte it went on from and the total (0 when those bytes
   * were another stream's and it started over).
   */
  fun download(
    videoId: String,
    part: File,
    onProgress: (Long, Long) -> Unit = { _, _ -> },
    isCancelled: () -> Boolean = { false },
    onResume: (Long, Long) -> Unit = { _, _ -> },
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
          if (YtStreams.resumesDownload(stream.itag, length, fresh.itag, freshLength)) {
            stream = fresh
            throw IOException("HTTP ${range.status} for the audio; asking a fresh address")
          }
          // Another file of a length nobody says: it can't continue this one, nor start over.
          // The refused address stays, so the next range asks for a fresh one again.
          if (freshLength == null) throw IOException("YouTube didn't say how long the file is")
          stream = fresh
          length = freshLength
          // Another file: the bytes so far don't belong to it.
          throw RangeSourceChanged(length)
        }
        else -> throw IOException("HTTP ${range.status} for the audio")
      }
    }
    // Returns only once the part file holds the announced length, the fresh stream's after a start over.
    val bytes = ranges.download(
      source, length, part, onProgress = { onProgress(it, length) }, isCancelled = isCancelled,
      resume = true, onResume = { onResume(it, length) },
    )
    // The stream the file came from: the last one resolved, whichever that was.
    return YtAudioFile(stream.itag, stream.bitrate, stream.mimeType, bytes, stream.source)
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
