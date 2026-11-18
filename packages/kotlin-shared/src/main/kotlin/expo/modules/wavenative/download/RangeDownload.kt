package expo.modules.wavenative.download

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
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
 * row without a byte arriving give up. That whole cycle of retries lasts at
 * most [retryCycleMs], with each request bounded by [REQUEST_TIMEOUT_MS].
 *
 * Without `resume` the part file is started afresh, and deleted whenever the
 * download doesn't complete (a failure or a cancellation), so nothing partial
 * is left behind. With it, the part file an earlier call left is continued
 * from its last byte, once the bytes just before it are checked to be the
 * same file's (else it starts over), and a failure or cancellation leaves what
 * arrived for the next call: deleting the part file is then the caller's.
 */
class RangeDownload(
  private val chunkBytes: Long = DEFAULT_CHUNK_BYTES,
  private val attempts: Int = DEFAULT_ATTEMPTS,
  private val pause: (Long) -> Unit = Thread::sleep,
  /** How much of the kept bytes is asked for again on resuming, to check they're the same file's. */
  private val overlapBytes: Long = DEFAULT_OVERLAP_BYTES,
) {
  /** The longest this downloader goes without a byte arriving before it gives up: every request timing out, and the pauses between. */
  val retryCycleMs: Long get() = cycleMs(attempts)

  /**
   * Downloads [length] bytes from [source] into [target], reporting the bytes
   * written so far. Throws [IOException] after too many failures and
   * [CancellationException] once [isCancelled] says so (or the thread is
   * interrupted while it pauses). When the source says it changed
   * ([RangeSourceChanged]) the part file starts over at the new length.
   * With [resume], [onResume] says where the kept bytes were continued from
   * (0 when they turned out to be another file's). Returns the length downloaded.
   */
  fun download(
    source: RangeSource,
    length: Long,
    target: File,
    onProgress: (Long) -> Unit = {},
    isCancelled: () -> Boolean = { false },
    resume: Boolean = false,
    onResume: (Long) -> Unit = {},
  ): Long {
    var done = false
    var length = length
    try {
      RandomAccessFile(target, "rw").use { out ->
        // Bytes kept from before, shorter than the file: the ones before [kept] are only checked, not written again.
        var kept = if (resume) out.length().takeIf { it < length } ?: 0L else 0L
        out.setLength(kept)
        out.seek(kept)
        var written = maxOf(0L, kept - overlapBytes)
        var failures = 0
        val buffer = ByteArray(BUFFER_BYTES)
        val check = ByteArray(BUFFER_BYTES)
        fun startOver() {
          out.setLength(0); out.seek(0); written = 0; kept = 0; failures = 0
        }
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
                // Bytes the part file already holds: they have to be the same, else it's another file's.
                val checked = minOf(read.toLong(), maxOf(0L, kept - written)).toInt()
                if (checked > 0) {
                  out.seek(written); out.readFully(check, 0, checked); out.seek(kept)
                  if (!buffer.copyOfRange(0, checked).contentEquals(check.copyOfRange(0, checked))) throw KeptBytesDiffer()
                  if (written + checked == kept) onResume(kept)
                }
                if (read > checked) out.write(buffer, checked, read - checked)
                written += read
                if (written >= kept) onProgress(written)
              }
            }
            // A short answer is fine (the rest is asked for next), an empty one isn't.
            if (written == before) throw IOException("No bytes in the answer for $before-$end")
            failures = 0
          } catch (e: KeptBytesDiffer) {
            startOver(); onResume(0); onProgress(0)
          } catch (e: RangeSourceChanged) {
            startOver(); length = e.length; onProgress(0)
          } catch (e: IOException) {
            // A request broken off by a cancel (a closed socket, an interrupt) isn't a failure.
            if (isCancelled()) throw CancellationException("Download cancelled").apply { initCause(e) }
            failures = if (written > before) 1 else failures + 1
            if (failures >= attempts) throw e
            try { pause(RETRY_PAUSE_MS * failures) } catch (stop: InterruptedException) {
              Thread.currentThread().interrupt()
              throw CancellationException("Download cancelled").apply { initCause(stop) }
            }
          }
        }
        out.fd.sync()
      }
      done = true
      return length
    } finally {
      if (!done && !resume) target.delete()
    }
  }

  /** The bytes kept from before aren't the file the source serves now. */
  private class KeptBytesDiffer : Exception()

  companion object {
    /** 1 MiB, what YouTube's own clients ask for at a time. */
    const val DEFAULT_CHUNK_BYTES = 1L shl 20
    const val DEFAULT_ATTEMPTS = 4
    /** How long a source should let one request take to connect, and then to read, before it fails. */
    const val REQUEST_TIMEOUT_MS = 20_000
    /** [retryCycleMs] for the default number of attempts. */
    val RETRY_CYCLE_MS: Long = cycleMs(DEFAULT_ATTEMPTS)
    private const val BUFFER_BYTES = 64 * 1024
    private const val RETRY_PAUSE_MS = 1_000L
    const val DEFAULT_OVERLAP_BYTES = 16L * 1024

    /** [attempts] requests each timing out on connecting and on reading, with the growing pauses between them. */
    private fun cycleMs(attempts: Int): Long =
      attempts * 2L * REQUEST_TIMEOUT_MS + (1 until attempts).sumOf { RETRY_PAUSE_MS * it }
  }
}
