package expo.modules.wavenative.tags

import java.io.File
import java.util.logging.Level
import java.util.logging.Logger
import kotlin.math.roundToLong
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.audio.mp3.MP3File
import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.Tag
import org.jaudiotagger.tag.TagOptionSingleton
import org.jaudiotagger.tag.id3.AbstractID3v2Frame
import org.jaudiotagger.tag.id3.AbstractID3v2Tag
import org.jaudiotagger.tag.id3.framebody.FrameBodyTXXX

/**
 * Reads MP3 (ID3), FLAC, M4A (AAC/ALAC), Ogg Vorbis and WAV tags with
 * jaudiotagger, which can also write them (needed by the v2 tag editor).
 */
class JAudioTaggerReader : TagReader {
  init {
    configure()
  }

  override fun read(file: File): RawTags {
    val audio = AudioFileIO.read(file)
    val header = audio.audioHeader
    val tag = audio.tag
    val durationMs =
      header?.let {
        val precise = runCatching { it.preciseTrackLength }.getOrNull()
        if (precise != null && precise > 0) (precise * 1000).roundToLong() else it.trackLength * 1000L
      } ?: 0L
    return RawTags(
      title = tag.field(FieldKey.TITLE),
      artist = tag.field(FieldKey.ARTIST),
      album = tag.field(FieldKey.ALBUM),
      albumArtist = tag.field(FieldKey.ALBUM_ARTIST),
      genre = tag.field(FieldKey.GENRE),
      year = tag.field(FieldKey.YEAR),
      trackNumber = numberOf(tag.field(FieldKey.TRACK), tag.field(FieldKey.TRACK_TOTAL)),
      discNumber = numberOf(tag.field(FieldKey.DISC_NO), tag.field(FieldKey.DISC_TOTAL)),
      compilation =
        isTruthyFlag(tag.field(FieldKey.IS_COMPILATION)) ||
          ((tag as? AbstractID3v2Tag) ?: (audio as? MP3File)?.iD3v2Tag).hasUserCompilationFlag(),
      durationMs = durationMs,
      sampleRate = header?.let { runCatching { it.sampleRateAsNumber }.getOrNull() }?.takeIf { it > 0 },
      bitrateKbps = header?.let { runCatching { it.bitRateAsNumber }.getOrNull() }?.toInt()?.takeIf { it > 0 },
      artwork = tag?.let { runCatching { it.firstArtwork?.binaryData }.getOrNull() }?.takeIf { it.isNotEmpty() },
    )
  }

  private fun Tag?.field(key: FieldKey): String? =
    if (this == null) null else runCatching { getFirst(key) }.getOrNull().cleanTag()

  /**
   * ffmpeg and several taggers write the compilation flag as a user text frame
   * (`TXXX:TCMP` or `TXXX:COMPILATION`) instead of iTunes' `TCMP` frame, which
   * jaudiotagger's IS_COMPILATION key doesn't see.
   */
  private fun AbstractID3v2Tag?.hasUserCompilationFlag(): Boolean {
    if (this == null) return false
    return runCatching {
      getFields("TXXX").any { field ->
        val body = (field as? AbstractID3v2Frame)?.body as? FrameBodyTXXX
        body != null &&
          USER_COMPILATION_KEYS.any { body.description.equals(it, ignoreCase = true) } &&
          isTruthyFlag(body.firstTextValue)
      }
    }.getOrDefault(false)
  }

  private companion object {
    val USER_COMPILATION_KEYS = listOf("TCMP", "COMPILATION")

    @Volatile private var configured = false

    fun configure() {
      if (configured) return
      synchronized(this) {
        if (configured) return
        // jaudiotagger logs every quirk it meets at INFO/WARNING; a large library floods logcat.
        Logger.getLogger("org.jaudiotagger").level = Level.OFF
        // Avoids java.awt / javax.imageio code paths, which don't exist on Android.
        TagOptionSingleton.getInstance().isAndroid = true
        configured = true
      }
    }
  }
}
