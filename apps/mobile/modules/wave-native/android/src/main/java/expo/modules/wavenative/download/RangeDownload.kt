package expo.modules.wavenative.download

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.CancellationException

/**
 * Opens bytes [start] to [end] (inclusive) of a remote file. Throws [IOException] when it can't,
 * and [RangeSourceChanged] when the file it serves is now another one.
 */
fun interface RangeSource {
  fun open(start: Long, end: Long): InputStream
}

/** The source now serves a different file, [length] bytes long: what arrived so far is thrown away. */
class RangeSourceChanged(val length: Long) : Exception("The file changed; starting over")

/**
 * Downloads a file of known length in byte ranges of [chunkBytes] into a part
 * file: YouTube's media servers slow a single open-ended request down to about
 * playback speed, and answer bounded ones at full speed. A request that breaks
 * off is tried again from the last byte that arrived; [attempts] failures in a
 * row without a byte arriving give up.
 *
 * The part file is started afresh, and deleted whenever the download doesn't
 * complete (a failure or a cancellation), so nothing partial is left behind.
 */
class RangeDownload(
  private val chunkBytes: Long = DEFAULT_CHUNK_BYTES,
  private val attempts: Int = 4,
  private val pause: (Long) -> Unit = Thread::sleep,
) {
  /**
   * Downloads [length] bytes from [source] into [target], reporting the bytes
   * written so far. Throws [IOException] after too many failures and
   * [CancellationException] once [isCancelled] says so. When the source says
   * it changed ([RangeSourceChanged]) the part file starts over at the new
   * length. Returns the length downloaded.
   */
  fun download(
    source: RangeSource,
    length: Long,
    target: File,
    onProgress: (Long) -> Unit = {},
    isCancelled: () -> Boolean = { false },
  ): Long {
    var done = false
    var length = length
    try {
      FileOutputStream(target, false).use { out ->
        var written = 0L
        var failures = 0
        val buffer = ByteArray(BUFFER_BYTES)
        while (written < length) {
          if (isCancelled()) throw CancellationException("Download cancelled")
          // Ranges keep to chunk boundaries; after a short answer, the rest of the chunk is asked for.
          val end = minOf((written / chunkBytes + 1) * chunkBytes, length) - 1
          val before = written
          try {
            source.open(written, end).use { input ->
              while (written <= end) {
                if (isCancelled()) throw CancellationException("Download cancelled")
                val read = input.read(buffer, 0, minOf(buffer.size.toLong(), end - written + 1).toInt())
                if (read < 0) break
                out.write(buffer, 0, read)
                written += read
                onProgress(written)
              }
            }
            // A short answer is fine (the rest is asked for next), an empty one isn't.
            if (written == before) throw IOException("No bytes in the answer for $before-$end")
            failures = 0
          } catch (e: RangeSourceChanged) {
            out.channel.truncate(0)
            out.channel.position(0)
            written = 0
            failures = 0
            length = e.length
            onProgress(0)
          } catch (e: IOException) {
            failures = if (written > before) 1 else failures + 1
            if (failures >= attempts) throw e
            pause(RETRY_PAUSE_MS * failures)
          }
        }
        out.fd.sync()
      }
      done = true
      return length
    } finally {
      if (!done) target.delete()
    }
  }

  companion object {
    /** 1 MiB, what YouTube's own clients ask for at a time. */
    const val DEFAULT_CHUNK_BYTES = 1L shl 20
    private const val BUFFER_BYTES = 64 * 1024
    private const val RETRY_PAUSE_MS = 1_000L
  }
}
