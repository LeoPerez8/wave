package expo.modules.wavenative.normalize

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile

/** A Library file to measure, as the Library store last saw it (JS's `SongToMeasure`). */
data class LibrarySong(val id: Long, val path: String, val sizeBytes: Long, val modifiedAt: Long)

/**
 * What measuring [song] gave the charging job, kept until the app takes it in (JS's
 * `LibraryMeasurement`). [seq] is its place among the results, which only grows; [loudness] (LUFS)
 * and [peak] (0–1) mean something for [Kind.MEASURED] only.
 */
data class LibraryResult(val seq: Long, val song: LibrarySong, val kind: Kind, val loudness: Double, val peak: Double) {
  enum class Kind {
    MEASURED,
    UNMEASURABLE,

    /** The file couldn't be opened: it waits for the app's next list, which still has it if it's there. */
    UNREADABLE,
  }
}

/**
 * The charging job's work and what it did, in [dir] (Normalize Volume, [LibraryMeasurements]): the
 * Library files the app handed over to measure ([replace]), and a journal of the results, one
 * appended as each file is done, so a run stopped mid-file (unplugged, out of time, the process
 * killed) loses only that file. The Library store stays the schema's only owner: the app takes
 * the results in ([results]) and then has them forgotten ([forget]), which drops their songs from
 * the list too. A song with a result isn't measured again while the result is kept, so a list the
 * app handed over before taking results in doesn't redo them. Thread-safe: JS and the job's
 * thread share it.
 */
class LibraryToMeasure(private val dir: File) {
  private var loaded = false
  private var songs: List<LibrarySong> = emptyList()
  private val results = ArrayList<LibraryResult>()
  private val done = HashSet<LibrarySong>()
  private var nextSeq = 1L

  private val listFile get() = File(dir, LIST_FILE)
  private val resultsFile get() = File(dir, RESULTS_FILE)

  /** The app's list of files to measure, in its order, in place of the one before. */
  @Synchronized
  fun replace(songs: List<LibrarySong>) {
    load()
    this.songs = songs.toList()
    writeList()
  }

  /** The first file of the list without a result: the one to measure next. Null: nothing left. */
  @Synchronized
  fun next(): LibrarySong? {
    load()
    return songs.firstOrNull { it !in done }
  }

  /** How many files of the list have no result. */
  @Synchronized
  fun left(): Int {
    load()
    return songs.count { it !in done }
  }

  /** Keeps what measuring [song] gave, on disk before it returns. */
  @Synchronized
  fun record(song: LibrarySong, kind: LibraryResult.Kind, loudness: Double, peak: Double): LibraryResult {
    load()
    val result = LibraryResult(nextSeq++, song, kind, loudness, peak)
    dir.mkdirs()
    FileOutputStream(resultsFile, true).use { out ->
      out.write(bytesOf(result))
      out.fd.sync()
    }
    results += result
    done += song
    return result
  }

  /** The first [limit] results kept, in their order. */
  @Synchronized
  fun results(limit: Int): List<LibraryResult> {
    load()
    return results.take(limit.coerceAtLeast(0))
  }

  /** The app kept the results through [seq] in the Library store: they go, and their songs leave the list. */
  @Synchronized
  fun forget(seq: Long) {
    load()
    val taken = results.filter { it.seq <= seq }
    if (taken.isEmpty()) return
    results.removeAll { it.seq <= seq }
    done.clear()
    results.mapTo(done) { it.song }
    val takenSongs = taken.mapTo(HashSet()) { it.song }
    songs = songs.filter { it !in takenSongs || it in done }
    writeList()
    writeResults()
  }

  private fun load() {
    if (loaded) return
    loaded = true
    readList()
    readResults()
  }

  private fun readList() {
    val file = listFile
    if (!file.isFile) return
    try {
      DataInputStream(file.inputStream().buffered()).use { input ->
        if (input.readInt() != VERSION) return
        nextSeq = maxOf(nextSeq, input.readLong())
        val count = input.readInt()
        songs = List(count) { LibrarySong(id = input.readLong(), sizeBytes = input.readLong(), modifiedAt = input.readLong(), path = input.readUTF()) }
      }
    } catch (_: IOException) {
      // A list that can't be read is no list: the app hands over a new one at its next start.
      songs = emptyList()
    }
  }

  private fun readResults() {
    val file = resultsFile
    if (!file.isFile) return
    val bytes = try {
      file.readBytes()
    } catch (_: IOException) {
      return
    }
    val input = DataInputStream(ByteArrayInputStream(bytes))
    var whole = 0
    try {
      while (input.available() > 0) {
        val result = LibraryResult(
          seq = input.readLong(),
          song = LibrarySong(id = input.readLong(), sizeBytes = input.readLong(), modifiedAt = input.readLong(), path = input.readUTF()),
          kind = LibraryResult.Kind.entries.getOrNull(input.readByte().toInt()) ?: throw EOFException(),
          loudness = input.readDouble(),
          peak = input.readDouble(),
        )
        results += result
        done += result.song
        nextSeq = maxOf(nextSeq, result.seq + 1)
        whole = bytes.size - input.available()
      }
    } catch (_: IOException) {
      // The last result was cut off mid-write (the process died): it's measured again.
    }
    if (whole < bytes.size) runCatching { RandomAccessFile(file, "rw").use { it.setLength(whole.toLong()) } }
  }

  private fun writeList() {
    replaceFile(listFile) { out ->
      out.writeInt(VERSION)
      out.writeLong(nextSeq)
      out.writeInt(songs.size)
      for (song in songs) {
        out.writeLong(song.id)
        out.writeLong(song.sizeBytes)
        out.writeLong(song.modifiedAt)
        out.writeUTF(song.path)
      }
    }
  }

  private fun writeResults() {
    replaceFile(resultsFile) { out -> for (result in results) out.write(bytesOf(result)) }
  }

  /** Writes [file] whole beside it and moves it in, so a reader finds the old one or the new one. */
  private fun replaceFile(file: File, write: (DataOutputStream) -> Unit) {
    dir.mkdirs()
    val next = File(dir, "${file.name}.next")
    FileOutputStream(next).use { stream ->
      val out = DataOutputStream(stream.buffered())
      write(out)
      out.flush()
      stream.fd.sync()
    }
    if (!next.renameTo(file)) throw IOException("Couldn't replace ${file.name}")
  }

  private fun bytesOf(result: LibraryResult): ByteArray {
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).apply {
      writeLong(result.seq)
      writeLong(result.song.id)
      writeLong(result.song.sizeBytes)
      writeLong(result.song.modifiedAt)
      writeUTF(result.song.path)
      writeByte(result.kind.ordinal)
      writeDouble(result.loudness)
      writeDouble(result.peak)
      flush()
    }
    return bytes.toByteArray()
  }

  companion object {
    private const val VERSION = 1
    const val LIST_FILE = "to-measure"
    const val RESULTS_FILE = "measured"
  }
}
