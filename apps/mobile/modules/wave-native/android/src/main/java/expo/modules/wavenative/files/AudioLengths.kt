package expo.modules.wavenative.files

import java.io.File
import java.util.concurrent.CancellationException

/**
 * How long Library files play, each read from its audio samples to their end ([readLength], the
 * phone's extractor: `AndroidAudioDuration`), which also proves the
 * audio is there to its end. The check for songs a replacement left twice trusts only these.
 */
class AudioLengths(private val readLength: (File) -> Long) {
  /** Each of [paths]'s length in milliseconds, in order; null for a file missing or unreadable. */
  fun read(paths: List<String>): List<Long?> = paths.map { path ->
    val file = File(path)
    if (!file.isFile) null
    else try {
      readLength(file)
    } catch (e: CancellationException) {
      throw e
    } catch (_: Exception) {
      null
    }
  }
}
