package expo.modules.wavenative.tags

import expo.modules.wavenative.lyrics.Sidecars
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.jaudiotagger.audio.AudioFile
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.audio.exceptions.CannotReadException
import org.jaudiotagger.audio.exceptions.InvalidAudioFrameException
import org.jaudiotagger.audio.mp3.MP3File
import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.Tag
import org.jaudiotagger.tag.id3.ID3v24Tag
import org.jaudiotagger.tag.wav.WavTag

/** Where found lyrics went: the file's tags, a sidecar `.lrc` beside it, or nowhere (none found). */
enum class LyricsDestination(val id: String) {
  TAGS("tags"),
  SIDECAR("sidecar"),
  NONE("none"),
}

/**
 * Where a found genre, track number or year went: the file's tags, nowhere for
 * a format without tag writing, or none (nothing found, or a track number or
 * year the file already has and keeps).
 */
enum class TagDestination(val id: String) {
  TAGS("tags"),
  NOT_WRITTEN("notWritten"),
  NONE("none"),
}

/** Where a song sits on its album and the album's year, as found: each null when not found. */
data class AlbumPlace(val trackNumber: Int? = null, val discNumber: Int? = null, val year: Int? = null)

data class TagWriteReport(
  val lyrics: LyricsDestination,
  val genre: TagDestination,
  /** The track number, with the disc. */
  val trackNumber: TagDestination = TagDestination.NONE,
  val year: TagDestination = TagDestination.NONE,
) {
  fun toMap(): Map<String, String> =
    mapOf("lyrics" to lyrics.id, "genre" to genre.id, "trackNumber" to trackNumber.id, "year" to year.id)
}

/**
 * Writes a song's lyrics and genre into its file, replacing what is there, and
 * fills in its track number, disc number and year, keeping any the file
 * already has, with jaudiotagger (MP3, FLAC, M4A, Ogg Vorbis and WAV). Only
 * those fields change: the audio and every other tag are left as they were.
 * The disc number is written only with the track number it belongs to.
 *
 * A format it can't write tags to (Opus, raw AAC) gets the lyrics in a
 * sidecar `.lrc` beside it instead, and its genre, track number and year
 * aren't written. A sidecar that is already there is replaced too, since the
 * Lyrics view would show it over the tags. With nothing to write the file
 * isn't touched at all.
 *
 * Lyrics are LRC for synced lyrics, plain text otherwise. Throws when the file
 * can't be written (it is then left as it was, or as jaudiotagger left it).
 */
class SongTagWriter {
  init {
    JAudioTaggerReader.configure()
  }

  fun write(file: File, lyrics: String?, genre: String?, place: AlbumPlace = AlbumPlace()): TagWriteReport {
    if (lyrics == null && genre == null && place.trackNumber == null && place.year == null) {
      return TagWriteReport(LyricsDestination.NONE, TagDestination.NONE)
    }
    val audio = if (takesTags(file)) readForWriting(file) else null
    if (audio == null) {
      lyrics?.let { writeSidecar(file, it, Sidecars.find(file)) }
      return TagWriteReport(
        lyrics = if (lyrics != null) LyricsDestination.SIDECAR else LyricsDestination.NONE,
        genre = notWritten(genre),
        trackNumber = notWritten(place.trackNumber),
        year = notWritten(place.year),
      )
    }
    // What the file has, as a scan reads it, is kept.
    val trackNumber = place.trackNumber?.takeUnless { audio.has(FieldKey.TRACK) }
    val discNumber = place.discNumber?.takeIf { trackNumber != null && !audio.has(FieldKey.DISC_NO) }
    val year = place.year?.takeUnless { audio.has(FieldKey.YEAR) }
    if (lyrics == null && genre == null && trackNumber == null && year == null) {
      return TagWriteReport(LyricsDestination.NONE, TagDestination.NONE)
    }
    val tag = tagToWrite(audio)
    // A WAV file's RIFF INFO chunk, when it has one, gets what it has a field for (no lyrics, no disc).
    val info = (audio.tag as? WavTag)?.takeIf { it.isExistingInfoTag }?.infoTag
    if (lyrics != null) tag.replace(FieldKey.LYRICS, lyrics)
    if (genre != null) {
      tag.replace(FieldKey.GENRE, genre)
      info?.replace(FieldKey.GENRE, genre)
    }
    trackNumber?.let {
      tag.setField(FieldKey.TRACK, it.toString())
      info?.setField(FieldKey.TRACK, it.toString())
    }
    discNumber?.let { tag.setField(FieldKey.DISC_NO, it.toString()) }
    year?.let {
      tag.setField(FieldKey.YEAR, it.toString())
      info?.setField(FieldKey.YEAR, it.toString())
    }
    AudioFileIO.write(audio)
    if (lyrics != null) Sidecars.find(file)?.let { writeSidecar(file, lyrics, it) }
    return TagWriteReport(
      lyrics = if (lyrics != null) LyricsDestination.TAGS else LyricsDestination.NONE,
      genre = writtenIf(genre),
      trackNumber = writtenIf(trackNumber),
      year = writtenIf(year),
    )
  }

  private fun notWritten(value: Any?): TagDestination =
    if (value != null) TagDestination.NOT_WRITTEN else TagDestination.NONE

  private fun writtenIf(value: Any?): TagDestination = if (value != null) TagDestination.TAGS else TagDestination.NONE

  /**
   * Whether the file has a value for [key] where a scan reads it
   * (`JAudioTaggerReader`): its tag or, for a WAV file, its ID3 or INFO chunk.
   */
  private fun AudioFile.has(key: FieldKey): Boolean {
    val tags = (tag as? WavTag)?.let { listOfNotNull(it.iD3Tag, it.infoTag) } ?: listOfNotNull(tag)
    return tags.any { runCatching { it.getFirst(key) }.getOrNull()?.isNotBlank() == true }
  }

  /** The file read for writing, or null when jaudiotagger can't parse it (a sidecar does instead). */
  private fun readForWriting(file: File): AudioFile? =
    try {
      AudioFileIO.read(file)
    } catch (e: CannotReadException) {
      null
    } catch (e: InvalidAudioFrameException) {
      null
    }

  /**
   * The tag to set the fields in, created when the file has none. An MP3's is
   * its ID3v2 tag (an ID3v1 one has no lyrics). A WAV file keeps them in an ID3
   * chunk, since its RIFF INFO chunk has no lyrics field; the genre also goes
   * into the INFO chunk when there is one, so readers of either see it.
   */
  private fun tagToWrite(audio: AudioFile): Tag {
    if (audio is MP3File) {
      if (!audio.hasID3v2Tag()) audio.setID3v2Tag(ID3v24Tag())
      return audio.iD3v2Tag
    }
    val wav = audio.tag as? WavTag
    if (wav != null) {
      if (!wav.isExistingId3Tag || wav.iD3Tag == null) wav.setID3Tag(ID3v24Tag())
      return wav.iD3Tag
    }
    return audio.tagOrCreateAndSetDefault
  }

  private fun Tag.replace(key: FieldKey, value: String) {
    deleteField(key)
    setField(key, value)
  }

  /** Writes [lyrics] into [existing], or `Song.lrc` beside [audio], as UTF-8. */
  private fun writeSidecar(audio: File, lyrics: String, existing: File?) {
    val target = existing ?: File(audio.parentFile, "${audio.nameWithoutExtension}.lrc")
    val temp = File(target.parentFile, ".${target.name}.tmp")
    temp.writeBytes(lyrics.toByteArray(Charsets.UTF_8))
    try {
      Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
    } catch (e: IOException) {
      temp.delete()
      throw e
    }
  }

  companion object {
    private val TAGGABLE = setOf("mp3", "flac", "m4a", "mp4", "wav", "ogg", "oga")

    /** Whether Wave writes [file]'s tags (Opus, even in a `.ogg`, and raw AAC get a sidecar). */
    fun takesTags(file: File): Boolean {
      val extension = file.extension.lowercase()
      if (extension !in TAGGABLE) return false
      return !(extension == "ogg" || extension == "oga") || !OggOpusReader.isOpus(file)
    }
  }
}
