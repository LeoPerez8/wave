package expo.modules.wavenative.tags

import org.jaudiotagger.tag.Tag
import org.jaudiotagger.tag.TagTextField
import org.jaudiotagger.tag.flac.FlacTag
import org.jaudiotagger.tag.id3.AbstractID3v2Frame
import org.jaudiotagger.tag.id3.AbstractID3v2Tag
import org.jaudiotagger.tag.id3.framebody.FrameBodyTXXX
import org.jaudiotagger.tag.mp4.Mp4Tag
import org.jaudiotagger.tag.mp4.field.Mp4TagReverseDnsField
import org.jaudiotagger.tag.vorbiscomment.VorbisCommentTag

/**
 * A file's loudness tags as tagged (Core's `GainTagText`, which reads them for
 * Normalize Volume): ReplayGain's in MP3, FLAC, Ogg and M4A, and an Opus
 * file's R128 ones. Values are passed as tagged ("-6.54 dB", "-1536").
 */
data class LoudnessTags(
  val replayGainTrackGain: String? = null,
  val replayGainTrackPeak: String? = null,
  val replayGainAlbumGain: String? = null,
  val replayGainAlbumPeak: String? = null,
  val r128TrackGain: String? = null,
  val r128AlbumGain: String? = null,
) {
  /** Whether the file has none of them. */
  fun isEmpty(): Boolean = this == NONE

  /** As JS receives it (`NativeScannedTrack.loudnessTags`). */
  fun toMap(): Map<String, String?> =
    mapOf(
      "replayGainTrackGain" to replayGainTrackGain,
      "replayGainTrackPeak" to replayGainTrackPeak,
      "replayGainAlbumGain" to replayGainAlbumGain,
      "replayGainAlbumPeak" to replayGainAlbumPeak,
      "r128TrackGain" to r128TrackGain,
      "r128AlbumGain" to r128AlbumGain,
    )

  companion object {
    private val NONE = LoudnessTags()

    const val TRACK_GAIN = "REPLAYGAIN_TRACK_GAIN"
    const val TRACK_PEAK = "REPLAYGAIN_TRACK_PEAK"
    const val ALBUM_GAIN = "REPLAYGAIN_ALBUM_GAIN"
    const val ALBUM_PEAK = "REPLAYGAIN_ALBUM_PEAK"
    const val R128_TRACK_GAIN = "R128_TRACK_GAIN"
    const val R128_ALBUM_GAIN = "R128_ALBUM_GAIN"

    /** The tags among [fields] (upper-case names to their first value). */
    fun of(fields: (String) -> String?): LoudnessTags =
      LoudnessTags(
        replayGainTrackGain = fields(TRACK_GAIN),
        replayGainTrackPeak = fields(TRACK_PEAK),
        replayGainAlbumGain = fields(ALBUM_GAIN),
        replayGainAlbumPeak = fields(ALBUM_PEAK),
        r128TrackGain = fields(R128_TRACK_GAIN),
        r128AlbumGain = fields(R128_ALBUM_GAIN),
      )

    /**
     * The loudness tags in a jaudiotagger [tag], or the file's ID3v2 tag [id3]:
     * a user text frame (`TXXX:REPLAYGAIN_TRACK_GAIN`) in ID3, a Vorbis comment
     * in FLAC and Ogg, an iTunes reverse-DNS atom
     * (`----:com.apple.iTunes:replaygain_track_gain`) in MP4. Taggers write the
     * names in either case.
     */
    fun read(tag: Tag?, id3: AbstractID3v2Tag?): LoudnessTags {
      val values = HashMap<String, String>()
      fun keep(name: String?, value: String?) {
        val key = name?.trim()?.uppercase() ?: return
        val text = value.cleanTag() ?: return
        values.putIfAbsent(key, text)
      }
      runCatching {
        id3?.getFields("TXXX")?.forEach { field ->
          val body = (field as? AbstractID3v2Frame)?.body as? FrameBodyTXXX ?: return@forEach
          keep(body.description, body.firstTextValue)
        }
      }
      runCatching {
        when (tag) {
          is Mp4Tag -> tag.fields.forEach { field ->
            if (field is Mp4TagReverseDnsField) keep(field.descriptor, field.content)
          }
          is VorbisCommentTag, is FlacTag -> tag.fields.forEach { field ->
            keep(field.id, (field as? TagTextField)?.content)
          }
          else -> Unit
        }
      }
      return of(values::get)
    }
  }
}
