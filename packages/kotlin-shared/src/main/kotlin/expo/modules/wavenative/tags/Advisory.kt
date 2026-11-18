package expo.modules.wavenative.tags

import org.jaudiotagger.tag.Tag
import org.jaudiotagger.tag.flac.FlacTag
import org.jaudiotagger.tag.id3.AbstractID3v2Frame
import org.jaudiotagger.tag.id3.AbstractID3v2Tag
import org.jaudiotagger.tag.id3.framebody.FrameBodyTXXX
import org.jaudiotagger.tag.id3.valuepair.TextEncoding
import org.jaudiotagger.tag.mp4.Mp4FieldKey
import org.jaudiotagger.tag.mp4.Mp4Tag
import org.jaudiotagger.tag.vorbiscomment.VorbisCommentTag

/**
 * A file's advisory tag, whether the song is explicit (docs/spec.md): `ITUNESADVISORY`
 * as an ID3 user text frame (`TXXX`) or a Vorbis comment, `rtng` in MP4. Values are
 * passed as tagged; Core's `explicitFromAdvisory` reads them (1 explicit, 0 clean).
 */
internal object Advisory {
  /** The ID3 `TXXX` description and the Vorbis comment name. */
  const val KEY = "ITUNESADVISORY"

  /** The advisory [tag] has, as tagged; [id3] is the file's ID3v2 tag, when it has one. */
  fun read(tag: Tag?, id3: AbstractID3v2Tag?): String? =
    runCatching {
      when (tag) {
        is Mp4Tag -> tag.getFirst(Mp4FieldKey.RATING).cleanTag()
        is VorbisCommentTag, is FlacTag -> tag.getFirst(KEY).cleanTag()
        else -> id3?.userText(KEY)
      }
    }.getOrNull()

  /** Sets [tag]'s advisory to [value] (1 explicit, 0 clean), replacing the one it has. */
  fun write(tag: Tag, value: Int) {
    when (tag) {
      is Mp4Tag -> tag.setField(Mp4FieldKey.RATING, value.toString())
      is VorbisCommentTag -> tag.setField(KEY, value.toString())
      is FlacTag -> tag.setField(KEY, value.toString())
      is AbstractID3v2Tag -> {
        // A TXXX frame with the same description takes this one's place.
        val frame = tag.createFrame("TXXX")
        frame.body = FrameBodyTXXX(TextEncoding.ISO_8859_1, KEY, value.toString())
        tag.setField(frame)
      }
      else -> Unit
    }
  }

  private fun AbstractID3v2Tag.userText(description: String): String? =
    getFields("TXXX").firstNotNullOfOrNull { field ->
      ((field as? AbstractID3v2Frame)?.body as? FrameBodyTXXX)
        ?.takeIf { it.description.equals(description, ignoreCase = true) }
        ?.firstTextValue
        .cleanTag()
    }
}
