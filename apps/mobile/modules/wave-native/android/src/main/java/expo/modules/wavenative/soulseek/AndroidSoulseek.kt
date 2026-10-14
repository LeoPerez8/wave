package expo.modules.wavenative.soulseek

import android.content.Context
import expo.modules.wavenative.net.Connectivity
import expo.modules.wavenative.secrets.KeystoreCipher
import expo.modules.wavenative.tags.JAudioTaggerReader
import java.io.File
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey

/** Owns the session for the whole app process; Expo screen/module destruction doesn't disconnect it. */
class AndroidSoulseek private constructor(context: Context) {
  // Offline the way YouTube Music tells it, so Soulseek's server isn't unreachable behind a captive portal.
  private val connectivity = Connectivity(context)
  val client = SoulseekClient(
    SoulseekSessionStore(File(context.noBackupFilesDir, "soulseek-session"), KeystoreCipher("wave-soulseek-session-v1")),
    online = connectivity::online,
    switch = SoulseekSwitchFile(File(context.noBackupFilesDir, "soulseek-best-quality")),
  )

  fun download(
    id: String,
    candidate: SoulseekCandidate,
    part: File,
    expectedDurationMs: Long,
    onProgress: (Long, Long) -> Unit = { _, _ -> },
    onQueued: (Long) -> Unit = {},
    /** Polled while waiting for the peer and while decoding; the journal's deadlines end the transfer. */
    isCancelled: () -> Boolean,
  ): Map<String, Any?> {
    try {
      val verified = client.download(id, candidate, part, expectedDurationMs, onProgress, onQueued, isCancelled)
      AndroidMp3Decode.validate(part, verified, isCancelled)
      JAudioTaggerReader.configure()
      val tag = AudioFileIO.read(part).tag
      fun text(key: FieldKey): String? = tag?.getFirst(key)?.takeIf { it.isNotBlank() }
      return verified.toMap() + mapOf(
        "partPath" to part.path,
        "receivedTags" to mapOf("title" to text(FieldKey.TITLE), "artist" to text(FieldKey.ARTIST), "album" to text(FieldKey.ALBUM)),
      )
    } catch (e: Exception) { part.delete(); throw e }
  }

  companion object {
    @Volatile private var instance: AndroidSoulseek? = null
    fun get(context: Context): AndroidSoulseek = instance ?: synchronized(this) {
      instance ?: AndroidSoulseek(context.applicationContext).also { instance = it }
    }
  }
}
