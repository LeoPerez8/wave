package expo.modules.wavenative.tags

import java.io.File
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.Tag
import org.jaudiotagger.tag.images.ArtworkFactory

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
  /** The advisory tag ([Advisory]): 1 explicit, 0 checked and clean; null writes none. */
  val advisory: Int? = null,
  /**
   * A quality replacement's old file (Core's `keepTagsOf`): the new one keeps its other tags
   * ([DownloadTagWriter.KEPT_FIELDS]) and every genre value it has.
   */
  val keepTagsOf: String? = null,
) {
  companion object {
    /** From JS: `{ title, artist, album, albumArtist, year, trackNumber, genre, lyrics, advisory, keepTagsOf }`. */
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
        advisory = (map["advisory"] as? Number)?.toInt()?.takeIf { it == 0 || it == 1 },
        keepTagsOf = text("keepTagsOf"),
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

  /**
   * Returns the file's SHA-256 as written, when the write went through every byte of it (a
   * fragmented M4A, rewritten whole), else null ([FragmentedMp4.writeTag]).
   */
  fun write(file: File, tags: DownloadTags, artwork: ByteArray?): String? {
    val audio = AudioFileIO.read(file)
    val tag = audio.createDefaultTag()
    val kept = tags.keepTagsOf?.let { keptTagOf(File(it)) }
    tag.setField(FieldKey.TITLE, tags.title)
    tag.setField(FieldKey.ARTIST, tags.artist)
    tags.album?.let { tag.setField(FieldKey.ALBUM, it) }
    tags.albumArtist?.let { tag.setField(FieldKey.ALBUM_ARTIST, it) }
    tags.year?.let { tag.setField(FieldKey.YEAR, it.toString()) }
    tags.trackNumber?.let { tag.setField(FieldKey.TRACK, it.toString()) }
    tags.discNumber?.let { tag.setField(FieldKey.DISC_NO, it.toString()) }
    // The replaced file's genres when it has several: the Library knows only the first.
    val genres = kept?.values(FieldKey.GENRE)?.takeIf { it.size > 1 } ?: listOfNotNull(tags.genre)
    genres.forEachIndexed { index, genre ->
      if (index == 0) tag.setField(FieldKey.GENRE, genre) else tag.addField(FieldKey.GENRE, genre)
    }
    if (kept != null) keep(kept, tag)
    tags.lyrics?.let { tag.setField(FieldKey.LYRICS, it) }
    tags.advisory?.let { Advisory.write(tag, it) }
    if (artwork != null && artwork.isNotEmpty()) {
      tag.setField(
        ArtworkFactory.getNew().apply {
          binaryData = artwork
          mimeType = mimeTypeOf(artwork)
          pictureType = FRONT_COVER
        },
      )
    }
    audio.tag = tag
    return FragmentedMp4.writeTag(audio, file, hashed = true)
  }

  /** The tag of the file a replacement replaces; null when it's gone or can't be read. */
  private fun keptTagOf(file: File): Tag? =
    if (!file.isFile) null else runCatching { AudioFileIO.read(file).tag }.getOrNull()

  /** Every value of [key], with an ID3v2.4 frame's NUL-separated values split. */
  private fun Tag.values(key: FieldKey): List<String> =
    runCatching { getAll(key) }.getOrNull().orEmpty()
      .flatMap { it.split('\u0000') }
      .map(String::trim)
      .filter(String::isNotEmpty)

  /** Copies [from]'s [KEPT_FIELDS] into [to]; a field [to]'s format can't hold is left out. */
  private fun keep(from: Tag, to: Tag) {
    for (key in KEPT_FIELDS) {
      from.values(key).forEachIndexed { index, value ->
        runCatching { if (index == 0) to.setField(key, value) else to.addField(key, value) }
      }
    }
  }

  private fun mimeTypeOf(image: ByteArray): String =
    if (image.size >= 8 && image[0] == 0x89.toByte() && image[1] == 'P'.code.toByte()) "image/png" else "image/jpeg"

  internal companion object {
    /** ID3/FLAC picture type 3, "Cover (front)". */
    private const val FRONT_COVER = 3

    /**
     * What a quality replacement keeps of the old file besides the tags the Library has (Core's
     * `qualityReplacementTags`): the owner's and the release's own. ReplayGain, encoder and
     * gapless fields measure the old file's audio, so the new file doesn't take them.
     */
    val KEPT_FIELDS = listOf(
      FieldKey.COMPOSER, FieldKey.COMPOSER_SORT, FieldKey.LYRICIST, FieldKey.CONDUCTOR,
      FieldKey.COMMENT, FieldKey.BPM, FieldKey.GROUPING, FieldKey.MOOD, FieldKey.KEY,
      FieldKey.ISRC, FieldKey.RECORD_LABEL, FieldKey.COPYRIGHT, FieldKey.SUBTITLE,
      FieldKey.TRACK_TOTAL, FieldKey.DISC_TOTAL, FieldKey.IS_COMPILATION, FieldKey.ORIGINAL_YEAR,
      FieldKey.LANGUAGE, FieldKey.ARTIST_SORT, FieldKey.ALBUM_ARTIST_SORT, FieldKey.ALBUM_SORT,
      FieldKey.TITLE_SORT, FieldKey.MUSICBRAINZ_TRACK_ID, FieldKey.MUSICBRAINZ_RELEASEID,
      FieldKey.MUSICBRAINZ_ARTISTID, FieldKey.MUSICBRAINZ_RELEASEARTISTID,
    )
  }
}
