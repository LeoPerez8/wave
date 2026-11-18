package expo.modules.wavenative.tags

import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.Tag
import org.jaudiotagger.tag.flac.FlacTag
import org.jaudiotagger.tag.id3.AbstractID3v2Tag
import org.jaudiotagger.tag.id3.ID3v24Tag
import org.jaudiotagger.tag.mp4.Mp4Tag
import org.jaudiotagger.tag.mp4.field.Mp4TagReverseDnsField
import org.jaudiotagger.tag.vorbiscomment.VorbisCommentTag
import org.jaudiotagger.tag.vorbiscomment.VorbisCommentTagField
import org.jaudiotagger.tag.wav.WavTag

/**
 * A song's original (first) release date tag, apart from the album's Year, under the names
 * MusicBrainz Picard gives it: ID3v2.4 `TDOR`, ID3v2.3 `TORY` (which holds a year alone, so a
 * month or day also goes in `TXXX:ORIGINALRELEASEDATE`),
 * Vorbis comment `ORIGINALDATE` (FLAC, Ogg Vorbis) and MP4 `----:com.apple.iTunes:ORIGINALDATE`.
 * A WAV file keeps it in its ID3 chunk; its RIFF INFO chunk has no field for it.
 */
internal object OriginalDate {
  private const val VORBIS = "ORIGINALDATE"
  private const val MP4_ISSUER = "com.apple.iTunes"
  private const val MP4 = "----:$MP4_ISSUER:$VORBIS"

  /** The date [tag] holds under any of the names taggers use; null when none. */
  fun read(tag: Tag?): String? {
    if (tag == null) return null
    if (tag is WavTag) return read(tag.iD3Tag)
    fun first(key: FieldKey) = runCatching { tag.getFirst(key) }.getOrNull().cleanTag()
    fun raw(id: String) = runCatching { tag.getFirst(id) }.getOrNull().cleanTag()
    return first(FieldKey.ORIGINALRELEASEDATE)
      ?: when (tag) {
        is VorbisCommentTag, is FlacTag -> raw(VORBIS)
        is Mp4Tag -> raw(MP4)
        else -> null
      }
      ?: first(FieldKey.ORIGINAL_YEAR)
      ?: if (tag is VorbisCommentTag || tag is FlacTag) raw("ORIGINALYEAR") else null
  }

  /**
   * Takes every original date out of [tag], under each name [read] knows, so a [write] after it
   * leaves no other date behind (an ID3v2.3 `TXXX` day beside a new `TORY` year).
   */
  fun remove(tag: Tag) {
    if (tag is WavTag) return tag.iD3Tag?.let(::remove) ?: Unit
    for (key in listOf(FieldKey.ORIGINALRELEASEDATE, FieldKey.ORIGINAL_YEAR)) runCatching { tag.deleteField(key) }
    val raw = when (tag) {
      is FlacTag -> return remove(tag.vorbisCommentTag)
      is VorbisCommentTag -> listOf(VORBIS, "ORIGINALYEAR")
      is Mp4Tag -> listOf(MP4)
      else -> emptyList()
    }
    for (id in raw) runCatching { tag.deleteField(id) }
  }

  /**
   * Sets [date] (`1985`, `1985-06` or `1985-06-21`) as [tag]'s original date, as far as its
   * format holds it; false for a tag with no field for it.
   */
  fun write(tag: Tag, date: String): Boolean {
    when (tag) {
      is ID3v24Tag -> tag.setField(FieldKey.ORIGINAL_YEAR, date)
      is AbstractID3v2Tag -> {
        tag.setField(FieldKey.ORIGINAL_YEAR, date.take(4))
        // TORY holds a year alone; a scan reads the whole date from jaudiotagger's TXXX frame.
        if (date.length > 4) tag.setField(FieldKey.ORIGINALRELEASEDATE, date)
      }
      is FlacTag -> tag.vorbisCommentTag.setField(VorbisCommentTagField(VORBIS, date))
      is VorbisCommentTag -> tag.setField(VorbisCommentTagField(VORBIS, date))
      is Mp4Tag -> tag.setField(Mp4TagReverseDnsField(MP4, MP4_ISSUER, VORBIS, date))
      is WavTag -> return tag.iD3Tag?.let { write(it, date) } ?: false
      else -> return false
    }
    return true
  }
}
