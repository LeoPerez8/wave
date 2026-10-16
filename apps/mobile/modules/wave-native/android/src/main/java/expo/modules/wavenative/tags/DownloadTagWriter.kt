package expo.modules.wavenative.tags

import java.io.File
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.images.ArtworkFactory
import org.jaudiotagger.tag.mp4.Mp4Tag
import org.jaudiotagger.tag.mp4.Mp4TagCreator

/** The tags a YT Music download gets (Core's `ytDownloadTags`); null fields are left out. */
data class DownloadTags(
  val title: String,
  val artist: String,
  val album: String?,
  val albumArtist: String?,
  val year: Int?,
  val trackNumber: Int?,
  val genre: String?,
  /** LRC for synced lyrics, plain text otherwise. */
  val lyrics: String?,
  val discNumber: Int? = null,
) {
  companion object {
    /** From JS: `{ title, artist, album, albumArtist, year, trackNumber, genre, lyrics }`. */
    fun fromJs(map: Map<String, Any?>): DownloadTags? {
      fun text(key: String): String? = (map[key] as? String)?.takeIf(String::isNotBlank)
      fun number(key: String): Int? = (map[key] as? Number)?.toInt()?.takeIf { it > 0 }
      return DownloadTags(
        title = text("title") ?: return null,
        artist = text("artist") ?: return null,
        album = text("album"),
        albumArtist = text("albumArtist"),
        year = number("year"),
        trackNumber = number("trackNumber"),
        genre = text("genre"),
        lyrics = text("lyrics"),
        discNumber = number("discNumber"),
      )
    }
  }
}

/**
 * Writes trusted download metadata and artwork with the existing format-aware
 * writer. Recording and audio validation must happen before peer tags are replaced.
 * A fragmented M4A (what YouTube serves) is tagged by [FragmentedMp4], which
 * jaudiotagger's MP4 writer can't do.
 */
class DownloadTagWriter {
  init {
    JAudioTaggerReader.configure()
  }

  fun write(file: File, tags: DownloadTags, artwork: ByteArray?) {
    val audio = AudioFileIO.read(file)
    val tag = audio.createDefaultTag()
    tag.setField(FieldKey.TITLE, tags.title)
    tag.setField(FieldKey.ARTIST, tags.artist)
    tags.album?.let { tag.setField(FieldKey.ALBUM, it) }
    tags.albumArtist?.let { tag.setField(FieldKey.ALBUM_ARTIST, it) }
    tags.year?.let { tag.setField(FieldKey.YEAR, it.toString()) }
    tags.trackNumber?.let { tag.setField(FieldKey.TRACK, it.toString()) }
    tags.discNumber?.let { tag.setField(FieldKey.DISC_NO, it.toString()) }
    tags.genre?.let { tag.setField(FieldKey.GENRE, it) }
    tags.lyrics?.let { tag.setField(FieldKey.LYRICS, it) }
    if (artwork != null && artwork.isNotEmpty()) {
      tag.setField(
        ArtworkFactory.getNew().apply {
          binaryData = artwork
          mimeType = mimeTypeOf(artwork)
          pictureType = FRONT_COVER
        },
      )
    }
    if (tag is Mp4Tag && FragmentedMp4.isFragmented(file)) {
      val ilst = Mp4TagCreator().convertMetadata(tag)
      FragmentedMp4.writeIlst(file, ByteArray(ilst.remaining()).also(ilst::get))
    } else {
      audio.tag = tag
      AudioFileIO.write(audio)
    }
  }

  private fun mimeTypeOf(image: ByteArray): String =
    if (image.size >= 8 && image[0] == 0x89.toByte() && image[1] == 'P'.code.toByte()) "image/png" else "image/jpeg"

  private companion object {
    /** ID3/FLAC picture type 3, "Cover (front)". */
    const val FRONT_COVER = 3
  }
}
