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
import org.jaudiotagger.tag.flac.FlacTag
import org.jaudiotagger.tag.id3.AbstractID3v2Frame
import org.jaudiotagger.tag.id3.AbstractID3v2Tag
import org.jaudiotagger.tag.id3.framebody.FrameBodyTXXX
import org.jaudiotagger.tag.vorbiscomment.VorbisCommentTag

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
    val id3 = (tag as? AbstractID3v2Tag) ?: (audio as? MP3File)?.iD3v2Tag
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
        isTruthyFlag(tag.field(FieldKey.IS_COMPILATION)) || id3.hasUserCompilationFlag(),
      durationMs = durationMs,
      sampleRate = header?.let { runCatching { it.sampleRateAsNumber }.getOrNull() }?.takeIf { it > 0 },
      bitrateKbps = header?.let { runCatching { it.bitRateAsNumber }.getOrNull() }?.toInt()?.takeIf { it > 0 },
      artwork = tag?.let { runCatching { it.firstArtwork?.binaryData }.getOrNull() }?.takeIf { it.isNotEmpty() },
      lyrics = tag.field(FieldKey.LYRICS) ?: id3.userText(USER_LYRICS_KEYS) ?: tag.vorbisField(USER_LYRICS_KEYS),
    )
  }

  private fun Tag?.field(key: FieldKey): String? =
    if (this == null) null else runCatching { getFirst(key) }.getOrNull().cleanTag()

  /** The first of the Vorbis comment fields [names] that has a value (FLAC and Ogg Vorbis). */
  private fun Tag?.vorbisField(names: List<String>): String? {
    if (this !is VorbisCommentTag && this !is FlacTag) return null
    return names.firstNotNullOfOrNull { name -> runCatching { getFirst(name) }.getOrNull().cleanTag() }
  }

  /** The value of the first user text frame (`TXXX`) described as one of [descriptions]. */
  private fun AbstractID3v2Tag?.userText(descriptions: List<String>): String? {
    if (this == null) return null
    return runCatching {
      getFields("TXXX").firstNotNullOfOrNull { field ->
        val body = (field as? AbstractID3v2Frame)?.body as? FrameBodyTXXX
        body
          ?.takeIf { frame -> descriptions.any { frame.description.equals(it, ignoreCase = true) } }
          ?.firstTextValue
          .cleanTag()
      }
    }.getOrNull()
  }

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

    /**
     * Where lyrics end up outside the standard field: foobar2000 writes
     * `UNSYNCEDLYRICS`, and ffmpeg (converting a FLAC to MP3, say) a
     * `TXXX:USLT` frame, since it can't write a real USLT one.
     */
    val USER_LYRICS_KEYS = listOf("UNSYNCEDLYRICS", "UNSYNCED LYRICS", "LYRICS", "USLT")

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
