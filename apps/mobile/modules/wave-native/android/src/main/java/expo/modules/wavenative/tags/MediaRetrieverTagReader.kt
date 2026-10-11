package expo.modules.wavenative.tags

import android.media.MediaMetadataRetriever
import java.io.File

/**
 * Fallback reader backed by Android's own media framework, for files jaudiotagger
 * can't parse (raw ADTS `.aac`, unusual containers, damaged headers).
 */
class MediaRetrieverTagReader : TagReader {
  override fun read(file: File): RawTags =
    MediaMetadataRetriever().use { retriever ->
      retriever.setDataSource(file.absolutePath)
      fun get(key: Int): String? = retriever.extractMetadata(key).cleanTag()
      RawTags(
        title = get(MediaMetadataRetriever.METADATA_KEY_TITLE),
        artist = get(MediaMetadataRetriever.METADATA_KEY_ARTIST),
        album = get(MediaMetadataRetriever.METADATA_KEY_ALBUM),
        albumArtist = get(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST),
        genre = get(MediaMetadataRetriever.METADATA_KEY_GENRE),
        year = get(MediaMetadataRetriever.METADATA_KEY_YEAR) ?: get(MediaMetadataRetriever.METADATA_KEY_DATE),
        trackNumber = get(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER),
        discNumber = get(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER),
        compilation = isTruthyFlag(get(MediaMetadataRetriever.METADATA_KEY_COMPILATION)),
        durationMs = get(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L,
        sampleRate = get(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE)?.toIntOrNull(),
        bitrateKbps = get(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull()?.div(1000),
        artwork = retriever.embeddedPicture,
      )
    }
}
