package expo.modules.wavenative.tags

import java.io.File

/**
 * Picks the right reader for a file: Opus goes to [opus], everything else to
 * [primary]. When the chosen reader fails (unsupported or damaged file) the
 * [fallback] is tried, and when that fails too the file still gets empty tags,
 * so it shows up in the library under its file name.
 */
class AudioTagReader(
  private val primary: TagReader,
  private val opus: TagReader = OggOpusReader(),
  private val fallback: TagReader? = null,
) : TagReader {
  override fun read(file: File): RawTags {
    val reader = if (isOpusFile(file)) opus else primary
    return attempt(reader, file) ?: fallback?.let { attempt(it, file) } ?: RawTags()
  }

  private fun isOpusFile(file: File): Boolean =
    when (file.extension.lowercase()) {
      "opus" -> true
      "ogg", "oga" -> OggOpusReader.isOpus(file)
      else -> false
    }

  private fun attempt(reader: TagReader, file: File): RawTags? =
    try {
      reader.read(file)
    } catch (e: Exception) {
      null
    } catch (e: StackOverflowError) {
      null
    } catch (e: OutOfMemoryError) {
      // A corrupt length field can make a parser allocate absurdly; skip the tags, keep the file.
      null
    }
}
